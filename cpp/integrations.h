#pragma once
#include "services.h"
struct mosquitto;
namespace storm {
QString cwopPacket(const QString &id, double latitude, double longitude,
                   const Reading &row, double rainHour, double rainDay);
class Integrations : public QObject {
  Q_OBJECT
public:
  explicit Integrations(Services &services);
  ~Integrations();
  void start();

private:
  Services &services;
  QTimer timer, reporting;
  mosquitto *mqtt = nullptr;
  QString mqttConfig, mqttRoot;
  bool connected = false;
  qint64 lastCwop = 0, lastRelay = 0;
  void tick();
  void publish(const QString &suffix, const QByteArray &payload);
  void announce();
  void relay();
};
} // namespace storm
