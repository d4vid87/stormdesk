#include "discovery.h"
#include "http.h"
#include "integrations.h"
#include <QCommandLineParser>
#include <QCoreApplication>
#include <QDateTime>
#include <QDir>
#include <QFile>
#include <QJsonDocument>
#include <QLockFile>
#include <QNetworkReply>
#include <QProcess>
#include <QTemporaryDir>
#include <QTextStream>
#include <QTimer>
#include <cmath>
#include <memory>
#ifdef STORMDESK_GUI
#include "window.h"
#include "popup.h"
#include <QApplication>
#include <QWindow>
#include <QPixmap>
#ifdef STORMDESK_ANDROID_WEBVIEW
#include <QtWebView>
#endif
class NativeApplication : public QApplication {
public:
  using QApplication::QApplication;
  bool notify(QObject *receiver, QEvent *event) override {
#ifdef Q_OS_ANDROID
    // shortcut: tested Adreno retains partial frames; remove after a Qt upgrade passes device QA.
    if (event->type() == QEvent::UpdateRequest)
      if (auto widget = qobject_cast<QWidget *>(receiver); widget && widget->isWindow())
        widget->update();
#endif
#if defined(Q_OS_ANDROID) && QT_VERSION >= QT_VERSION_CHECK(6, 9, 0)
    if (event->type() == QEvent::Show) {
      auto popup = qobject_cast<QWidget *>(receiver);
      if (popup && popup->windowType() == Qt::Popup && popup->parentWidget()) {
        // Android's popup placement includes the system bars on edge-to-edge surfaces.
        QTimer::singleShot(0, popup, [popup] {
          if (!popup->parentWidget())
            return;
          auto parent = popup->parentWidget()->window()->windowHandle();
          if (parent && popup->isVisible())
            popup->setGeometry(storm::popupBounds(
                popup->geometry(), parent->geometry().marginsRemoved(parent->safeAreaMargins())));
        });
      }
    }
#endif
    return QApplication::notify(receiver, event);
  }
};
#endif

int main(int argc, char **argv) {
#ifdef Q_OS_ANDROID
  qputenv("ANDROID_OPENSSL_SUFFIX", "_3");
#endif
  bool headless = false;
  for (int i = 1; i < argc; ++i) {
    const QByteArray arg(argv[i]);
    if (arg == "--headless" || arg == "--check" || arg == "--version" ||
        arg == "--help" || arg == "--browser")
      headless = true;
  }
  std::unique_ptr<QCoreApplication> app;
#ifdef STORMDESK_GUI
  if (!headless) {
#ifdef STORMDESK_WEBENGINE
    QCoreApplication::setAttribute(Qt::AA_ShareOpenGLContexts);
#endif
#ifdef STORMDESK_ANDROID_WEBVIEW
    QtWebView::initialize();
#endif
    app = std::make_unique<NativeApplication>(argc, argv);
  } else
#endif
    app = std::make_unique<QCoreApplication>(argc, argv);
  QCoreApplication::setApplicationName("StormDesk");
  QCoreApplication::setOrganizationName("StormDesk");
  QCoreApplication::setApplicationVersion(STORMDESK_VERSION);
  QCommandLineParser cli;
  cli.setApplicationDescription("StormDesk native C++ weather dashboard");
  cli.addHelpOption();
  cli.addVersionOption();
  cli.addOptions(
      {{"headless", "Run the collector and LAN dashboard without a window"},
       {"browser", "Run services and open the system browser"},
       {"check",
        "Check a running server; nonzero exit if no recent station reading"},
       {"data-dir", "Store the native app's settings and archive here",
        "directory"},
       {"bind", "HTTP listen address (default: all IPv4 interfaces)", "address",
        "0.0.0.0"},
       {"port", "HTTP port; 0 chooses an available port", "port"},
       {"no-udp", "Do not bind the Tempest UDP broadcast port"},
       {"demo",
        "Use labeled synthetic readings in a disposable data directory"},
       {"scale", "UI size from 0.7 to 2.0", "factor"},
       {"screenshot", "Save the native dashboard as PNG, then exit", "file"}});
  cli.process(*app);
  std::unique_ptr<QTemporaryDir> demo;
  QString directory = cli.value("data-dir");
  if (directory.isEmpty())
    directory = storm::defaultDataDir();
  if (cli.isSet("demo")) {
    demo = std::make_unique<QTemporaryDir>();
    if (!demo->isValid())
      return 1;
    directory = demo->path();
  }
  if (!QDir().mkpath(directory)) {
    qCritical("Cannot create data directory");
    return 1;
  }
  storm::Config config(QDir(directory).filePath("config.json"));
  QString error;
  if (!config.load(&error)) {
    qCritical().noquote() << error;
    return 1;
  }
  bool validPort = false;
  uint port = cli.isSet("port") ? cli.value("port").toUInt(&validPort)
                                : uint(config.number("httpPort", 8088));
  if (!cli.isSet("port"))
    validPort = true;
  if (!validPort || port > 65535) {
    qCritical("Port must be between 0 and 65535");
    return 1;
  }
  if (cli.isSet("check")) {
    QNetworkAccessManager network;
    QNetworkRequest request(
        QUrl("http://127.0.0.1:" + QString::number(port) + "/api/v1"));
    request.setTransferTimeout(5000);
    auto reply = network.get(request);
    QObject::connect(
        reply, &QNetworkReply::finished, app.get(), [&] {
          const auto value = QJsonDocument::fromJson(reply->readAll()).object();
          const auto at =
              value.value("current").toObject().value("at").toDouble();
          bool ok = reply->error() == QNetworkReply::NoError && at > 0 &&
                    QDateTime::currentSecsSinceEpoch() - at < 900;
          QTextStream(stdout)
              << (ok ? "Station reading is recent\n"
                     : "Server unavailable or station reading missing/stale\n");
          app->exit(ok ? 0 : 1);
        });
    QTimer::singleShot(6000, app.get(), [&] { app->exit(1); });
    return app->exec();
  }
  QLockFile lock(QDir(directory).filePath("native.lock"));
  if (!lock.tryLock(0)) {
    qCritical("Another native StormDesk instance is using this data directory");
    return 1;
  }
  storm::Archive archive(QDir(directory).filePath("stormdesk.db"));
  if (!archive.open(&error)) {
    qCritical().noquote() << error;
    return 1;
  }
  storm::Services services(config, archive);
  if (demo) {
    config.value = {
        {"settings", QJsonObject{{"stationName", "DEMO · Central Texas"},
                                 {"stationSource", "demo"},
                                 {"stationId", "demo"},
                                 {"lat", 32.6},
                                 {"lon", -97.3},
                                 {"units", "imperial"}}}};
    const auto now = QDateTime::currentSecsSinceEpoch();
    for (int i = 0; i < 48 * 60; ++i) {
      storm::Reading row{};
      row[0] = double(now - (48 * 60 - 1 - i) * 60);
      row[2] = 3.2;
      row[3] = 5.8;
      row[6] = 1015 + std::sin(i / 180.0);
      row[7] = 22 + 5 * std::sin(i / 230.0);
      row[8] = 61;
      row[10] = 2.4;
      row[12] = 0;
      row[15] = 0;
      row[18] = 2.3;
      if (!archive.insert(row, 3, "demo:demo", &error)) {
        qCritical().noquote() << error;
        return 1;
      }
    }
    services.observation = archive.latest();
    services.stationStatus = "DEMO · synthetic station readings";
    QJsonArray times, highs, lows, codes, chances, sunrise, sunset;
    for (int i = 0; i < 10; ++i) {
      auto day = QDateTime(QDate::currentDate().addDays(i), QTime(12, 0));
      times.append(double(day.toSecsSinceEpoch()));
      highs.append(27 + i % 4);
      lows.append(17 + i % 3);
      codes.append(i % 3 ? 2 : 61);
      chances.append(i % 3 ? 10 : 70);
      sunrise.append(
          double(QDateTime(day.date(), QTime(7, 12)).toSecsSinceEpoch()));
      sunset.append(
          double(QDateTime(day.date(), QTime(18, 45)).toSecsSinceEpoch()));
    }
    services.forecast = {
        {"current",
         QJsonObject{{"weather_code", 2}, {"apparent_temperature", 23}}},
        {"utc_offset_seconds", QDateTime::currentDateTime().offsetFromUtc()},
        {"daily", QJsonObject{{"time", times},
                              {"temperature_2m_max", highs},
                              {"temperature_2m_min", lows},
                              {"weather_code", codes},
                              {"precipitation_probability_max", chances},
                              {"sunrise", sunrise},
                              {"sunset", sunset}}}};
    services.forecastStatus = "DEMO · synthetic forecast";
    services.warningStatus = "DEMO · no real warning feed";
  }
  storm::HttpServer server(services);
  QHostAddress bind(cli.value("bind"));
  if (bind.isNull()) {
    qCritical("Invalid bind address");
    return 1;
  }
  if (!server.start(quint16(port), bind, &error)) {
    qCritical().noquote() << error;
    return 1;
  }
  QTextStream(stdout) << "StormDesk " STORMDESK_VERSION " · http://127.0.0.1:"
                      << server.serverPort() << "\nData: " << directory << '\n';
  storm::Integrations integrations(services);
  storm::Discovery discovery(services, server.serverPort());
  if (!demo && !cli.isSet("no-udp"))
    discovery.start();
  if (!demo) {
    services.start(&error, !cli.isSet("no-udp"));
    integrations.start();
  }
  if (cli.isSet("browser")) {
    const QString url =
        "http://127.0.0.1:" + QString::number(server.serverPort());
#ifdef Q_OS_WIN
    const bool opened = QProcess::startDetached(
        "rundll32.exe", {"url.dll,FileProtocolHandler", url});
#elif defined(Q_OS_MACOS)
    const bool opened = QProcess::startDetached("/usr/bin/open", {url});
#else
    const bool opened = QProcess::startDetached("xdg-open", {url});
#endif
    if (!opened)
      qWarning("Could not open the browser; use the printed local address.");
  }
#ifdef STORMDESK_GUI
  std::unique_ptr<storm::Window> window;
  if (!headless) {
#ifdef Q_OS_ANDROID
    window = std::make_unique<storm::Window>(services, server, true);
#else
    window = std::make_unique<storm::Window>(services, server);
#endif
    if (cli.isSet("scale")) {
      bool ok;
      auto value = cli.value("scale").toDouble(&ok);
      if (!ok || value < .7 || value > 2) {
        qCritical("UI scale must be between 0.7 and 2.0");
        return 1;
      }
      window->applyScale(value);
    }
    window->show();
    if (!demo && (config.settings().isEmpty() ||
                  config.settings().value("nativeSetupPending").toBool()))
      QTimer::singleShot(0, window.get(), &storm::Window::setup);
    if (cli.isSet("screenshot"))
      QTimer::singleShot(1000, window.get(), [&] {
        const bool saved = window->grab().save(cli.value("screenshot"));
        app->exit(saved ? 0 : 1);
      });
  }
#else
  Q_UNUSED(headless);
#endif
  return app->exec();
}
