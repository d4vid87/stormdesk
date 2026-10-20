#include "window.h"
#include <QtTest>
#include <QTemporaryDir>
#include <QScrollArea>
#include <QScrollBar>
#include <QSettings>
#include <QTabWidget>

using namespace storm;
class UiTest : public QObject {
    Q_OBJECT
private slots:
    void settingsKeepRulesAndUnsetLocation() {
        QTemporaryDir dir; QSettings::setDefaultFormat(QSettings::IniFormat); QSettings::setPath(QSettings::IniFormat, QSettings::UserScope, dir.path());
        Config cfg(dir.filePath("config.json")); QString error; QVERIFY(cfg.load(&error));
        const QJsonObject rule{{"metric", "future-metric"}, {"op", ">"}, {"value", 1.234567}, {"durMin", 1.56789}, {"metric2", "gust"}, {"value2", 12}};
        cfg.value = {{"settings", QJsonObject{{"rules", QJsonArray{rule}}}}};
        Archive db(dir.filePath("db")); QVERIFY(db.open(&error)); Services services(cfg, db); HttpServer server(services); QVERIFY(server.start(0, QHostAddress::LocalHost, &error));
        Window window(services, server); QPushButton *save = nullptr;
        for (auto button : window.findChildren<QPushButton *>()) if (button->text() == "Save changes") save = button;
        QVERIFY(save); save->click();
        QCOMPARE(cfg.settings().value("rules").toArray()[0].toObject(), rule); QVERIFY(!cfg.settings().contains("lat"));
        auto rev = cfg.value.value("_rev"); QCOMPARE(cfg.merge({{"_rev", rev}, {"settings", QJsonObject{{"stationName", "Remote edit"}}}}, &error), 200);
        save->click(); QCOMPARE(cfg.text("stationName"), QString("Remote edit"));
    }
    void scaleAndReflow() {
        QTemporaryDir dir;
        QSettings::setDefaultFormat(QSettings::IniFormat);
        QSettings::setPath(QSettings::IniFormat, QSettings::UserScope, dir.path());
        Config cfg(dir.filePath("config.json")); QString error; QVERIFY(cfg.load(&error));
        Archive db(dir.filePath("db")); QVERIFY(db.open(&error));
        Services services(cfg, db); HttpServer server(services); QVERIFY(server.start(0, QHostAddress::LocalHost, &error));
        Window window(services, server); window.show();
        for (const auto &size : {QSize(360, 800), QSize(800, 480), QSize(1280, 720), QSize(1920, 1080), QSize(3840, 2160)}) {
            for (double scale : {.7, 1.0, 1.5, 2.0}) {
                window.applyScale(scale); window.resize(size); QTest::qWait(10);
                QCOMPARE(window.scale(), scale);
                QVERIFY2(window.width() <= size.width(), qPrintable("Window cannot fit width " + QString::number(size.width()) + " at " + QString::number(scale)));
                for (int page : {0, 2, 3}) {
                    window.findChild<QStackedWidget *>()->setCurrentIndex(page); QTest::qWait(10);
                    auto tabs = window.findChild<QTabWidget *>();
                    const int count = page == 3 ? tabs->count() : 1;
                    for (int tab = 0; tab < count; ++tab) {
                        if (page == 3) { tabs->setCurrentIndex(tab); QTest::qWait(5); }
                        for (auto area : window.findChildren<QScrollArea *>()) if (area->isVisible()) {
                            if (area->horizontalScrollBar()->maximum() != 0) for (auto child : area->findChildren<QWidget *>()) if (child->isVisible() && child->minimumSizeHint().width() > area->viewport()->width() - 25) qDebug() << child->metaObject()->className() << child->objectName() << child->minimumSizeHint() << (qobject_cast<QPushButton *>(child) ? qobject_cast<QPushButton *>(child)->text() : QString());
                            QVERIFY2(area->horizontalScrollBar()->maximum() == 0, qPrintable("Horizontal overflow on page " + QString::number(page) + ", tab " + QString::number(tab) + " at " + QString::number(size.width()) + " / " + QString::number(scale)));
                        }
                    }
                    tabs->setCurrentIndex(0);
                }
                window.findChild<QStackedWidget *>()->setCurrentIndex(0);
            }
        }
        auto page = window.findChildren<QComboBox *>();
        for (auto box : page) if (box->accessibleName() == "Dashboard page") {
            for (int i : {2, 3, 0}) { box->setCurrentIndex(i); QMetaObject::invokeMethod(box, "activated", Q_ARG(int, i)); QTest::qWait(10); }
        }
        if (!qEnvironmentVariable("STORMDESK_UI_CAPTURE").isEmpty()) {
            window.applyScale(1.5); window.resize(800, 480); QTest::qWait(30);
            QVERIFY(window.grab().save(qEnvironmentVariable("STORMDESK_UI_CAPTURE")));
        }
    }
};
QTEST_MAIN(UiTest)
#include "ui_tests.moc"
