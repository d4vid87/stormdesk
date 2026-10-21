#include "advanced.h"
#include "core.h"
#include "discovery.h"
#include "http.h"
#include "integrations.h"
#include <QFile>
#include <QNetworkProxy>
#include <QNetworkReply>
#include <QSqlQuery>
#include <QTcpSocket>
#include <QTemporaryDir>
#include <QTimeZone>
#include <QUrlQuery>
#include <QtTest>
#include <limits>

using namespace storm;
class ScriptedServices : public Services {
public:
  using Services::Services;
  QList<QPair<QJsonDocument, QString>> replies;
  QList<QUrl> requested;
  int completed = 0;
  void request(const QUrl &url,
               std::function<void(QJsonDocument, QString)> callback,
               const QByteArray & = {}, const QByteArray & = {},
               const QByteArray & = "GET") override {
    requested << url;
    const auto reply = replies.isEmpty()
                           ? QPair<QJsonDocument, QString>{{}, "Offline"}
                           : replies.takeFirst();
    QTimer::singleShot(0, this, [this, callback, reply] {
      ++completed;
      callback(reply.first, reply.second);
    });
  }
};
static QJsonDocument forecastFixture(double temperature = 19) {
  const auto now = QDateTime::currentSecsSinceEpoch();
  const auto day = now - now % 86400;
  return QJsonDocument(QJsonObject{
      {"current",
       QJsonObject{{"temperature_2m", temperature}, {"weather_code", 0}}},
      {"utc_offset_seconds", 0},
      {"daily", QJsonObject{{"time", QJsonArray{double(day)}},
                            {"sunrise", QJsonArray{double(day + 21600)}},
                            {"sunset", QJsonArray{double(day + 64800)}}}}});
}
class CoreTest : public QObject {
  Q_OBJECT
private slots:
  void forecastRetriesAndRestoresSavedData() {
    QTemporaryDir dir;
    Config cfg(dir.filePath("config.json"));
    cfg.value = {{"settings", QJsonObject{{"lat", 32.6}, {"lon", -97.3}}}};
    Archive db(dir.filePath("db"));
    QString error;
    QVERIFY(db.open(&error));
    ScriptedServices services(cfg, db);
    services.replies = {{{}, "Offline"}, {forecastFixture(), {}}};
    services.pollForecast();
    QTRY_COMPARE(services.completed, 1);
    auto timer = services.findChild<QTimer *>("forecastRefresh");
    QVERIFY(timer && timer->isActive());
    QCOMPARE(timer->interval(), 30000);
    QVERIFY(services.forecast.isEmpty());
    QVERIFY(services.forecastStatus.contains("retrying in 30 seconds"));
    timer->start(1);
    QTRY_COMPARE(services.completed, 2);
    QCOMPARE(services.forecast.value("current")
                 .toObject()
                 .value("temperature_2m")
                 .toDouble(),
             19.0);
    QCOMPARE(timer->interval(), 900000);
    QVERIFY(!db.meta("native_forecast:32.6,-97.3").isEmpty());
    ScriptedServices resumed(cfg, db);
    resumed.pollForecast();
    QCOMPARE(resumed.forecast.value("current")
                 .toObject()
                 .value("temperature_2m")
                 .toDouble(),
             19.0);
    QTRY_COMPARE(resumed.completed, 1);
    QVERIFY(resumed.forecastStatus.contains("saved data from"));
    QCOMPARE(
        resumed.snapshot().value("forecast").toObject().value("updated_at"),
        resumed.forecast.value("_at"));
    auto retry = resumed.findChild<QTimer *>("forecastRefresh");
    for (int interval : {60000, 120000, 240000, 300000, 300000}) {
      const int next = resumed.completed + 1;
      retry->start(1);
      QTRY_COMPARE(resumed.completed, next);
      QCOMPARE(retry->interval(), interval);
    }
    resumed.replies = {{forecastFixture(21), {}}};
    retry->start(1);
    QTRY_COMPARE(resumed.forecast.value("current")
                     .toObject()
                     .value("temperature_2m")
                     .toDouble(),
                 21.0);
    QCOMPARE(retry->interval(), 900000);
    cfg.value = {{"settings", QJsonObject{{"lat", 35.3}, {"lon", -97.2}}}};
    resumed.pollForecast();
    QVERIFY(resumed.forecast.isEmpty());
    QTRY_VERIFY(resumed.forecastStatus.contains("retrying in 30 seconds"));
  }
  void forecastRejectsInvalidSavedResponses() {
    QTemporaryDir dir;
    Config cfg(dir.filePath("config.json"));
    cfg.value = {{"settings", QJsonObject{{"lat", 32.6}, {"lon", -97.3}}}};
    Archive db(dir.filePath("db"));
    QString error;
    QVERIFY(db.open(&error));
    auto cached = forecastFixture().object();
    cached["_location"] = "32.6,-97.3";
    const auto now = QDateTime::currentSecsSinceEpoch();
    for (qint64 at : {now - 86401, now + 3600}) {
      cached["_at"] = double(at);
      QVERIFY(db.setMeta("native_forecast:32.6,-97.3",
                         QString::fromUtf8(QJsonDocument(cached).toJson())));
      ScriptedServices services(cfg, db);
      services.pollForecast();
      QVERIFY(services.forecast.isEmpty());
      QTRY_COMPARE(services.completed, 1);
    }
    cached["_at"] = double(now);
    cached["_location"] = "40,-105";
    QVERIFY(db.setMeta("native_forecast:32.6,-97.3",
                       QString::fromUtf8(QJsonDocument(cached).toJson())));
    ScriptedServices services(cfg, db);
    services.replies = {
        {QJsonDocument(QJsonObject{{"current", QJsonObject()}}), {}}};
    services.pollForecast();
    QVERIFY(services.forecast.isEmpty());
    QTRY_COMPARE(services.completed, 1);
    QVERIFY(services.forecastStatus.contains("Forecast unavailable"));
  }
  void tempestCloudRecoversAndRestarts() {
    QTemporaryDir dir;
    const auto configPath = dir.filePath("config.json");
    const auto dbPath = dir.filePath("db");
    const auto now = QDateTime::currentSecsSinceEpoch();
    auto observation = [](qint64 at, double temperature) {
      Reading reading{};
      reading[0] = double(at);
      reading[7] = temperature;
      return QJsonDocument(QJsonObject{{"obs", QJsonArray{toJson(reading)}}});
    };
    QString error;
    {
      Config cfg(configPath);
      QVERIFY(cfg.save(
          {{"settings", QJsonObject{{"stationSource", "tempest"},
                                    {"stationId", "123"},
                                    {"deviceId", "456"},
                                    {"token", "fixture-token"},
                                    {"nativeTempestConnection", "cloud"}}}},
          &error));
      Archive db(dbPath);
      QVERIFY(db.open(&error));
      QVERIFY(db.setMeta("backfill_done", "1"));
      ScriptedServices services(cfg, db);
      services.replies = {{observation(now - 120, 20), {}},
                          {{}, "Offline"},
                          {observation(now - 60, 21), {}}};
      QVERIFY(services.start(&error, false));
      QTRY_COMPARE(services.completed, 1);
      QCOMPARE(*services.observation[7], 20.0);
      auto timer = services.findChild<QTimer *>("stationRefresh");
      QVERIFY(timer && timer->isActive());
      QCOMPARE(timer->interval(), 10000);
      QVERIFY(QMetaObject::invokeMethod(timer, "timeout"));
      QTRY_COMPARE(services.completed, 2);
      QVERIFY(services.stationStatus.contains("Offline"));
      QCOMPARE(*services.observation[7], 20.0);
      QVERIFY(QMetaObject::invokeMethod(timer, "timeout"));
      QTRY_COMPARE(services.completed, 3);
      QCOMPARE(*services.observation[7], 21.0);
      QVERIFY(services.stationStatus.startsWith("Live"));
      QCOMPARE(services.requested.last().path(),
               QString("/swd/rest/observations/device/456"));
      QCOMPARE(db.health().value("rows").toInt(), 2);
    }
    {
      Config cfg(configPath);
      QVERIFY(cfg.load(&error));
      Archive db(dbPath);
      QVERIFY(db.open(&error));
      ScriptedServices resumed(cfg, db);
      resumed.replies = {{observation(now, 22), {}}};
      QVERIFY(resumed.start(&error, false));
      QCOMPARE(*resumed.observation[7], 21.0);
      QTRY_COMPARE(resumed.completed, 1);
      QCOMPARE(*resumed.observation[7], 22.0);
      QCOMPARE(db.health().value("rows").toInt(), 3);
    }
  }
  void hookEchoFollowsSelectedPlace() {
    QTemporaryDir dir;
    Config cfg(dir.filePath("config.json"));
    Archive db(dir.filePath("db"));
    Services services(cfg, db);
    QCOMPARE(services.radarUrl().toString(),
             QString("https://app.hookecho.io/?embed"));
    cfg.value = {
        {"settings",
         QJsonObject{{"lat", 32.6}, {"lon", -97.3}, {"radarSite", "kfws"}}}};
    QCOMPARE(services.radarUrl().fragment(),
             QString("goto=KFWS,-97.3,32.6,7,bm:dark"));
    auto s = cfg.settings();
    s["activePlace"] = "trip";
    s["places"] =
        QJsonArray{QJsonObject{{"id", "trip"}, {"lat", 35.3}, {"lon", -97.2}}};
    cfg.value["settings"] = s;
    QCOMPARE(services.radarUrl().fragment(),
             QString("goto=KTLX,-97.2,35.3,7,bm:dark"));
    s.remove("activePlace");
    s["radarSite"] = "KFWS,1,2,3";
    cfg.value["settings"] = s;
    QCOMPARE(services.radarUrl().fragment(),
             QString("goto=KFWS,-97.3,32.6,7,bm:dark"));
    s["lat"] = 100;
    cfg.value["settings"] = s;
    QVERIFY(services.radarUrl().fragment().isEmpty());
  }
  void nexradExcludesAirportRadars() {
    QJsonObject location{{"lat", 33.0649986}, {"lon", -96.9179993}};
    QCOMPARE(nexradSite(location), QString("KFWS"));
    location["radarSite"] = "TDFW";
    QCOMPARE(nexradSite(location), QString("KFWS"));
    location["radarSite"] = "KDFW";
    QCOMPARE(nexradSite(location), QString("KFWS"));
    location = {{"lat", 18.47}, {"lon", -66.18}, {"radarSite", "TSJU"}};
    QCOMPARE(nexradSite(location), QString("TJUA"));
    location = {{"lat", 60.7919}, {"lon", -161.8764}};
    QCOMPARE(nexradSite(location), QString("PABC"));
    location["lat"] = std::numeric_limits<double>::infinity();
    QVERIFY(nexradSite(location).isEmpty());
  }
  void tempestMetadataSetsStationLocation() {
    QJsonObject station{
        {"station_id", 12345},
        {"name", "My Tempest"},
        {"latitude", 33.065},
        {"longitude", -96.918},
        {"station_meta", QJsonObject{{"elevation", 180}}},
        {"devices",
         QJsonArray{QJsonObject{{"device_type", "HB"}, {"device_id", 7}},
                    QJsonObject{{"device_type", "AR"}, {"device_id", 8}},
                    QJsonObject{{"device_type", "ST"},
                                {"device_id", 98765},
                                {"serial_number", "ST-TEST"}}}}};
    QString error;
    const auto settings = tempestStationSettings(station, &error);
    QVERIFY2(!settings.isEmpty(), qPrintable(error));
    QCOMPARE(settings.value("stationId").toString(), QString("12345"));
    QCOMPARE(settings.value("deviceId").toString(), QString("98765"));
    QCOMPARE(settings.value("nativeTempestConnection").toString(),
             QString("cloud"));
    QCOMPARE(settings.value("lat").toDouble(), 33.065);
    QCOMPARE(settings.value("lon").toDouble(), -96.918);
    QCOMPARE(settings.value("radarSite").toString(), QString("KFWS"));
    QCOMPARE(settings.value("elevationM").toDouble(), 180.0);
    QVERIFY(settings.value("activePlace").toString().isEmpty());
    QVERIFY(!settings.contains("token"));
    auto broken = station;
    broken.remove("latitude");
    QVERIFY(tempestStationSettings(broken, &error).isEmpty());
    QVERIFY(!error.isEmpty());
    broken = station;
    broken["longitude"] = 181;
    QVERIFY(tempestStationSettings(broken, &error).isEmpty());
    broken = station;
    broken["station_id"] = "../invalid";
    QVERIFY(tempestStationSettings(broken, &error).isEmpty());
    broken = station;
    broken["devices"] =
        QJsonArray{QJsonObject{{"device_type", "AR"}, {"device_id", 8}}};
    QVERIFY(tempestStationSettings(broken, &error).isEmpty());
    broken = station;
    broken.remove("station_meta");
    QVERIFY(
        tempestStationSettings(broken, &error).value("elevationM").isNull());
    broken["name"] = "";
    broken["public_name"] = "Public station";
    QCOMPARE(
        tempestStationSettings(broken, &error).value("stationName").toString(),
        QString("Public station"));
  }
  void warningsFollowLocationDuringPendingRequest() {
    QTemporaryDir dir;
    Config cfg(dir.filePath("config.json"));
    cfg.value = {{"settings", QJsonObject{{"lat", 40.0}, {"lon", -105.0}}}};
    Archive db(dir.filePath("db"));
    QString error;
    QVERIFY(db.open(&error));
    Services services(cfg, db);
    services.network.setProxy(
        QNetworkProxy(QNetworkProxy::HttpProxy, "127.0.0.1", 1));
    QStringList requested;
    connect(&services.network, &QNetworkAccessManager::finished, this,
            [&requested](QNetworkReply *reply) {
              requested << QUrlQuery(reply->url()).queryItemValue("point");
            });
    services.pollWarnings();
    services.warnings = QJsonArray{QJsonObject{{"id", "old-location-warning"}}};
    cfg.value = {{"settings", QJsonObject{{"lat", 33.065}, {"lon", -96.918}}}};
    services.pollWarnings();
    QVERIFY(services.warnings.isEmpty());
    QVERIFY(services.warningStatus.contains("Checking"));
    QTRY_VERIFY(requested.contains("33.0650,-96.9180"));
    QVERIFY(services.warningStatus.contains("unavailable"));
  }
  void nativeCloudConnectionIgnoresUdp() {
    QTemporaryDir dir;
    Config cfg(dir.filePath("config.json"));
    cfg.value = {
        {"settings", QJsonObject{{"stationSource", "tempest"},
                                 {"stationId", "test"},
                                 {"tempestSerial", "ST-TEST"},
                                 {"nativeTempestConnection", "cloud"}}}};
    Archive db(dir.filePath("db"));
    QString error;
    QVERIFY(db.open(&error));
    Services services(cfg, db);
    Reading reading{};
    reading[0] = double(QDateTime::currentSecsSinceEpoch());
    reading[7] = 20;
    auto packet = QJsonObject{{"type", "obs_st"},
                              {"serial_number", "ST-TEST"},
                              {"obs", QJsonArray{QJsonValue(toJson(reading))}}};
    services.receivePacket(packet);
    QCOMPARE(db.health().value("rows").toInt(), 0);
    QVERIFY(!services.observation[0]);
    auto settings = cfg.settings();
    settings["nativeTempestConnection"] = "local";
    cfg.value["settings"] = settings;
    services.receivePacket(packet);
    QCOMPARE(db.health().value("rows").toInt(), 1);
  }
  void discoveryPacketsAreBounded() {
    auto packet =
        serviceAnnouncement("stormdesk-test.local", "192.168.1.2", 8088);
    auto records = decodeDns(packet);
    QCOMPARE(records.size(), 5);
    QCOMPARE(records.last().toObject().value("address").toString(),
             QString("192.168.1.2"));
    QCOMPARE(records[2].toObject().value("port").toInt(), 8088);
    for (int length = 0; length < packet.size(); ++length)
      QVERIFY(decodeDns(packet.left(length)).isEmpty());
    QByteArray cyclic(12, 0);
    cyclic[5] = 1;
    cyclic.append(char(0xc0));
    cyclic.append(char(12));
    cyclic.append(QByteArray(4, 0));
    QVERIFY(decodeDns(cyclic).isEmpty());
    QVERIFY(serviceAnnouncement("test.local", "::1", 8088).isEmpty());
  }
  void legacyImportIsIdempotentAndKeepsSource() {
    QTemporaryDir dir;
    QString error;
    Archive db(dir.filePath("db"));
    QVERIFY(db.open(&error));
    QFile source(dir.filePath("2020.jsonl"));
    QVERIFY(source.open(QIODevice::WriteOnly));
    source.write("[1600000000,null,null,null,null,null,1000,20,50]\ninvalid\n");
    source.close();
    QCOMPARE(db.importJsonl(dir.path(), "tempest:test", &error), 1);
    QCOMPARE(db.importJsonl(dir.path(), "tempest:test", &error), 0);
    QCOMPARE(db.latest()[7].value(), 20.0);
    QVERIFY(source.exists());
    QCOMPARE(db.importJsonl(dir.path(), "tempest:other", &error), -1);
    QVERIFY(db.clear("tempest:other", &error));
    QCOMPARE(db.health().value("rows").toInt(), 0);
    QCOMPARE(db.meta("station_fingerprint"), QString("tempest:other"));
  }
  void advancedToolsPreserveMeaningAndTracking() {
    QVERIFY(std::abs(dewPoint(20, 50).value() - 9.26) < .05);
    QVERIFY(std::abs(wetBulb(20, 50).value() - 13.7) < .2);
    QVERIFY(!dewPoint(20, 0));
    QVERIFY(!wetBulb(20, 101));
    auto equinox = QDateTime::fromString("2026-03-20T12:00:00Z", Qt::ISODate)
                       .toSecsSinceEpoch();
    QVERIFY(solarAltitude(equinox, 0, 0) > 85);
    QVERIFY(solarAltitude(equinox + 43200, 0, 0) < -85);
    auto newMoon = QDateTime::fromString("2000-01-06T18:14:00Z", Qt::ISODate)
                       .toSecsSinceEpoch();
    QCOMPARE(moonPhase(newMoon).value("phase").toString(), QString("New"));
    QVERIFY(moonPhase(newMoon).value("illumination").toDouble() < .01);
    auto ring =
        QJsonArray{QJsonArray{0, 0}, QJsonArray{10, 0}, QJsonArray{10, 10},
                   QJsonArray{0, 10}, QJsonArray{0, 0}};
    auto hole = QJsonArray{QJsonArray{2, 2}, QJsonArray{8, 2}, QJsonArray{8, 8},
                           QJsonArray{2, 8}, QJsonArray{2, 2}};
    QJsonObject geometry{{"type", "Polygon"},
                         {"coordinates", QJsonArray{ring, hole}}};
    QVERIFY(pointInGeometry(1, 1, geometry));
    QVERIFY(!pointInGeometry(5, 5, geometry));
    QVERIFY(!pointInGeometry(15, 5, geometry));
    auto drought = newestDrought(
        QJsonArray{QJsonObject{{"mapDate", "1/2/2026"}, {"d1", 50}},
                   QJsonObject{{"mapDate", "12/30/2025"}, {"d1", 80}},
                   QJsonObject{{"mapDate", "invalid"}, {"d1", 100}}});
    QCOMPARE(drought.value("d1").toInt(), 50);
    const auto at = QDateTime::currentSecsSinceEpoch();
    QJsonObject hourly{
        {"time",
         QJsonArray{double(at + 3600), double(at + 7200), double(at + 10800)}},
        {"temperature_2m", QJsonArray{-2, -1, QJsonValue()}},
        {"relative_humidity_2m", QJsonArray{80, 85, QJsonValue()}},
        {"precipitation_probability", QJsonArray{60, 70, 0}},
        {"weather_code", QJsonArray{71, 71, 0}}};
    auto events = weatherTimeline({{"hourly", hourly}}, {}, {}, {}, {}, {}, at);
    QCOMPARE(
        events.size(),
        3); // Consecutive rain, freeze and winter windows merge separately.
    auto onlyRain = weatherTimeline({{"hourly", hourly}}, {}, {}, {}, {},
                                    {{"categories", QJsonArray{"precip"}}}, at);
    QCOMPARE(onlyRain.size(), 1);
    QCOMPARE(onlyRain[0].toObject().value("end").toDouble(),
             double(at + 10800));
    QJsonObject models{
        {"hourly", QJsonObject{{"time", QJsonArray{double(at)}},
                               {"precipitation_gfs", QJsonArray{0}},
                               {"precipitation_ecmwf", QJsonArray{1}}}}};
    QCOMPARE(modelConfidence(
                 models, {{"kind", "precip"}, {"start", double(at)}}, at, at)
                 .value("level")
                 .toString(),
             QString("Low"));
    QTemporaryDir dir;
    Config cfg(dir.filePath("config.json"));
    QString error;
    QVERIFY(cfg.load(&error));
    cfg.value = {{"settings", QJsonObject{{"lat", 30}, {"lon", -97}}}};
    Archive db(dir.filePath("db"));
    QVERIFY(db.open(&error));
    Services services(cfg, db);
    Advanced tools(services);
    services.forecast = {
        {"daily", QJsonObject()},
        {"hourly", QJsonObject{{"time", QJsonArray{double(at + 90000)}},
                               {"temperature_2m", QJsonArray{20}}}}};
    tools.recordForecast();
    tools.recordForecast();
    QCOMPARE(tools.snapshots().size(), 1);
    QCOMPARE(tools.verification().size(), 1);
    services.observation[0] = double(at + 90000);
    services.observation[7] = 22;
    tools.recordForecast();
    QCOMPARE(tools.verification()[0].toObject().value("observed").toDouble(),
             22.0);
    cfg.value["settings"] = QJsonObject{{"lat", 31}, {"lon", -98}};
    QCOMPARE(tools.verification().size(), 0);
  }
  void conversionsAndCounters() {
    Counters m;
    auto f = collectFields(
        "tempf=68&windspeedmph=10&baromin=30&dailyrainin=1&lightning_num=5",
        {});
    auto r = normalize(f, 1800000000, m);
    QCOMPARE(*r[7], 20.0);
    QVERIFY(std::abs(*r[2] - 4.4704) < .00001);
    QVERIFY(std::abs(*r[6] - 1015.917) < .001);
    QCOMPARE(*r[12], 0.0);
    QCOMPARE(*r[15], 0.0);
    f["dailyrainin"] = 1.5;
    f["lightning_num"] = 7;
    r = normalize(f, 1800000060, m);
    QVERIFY(std::abs(*r[12] - 12.7) < .00001);
    QCOMPARE(*r[15], 2.0);
    f["dailyrainin"] = .1;
    r = normalize(f, 1800000120, m);
    QVERIFY(std::abs(*r[12] - 2.54) < .00001);
    QVERIFY(
        !normalize(collectFields({}, "{\"tempf\":\"NaN\"}"), 1800000180, m)[7]);
    QCOMPARE(collectFields("note=A%2BB+C", {}).value("note").toString(),
             QString("A+B C"));
  }
  void configPreservesUnknownFieldsAndSecrets() {
    QTemporaryDir dir;
    Config cfg(dir.filePath("config.json"));
    QString error;
    QVERIFY(cfg.load(&error));
    cfg.value = {{"settings", QJsonObject{{"token", "secret"},
                                          {"fontScale", 1.25},
                                          {"units", "metric"}}},
                 {"_access", QJsonObject{{"adminHash", "private"}}},
                 {"future", 12}};
    QCOMPARE(cfg.merge({{"_rev", 0},
                        {"settings", QJsonObject{{"stationName", "Home"}}}},
                       &error),
             200);
    QCOMPARE(cfg.stationSource(), QString("tempest"));
    QCOMPARE(cfg.windUnit(), QString("km/h"));
    QCOMPARE(cfg.windFactor(), 3.6);
    QCOMPARE(cfg.text("token"), QString("secret"));
    QCOMPARE(cfg.value.value("future").toInt(), 12);
    QCOMPARE(
        cfg.merge({{"_rev", 0}, {"settings", QJsonObject{{"token", "wrong"}}}},
                  &error),
        409);
    auto publicConfig = QJsonDocument(cfg.publicValue()).toJson();
    QVERIFY(!publicConfig.contains("secret"));
    QVERIFY(!publicConfig.contains("private"));
    QFile broken(cfg.path);
    QVERIFY(broken.open(QIODevice::WriteOnly));
    broken.write("not JSON");
    broken.close();
    QVERIFY(!cfg.load(&error));
    QVERIFY(broken.open(QIODevice::ReadOnly));
    QCOMPARE(broken.readAll(), QByteArray("not JSON"));
  }
  void archiveCompatibilityBackupRestore() {
    QTemporaryDir dir;
    Archive db(dir.filePath("stormdesk.db"));
    QString error;
    QVERIFY2(db.open(&error), qPrintable(error));
    Reading r{};
    r[0] = 1800000000;
    r[7] = 20;
    r[12] = .5;
    r[18] = 1.5;
    QVERIFY(db.insert(r, 3, "ecowitt:home", &error));
    QVERIFY(db.insert(r, 3, "ecowitt:home", &error));
    QCOMPARE(db.health().value("rows").toInt(), 1);
    QVERIFY(!db.insert(r, 3, "ecowitt:other", &error));
    auto tuples = db.tuples(1799999990, 1800000010);
    QCOMPARE(tuples.size(), 1);
    QCOMPARE(tuples[0].toArray().size(), 19);
    QVERIFY(tuples[0].toArray()[8].isNull());
    QJsonObject cfg{{"settings", QJsonObject{{"stationName", "Home"},
                                             {"token", "private"}}}};
    QString backup = dir.filePath("snapshot.wdbak");
    QVERIFY2(db.backup(backup, cfg, &error), qPrintable(error));
    QJsonObject restored;
    QVERIFY(!Archive::inspect(backup, &restored, &error).isEmpty());
    QCOMPARE(restored, cfg);
    *r[0] += 60;
    *r[7] = 22;
    QVERIFY(db.insert(r, 3, "ecowitt:home", &error));
    QCOMPARE(db.health().value("rows").toInt(), 2);
    QVERIFY2(db.restore(backup, &error), qPrintable(error));
    QCOMPARE(db.health().value("rows").toInt(), 1);
    QCOMPARE(db.meta("station_fingerprint"), QString("ecowitt:home"));
    QVERIFY(db.exportCsv(dir.filePath("history.csv"), &error));
    QFile csv(dir.filePath("history.csv"));
    QVERIFY(csv.open(QIODevice::ReadOnly));
    QVERIFY(csv.readAll().startsWith("time,wind_lull,wind_avg"));
    QVERIFY(!db.backup(backup, cfg, &error));
  }
  void dailyBoundaryAndNulls() {
    QTemporaryDir dir;
    Archive db(dir.filePath("db"));
    QString error;
    QVERIFY(db.open(&error));
    Reading r{};
    r[0] = QDateTime(QDate(2026, 10, 20), QTime(2, 0), QTimeZone("UTC"))
               .toSecsSinceEpoch();
    r[7] = 18;
    QVERIFY(db.insert(r, 0, "tempest:1", &error));
    auto utc = db.daily(0)[0].toObject(),
         central = db.daily(-300)[0].toObject();
    QCOMPARE(utc.value("day").toString(), QString("2026-10-20"));
    QCOMPARE(central.value("day").toString(), QString("2026-10-19"));
    QVERIFY(utc.value("rain").isNull());
  }
  void requestLimits() {
    HttpRequest req;
    qsizetype used = 0;
    QCOMPARE(
        HttpRequest::parse("GET /health HTTP/1.1\r\nHost: localhost\r\n\r\n",
                           &req, &used),
        200);
    QCOMPARE(
        HttpRequest::parse(
            "POST /ingest HTTP/1.1\r\nHost: x\r\nContent-Length: 5\r\n\r\na",
            &req, &used),
        0);
    QCOMPARE(HttpRequest::parse("PUT /config HTTP/1.1\r\nHost: "
                                "x\r\nContent-Length: 99999999\r\n\r\n",
                                &req, &used),
             413);
    QCOMPARE(
        HttpRequest::parse(
            "POST /ingest HTTP/1.1\r\nHost: x\r\nContent-Length: -1\r\n\r\n",
            &req, &used),
        400);
    QCOMPARE(HttpRequest::parse("POST / HTTP/1.1\r\nHost: x\r\nContent-Length: "
                                "0\r\nContent-Length: 1\r\n\r\n",
                                &req, &used),
             400);
    QCOMPARE(
        HttpRequest::parse(
            "GET / HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n",
            &req, &used),
        501);
    QCOMPARE(HttpRequest::parse(QByteArray(17000, 'x'), &req, &used), 431);
  }
  void httpAccessAndIngest() {
    QTemporaryDir dir;
    Config cfg(dir.filePath("config.json"));
    QString error;
    QVERIFY(cfg.load(&error));
    cfg.value = {{"settings", QJsonObject{{"stationSource", "ecowitt"},
                                          {"stationId", "test"},
                                          {"ingestKey", "topsecret"},
                                          {"token", "private"}}}};
    Archive db(dir.filePath("db"));
    QVERIFY(db.open(&error));
    Services s(cfg, db);
    HttpServer server(s);
    QVERIFY(server.start(0, QHostAddress::LocalHost, &error));
    auto get = [&](const QString &path, const QByteArray &origin = {}) {
      QNetworkRequest req(QUrl(
          "http://127.0.0.1:" + QString::number(server.serverPort()) + path));
      if (!origin.isEmpty())
        req.setRawHeader("Origin", origin);
      auto reply = s.network.get(req);
      QSignalSpy spy(reply, &QNetworkReply::finished);
      if (!spy.wait(5000))
        return QPair<int, QByteArray>{0, {}};
      auto result = qMakePair(
          reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt(),
          reply->readAll());
      reply->deleteLater();
      return result;
    };
    QCOMPARE(get("/").first, 200);
    QVERIFY(get("/").second.contains("__WD_VER"));
    QCOMPARE(get("/js/app.js").first, 200);
    QCOMPARE(get("/config").first, 200);
    QCOMPARE(get("/config", "https://attacker.example").first, 401);
    auto publicCfg = get("/config-public");
    QCOMPARE(publicCfg.first, 200);
    QVERIFY(!publicCfg.second.contains("topsecret"));
    QVERIFY(!publicCfg.second.contains("private"));
    QCOMPARE(get("/ingest?tempf=72&key=wrong").first, 401);
    QCOMPARE(get("/ingest?tempf=72&humidity=50&key=topsecret").first, 200);
    QCOMPARE(db.health().value("rows").toInt(), 1);
    auto api = QJsonDocument::fromJson(get("/api/v1").second).object();
    QCOMPARE(api.value("api").toInt(), 1);
    QVERIFY(api.value("current").toObject().value("temp").isDouble());
    QVERIFY(!QJsonDocument(api).toJson().contains("topsecret"));
  }
  void pressureTrendUsesThreeHourBands() {
    QTemporaryDir dir;
    Archive db(dir.filePath("db"));
    QString error;
    QVERIFY(db.open(&error));
    Reading r{};
    r[0] = 1800000000;
    r[6] = 1010;
    QVERIFY(db.insert(r, 0, "tempest:test", &error));
    *r[0] += 10800;
    r[6] = 1012;
    QVERIFY(db.insert(r, 0, "tempest:test", &error));
    QCOMPARE(db.current().value("pressure_trend").toString(),
             QString("rising rapidly"));
    *r[0] += 60;
    r[6] = 1009.4;
    QVERIFY(db.insert(r, 0, "tempest:test", &error));
    QCOMPARE(db.current().value("pressure_trend").toString(),
             QString("falling"));
    *r[0] += 60;
    r[6] = 1010.2;
    QVERIFY(db.insert(r, 0, "tempest:test", &error));
    QCOMPARE(db.current().value("pressure_trend").toString(),
             QString("steady"));
  }
  void documentCopyPreservesDestinationOnFailure() {
    QTemporaryDir dir;
    QFile input(dir.filePath("source"));
    QVERIFY(input.open(QIODevice::WriteOnly));
    const QByteArray bytes(200000, 'x');
    QCOMPARE(input.write(bytes), qint64(bytes.size()));
    input.close();
    QString error;
    const auto dest = dir.filePath("destination");
    QVERIFY(copyDocument(input.fileName(), dest, &error));
    QVERIFY(!copyDocument(dir.filePath("missing"), dest, &error));
    QFile output(dest);
    QVERIFY(output.open(QIODevice::ReadOnly));
    QCOMPARE(output.readAll(), bytes);
  }
  void tomorrowRulesRequireFreshHomeForecast() {
    QTemporaryDir dir;
    Config cfg(dir.filePath("config.json"));
    QString error;
    QVERIFY(cfg.load(&error));
    cfg.value = {
        {"settings",
         QJsonObject{{"units", "metric"},
                     {"activePlace", "away"},
                     {"rules", QJsonArray{QJsonObject{{"metric", "hiTomorrow"},
                                                      {"op", ">"},
                                                      {"value", 40}}}}}}};
    Archive db(dir.filePath("db"));
    QVERIFY(db.open(&error));
    Services services(cfg, db);
    QSignalSpy alerts(&services, &Services::notification);
    const auto now = QDateTime::currentSecsSinceEpoch();
    services.observation[0] = double(now);
    services.observation[7] = 20;
    services.forecast = {
        {"_at", double(now)},
        {"daily", QJsonObject{{"temperature_2m_max", QJsonArray{20, 50}}}}};
    services.checkRules();
    QCOMPARE(alerts.size(), 0);
    auto settings = cfg.settings();
    settings["activePlace"] = "";
    cfg.value["settings"] = settings;
    services.observation[0] = double(now + 1);
    services.forecast["_at"] = double(now - 7200);
    services.checkRules();
    QCOMPARE(alerts.size(), 0);
    services.observation[0] = double(now + 2);
    services.forecast["_at"] = double(now);
    services.checkRules();
    QCOMPARE(alerts.size(), 1);
  }
  void rulesLatchAndRearm() {
    QTemporaryDir dir;
    Config cfg(dir.filePath("config.json"));
    QString error;
    QVERIFY(cfg.load(&error));
    cfg.value = {
        {"settings",
         QJsonObject{
             {"stationSource", "ecowitt"},
             {"stationId", "test"},
             {"units", "metric"},
             {"rules", QJsonArray{QJsonObject{
                           {"metric", "temp"}, {"op", ">"}, {"value", 25}}}}}}};
    Archive db(dir.filePath("db"));
    QVERIFY(db.open(&error));
    Services service(cfg, db);
    QSignalSpy notifications(&service, &Services::notification);
    service.observation[0] = QDateTime::currentSecsSinceEpoch();
    service.observation[7] = 30;
    service.checkRules();
    QCOMPARE(notifications.size(), 1);
    service.checkRules();
    QCOMPARE(notifications.size(), 1);
    service.observation[7] = 20;
    service.checkRules();
    service.observation[7] = 30;
    service.checkRules();
    QCOMPARE(notifications.size(), 2);
    auto settings = cfg.settings();
    settings["rules"] =
        QJsonArray{QJsonObject{{"metric", "temp"}, {"op", "<"}, {"value", -5}}};
    cfg.value["settings"] = settings;
    service.observation[7] = -6;
    service.checkRules();
    QCOMPARE(notifications.size(), 3);
    service.observation[7] = -5.2;
    service.checkRules();
    QCOMPARE(notifications.size(), 3);
    service.observation[7] = -4;
    service.checkRules();
    service.observation[7] = -6;
    service.checkRules();
    QCOMPARE(notifications.size(), 4);
    service.observation[0] = QDateTime::currentSecsSinceEpoch() - 1000;
    service.checkRules();
    QCOMPARE(notifications.size(), 4);
  }
  void wbgtAndReporting() {
    QVERIFY(!wbgt(20, 0, 500, 1));
    auto sun = wbgt(35, 50, 800, 1);
    QVERIFY(sun.has_value());
    QVERIFY(*wbgt(35, 50, 0, 1) < *sun);
    QVERIFY(*wbgt(35, 50, 800, 8) < *sun);
    Reading r{};
    r[0] = 1800000000;
    r[7] = -20;
    r[8] = 100;
    auto line = cwopPacket("DW1234", 32.5, -97.25, r, 0, 0);
    QVERIFY(line.contains("3230.00N/09715.00W"));
    QVERIFY(line.contains("t-04"));
    QVERIFY(line.contains("h00"));
    QVERIFY(line.contains("_.../...g..."));
    QVERIFY(cwopPacket("invalid\\r\\n", 32.5, -97.25, r, 0, 0).isEmpty());
  }
  void scaleBounds() {
    QCOMPARE(uiScale(.2), .7);
    QCOMPARE(uiScale(3), 2.0);
    QCOMPARE(uiScale(1.5), 1.5);
    QCOMPARE(uiScale(std::numeric_limits<double>::quiet_NaN()), 1.0);
  }
};
QTEST_GUILESS_MAIN(CoreTest)
#include "tests.moc"
