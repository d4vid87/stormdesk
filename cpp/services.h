#pragma once
#include "core.h"
#include <QHash>
#include <QNetworkAccessManager>
#include <QObject>
#include <QTimer>
#include <QUdpSocket>
#include <functional>

namespace storm {
class Services : public QObject {
  Q_OBJECT
public:
  Services(Config &config, Archive &archive, QObject *parent = nullptr);
  Config &config;
  Archive &archive;
  QNetworkAccessManager network;
  QJsonObject forecast, packets, diagnostics, mqttValues;
  QJsonArray warnings, discovered;
  Reading observation{};
  QString stationStatus = "Waiting for station",
          forecastStatus = "Choose a location in Settings";
  QString warningStatus;
  bool start(QString *error, bool udp = true);
  void refresh();
  void resetRuntime();
  void pollStation();
  void pollForecast();
  void pollWarnings();
  void checkRules();
  int ingest(const QUrl &url, const QByteArray &body);
  bool accept(const Reading &row, int source, const QString &identity,
              const QString &origin, const QJsonObject &metadata = {});
  void receivePacket(QJsonObject packet);
  QJsonObject snapshot() const;
  QUrl radarUrl() const;
  void request(const QUrl &url,
               std::function<void(QJsonDocument, QString)> callback,
               const QByteArray &body = {},
               const QByteArray &authorization = {},
               const QByteArray &method = "GET");
  void push(const QString &title, const QString &message);
signals:
  void discoveryRequested();
  void changed();
  void packetReceived(QJsonObject packet);
  void notification(QString title, QString message);

private:
  QUdpSocket udp;
  QTimer stationTimer, forecastTimer, warningTimer, rulesTimer;
  QHash<QString, Counters> counters;
  QHash<QString, qint64> keptAt;
  QHash<QString, double> rawAt;
  QHash<QString, qint64> ruleSince;
  QHash<QString, bool> latched;
  QString rulesRevision, warningLocation;
  bool forecastBusy = false, stationBusy = false, warningsBusy = false;
  void takeFields(const QJsonObject &fields, qint64 rawTime, int source,
                  const QString &origin);
  void pollLaCrosse();
  void backfill();
  bool backfillBusy = false;
  int backfillEmpty = 0;
  QString laCrosseToken;
  qint64 laCrosseTokenAt = 0, lastRulesAt = 0;
  QString laCrosseCredentials;
};
} // namespace storm
