#pragma once
#include "services.h"
#include <QJsonDocument>
#include <QDate>
#include <QSet>

namespace storm {
double solarAltitude(qint64 at, double lat, double lon);
qint64 solarCrossing(qint64 around, double lat, double lon, double altitude,
                     bool rising);
QJsonObject moonPhase(qint64 at);
bool pointInGeometry(double lon, double lat, const QJsonObject &geometry);
QString outlookRisk(const QJsonObject &geo, double lat, double lon);
QJsonObject newestDrought(const QJsonArray &rows);
QJsonObject modelConfidence(const QJsonObject &models, const QJsonObject &event,
                            qint64 fetched, qint64 at);
QJsonArray weatherTimeline(const QJsonObject &forecast,
                           const QJsonArray &observations,
                           const QJsonArray &warnings, const QJsonObject &air,
                           const QJsonObject &nowcast,
                           const QJsonObject &preferences, qint64 at);
QJsonObject archiveSummary(const QJsonArray &days);

// Providers are requested on demand by the visible native tool; all values stay
// in SI.
class Advanced : public QObject {
  Q_OBJECT
public:
  explicit Advanced(Services &services);
  Services &services;
  QHash<QString, QJsonDocument> data;
  QHash<QString, QString> errors;
  QHash<QString, qint64> fetched;
  void load(const QString &kind, bool force = false);
  void recordForecast();
  QJsonArray snapshots() const;
  QJsonArray verification() const;
signals:
  void changed();

private:
  QSet<QString> busy;
  QSet<QString> pending;
  QString locationKey;
  void fetch(const QString &kind, const QUrl &url, bool force,
             int lifetime = 900, const QByteArray &auth = {});
  void drought(bool force);
  QString key() const;
};
} // namespace storm
