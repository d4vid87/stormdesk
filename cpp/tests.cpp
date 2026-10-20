#include "core.h"
#include "http.h"
#include "integrations.h"
#include <QtTest>
#include <QTemporaryDir>
#include <QFile>
#include <QSqlQuery>
#include <QTcpSocket>
#include <QNetworkReply>
#include <QTimeZone>
#include <limits>

using namespace storm;
class CoreTest : public QObject {
    Q_OBJECT
private slots:
    void conversionsAndCounters() {
        Counters m;
        auto f = collectFields("tempf=68&windspeedmph=10&baromin=30&dailyrainin=1&lightning_num=5", {});
        auto r = normalize(f, 1800000000, m);
        QCOMPARE(*r[7], 20.0); QVERIFY(std::abs(*r[2] - 4.4704) < .00001); QVERIFY(std::abs(*r[6] - 1015.917) < .001);
        QCOMPARE(*r[12], 0.0); QCOMPARE(*r[15], 0.0);
        f["dailyrainin"] = 1.5; f["lightning_num"] = 7;
        r = normalize(f, 1800000060, m); QVERIFY(std::abs(*r[12] - 12.7) < .00001); QCOMPARE(*r[15], 2.0);
        f["dailyrainin"] = .1; r = normalize(f, 1800000120, m); QVERIFY(std::abs(*r[12] - 2.54) < .00001);
        QVERIFY(!normalize(collectFields({}, "{\"tempf\":\"NaN\"}"), 1800000180, m)[7]);
        QCOMPARE(collectFields("note=A%2BB+C", {}).value("note").toString(), QString("A+B C"));
    }
    void configPreservesUnknownFieldsAndSecrets() {
        QTemporaryDir dir; Config cfg(dir.filePath("config.json")); QString error;
        QVERIFY(cfg.load(&error)); cfg.value = {{"settings", QJsonObject{{"token", "secret"}, {"fontScale", 1.25}, {"units", "metric"}}}, {"_access", QJsonObject{{"adminHash", "private"}}}, {"future", 12}};
        QCOMPARE(cfg.merge({{"_rev", 0}, {"settings", QJsonObject{{"stationName", "Home"}}}}, &error), 200);
        QCOMPARE(cfg.stationSource(), QString("tempest"));
        QCOMPARE(cfg.windUnit(), QString("km/h")); QCOMPARE(cfg.windFactor(), 3.6);
        QCOMPARE(cfg.text("token"), QString("secret")); QCOMPARE(cfg.value.value("future").toInt(), 12);
        QCOMPARE(cfg.merge({{"_rev", 0}, {"settings", QJsonObject{{"token", "wrong"}}}}, &error), 409);
        auto publicConfig = QJsonDocument(cfg.publicValue()).toJson(); QVERIFY(!publicConfig.contains("secret")); QVERIFY(!publicConfig.contains("private"));
        QFile broken(cfg.path); QVERIFY(broken.open(QIODevice::WriteOnly)); broken.write("not JSON"); broken.close(); QVERIFY(!cfg.load(&error));
        QVERIFY(broken.open(QIODevice::ReadOnly)); QCOMPARE(broken.readAll(), QByteArray("not JSON"));
    }
    void archiveCompatibilityBackupRestore() {
        QTemporaryDir dir; Archive db(dir.filePath("stormdesk.db")); QString error; QVERIFY2(db.open(&error), qPrintable(error));
        Reading r{}; r[0] = 1800000000; r[7] = 20; r[12] = .5; r[18] = 1.5;
        QVERIFY(db.insert(r, 3, "ecowitt:home", &error)); QVERIFY(db.insert(r, 3, "ecowitt:home", &error));
        QCOMPARE(db.health().value("rows").toInt(), 1); QVERIFY(!db.insert(r, 3, "ecowitt:other", &error));
        auto tuples = db.tuples(1799999990, 1800000010); QCOMPARE(tuples.size(), 1); QCOMPARE(tuples[0].toArray().size(), 19); QVERIFY(tuples[0].toArray()[8].isNull());
        QJsonObject cfg{{"settings", QJsonObject{{"stationName", "Home"}, {"token", "private"}}}};
        QString backup = dir.filePath("snapshot.wdbak"); QVERIFY2(db.backup(backup, cfg, &error), qPrintable(error));
        QJsonObject restored; QVERIFY(!Archive::inspect(backup, &restored, &error).isEmpty()); QCOMPARE(restored, cfg);
        *r[0] += 60; *r[7] = 22; QVERIFY(db.insert(r, 3, "ecowitt:home", &error)); QCOMPARE(db.health().value("rows").toInt(), 2);
        QVERIFY2(db.restore(backup, &error), qPrintable(error)); QCOMPARE(db.health().value("rows").toInt(), 1);
        QCOMPARE(db.meta("station_fingerprint"), QString("ecowitt:home"));
        QVERIFY(db.exportCsv(dir.filePath("history.csv"), &error)); QFile csv(dir.filePath("history.csv")); QVERIFY(csv.open(QIODevice::ReadOnly)); QVERIFY(csv.readAll().startsWith("time,wind_lull,wind_avg"));
        QVERIFY(!db.backup(backup, cfg, &error));
    }
    void dailyBoundaryAndNulls() {
        QTemporaryDir dir; Archive db(dir.filePath("db")); QString error; QVERIFY(db.open(&error));
        Reading r{}; r[0] = QDateTime(QDate(2026, 10, 20), QTime(2, 0), QTimeZone("UTC")).toSecsSinceEpoch(); r[7] = 18;
        QVERIFY(db.insert(r, 0, "tempest:1", &error));
        auto utc = db.daily(0)[0].toObject(), central = db.daily(-300)[0].toObject();
        QCOMPARE(utc.value("day").toString(), QString("2026-10-20")); QCOMPARE(central.value("day").toString(), QString("2026-10-19")); QVERIFY(utc.value("rain").isNull());
    }
    void requestLimits() {
        HttpRequest req; qsizetype used = 0;
        QCOMPARE(HttpRequest::parse("GET /health HTTP/1.1\r\nHost: localhost\r\n\r\n", &req, &used), 200);
        QCOMPARE(HttpRequest::parse("POST /ingest HTTP/1.1\r\nHost: x\r\nContent-Length: 5\r\n\r\na", &req, &used), 0);
        QCOMPARE(HttpRequest::parse("PUT /config HTTP/1.1\r\nHost: x\r\nContent-Length: 99999999\r\n\r\n", &req, &used), 413);
        QCOMPARE(HttpRequest::parse("POST /ingest HTTP/1.1\r\nHost: x\r\nContent-Length: -1\r\n\r\n", &req, &used), 400);
        QCOMPARE(HttpRequest::parse("POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 0\r\nContent-Length: 1\r\n\r\n", &req, &used), 400);
        QCOMPARE(HttpRequest::parse("GET / HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n", &req, &used), 501);
        QCOMPARE(HttpRequest::parse(QByteArray(17000, 'x'), &req, &used), 431);
    }
    void httpAccessAndIngest() {
        QTemporaryDir dir; Config cfg(dir.filePath("config.json")); QString error; QVERIFY(cfg.load(&error));
        cfg.value = {{"settings", QJsonObject{{"stationSource", "ecowitt"}, {"stationId", "test"}, {"ingestKey", "topsecret"}, {"token", "private"}}}};
        Archive db(dir.filePath("db")); QVERIFY(db.open(&error)); Services s(cfg, db); HttpServer server(s); QVERIFY(server.start(0, QHostAddress::LocalHost, &error));
        auto get = [&](const QString &path, const QByteArray &origin = {}) {
            QNetworkRequest req(QUrl("http://127.0.0.1:" + QString::number(server.serverPort()) + path));
            if (!origin.isEmpty()) req.setRawHeader("Origin", origin);
            auto reply = s.network.get(req); QSignalSpy spy(reply, &QNetworkReply::finished); if (!spy.wait(5000)) return QPair<int,QByteArray>{0, {}};
            auto result = qMakePair(reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt(), reply->readAll()); reply->deleteLater(); return result;
        };
        QCOMPARE(get("/").first, 200); QVERIFY(get("/").second.contains("__WD_VER")); QCOMPARE(get("/js/app.js").first, 200);
        QCOMPARE(get("/config").first, 200); QCOMPARE(get("/config", "https://attacker.example").first, 401);
        auto publicCfg = get("/config-public"); QCOMPARE(publicCfg.first, 200); QVERIFY(!publicCfg.second.contains("topsecret")); QVERIFY(!publicCfg.second.contains("private"));
        QCOMPARE(get("/ingest?tempf=72&key=wrong").first, 401);
        QCOMPARE(get("/ingest?tempf=72&humidity=50&key=topsecret").first, 200);
        QCOMPARE(db.health().value("rows").toInt(), 1);
        auto api = QJsonDocument::fromJson(get("/api/v1").second).object(); QCOMPARE(api.value("api").toInt(), 1); QVERIFY(api.value("current").toObject().value("temp").isDouble());
        QVERIFY(!QJsonDocument(api).toJson().contains("topsecret"));
    }
    void pressureTrendUsesThreeHourBands() {
        QTemporaryDir dir; Archive db(dir.filePath("db")); QString error; QVERIFY(db.open(&error));
        Reading r{}; r[0] = 1800000000; r[6] = 1010; QVERIFY(db.insert(r, 0, "tempest:test", &error));
        *r[0] += 10800; r[6] = 1012; QVERIFY(db.insert(r, 0, "tempest:test", &error)); QCOMPARE(db.current().value("pressure_trend").toString(), QString("rising rapidly"));
        *r[0] += 60; r[6] = 1009.4; QVERIFY(db.insert(r, 0, "tempest:test", &error)); QCOMPARE(db.current().value("pressure_trend").toString(), QString("falling"));
        *r[0] += 60; r[6] = 1010.2; QVERIFY(db.insert(r, 0, "tempest:test", &error)); QCOMPARE(db.current().value("pressure_trend").toString(), QString("steady"));
    }
    void documentCopyPreservesDestinationOnFailure() {
        QTemporaryDir dir; QFile input(dir.filePath("source")); QVERIFY(input.open(QIODevice::WriteOnly));
        const QByteArray bytes(200000, 'x'); QCOMPARE(input.write(bytes), qint64(bytes.size())); input.close();
        QString error; const auto dest = dir.filePath("destination"); QVERIFY(copyDocument(input.fileName(), dest, &error));
        QVERIFY(!copyDocument(dir.filePath("missing"), dest, &error));
        QFile output(dest); QVERIFY(output.open(QIODevice::ReadOnly)); QCOMPARE(output.readAll(), bytes);
    }
    void rulesLatchAndRearm() {
        QTemporaryDir dir; Config cfg(dir.filePath("config.json")); QString error; QVERIFY(cfg.load(&error));
        cfg.value = {{"settings", QJsonObject{{"stationSource", "ecowitt"}, {"stationId", "test"}, {"units", "metric"},
            {"rules", QJsonArray{QJsonObject{{"metric", "temp"}, {"op", ">"}, {"value", 25}}}}}}};
        Archive db(dir.filePath("db")); QVERIFY(db.open(&error)); Services service(cfg, db);
        QSignalSpy notifications(&service, &Services::notification);
        service.observation[0] = QDateTime::currentSecsSinceEpoch(); service.observation[7] = 30;
        service.checkRules(); QCOMPARE(notifications.size(), 1);
        service.checkRules(); QCOMPARE(notifications.size(), 1);
        service.observation[7] = 20; service.checkRules();
        service.observation[7] = 30; service.checkRules(); QCOMPARE(notifications.size(), 2);
        service.observation[0] = QDateTime::currentSecsSinceEpoch() - 1000; service.checkRules(); QCOMPARE(notifications.size(), 2);
    }
    void wbgtAndReporting() {
        QVERIFY(!wbgt(20, 0, 500, 1)); auto sun = wbgt(35, 50, 800, 1); QVERIFY(sun.has_value());
        QVERIFY(*wbgt(35, 50, 0, 1) < *sun); QVERIFY(*wbgt(35, 50, 800, 8) < *sun);
        Reading r{}; r[0] = 1800000000; r[7] = -20; r[8] = 100;
        auto line = cwopPacket("DW1234", 32.5, -97.25, r, 0, 0);
        QVERIFY(line.contains("3230.00N/09715.00W")); QVERIFY(line.contains("t-04")); QVERIFY(line.contains("h00")); QVERIFY(line.contains("_.../...g..."));
        QVERIFY(cwopPacket("invalid\\r\\n", 32.5, -97.25, r, 0, 0).isEmpty());
    }
    void scaleBounds() { QCOMPARE(uiScale(.2), .7); QCOMPARE(uiScale(3), 2.0); QCOMPARE(uiScale(1.5), 1.5); QCOMPARE(uiScale(std::numeric_limits<double>::quiet_NaN()), 1.0); }
};
QTEST_GUILESS_MAIN(CoreTest)
#include "tests.moc"
