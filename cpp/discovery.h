#pragma once
#include "services.h"

namespace storm {
QJsonArray decodeDns(const QByteArray &packet);
QByteArray serviceAnnouncement(const QString &host, const QString &address,
                               quint16 port, quint32 ttl = 120);
class Discovery : public QObject {
  Q_OBJECT
public:
  Discovery(Services &services, quint16 port);
  bool start();
  void scan();

private:
  Services &services;
  quint16 port;
  QUdpSocket socket;
  QTimer timer;
  struct Found {
    QString target;
    int port = 80;
    qint64 expires = 0;
  };
  QHash<QString, Found> consoles;
  QHash<QString, QPair<QString, qint64>> addresses;
  QString host, address;
  void publish();
};
} // namespace storm
