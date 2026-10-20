#include "http.h"
#include <QCryptographicHash>
#include <QCoreApplication>
#include <memory>
#include <QDateTime>
#include <QDir>
#include <QFile>
#include <QJsonDocument>
#include <QMimeDatabase>
#include <QNetworkInterface>
#include <QRandomGenerator>
#include <QRegularExpression>
#include <QStandardPaths>
#include <QTemporaryDir>
#include <QUrlQuery>
#include <QUuid>
#include <QSqlQuery>
#include <algorithm>
#include <QResource>

static void initSiteResources() { Q_INIT_RESOURCE(siteassets); }
namespace storm {
static constexpr qsizetype maxHeader = 16384, maxBody = 256 * 1024;
int HttpRequest::parse(const QByteArray &bytes, HttpRequest *out, qsizetype *consumed) {
    auto end = bytes.indexOf("\r\n\r\n");
    if (end < 0) return bytes.size() > maxHeader ? 431 : 0;
    if (end > maxHeader) return 431;
    auto lines = bytes.left(end).split('\n');
    const auto first = lines.takeFirst().trimmed().split(' ');
    if (first.size() != 3 || !first[2].startsWith("HTTP/1.") || !first[1].startsWith('/') || first[1].contains('#')) return 400;
    HttpRequest req; req.method = first[0]; req.target = first[1];
    for (auto line : lines) {
        if (line.startsWith(' ') || line.startsWith('\t')) return 400;
        auto colon = line.indexOf(':');
        if (colon < 1) return 400;
        auto key = line.left(colon).toLower(), value = line.mid(colon + 1).trimmed();
        if (req.headers.contains(key)) return 400;
        req.headers[key] = value;
    }
    if (!req.headers.contains("host")) return 400;
    if (req.headers.contains("transfer-encoding")) return 501;
    bool ok = true; qint64 length = 0;
    if (req.headers.contains("content-length")) length = req.headers.value("content-length").toLongLong(&ok);
    if (!ok || length < 0) return 400;
    if (length > maxBody) return 413;
    if ((req.method == "PUT" || req.method == "POST") && !req.headers.contains("content-length")) return 411;
    if (bytes.size() < end + 4 + length) return 0;
    req.body = bytes.mid(end + 4, length); *out = req; *consumed = end + 4 + length;
    return 200;
}
HttpServer::HttpServer(Services &s, QObject *parent) : QTcpServer(parent), services(s) {
    initSiteResources();
    setMaxPendingConnections(32);
    const auto explicitSite = qEnvironmentVariable("WD_SITE_DIR");
    if (!explicitSite.isEmpty()) siteDirectory = explicitSite;
    else siteDirectory = ":/site";
    connect(this, &QTcpServer::newConnection, this, [this] {
        while (hasPendingConnections()) {
            auto socket = nextPendingConnection();
            if (findChildren<QTcpSocket *>().size() > 128) { socket->abort(); socket->deleteLater(); continue; }
            socket->setReadBufferSize(maxHeader + maxBody + 4);
            auto bytes = std::make_shared<QByteArray>();
            auto deadline = new QTimer(socket); deadline->setSingleShot(true); deadline->start(15000);
            connect(deadline, &QTimer::timeout, socket, [socket] { respond(socket, 408); });
            connect(socket, &QTcpSocket::disconnected, socket, &QObject::deleteLater);
            auto connection = std::make_shared<QMetaObject::Connection>();
            *connection = connect(socket, &QTcpSocket::readyRead, this, [this, socket, bytes, deadline, connection] {
                bytes->append(socket->readAll());
                HttpRequest req; qsizetype used = 0;
                const int status = HttpRequest::parse(*bytes, &req, &used);
                if (!status) return;
                disconnect(*connection); deadline->stop();
                if (status != 200) { respond(socket, status); return; }
                route(socket, req);
            });
        }
    });
    connect(&services, &Services::packetReceived, this, [this](const QJsonObject &p) { event("udp", {{p.value("type").toString(), p}}); });
    keepAlive.start(15000);
    connect(&keepAlive, &QTimer::timeout, this, [this] {
        for (auto &s : streams) if (s && s->state() == QAbstractSocket::ConnectedState) s->write(": ping\n\n");
        streams.erase(std::remove_if(streams.begin(), streams.end(), [](auto &s) { return !s || s->state() != QAbstractSocket::ConnectedState; }), streams.end());
    });
}
bool HttpServer::start(quint16 port, const QHostAddress &address, QString *error) {
    if (listen(address, port)) return true;
    if (error) *error = "HTTP server could not bind: " + errorString();
    return false;
}
void HttpServer::respond(QTcpSocket *socket, int code, const QByteArray &body, const QByteArray &type) {
    if (!socket || socket->state() != QAbstractSocket::ConnectedState) return;
    socket->write("HTTP/1.1 " + QByteArray::number(code) + " Response\r\nContent-Type: " + type + "\r\nContent-Length: " + QByteArray::number(body.size()) +
        "\r\nConnection: close\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, PUT, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, Authorization\r\nX-Content-Type-Options: nosniff\r\n\r\n");
    socket->write(body); socket->disconnectFromHost();
}
bool HttpServer::sameOrigin(const HttpRequest &req) const {
    const auto host = QUrl("http://" + QString::fromUtf8(req.headers.value("host")));
    const QHostAddress address(host.host());
    bool valid = host.host() == "localhost" || address.isLoopback() || QNetworkInterface::allAddresses().contains(address);
    if (!valid || host.port(serverPort()) != serverPort()) return false;
    const auto origin = req.headers.value("origin");
    if (origin.isEmpty()) return req.headers.value("sec-fetch-site") != "cross-site";
    const auto u = QUrl(QString::fromUtf8(origin));
    return u.scheme() == "http" && u.host() == host.host() && u.port(80) == host.port(80);
}
bool HttpServer::authorized(QTcpSocket *socket, const HttpRequest &req) const {
    const auto auth = req.headers.value("authorization");
    if (auth.startsWith("Bearer ")) {
        const auto hash = QString::fromLatin1(QCryptographicHash::hash(auth.mid(7), QCryptographicHash::Sha256).toHex());
        for (const auto &v : services.config.value.value("_access").toObject().value("editors").toArray()) {
            auto e = v.toObject(); if (e.value("hash").toString() == hash && !e.value("revoked").toBool()) return true;
        }
    }
    return socket->peerAddress().isLoopback() && sameOrigin(req);
}
QJsonObject HttpServer::pairCode() {
    code = QString::number(QRandomGenerator::system()->bounded(1000000)).rightJustified(6, '0');
    expires = QDateTime::currentSecsSinceEpoch() + 600;
    return {{"code", code}, {"expires", double(expires)}};
}
void HttpServer::event(const QString &type, const QJsonObject &data) {
    auto frame = "event: " + type.toUtf8() + "\ndata: " + QJsonDocument(data).toJson(QJsonDocument::Compact) + "\n\n";
    for (auto &s : streams) {
        if (!s) continue;
        if (s->bytesToWrite() > 256 * 1024) s->abort();
        else s->write(frame);
    }
}
void HttpServer::route(QTcpSocket *socket, const HttpRequest &req) {
    const QUrl url = QUrl::fromEncoded(req.target); const auto path = url.path();
    auto json = [socket](const QJsonValue &value, int status = 200) {
        const auto bytes = value.isArray() ? QJsonDocument(value.toArray()).toJson(QJsonDocument::Compact) : QJsonDocument(value.toObject()).toJson(QJsonDocument::Compact);
        respond(socket, status, bytes);
    };
    const bool push = path == "/ingest" || path.startsWith("/ingest/") || path == "/updateweatherstation.php" || path.startsWith("/weatherstation/") || path == "/data/report" || path == "/data/report/";
    const bool privateRoute = path == "/config" || path.startsWith("/pair/") || path == "/diag" || path.startsWith("/health") || path.startsWith("/backup") ||
        path.startsWith("/restore") || path.startsWith("/archive/") || path == "/history.csv" || path.startsWith("/ha/") || path == "/alerts/test" || path.startsWith("/discover/");
    const bool pairing = path == "/pair/claim";
    if (req.method == "OPTIONS") { respond(socket, 204); return; }
    if (privateRoute && !pairing && !authorized(socket, req)) { respond(socket, 401); return; }
    if (push) {
        if (req.method != "GET" && req.method != "POST") { respond(socket, 405); return; }
        int status = services.ingest(url, req.body); respond(socket, status, status == 200 ? "success" : "", "text/plain"); return;
    }
    if (path == "/config") {
        if (req.method == "GET") json(services.config.value);
        else if (req.method == "PUT") {
            auto doc = QJsonDocument::fromJson(req.body);
            if (!doc.isObject()) { respond(socket, 400); return; }
            QString error; int status = services.config.merge(doc.object(), &error);
            if (status == 204) respond(socket, status); else json(services.config.value, status);
            if (status < 300) { services.refresh(); event("config", {{"rev", services.config.value.value("_rev")}}); }
        } else respond(socket, 405);
        return;
    }
    if (path == "/pair/start" && req.method == "POST") { json(pairCode()); return; }
    if (pairing && req.method == "POST") {
        auto &attempt = pairFailures[socket->peerAddress().toString()]; const auto now = QDateTime::currentSecsSinceEpoch();
        if (attempt.first < now - 600) attempt = {now, 0};
        if (++attempt.second > 10) { respond(socket, 429); return; }
        const auto body = QJsonDocument::fromJson(req.body).object();
        if (code.isEmpty() || now > expires || body.value("code").toString() != code) { respond(socket, 401); return; }
        const auto token = QUuid::createUuid().toString(QUuid::Id128) + QUuid::createUuid().toString(QUuid::Id128);
        auto next = services.config.value; auto access = next.value("_access").toObject(); auto editors = access.value("editors").toArray();
        const auto id = QUuid::createUuid().toString(QUuid::Id128);
        editors.append(QJsonObject{{"id", id}, {"name", body.value("name").toString("Screen").left(80)}, {"hash", QString::fromLatin1(QCryptographicHash::hash(token.toUtf8(), QCryptographicHash::Sha256).toHex())}, {"paired", double(now)}, {"revoked", false}});
        access["editors"] = editors; next["_access"] = access; QString error;
        if (!services.config.save(next, &error)) { respond(socket, 500); return; }
        code.clear(); json(QJsonObject{{"token", token}, {"id", id}}); return;
    }
    if (path == "/pair/devices" && req.method == "GET") {
        QJsonArray devices;
        for (const auto &v : services.config.value.value("_access").toObject().value("editors").toArray()) { auto d = v.toObject(); d.remove("hash"); devices.append(d); }
        json(QJsonObject{{"devices", devices}}); return;
    }
    if (path == "/pair/devices/revoke" && req.method == "POST") {
        auto id = QJsonDocument::fromJson(req.body).object().value("id").toString();
        auto cfg = services.config.value; auto access = cfg.value("_access").toObject(); auto list = access.value("editors").toArray(); bool found = false;
        for (int i = 0; i < list.size(); ++i) { auto e = list[i].toObject(); if (e.value("id") == id) { e["revoked"] = true; list[i] = e; found = true; } }
        if (!found) { respond(socket, 404); return; }
        access["editors"] = list; cfg["_access"] = access; QString error;
        json(QJsonObject{{"ok", services.config.save(cfg, &error)}}); return;
    }
    if (req.method != "GET" && !(path == "/alerts/test" && req.method == "POST")) { respond(socket, 405); return; }
    if (path == "/config-public") { json(services.config.publicValue()); return; }
    if (path == "/api/v1") { json(services.snapshot()); return; }
    if (path == "/udp") { json(services.packets); return; }
    if (path == "/diag") { json(services.diagnostics); return; }
    if (path == "/health") { json(QJsonObject{{"version", STORMDESK_VERSION}, {"archive", services.archive.health()}, {"ingest", services.diagnostics}}); return; }
    if (path == "/history/tuples") {
        auto q = QUrlQuery(url); auto to = q.queryItemValue("to").toLongLong();
        if (!to) to = QDateTime::currentSecsSinceEpoch() + 300;
        auto from = q.queryItemValue("from").toLongLong();
        if (!from) from = to - std::clamp(q.hasQueryItem("hours") ? q.queryItemValue("hours").toInt() : 3, 1, 168) * 3600;
        json(QJsonObject{{"obs", services.archive.tuples(std::max(from, to - 168 * 3600), to)}}); return;
    }
    if (path == "/history/daily") { json(services.archive.daily(QUrlQuery(url).queryItemValue("tz").toInt())); return; }
    if (path == "/history/coverage") {
        auto h = services.archive.health(); h["backfill"] = "off"; h["count"] = h.value("rows"); h["stationFingerprint"] = services.archive.meta("station_fingerprint"); json(h); return;
    }
    if (path == "/events") {
        streams.erase(std::remove_if(streams.begin(), streams.end(), [](const auto &s) { return !s || s->state() != QAbstractSocket::ConnectedState; }), streams.end());
        if (streams.size() >= 8) { respond(socket, 503); return; }
        socket->write("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nConnection: keep-alive\r\n\r\n: connected\n\n");
        streams.append(socket); return;
    }
    if (path == "/backup.wdbak" || path == "/backup.db" || path == "/history.csv") {
        auto temporary = new QTemporaryDir(QDir::tempPath() + "/stormdesk-XXXXXX");
        const auto fileName = temporary->filePath("export"); QString error;
        bool ok = path == "/history.csv" ? services.archive.exportCsv(fileName, &error) : services.archive.backup(fileName, services.config.value, &error);
        if (!ok) { delete temporary; respond(socket, 500); return; }
        auto file = new QFile(fileName, socket);
        if (!file->open(QIODevice::ReadOnly)) { delete temporary; respond(socket, 500); return; }
        socket->write("HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: " + QByteArray::number(file->size()) + "\r\nConnection: close\r\n\r\n");
        auto pump = [file, socket] {
            while (file->bytesAvailable() > 0 && socket->bytesToWrite() < 65536) socket->write(file->read(32768));
            if (file->atEnd() && socket->bytesToWrite() == 0) socket->disconnectFromHost();
        };
        connect(socket, &QTcpSocket::bytesWritten, socket, [pump](qint64) { pump(); });
        connect(socket, &QObject::destroyed, this, [temporary] { delete temporary; }); pump(); return;
    }
    if (path == "/alerts/test") { services.push("StormDesk test", "Your weather notification channel is working."); json(QJsonObject{{"queued", true}}); return; }
    if (path == "/proxy/nhc" || path == "/ha/states" || path == "/ha/test") {
        QUrl upstream = path == "/proxy/nhc" ? QUrl("https://www.nhc.noaa.gov/CurrentStorms.json") : QUrl(services.config.text("haUrl") + "/api/" + (path == "/ha/states" ? "states" : ""));
        QPointer<QTcpSocket> guard(socket);
        services.request(upstream, [guard](QJsonDocument doc, const QString &error) { if (guard) respond(guard, error.isEmpty() ? 200 : 502, error.isEmpty() ? doc.toJson(QJsonDocument::Compact) : "{\"error\":\"Upstream unavailable\"}"); }, {}, path == "/proxy/nhc" ? QByteArray() : "Bearer " + services.config.text("haToken").toUtf8());
        return;
    }
    QString relative = path;
    if (relative == "/" || relative == "/public") relative = "/index.html";
    if (relative.endsWith('/')) relative += "index.html";
    if (relative.contains("..") || relative.contains('\\') || relative.contains(QChar::Null)) { respond(socket, 400); return; }
    const auto root = QFileInfo(siteDirectory).canonicalFilePath();
    const auto target = QFileInfo(QDir(root).filePath(relative.mid(1))).canonicalFilePath();
    if (root.isEmpty() || !target.startsWith(root + '/')) { respond(socket, 404); return; }
    QFile file(target);
    if (file.size() > 16 * 1024 * 1024 || !file.open(QIODevice::ReadOnly)) { respond(socket, 404); return; }
    auto bytes = file.readAll(); auto mime = QMimeDatabase().mimeTypeForFile(target).name().toUtf8();
    if (relative.endsWith(".html")) {
        auto prefix = QString::fromUtf8(req.headers.value("x-ingress-path")).trimmed();
        while (prefix.endsWith('/')) prefix.chop(1);
        if (!QRegularExpression("^/[A-Za-z0-9_/-]*$").match(prefix).hasMatch()) prefix.clear();
        auto script = QByteArray("<script>window.__WD_VER='" STORMDESK_VERSION "';window.__WD_SRV='") + prefix.toUtf8() + "';window.__WD_UDP='" + prefix.toUtf8() + "/udp';</script>";
        bytes.replace("</head>", script + "</head>");
    }
    respond(socket, 200, bytes, mime);
}
}
