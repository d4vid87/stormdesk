#pragma once
#include "services.h"
#include <QPointer>
#include <QTcpServer>
#include <QTcpSocket>
#include <QTemporaryFile>
#include <memory>

namespace storm {
class Advanced;
struct HttpRequest {
  QByteArray method, target, body;
  QHash<QByteArray, QByteArray> headers;
  static int parse(const QByteArray &bytes, HttpRequest *out,
                   qsizetype *consumed, bool headersOnly = false);
};
class HttpServer : public QTcpServer {
  Q_OBJECT
public:
  explicit HttpServer(Services &services, QObject *parent = nullptr);
  Services &services;
  bool start(quint16 port, const QHostAddress &address, QString *error);
  QJsonObject pairCode();
  QString siteDirectory;
  static void respond(QTcpSocket *socket, int code, const QByteArray &body = {},
                      const QByteArray &type = "application/json");

private:
  QList<QPointer<QTcpSocket>> streams;
  QString code;
  qint64 expires = 0;
  QHash<QString, QPair<qint64, int>> pairFailures;
  QTimer keepAlive;
  Advanced *providers;
  int activeRestores = 0;
  QHash<QString, QPair<qint64, std::shared_ptr<QTemporaryFile>>> restores;
  void inspectUpload(QTcpSocket *socket, std::shared_ptr<QTemporaryFile> file);
  void route(QTcpSocket *socket, const HttpRequest &request);
  bool authorized(QTcpSocket *socket, const HttpRequest &request) const;
  bool sameOrigin(const HttpRequest &request) const;
  void event(const QString &type, const QJsonObject &data);
};
} // namespace storm
