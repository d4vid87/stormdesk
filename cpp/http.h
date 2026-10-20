#pragma once
#include "services.h"
#include <QTcpServer>
#include <QTcpSocket>
#include <QPointer>

namespace storm {
struct HttpRequest {
    QByteArray method, target, body;
    QHash<QByteArray, QByteArray> headers;
    static int parse(const QByteArray &bytes, HttpRequest *out, qsizetype *consumed);
};
class HttpServer : public QTcpServer {
    Q_OBJECT
public:
    explicit HttpServer(Services &services, QObject *parent = nullptr);
    Services &services;
    bool start(quint16 port, const QHostAddress &address, QString *error);
    QJsonObject pairCode();
    QString siteDirectory;
    static void respond(QTcpSocket *socket, int code, const QByteArray &body = {}, const QByteArray &type = "application/json");
private:
    QList<QPointer<QTcpSocket>> streams;
    QString code;
    qint64 expires = 0;
    QHash<QString, QPair<qint64, int>> pairFailures;
    QTimer keepAlive;
    void route(QTcpSocket *socket, const HttpRequest &request);
    bool authorized(QTcpSocket *socket, const HttpRequest &request) const;
    bool sameOrigin(const HttpRequest &request) const;
    void event(const QString &type, const QJsonObject &data);
};
}
