#include "instruments.h"
#include "radar.h"
#include "setup.h"
#include "tools.h"
#include "window.h"
#include <QCheckBox>
#include <QFontDatabase>
#include <QLineEdit>
#include <QListWidget>
#include <QMessageBox>
#include <QNetworkProxy>
#include <QNetworkReply>
#include <QPointer>
#include <QScrollArea>
#include <QScrollBar>
#include <QSettings>
#include <QStandardPaths>
#include <QTabWidget>
#include <QTemporaryDir>
#include <QToolButton>
#include <QUrlQuery>
#include <QtTest>
#include <cmath>

using namespace storm;
class UiTest : public QObject {
  Q_OBJECT
  QTemporaryDir preferences;
private slots:
  void initTestCase() {
    QVERIFY(preferences.isValid());
    QSettings::setDefaultFormat(QSettings::IniFormat);
    QSettings::setPath(QSettings::IniFormat, QSettings::UserScope,
                       preferences.path());
    QStandardPaths::setTestModeEnabled(true);
    QNetworkProxy::setApplicationProxy(
        QNetworkProxy(QNetworkProxy::HttpProxy, "127.0.0.1", 1));
#ifdef Q_OS_WIN
    // The offscreen plugin does not load the Windows system font database.
    QVERIFY(QFontDatabase::addApplicationFont(qEnvironmentVariable("WINDIR") +
                                              "/Fonts/segoeui.ttf") >= 0);
    QApplication::setFont(QFont("Segoe UI"));
#endif
  }
  void releaseChecksAndFailures() {
    struct Releases : Services {
      using Services::Services;
      QList<std::function<void(QJsonDocument, QString)>> pending;
      void request(const QUrl &url, std::function<void(QJsonDocument, QString)> callback,
                   const QByteArray & = {}, const QByteArray & = {},
                   const QByteArray & = "GET") override {
        QVERIFY(url.toString() == "https://api.github.com/repos/d4vid87/stormdesk/releases?per_page=30");
        pending << callback;
      }
    };
    QTemporaryDir dir;
    Config cfg(dir.filePath("config.json"));
    Archive db(dir.filePath("db"));
    QString error;
    QVERIFY(db.open(&error));
    Releases services(cfg, db);
    HttpServer server(services);
    QVERIFY(server.start(0, QHostAddress::LocalHost, &error));
    QSettings prefs(QSettings::defaultFormat(), QSettings::UserScope, "StormDesk", "Native");
    prefs.setValue("automaticUpdates", false);
    prefs.setValue("previewUpdates", false);
    {
      Window window(services, server);
      auto check = window.findChild<QPushButton *>("checkUpdates");
      auto download = window.findChild<QPushButton *>("downloadUpdate");
      auto status = window.findChild<QLabel *>("appUpdateStatus");
      auto automatic = window.findChild<QCheckBox *>("automaticUpdates");
      QVERIFY(check && download && status && automatic);
      QVERIFY(!automatic->isChecked());
      check->click();
      QCOMPARE(services.pending.size(), 1);
      QVERIFY(!check->isEnabled());
      services.pending.takeFirst()({}, "Offline");
      QVERIFY(check->isEnabled());
      QVERIFY(download->isHidden());
      QVERIFY(status->text().contains("Could not check"));
      check->click();
      services.pending.takeFirst()(QJsonDocument(QJsonObject{}), {});
      QVERIFY(status->text().contains("Could not check"));
      check->click();
      services.pending.takeFirst()(QJsonDocument(QJsonArray{QJsonObject{
          {"tag_name", "v9.0.0"}, {"draft", false}, {"prerelease", false},
          {"published_at", "2026-10-21"}, {"assets", QJsonArray{QJsonObject{}}}}}), {});
      QVERIFY(status->text().contains("v9.0.0"));
      QVERIFY(!download->isHidden());
      check->click();
      services.pending.takeFirst()(QJsonDocument(QJsonArray{}), {});
      QVERIFY(status->text().contains("No newer release"));
      QVERIFY(download->isHidden());
      automatic->setChecked(true);
    }
    QCOMPARE(prefs.value("automaticUpdates").toBool(), true);
    prefs.remove("automaticUpdates");
    prefs.remove("previewUpdates");
    prefs.remove("lastUpdateCheck");
  }
  void instrumentAndRealSetup() {
    QTemporaryDir dir;
    Config cfg(dir.filePath("config.json"));
    QString error;
    QVERIFY(cfg.save({{"settings", QJsonObject{{"stationName", "Home"},
                                               {"lat", 32.6},
                                               {"lon", -97.3},
                                               {"units", "imperial"},
                                               {"keepThis", 42}}}},
                     &error));
    Archive db(dir.filePath("db"));
    QVERIFY(db.open(&error));
    Services services(cfg, db);
    const auto now = QDateTime::currentSecsSinceEpoch();
    services.forecast = {{"_at", double(now)},
                         {"current", QJsonObject{{"temperature_2m", 20},
                                                 {"relative_humidity_2m", 50},
                                                 {"wind_speed_10m", 5},
                                                 {"wind_direction_10m", 220},
                                                 {"pressure_msl", 1013},
                                                 {"weather_code", 61},
                                                 {"is_day", 1}}}};
    HttpServer server(services);
    QVERIFY(server.start(0, QHostAddress::LocalHost, &error));
    Window window(services, server);
    window.applyScale(1);
    QSettings isolated(QSettings::defaultFormat(), QSettings::UserScope,
                       "StormDesk", "Native");
    QCOMPARE(isolated.value("scale").toDouble(), 1.0);
    window.resize(1440, 950);
    window.show();
    QTest::qWait(10);
    QCOMPARE(window.findChildren<InstrumentFace *>().size(), 8);
    auto sunCycle = window.findChild<SunCycle *>("sunCycle");
    QVERIFY(sunCycle);
    QVERIFY(!sunCycle->hasTimes());
    sunCycle->setTimes(now - 3600, now + 3600, -18000, true);
    QVERIFY(sunCycle->hasTimes());
    QVERIFY(sunCycle->animated());
    QVERIFY(sunCycle->accessibleDescription().contains("Location local time"));
    sunCycle->setTimes(0, 0, 0, true);
    QVERIFY(!sunCycle->hasTimes());
    QVERIFY(!sunCycle->animated());
    auto localDay = QDateTime::currentDateTimeUtc()
                        .date()
                        .startOfDay(Qt::UTC)
                        .toSecsSinceEpoch();
    services.forecast["daily"] = QJsonObject{
        {"time", QJsonArray{double(localDay - 86400), double(localDay)}},
        {"sunrise",
         QJsonArray{double(localDay - 64800), double(localDay + 21600)}},
        {"sunset",
         QJsonArray{double(localDay - 21600), double(localDay + 64800)}}};
    window.render();
    QVERIFY(sunCycle->hasTimes());
    QVERIFY(sunCycle->accessibleDescription().contains("6:00 AM"));
    for (auto label : window.findChildren<QLabel *>()) {
      QVERIFY(!label->text().contains("10-day outlook", Qt::CaseInsensitive));
      QVERIFY(!label->text().contains("six hours", Qt::CaseInsensitive));
    }
    auto radar = window.findChild<Radar *>("dashboardRadar");
    QVERIFY(radar);
    auto stage = window.findChild<RadarStage *>("radarStage");
    auto shelf = window.findChild<QScrollArea *>("instrumentShelf");
    auto toggle = window.findChild<QPushButton *>("toggleInstruments");
    QVERIFY(stage && shelf && toggle);
    QVERIFY(shelf->isVisible());
    QCOMPARE(shelf->y(), 0);
    QVERIFY(radar->y() > shelf->geometry().bottom());
    QCOMPARE(radar->width(), stage->width());
    QCOMPARE(radar->geometry().bottom(), stage->rect().bottom());
    auto clock = window.findChild<QLabel *>("dashboardClock");
    QVERIFY(clock && !clock->text().isEmpty());
    QVERIFY(clock->font().pixelSize() >= 30);
    QVERIFY(shelf->width() > stage->width() * .9);
    QVERIFY(shelf->height() <= qRound(stage->height() * .46));
    QVERIFY(shelf->isAncestorOf(sunCycle));
    auto hit = stage->childAt(QPoint(stage->width() - 30, stage->height() / 2));
    QVERIFY(hit == radar || radar->isAncestorOf(hit));
    toggle->click();
    QVERIFY(!shelf->isVisible());
    QVERIFY(!sunCycle->animated());
    QCOMPARE(radar->geometry(), stage->rect());
    toggle->click();
    QVERIFY(shelf->isVisible());
    QVERIFY(QFontDatabase::families().contains("Barlow Semi Condensed Medium"));
    auto rain = window.findChild<InstrumentFace *>("instrumentFace0");
    auto wind = window.findChild<InstrumentFace *>("instrumentFace2");
    auto dew = window.findChild<InstrumentFace *>("instrumentFace7");
    QVERIFY(rain && !rain->reading());
    QVERIFY(shelf->isAncestorOf(rain));
    QVERIFY(wind && wind->reading());
    QCOMPARE(*wind->reading(), 5.0);
    QVERIFY(dew && dew->reading());
    QCOMPARE(rain->parentWidget()->mapTo(shelf, QPoint()).y(),
             dew->parentWidget()->mapTo(shelf, QPoint()).y());
    QVERIFY(rain->height() < 50);
    QVERIFY(rain->mapTo(shelf, QPoint()).x() < dew->mapTo(shelf, QPoint()).x());
    auto glyph = window.findChild<WeatherGlyph *>();
    QVERIFY(glyph && glyph->animated());
    auto animation = window.findChild<QCheckBox *>("iconAnimation");
    QVERIFY(animation);
    animation->setChecked(false);
    for (auto button : window.findChildren<QPushButton *>())
      if (button->text() == "Save changes")
        button->click();
    QVERIFY(!glyph->animated());
    QVERIFY(!sunCycle->animated());
    QCOMPARE(cfg.settings().value("nativeMotion").toBool(), false);
    rain->click();
    auto reading = window.findChild<QDialog *>();
    QVERIFY(reading);
    reading->accept();
    QTest::qWait(5);
    window.setup();
    QPointer<SetupDialog> setup =
        window.findChild<SetupDialog *>("stationSetup");
    QVERIFY(setup);
    setup->findChild<QPushButton *>("setup-forecast")->click();
    auto next = setup->findChild<QPushButton *>("setupNext");
    setup->findChild<QLineEdit *>("setupName")->clear();
    next->click();
    QVERIFY(setup->findChild<QLabel *>("setupMessage")
                ->text()
                .contains("location"));
    setup->findChild<QLineEdit *>("setupName")->setText("Actual location");
    next->click();
    services.forecast["_at"] = double(QDateTime::currentSecsSinceEpoch());
    emit services.changed();
    QVERIFY2(setup->findChild<QLabel *>("setupConnectionStatus")
                 ->text()
                 .contains("Forecast received"),
             qPrintable(
                 setup->findChild<QLabel *>("setupMessage")->text() + " / " +
                 setup->findChild<QLabel *>("setupConnectionStatus")->text()));
    QVERIFY(next->isEnabled());
    next->click();
    next->click();
    QTest::qWait(5);
    QVERIFY(!setup);
    QVERIFY(cfg.settings().value("nativeSetupDone").toBool());
    QCOMPARE(cfg.settings().value("keepThis").toInt(), 42);
    QCOMPARE(cfg.text("stationName"), QString("Actual location"));
    window.setup();
    setup = window.findChild<SetupDialog *>("stationSetup");
    setup->findChild<QPushButton *>("setup-station")->click();
    next = setup->findChild<QPushButton *>("setupNext");
    setup->findChild<QComboBox *>("setupMethod")->setCurrentIndex(0);
    next->click();
    next->click();
    QVERIFY(setup->findChild<QLabel *>("setupMessage")
                ->text()
                .contains("Tempest serial"));
    setup->findChild<QLineEdit *>("setup-tempestSerial")->setText("ST-TEST");
    next->click();
    QVERIFY(!next->isEnabled());
    QVERIFY(setup->findChild<QLabel *>("setupConnectionStatus")
                ->text()
                .contains("No recent station reading"));
    QCOMPARE(cfg.text("nativeTempestConnection"), QString("local"));
    QCOMPARE(db.health().value("rows").toInt(), 0);
    window.applyScale(2);
    setup->resize(360, 700);
    QTest::qWait(10);
    QVERIFY(setup->width() <= 360);
    for (auto area : setup->findChildren<QScrollArea *>())
      QVERIFY(area->horizontalScrollBar()->maximum() == 0);
    setup->reject();
    QTest::qWait(5);
    window.applyScale(1);
  }
  void gaugeMovesStayLocalAndPersist() {
    QTemporaryDir dir;
    Config cfg(dir.filePath("config.json"));
    QString error;
    QVERIFY(cfg.load(&error));
    Archive db(dir.filePath("db"));
    QVERIFY(db.open(&error));
    Services services(cfg, db);
    HttpServer server(services);
    QVERIFY(server.start(0, QHostAddress::LocalHost, &error));
    QSettings local(QSettings::defaultFormat(), QSettings::UserScope,
                    "StormDesk", "Native");
    local.setValue("gaugeOrder",
                   QStringList{"Rain today", "Rain today", "Invalid"});
    Window window(services, server);
    window.applyScale(1);
    window.resize(1600, 1100);
    window.show();
    QTest::qWait(10);
    QCOMPARE(window.windowTitle(), QString("STORMDESK"));
    QVERIFY(!window.findChild<QPushButton *>("weatherMotion"));
    auto connection = window.findChild<QPushButton *>("connectStation");
    QVERIFY(connection &&
            window.findChild<QTabWidget *>()->isAncestorOf(connection));
    QVERIFY(window.findChild<QTabWidget *>()->isAncestorOf(
        window.findChild<QCheckBox *>("iconAnimation")));
    QVERIFY(!window.findChild<QScrollArea *>("instrumentShelf")
                 ->isAncestorOf(connection));
    auto rain = window.findChild<QToolButton *>("gaugeHandle0");
    auto wind = window.findChild<QToolButton *>("gaugeHandle2");
    auto lightning = window.findChild<QToolButton *>("gaugeHandle1");
    QVERIFY(rain && wind && lightning);
    auto x = [&window](QWidget *w) { return w->mapTo(&window, QPoint()).x(); };
    QVERIFY(x(rain) < x(lightning));
    QTest::keyClick(rain, Qt::Key_Right, Qt::AltModifier);
    QTRY_VERIFY(x(rain) > x(lightning));
    QVERIFY(!window.findChild<QDialog *>());
    QCOMPARE(local.value("gaugeOrder").toStringList().at(1),
             QString("Rain today"));
    window.render();
    window.applyScale(1);
    QVERIFY(x(rain) > x(lightning));
    QTest::keyClick(rain, Qt::Key_Left, Qt::AltModifier);
    QTest::keyClick(rain, Qt::Key_Left, Qt::AltModifier);
    QTRY_VERIFY(x(rain) < x(lightning));
    QPoint target =
        rain->mapFromGlobal(wind->mapToGlobal(wind->rect().center()));
    QTest::mousePress(rain, Qt::LeftButton, {}, rain->rect().center());
    QTest::mouseMove(rain, target);
    QTest::mouseRelease(rain, Qt::LeftButton, {}, target);
    QTRY_VERIFY(x(rain) > x(wind));
    QCOMPARE(local.value("gaugeOrder").toStringList().at(2),
             QString("Rain today"));
    auto touch = QTest::createTouchDevice();
    target = rain->mapFromGlobal(wind->mapToGlobal(wind->rect().center()));
    QTest::touchEvent(rain, touch)
        .press(0, rain->rect().center(), rain)
        .commit();
    QTest::touchEvent(rain, touch).move(0, target, rain).commit();
    QTest::touchEvent(rain, touch).release(0, target, rain).commit();
    QTRY_VERIFY(x(rain) < x(wind));
    QTest::keyClick(rain, Qt::Key_Right, Qt::AltModifier);
    QTRY_VERIFY(x(rain) > x(wind));
    const auto before = local.value("gaugeOrder");
    QTest::mousePress(rain, Qt::LeftButton, {}, rain->rect().center());
    QTest::mouseMove(rain, QPoint(0, 600));
    QTest::mouseRelease(rain, Qt::LeftButton, {}, QPoint(0, 600));
    QCOMPARE(local.value("gaugeOrder"), before);
    Window reopened(services, server);
    reopened.applyScale(1);
    reopened.resize(1600, 1100);
    reopened.show();
    QTest::qWait(10);
    auto reopenedRain = reopened.findChild<QToolButton *>("gaugeHandle0");
    auto reopenedWind = reopened.findChild<QToolButton *>("gaugeHandle2");
    QVERIFY(reopenedRain->mapTo(&reopened, QPoint()).x() >
            reopenedWind->mapTo(&reopened, QPoint()).x());
    QVERIFY(!cfg.settings().contains("gaugeOrder"));
    local.remove("gaugeOrder");
  }
  void alertBannerTracksHighestSeverity() {
    QTemporaryDir dir;
    Config cfg(dir.filePath("config.json"));
    cfg.value = {{"settings", QJsonObject{{"theme", "graphite"}}}};
    Archive db(dir.filePath("db"));
    QString error;
    QVERIFY(db.open(&error));
    Services services(cfg, db);
    HttpServer server(services);
    QVERIFY(server.start(0, QHostAddress::LocalHost, &error));
    Window window(services, server);
    window.applyScale(1);
    window.show();
    auto banner = window.findChild<QLabel *>("nwsAlertBanner");
    QVERIFY(banner);
    auto alert = [](const QString &severity, const QString &event) {
      return QJsonObject{{"properties", QJsonObject{{"severity", severity},
                                                    {"event", event},
                                                    {"headline", event}}}};
    };
    const QList<QPair<QString, QString>> colors{
        {"Tornado Warning", "#ff0000"},
        {"Severe Thunderstorm Warning", "#ffa500"},
        {"Flash Flood Warning", "#00c800"},
        {"Tornado Watch", "#ffff00"},
        {"Air Quality Alert", "#ffffff"},
        {"Test Advisory", "#78b4c8"}};
    for (const auto &color : colors) {
      services.warnings = QJsonArray{alert("Unknown", color.first)};
      window.render();
      QCOMPARE(banner->property("eventColor").toString(), color.second);
      QVERIFY(banner->text().startsWith("National Weather Service · "));
      QVERIFY(!banner->text().contains("Unknown"));
      QVERIFY(banner->styleSheet().contains(color.second));
    }
    services.warnings =
        QJsonArray{alert("Moderate", "Air Quality Alert"),
                   alert("Extreme", "Tornado Warning"),
                   alert("Severe", "Severe Thunderstorm Warning")};
    window.render();
    QCOMPARE(banner->property("severity").toString(), QString("Extreme"));
    QCOMPARE(banner->property("eventColor").toString(), QString("#ff0000"));
    QVERIFY(banner->text().startsWith(
        "National Weather Service · Tornado Warning"));
    auto settings = cfg.settings();
    settings["theme"] = "light";
    cfg.value["settings"] = settings;
    window.applyScale(1);
    QVERIFY(banner->styleSheet().contains("#ff0000"));
    QCOMPARE(banner->palette().color(QPalette::WindowText),
             window.palette().color(QPalette::WindowText));
    services.warnings = {};
    services.warningStatus = "US National Weather Service";
    window.render();
    QVERIFY(banner->property("severity").toString().isEmpty());
    QVERIFY(banner->text().contains("No active warnings"));
    QVERIFY(banner->property("eventColor").toString().isEmpty());
    QVERIFY(banner->styleSheet().isEmpty());
    services.warningStatus = "US official warnings unavailable";
    window.render();
    QVERIFY(banner->property("severity").toString().isEmpty());
    QVERIFY(banner->text().contains("unavailable"));
    QVERIFY(!banner->text().contains("No active warnings"));
  }
  void alertBannerOpensOfficialDetails() {
    QTemporaryDir dir;
    Config cfg(dir.filePath("config.json"));
    Archive db(dir.filePath("db"));
    QString error;
    QVERIFY(db.open(&error));
    Services services(cfg, db);
    services.warningStatus = "US National Weather Service";
    services.warnings = QJsonArray{QJsonObject{
        {"properties",
         QJsonObject{
             {"event", "Severe Thunderstorm Warning"},
             {"severity", "Severe"},
             {"headline", "Thunderstorm warning for Test County"},
             {"areaDesc", "Test County; Neighbor County"},
             {"sent", "2030-06-01T12:00:00Z"},
             {"effective", "2030-06-01T12:01:00Z"},
             {"expires", "2030-06-01T13:00:00Z"},
             {"ends", "2030-06-01T12:45:00Z"},
             {"description", "Large hail and damaging wind are possible."},
             {"instruction", "Move indoors to an interior room."}}}}};
    HttpServer server(services);
    QVERIFY(server.start(0, QHostAddress::LocalHost, &error));
    Window window(services, server);
    window.applyScale(1);
    window.show();
    auto banner = window.findChild<QPushButton *>("openNwsAlerts");
    QVERIFY(banner && banner->isVisible());
    QVERIFY(
        banner->accessibleDescription().contains("National Weather Service"));
    banner->setFocus();
    QTest::keyClick(banner, Qt::Key_Space);
    auto pages = window.findChild<QStackedWidget *>("dashboardPages");
    QCOMPARE(pages->currentIndex(), 4);
    QCOMPARE(window.findChild<QComboBox *>("nativeTool")->currentIndex(), 6);
    QTRY_VERIFY(window.findChild<QLabel *>("nwsAlertMetadata") &&
                window.findChild<QLabel *>("nwsAlertMetadata")->isVisible());
    auto metadata = window.findChild<QLabel *>("nwsAlertMetadata");
    QVERIFY(metadata->text().contains(
        "Affected areas: Test County; Neighbor County"));
    const auto expires =
        QDateTime::fromString("2030-06-01T13:00:00Z", Qt::ISODate)
            .toLocalTime()
            .toString("ddd d MMM yyyy, h:mm AP t");
    QVERIFY(metadata->text().contains("Expires (device time): " + expires));
    bool description = false, instructions = false;
    for (auto label : window.findChildren<QLabel *>()) {
      description |= label->text().contains("Large hail and damaging wind");
      instructions |=
          label->text().contains("Move indoors to an interior room");
    }
    QVERIFY(description && instructions);
    pages->setCurrentIndex(0);
    QTest::mouseClick(banner, Qt::LeftButton);
    QCOMPARE(pages->currentIndex(), 4);
  }
  void tempestImportDrivesWarningsAndRadar() {
    QTemporaryDir dir;
    Config cfg(dir.filePath("config.json"));
    QString error;
    QJsonObject oldSettings{{"stationName", "Old forecast location"},
                            {"lat", 40.0},
                            {"lon", -105.0},
                            {"radarSite", "KFTG"},
                            {"elevationM", 1500},
                            {"keepThis", 42},
                            {"activePlace", "away"}};
    oldSettings["places"] =
        QJsonArray{QJsonObject{{"id", "away"}, {"lat", 42.0}, {"lon", -71.0}}};
    QVERIFY(cfg.save({{"settings", oldSettings}}, &error));
    Archive db(dir.filePath("db"));
    QVERIFY(db.open(&error));
    Services services(cfg, db);
    HttpServer server(services);
    QVERIFY(server.start(0, QHostAddress::LocalHost, &error));
    Window window(services, server);
    window.applyScale(1);
    window.resize(1440, 950);
    window.show();
    window.setup();
    QPointer<SetupDialog> setup =
        window.findChild<SetupDialog *>("stationSetup");
    QVERIFY(setup);
    window.applyScale(2);
    setup->resize(360, 700);
    QTest::qWait(10);
    QVERIFY(setup->width() <= 360);
    for (auto area : setup->findChildren<QScrollArea *>())
      QVERIFY(area->horizontalScrollBar()->maximum() == 0);
    window.applyScale(1);
    setup->resize(850, 760);
    setup->findChild<QPushButton *>("setup-tempest")->click();
    auto next = setup->findChild<QPushButton *>("setupNext");
    auto method = setup->findChild<QComboBox *>("setupMethod");
    QCOMPARE(method->currentIndex(), 1);
    auto token = setup->findChild<QLineEdit *>("setup-token");
    QCOMPARE(token->echoMode(), QLineEdit::Password);
    QVERIFY(token->isVisible());
    QVERIFY(setup->findChild<QLineEdit *>("setup-deviceId")->isReadOnly());
    next->click();
    QVERIFY(setup->findChild<QLabel *>("setupMessage")
                ->text()
                .contains("Import station"));
    token->setText(" fixture-token ");
    auto stations = setup->findChild<QComboBox *>("setupStations");
    QJsonObject station{
        {"station_id", 12345},
        {"name", "My Tempest"},
        {"latitude", 33.0650123},
        {"longitude", -96.9180456},
        {"station_meta", QJsonObject{{"elevation", 180}}},
        {"devices",
         QJsonArray{QJsonObject{{"device_type", "HB"}, {"device_id", 7}},
                    QJsonObject{{"device_type", "ST"},
                                {"device_id", 98765},
                                {"serial_number", "ST-TEST"}}}}};
    stations->setProperty("tempestToken", "fixture-token");
    stations->addItem("My Tempest", station);
    QVERIFY(QMetaObject::invokeMethod(stations, "activated", Q_ARG(int, 0)));
    QVERIFY(setup->findChild<QLabel *>("setupStationSummary")
                ->text()
                .contains("KFWS"));
    next->click();
    QCOMPARE(cfg.text("token"), QString("fixture-token"));
    QCOMPARE(cfg.text("deviceId"), QString("98765"));
    QCOMPARE(cfg.text("stationId"), QString("12345"));
    QCOMPARE(cfg.text("stationName"), QString("My Tempest"));
    QCOMPARE(cfg.text("radarSite"), QString("KFWS"));
    QCOMPARE(cfg.number("lat"), 33.0650123);
    QCOMPARE(cfg.number("lon"), -96.9180456);
    QCOMPARE(cfg.number("elevationM"), 180.0);
    QCOMPARE(cfg.number("keepThis"), 42.0);
    QVERIFY(cfg.text("activePlace").isEmpty());
    QVERIFY(services.radarUrl().fragment().startsWith(
        "goto=KFWS,-96.9180456,33.0650123,"));
    bool warningsAtStation = false;
    for (auto reply : services.network.findChildren<QNetworkReply *>())
      if (reply->url().host() == "api.weather.gov") {
        QCOMPARE(QUrlQuery(reply->url()).queryItemValue("point"),
                 QString("33.0650,-96.9180"));
        warningsAtStation = true;
      }
    QVERIFY(warningsAtStation);
    QVERIFY(setup->findChild<QLabel *>("setupConnectionStatus")
                ->text()
                .contains("KFWS"));
    setup->findChild<QPushButton *>("setupBack")->click();
    token->setText("replacement-token");
    QVERIFY(stations->count() == 0);
    next->click();
    QVERIFY(setup->findChild<QLabel *>("setupMessage")
                ->text()
                .contains("Import station"));
    QCOMPARE(cfg.text("token"), QString("fixture-token"));
    stations->setProperty("tempestToken", "fixture-token");
    stations->addItem("Stale result", station);
    QVERIFY(QMetaObject::invokeMethod(stations, "activated", Q_ARG(int, 0)));
    QVERIFY(setup->findChild<QLabel *>("setupMessage")
                ->text()
                .contains("current token"));
    next->click();
    QCOMPARE(cfg.text("token"), QString("fixture-token"));
    window.applyScale(2);
    setup->resize(360, 700);
    QTest::qWait(10);
    QVERIFY(setup->width() <= 360);
    for (auto area : setup->findChildren<QScrollArea *>())
      QVERIFY(area->horizontalScrollBar()->maximum() == 0);
    setup->reject();
    QTest::qWait(5);
    QVERIFY(!setup);
  }
  void nativeMapsAndCustomization() {
    QTemporaryDir dir;
    Config cfg(dir.filePath("config.json"));
    QString error;
    QVERIFY(cfg.load(&error));
    Archive db(dir.filePath("db"));
    QVERIFY(db.open(&error));
    Services services(cfg, db);
    services.network.setProxy(
        QNetworkProxy(QNetworkProxy::HttpProxy, "127.0.0.1", 1));
    HttpServer server(services);
    QVERIFY(server.start(0, QHostAddress::LocalHost, &error));
    Window window(services, server);
    window.show();
    auto stack = window.findChild<QStackedWidget *>("dashboardPages");
    stack->setCurrentIndex(4);
    auto tool = window.findChild<QComboBox *>("nativeTool");
    tool->setCurrentIndex(12);
    QTest::qWait(10);
    auto list = window.findChild<QListWidget *>("dashboardCards");
    QVERIFY(list);
    list->item(0)->setCheckState(Qt::Unchecked);
    QPushButton *apply = nullptr;
    for (auto button : window.findChildren<QPushButton *>())
      if (button->text() == "Apply dashboard")
        apply = button;
    QVERIFY(apply);
    apply->click();
    QVERIFY(cfg.settings()
                .value("nativeDashboard")
                .toObject()
                .value("hidden")
                .toArray()
                .contains("Rain today"));
#ifndef QT_NO_SYSTEMTRAYICON
    if (!QSystemTrayIcon::isSystemTrayAvailable()) {
      emit services.notification("Native alert test",
                                 "Visible without a system tray");
      QVERIFY(window.findChild<QMessageBox *>("weatherNotification"));
    }
#endif
    auto rev = cfg.value.value("_rev");
    QCOMPARE(cfg.merge({{"_rev", rev},
                        {"settings",
                         QJsonObject{{"activePlace", "away"},
                                     {"lat", 30},
                                     {"lon", -97},
                                     {"places",
                                      QJsonArray{QJsonObject{{"id", "away"},
                                                             {"name", "Trip"},
                                                             {"lat", 40},
                                                             {"lon", -74}}}}}}},
                       &error),
             200);
    QCOMPARE(cfg.location().value("lat").toInt(), 40);
    QCOMPARE(cfg.number("lat"), 30.0);
    QCOMPARE(cfg.merge({{"_rev", cfg.value.value("_rev")},
                        {"settings",
                         QJsonObject{{"mqttSubs", QJsonArray{QJsonObject{
                                                      {"topic", "garden/temp"},
                                                      {"label", "Garden"},
                                                      {"unit", "°C"},
                                                      {"future", 17}}}}}}},
                       &error),
             200);
    tool->setCurrentIndex(10);
    QTest::qWait(10);
    auto subscriptions = window.findChild<QTableWidget *>("mqttSubscriptions");
    QVERIFY(subscriptions);
    QCOMPARE(subscriptions->item(0, 2)->text(), QString("°C"));
    subscriptions->item(0, 1)->setText("Backyard");
    QPushButton *saveTopics = nullptr;
    for (auto button : window.findChildren<QPushButton *>())
      if (button->text() == "Save topics")
        saveTopics = button;
    QVERIFY(saveTopics);
    saveTopics->click();
    auto saved = cfg.settings().value("mqttSubs").toArray()[0].toObject();
    QCOMPARE(saved.value("label").toString(), QString("Backyard"));
    QCOMPARE(saved.value("unit").toString(), QString("°C"));
    QCOMPARE(saved.value("future").toInt(), 17);
  }
  void nativeModelFixture() {
    QTemporaryDir dir;
    QSettings::setDefaultFormat(QSettings::IniFormat);
    QSettings::setPath(QSettings::IniFormat, QSettings::UserScope, dir.path());
    Config cfg(dir.filePath("config.json"));
    QString error;
    QVERIFY(cfg.load(&error));
    cfg.value = {{"settings", QJsonObject{{"stationName",
                                           "DEMO · synthetic model guidance"},
                                          {"lat", 30},
                                          {"lon", -97},
                                          {"units", "metric"}}}};
    Archive db(dir.filePath("db"));
    QVERIFY(db.open(&error));
    Services services(cfg, db);
    HttpServer server(services);
    QVERIFY(server.start(0, QHostAddress::LocalHost, &error));
    Window window(services, server);
    auto tools = window.findChild<Tools *>();
    QVERIFY(tools);
    QJsonArray time, gfs, ecmwf, m1, m2, m3;
    const auto now = QDateTime::currentSecsSinceEpoch();
    for (int i = 0; i < 48; ++i) {
      time.append(double(now + (i + 1) * 3600));
      double value = 22 + 5 * std::sin(i / 4.0);
      gfs.append(value);
      ecmwf.append(value + 4);
      m1.append(value - 1);
      m2.append(value);
      m3.append(value + 2);
    }
    tools->advanced.data["models"] = QJsonDocument(QJsonObject{
        {"hourly", QJsonObject{{"time", time},
                               {"temperature_2m_gfs_seamless", gfs},
                               {"temperature_2m_ecmwf_ifs025", ecmwf}}}});
    tools->advanced.data["ensemble"] = QJsonDocument(
        QJsonObject{{"hourly", QJsonObject{{"time", time},
                                           {"temperature_2m_member01", m1},
                                           {"temperature_2m_member02", m2},
                                           {"temperature_2m_member03", m3}}}});
    for (auto key : {"models", "ensemble", "air", "nowcast"})
      tools->advanced.fetched[key] = now;
    window.applyScale(1);
    window.resize(1600, 1100);
    window.show();
    window.findChild<QStackedWidget *>("dashboardPages")->setCurrentIndex(4);
    window.findChild<QComboBox *>("nativeTool")->setCurrentIndex(2);
    QTest::qWait(20);
    auto tables = tools->findChildren<QTableWidget *>();
    QVERIFY(!tables.isEmpty());
    auto current = tables.last();
    QCOMPARE(current->rowCount(), 48);
    QCOMPARE(current->columnCount(), 4);
    for (auto box : tools->findChildren<QComboBox *>())
      if (box->accessibleName() == "Tool measurement")
        QCOMPARE(box->count(), 3);
    QCOMPARE(current->item(0, 3)->text(), QString("4.0"));
    auto area = qobject_cast<QScrollArea *>(
        window.findChild<QStackedWidget *>("dashboardPages")->currentWidget());
    QVERIFY(area);
    QVERIFY(area->verticalScrollBar()->maximum() > 0);
    auto contents = tools->findChild<QWidget *>("toolBody");
    QVERIFY(contents);
    int bottom = -1;
    for (int i = 0; i < contents->layout()->count(); ++i)
      if (auto widget = contents->layout()->itemAt(i)->widget()) {
        QVERIFY(widget->y() >= bottom);
        bottom = widget->geometry().bottom();
      }
    for (auto child : contents->findChildren<QWidget *>(
             QString(), Qt::FindDirectChildrenOnly))
      if (child->isVisible())
        QVERIFY(contents->layout()->indexOf(child) >= 0);
    if (!qEnvironmentVariable("STORMDESK_TOOLS_CAPTURE").isEmpty())
      QVERIFY(
          window.grab().save(qEnvironmentVariable("STORMDESK_TOOLS_CAPTURE")));
    Reading invalid{};
    const auto windTime = QDateTime(QDate::currentDate(), QTime(12, 0), Qt::UTC)
                              .toSecsSinceEpoch();
    invalid[0] = double(windTime - 1);
    invalid[2] = 1;
    invalid[4] = -999;
    invalid[7] = 20;
    QVERIFY(db.insert(invalid, 0, "tempest:fixture", &error));
    invalid[0] = double(windTime);
    invalid[4] = 90;
    QVERIFY(db.insert(invalid, 0, "tempest:fixture", &error));
    tools->advanced.fetched["normals"] = now;
    tools->advanced.fetched["official"] = now;
    window.findChild<QComboBox *>("nativeTool")->setCurrentIndex(9);
    QTest::qWait(10);
    QWidget *rose = nullptr;
    for (auto widget : tools->findChildren<QWidget *>())
      if (widget->accessibleName() == "Wind rose")
        rose = widget;
    QVERIFY(rose);
    QCOMPARE(rose->accessibleDescription(), QString("1 valid wind directions"));
  }
  void settingsKeepRulesAndUnsetLocation() {
    QTemporaryDir dir;
    QSettings::setDefaultFormat(QSettings::IniFormat);
    QSettings::setPath(QSettings::IniFormat, QSettings::UserScope, dir.path());
    Config cfg(dir.filePath("config.json"));
    QString error;
    QVERIFY(cfg.load(&error));
    const QJsonObject rule{{"metric", "future-metric"}, {"op", ">"},
                           {"value", 1.234567},         {"durMin", 1.56789},
                           {"metric2", "gust"},         {"value2", 12}};
    cfg.value = {{"settings", QJsonObject{{"rules", QJsonArray{rule}}}}};
    Archive db(dir.filePath("db"));
    QVERIFY(db.open(&error));
    Services services(cfg, db);
    HttpServer server(services);
    QVERIFY(server.start(0, QHostAddress::LocalHost, &error));
    Window window(services, server);
    QPushButton *save = nullptr;
    for (auto button : window.findChildren<QPushButton *>())
      if (button->text() == "Save changes")
        save = button;
    QVERIFY(save);
    save->click();
    QCOMPARE(cfg.settings().value("rules").toArray()[0].toObject(), rule);
    QVERIFY(!cfg.settings().contains("lat"));
    auto rev = cfg.value.value("_rev");
    QCOMPARE(
        cfg.merge({{"_rev", rev},
                   {"settings", QJsonObject{{"stationName", "Remote edit"}}}},
                  &error),
        200);
    save->click();
    QCOMPARE(cfg.text("stationName"), QString("Remote edit"));
  }
  void scaleAndReflow() {
    QTemporaryDir dir;
    QSettings::setDefaultFormat(QSettings::IniFormat);
    QSettings::setPath(QSettings::IniFormat, QSettings::UserScope, dir.path());
    Config cfg(dir.filePath("config.json"));
    QString error;
    QVERIFY(cfg.load(&error));
    Archive db(dir.filePath("db"));
    QVERIFY(db.open(&error));
    Services services(cfg, db);
    HttpServer server(services);
    QVERIFY(server.start(0, QHostAddress::LocalHost, &error));
    services.network.setProxy(
        QNetworkProxy(QNetworkProxy::HttpProxy, "127.0.0.1", 1));
    Window window(services, server);
    window.show();
    for (const auto &size : {QSize(360, 800), QSize(800, 480), QSize(1280, 720),
                             QSize(1920, 1080), QSize(3840, 2160)}) {
      for (double scale : {.7, 1.0, 1.5, 2.0}) {
        window.applyScale(scale);
        window.resize(size);
        QTest::qWait(10);
        QCOMPARE(window.scale(), scale);
        QVERIFY(window.height() <= size.height());
        QVERIFY2(window.width() <= size.width(),
                 qPrintable("Window cannot fit width " +
                            QString::number(size.width()) + " at " +
                            QString::number(scale)));
        for (int page : {0, 1, 2, 3, 4}) {
          window.findChild<QStackedWidget *>("dashboardPages")->setCurrentIndex(page);
          QTest::qWait(10);
          if (page == 0) {
            auto stage = window.findChild<RadarStage *>("radarStage");
            auto radar = window.findChild<Radar *>("dashboardRadar");
            auto toggle = window.findChild<QPushButton *>("toggleInstruments");
            auto shelf = window.findChild<QScrollArea *>("instrumentShelf");
            QVERIFY(stage && radar && toggle && shelf);
            if (!toggle->isChecked())
              toggle->click();
            if (shelf->isVisible()) {
              QVERIFY(stage->rect().contains(shelf->geometry()));
              QVERIFY(radar->y() > shelf->geometry().bottom());
            }
            QCOMPARE(radar->width(), stage->width());
            QCOMPARE(radar->geometry().bottom(), stage->rect().bottom());
          }
          auto tabs = window.findChild<QTabWidget *>();
          auto tool = window.findChild<QComboBox *>("nativeTool");
          const int count = page == 3   ? tabs->count()
                            : page == 4 ? tool->count()
                                        : 1;
          for (int tab = 0; tab < count; ++tab) {
            if (page == 3) {
              tabs->setCurrentIndex(tab);
              QTest::qWait(5);
            }
            if (page == 4) {
              tool->setCurrentIndex(tab);
              QTest::qWait(5);
            }
            for (auto area : window.findChildren<QScrollArea *>())
              if (area->isVisible()) {
                if (area->horizontalScrollBar()->maximum() != 0)
                  for (auto child : area->findChildren<QWidget *>())
                    if (child->isVisible() &&
                        child->minimumSizeHint().width() >
                            area->viewport()->width() - 25)
                      qDebug()
                          << child->metaObject()->className()
                          << child->objectName() << child->minimumSizeHint()
                          << (qobject_cast<QPushButton *>(child)
                                  ? qobject_cast<QPushButton *>(child)->text()
                                  : QString());
                QVERIFY2(area->horizontalScrollBar()->maximum() == 0,
                         qPrintable("Horizontal overflow on page " +
                                    QString::number(page) + ", tab " +
                                    QString::number(tab) + " at " +
                                    QString::number(size.width()) + " / " +
                                    QString::number(scale)));
              }
          }
          tabs->setCurrentIndex(0);
        }
        window.findChild<QStackedWidget *>("dashboardPages")->setCurrentIndex(0);
      }
    }
    auto page = window.findChildren<QComboBox *>();
    for (auto box : page)
      if (box->accessibleName() == "Dashboard page") {
        for (int i : {2, 3, 0}) {
          box->setCurrentIndex(i);
          QMetaObject::invokeMethod(box, "activated", Q_ARG(int, i));
          QTest::qWait(10);
        }
        break; // Page changes can rebuild the remaining controls in the
               // snapshot.
      }
    if (!qEnvironmentVariable("STORMDESK_UI_CAPTURE").isEmpty()) {
      window.applyScale(1.5);
      window.resize(800, 480);
      QTest::qWait(30);
      QVERIFY(window.grab().save(qEnvironmentVariable("STORMDESK_UI_CAPTURE")));
    }
  }
};
QTEST_MAIN(UiTest)
#include "ui_tests.moc"
