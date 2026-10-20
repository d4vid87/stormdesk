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
#include <QPointer>
#include <QScrollArea>
#include <QScrollBar>
#include <QSettings>
#include <QStandardPaths>
#include <QTabWidget>
#include <QTemporaryDir>
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
    QVERIFY(sunCycle->accessibleDescription().contains("06:00"));
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
    QVERIFY(shelf->height() <= stage->height() / 3);
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
    window.findChild<QPushButton *>("weatherMotion")->click();
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
    auto stack = window.findChild<QStackedWidget *>();
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
    window.findChild<QStackedWidget *>()->setCurrentIndex(4);
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
        window.findChild<QStackedWidget *>()->currentWidget());
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
    invalid[0] = double(now);
    invalid[2] = 1;
    invalid[4] = -999;
    invalid[7] = 20;
    QVERIFY(db.insert(invalid, 0, "tempest:fixture", &error));
    invalid[0] = double(now + 1);
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
          window.findChild<QStackedWidget *>()->setCurrentIndex(page);
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
        window.findChild<QStackedWidget *>()->setCurrentIndex(0);
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
