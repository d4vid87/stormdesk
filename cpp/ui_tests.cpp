#include "radar.h"
#include "tools.h"
#include "window.h"
#include <QFontDatabase>
#include <QListWidget>
#include <QMessageBox>
#include <QNetworkProxy>
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
#ifdef Q_OS_WIN
    // The offscreen plugin does not load the Windows system font database.
    QVERIFY(QFontDatabase::addApplicationFont(qEnvironmentVariable("WINDIR") +
                                              "/Fonts/segoeui.ttf") >= 0);
    QApplication::setFont(QFont("Segoe UI"));
#endif
  }
  void nativeMapsAndCustomization() {
    QCOMPARE(mercator(0, 0, 2), QPointF(512, 512));
    QVERIFY(std::isfinite(mercator(90, 0, 7).y()));
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
    auto list = window.findChild<QListWidget *>();
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
    QCOMPARE(current->item(0, 3)->text(), QString("4.0"));
    auto area = tools->findChild<QScrollArea *>();
    QVERIFY(area);
    QVERIFY(area->verticalScrollBar()->maximum() > 0);
    auto contents = area->widget();
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
        QVERIFY2(window.width() <= size.width(),
                 qPrintable("Window cannot fit width " +
                            QString::number(size.width()) + " at " +
                            QString::number(scale)));
        for (int page : {0, 1, 2, 3, 4}) {
          window.findChild<QStackedWidget *>()->setCurrentIndex(page);
          QTest::qWait(10);
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
