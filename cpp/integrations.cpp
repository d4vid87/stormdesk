#include "integrations.h"
#include <QDateTime>
#include <QJsonDocument>
#include <QNetworkReply>
#include <QPointer>
#include <QRegularExpression>
#include <QSqlQuery>
#include <QTcpSocket>
#include <QUrlQuery>
#include <cmath>
#ifdef STORMDESK_MQTT
#include <mosquitto.h>
#endif

namespace storm {
static QString digits(std::optional<double> value, int width,
                      double factor = 1) {
  if (!value || !std::isfinite(*value))
    return QString(width, '.');
  return QString::number(std::clamp(qRound64(*value * factor), qint64(0),
                                    qint64(std::pow(10, width) - 1)))
      .rightJustified(width, '0');
}
QString cwopPacket(const QString &id, double lat, double lon, const Reading &r,
                   double rainHour, double rainDay) {
  if (!QRegularExpression("^[A-Z0-9-]{3,12}$").match(id).hasMatch() ||
      std::abs(lat) > 90 || std::abs(lon) > 180 || !r[0])
    return {};
  auto position = [](double n, bool latitude) {
    double abs = std::abs(n);
    auto deg = int(abs);
    double minutes = (abs - deg) * 60;
    if (minutes >= 59.995) {
      ++deg;
      minutes = 0;
    }
    return QString::number(deg).rightJustified(latitude ? 2 : 3, '0') +
           QString::number(minutes, 'f', 2).rightJustified(5, '0') +
           (latitude ? (n < 0 ? "S" : "N") : (n < 0 ? "W" : "E"));
  };
  QString temp = "...";
  if (r[7]) {
    double f = *r[7] * 1.8 + 32;
    temp = f < 0 ? '-' + digits(-f, 2) : digits(f, 3);
  }
  QString humidity = r[8] && *r[8] >= 99.5 ? "00" : digits(r[8], 2);
  return id + ">APRS,TCPIP*:@" +
         QDateTime::fromSecsSinceEpoch(qint64(*r[0]))
             .toUTC()
             .toString("ddHHmm") +
         "z" + position(lat, true) + "/" + position(lon, false) + "_" +
         digits(r[4], 3) + "/" + digits(r[2], 3, 1 / .44704) + "g" +
         digits(r[3], 3, 1 / .44704) + "t" + temp + "r" +
         digits(rainHour, 3, 100 / 25.4) + "p" +
         digits(rainDay, 3, 100 / 25.4) + "P" + digits(r[18], 3, 100 / 25.4) +
         "h" + humidity + (r[6] ? "b" + digits(r[6], 5, 10) : "") + "StormDesk";
}
Integrations::Integrations(Services &s) : services(s) {
  connect(&timer, &QTimer::timeout, this, &Integrations::tick);
  connect(&reporting, &QTimer::timeout, this, &Integrations::relay);
  connect(&services, &Services::notification, this,
          [this](const QString &title, const QString &message) {
            publish(title == "Weather rule" ? "rule" : "alert",
                    message.toUtf8());
          });
}
Integrations::~Integrations() {
#ifdef STORMDESK_MQTT
  if (mqtt) {
    publish("status", "offline");
    mosquitto_disconnect(mqtt);
    mosquitto_loop_stop(mqtt, false);
    mosquitto_destroy(mqtt);
  }
#endif
}
void Integrations::start() {
  timer.start(10000);
  reporting.start(60000);
  tick();
}
void Integrations::publish(const QString &suffix, const QByteArray &payload) {
#ifdef STORMDESK_MQTT
  if (mqtt && connected)
    mosquitto_publish(mqtt, nullptr,
                      (mqttRoot + '/' + suffix).toUtf8().constData(),
                      int(payload.size()), payload.constData(), 1, true);
#else
  Q_UNUSED(suffix);
  Q_UNUSED(payload);
#endif
}
void Integrations::announce() {
#ifdef STORMDESK_MQTT
  const auto station = services.config.text("stationId");
  const auto prefix =
      services.config.text("haDiscoveryPrefix", "homeassistant");
  const QHash<QString, QString> units{
      {"temp", "°C"},      {"humidity", "%"},      {"pressure", "hPa"},
      {"wind_avg", "m/s"}, {"wind_gust", "m/s"},   {"wind_lull", "m/s"},
      {"wind_dir", "°"},   {"uv", "UV index"},     {"solar", "W/m²"},
      {"lux", "lx"},       {"rain", "mm"},         {"day_rain", "mm"},
      {"battery", "V"},    {"strikes", "strikes"}, {"strike_dist", "km"},
      {"feels_like", "°C"}};
  const QHash<QString, QString> classes{
      {"temp", "temperature"},       {"feels_like", "temperature"},
      {"humidity", "humidity"},      {"pressure", "atmospheric_pressure"},
      {"wind_avg", "wind_speed"},    {"wind_gust", "wind_speed"},
      {"wind_lull", "wind_speed"},   {"solar", "irradiance"},
      {"lux", "illuminance"},        {"rain", "precipitation"},
      {"day_rain", "precipitation"}, {"battery", "voltage"},
      {"strike_dist", "distance"}};
  auto keys = units.keys();
  keys << "pressure_trend" << "alert" << "rule";
  for (const auto &key : keys) {
    const auto unique = "wd_" + station + '_' + key;
    QJsonObject cfg{
        {"name", QString(key).replace('_', ' ')},
        {"unique_id", unique},
        {"state_topic", mqttRoot + '/' + key},
        {"availability_topic", mqttRoot + "/status"},
        {"device",
         QJsonObject{{"identifiers", QJsonArray{"stormdesk_" + station}},
                     {"name", services.config.text("stationName", "StormDesk")},
                     {"manufacturer", "StormDesk"},
                     {"model", "Weather station"},
                     {"sw_version", STORMDESK_VERSION}}}};
    if (units.contains(key)) {
      cfg["unit_of_measurement"] = units.value(key);
      cfg["state_class"] =
          key == "day_rain" ? "total_increasing" : "measurement";
    }
    if (classes.contains(key))
      cfg["device_class"] = classes.value(key);
    if (key != "alert" && key != "rule")
      cfg["expire_after"] = 1800;
    const auto payload = QJsonDocument(cfg).toJson(QJsonDocument::Compact);
    mosquitto_publish(
        mqtt, nullptr,
        (prefix + "/sensor/" + unique + "/config").toUtf8().constData(),
        int(payload.size()), payload.constData(), 1, true);
  }
  publish("status", "online");
#endif
}
void Integrations::tick() {
  const auto &cfg = services.config;
  const auto address = cfg.text("mqttUrl");
  if (address.isEmpty()) {
#ifdef STORMDESK_MQTT
    if (mqtt) {
      publish("status", "offline");
      mosquitto_disconnect(mqtt);
      mosquitto_loop_stop(mqtt, false);
      mosquitto_destroy(mqtt);
      mqtt = nullptr;
    }
#endif
    connected = false;
    mqttConfig.clear();
    return;
  }
#ifdef STORMDESK_MQTT
  QJsonObject signature{{"url", address},
                        {"user", cfg.text("mqttUser")},
                        {"pass", cfg.text("mqttPass")},
                        {"id", cfg.text("stationId")},
                        {"name", cfg.text("stationName")},
                        {"prefix", cfg.text("haDiscoveryPrefix")},
                        {"subscriptions", cfg.settings().value("mqttSubs")}};
  auto next = QString::fromUtf8(
      QJsonDocument(signature).toJson(QJsonDocument::Compact));
  if (next != mqttConfig) {
    if (mqtt) {
      publish("status", "offline");
      mosquitto_disconnect(mqtt);
      mosquitto_loop_stop(mqtt, false);
      mosquitto_destroy(mqtt);
      mqtt = nullptr;
    }
    connected = false;
    mqttConfig = next;
    QUrl url(address.contains("://") ? address : "mqtt://" + address);
    const auto station = cfg.text("stationId");
    if ((url.scheme() != "mqtt" && url.scheme() != "mqtts") ||
        url.host().isEmpty() || station.isEmpty() ||
        station.contains(QRegularExpression("[+#/\\s]"))) {
      services.diagnostics["mqtt"] =
          QJsonObject{{"ok", false},
                      {"what", "Use mqtt:// or mqtts:// and a station ID "
                               "without topic separators"}};
      return;
    }
    mosquitto_lib_init();
    mqttRoot = "stormdesk/" + station;
    mqtt = mosquitto_new(("stormdesk-" + station).toUtf8().constData(), true,
                         this);
    if (!mqtt)
      return;
    mosquitto_reconnect_delay_set(mqtt, 2, 60, true);
    if (!cfg.text("mqttUser").isEmpty())
      mosquitto_username_pw_set(mqtt, cfg.text("mqttUser").toUtf8().constData(),
                                cfg.text("mqttPass").toUtf8().constData());
    if (url.scheme() == "mqtts")
      mosquitto_int_option(mqtt, MOSQ_OPT_TLS_USE_OS_CERTS, 1);
    mosquitto_will_set(mqtt, (mqttRoot + "/status").toUtf8().constData(), 7,
                       "offline", 1, true);
    mosquitto_connect_callback_set(mqtt, [](mosquitto *client, void *context,
                                            int result) {
      auto self = static_cast<Integrations *>(context);
      QMetaObject::invokeMethod(
          self,
          [self, client, result] {
            if (self->mqtt != client)
              return;
            self->connected = result == 0;
            self->services.diagnostics["mqtt"] = QJsonObject{
                {"ok", result == 0},
                {"what",
                 result == 0 ? "Connected" : "Broker refused connection"}};
            if (self->connected)
              self->announce();
            if (self->connected)
              for (const auto &v : self->services.config.settings()
                                       .value("mqttSubs")
                                       .toArray()) {
                auto topic = v.toObject().value("topic").toString().toUtf8();
                if (!topic.isEmpty() && topic.size() <= 256)
                  mosquitto_subscribe(client, nullptr, topic.constData(), 1);
              }
            emit self->services.changed();
          },
          Qt::QueuedConnection);
    });
    mosquitto_disconnect_callback_set(
        mqtt, [](mosquitto *client, void *context, int) {
          auto self = static_cast<Integrations *>(context);
          QMetaObject::invokeMethod(
              self,
              [self, client] {
                if (self->mqtt == client)
                  self->connected = false;
              },
              Qt::QueuedConnection);
        });
    mosquitto_message_callback_set(mqtt, [](mosquitto *client, void *context,
                                            const mosquitto_message *message) {
      if (!message || message->payloadlen < 0 || message->payloadlen > 65536)
        return;
      auto self = static_cast<Integrations *>(context);
      const QString topic = QString::fromUtf8(message->topic);
      const QString payload = QString::fromUtf8(
          static_cast<const char *>(message->payload), message->payloadlen);
      QMetaObject::invokeMethod(
          self,
          [self, client, topic, payload] {
            if (self->mqtt != client)
              return;
            if (!self->services.mqttValues.contains(topic) &&
                self->services.mqttValues.size() >= 100)
              return;
            self->services.mqttValues[topic] =
                QJsonObject{{"value", payload},
                            {"at", double(QDateTime::currentSecsSinceEpoch())}};
            emit self->services.changed();
          },
          Qt::QueuedConnection);
    });
    int result = mosquitto_connect_async(
        mqtt, url.host().toUtf8().constData(),
        url.port(url.scheme() == "mqtts" ? 8883 : 1883), 60);
    if (result == MOSQ_ERR_SUCCESS)
      result = mosquitto_loop_start(mqtt);
    if (result != MOSQ_ERR_SUCCESS) {
      mqttConfig.clear();
      services.diagnostics["mqtt"] = QJsonObject{
          {"ok", false}, {"what", "MQTT connection could not start"}};
    }
  }
  const auto row = services.archive.current();
  if (row.value("at").toDouble() < QDateTime::currentSecsSinceEpoch() - 900)
    return;
  for (auto it = row.begin(); it != row.end(); ++it) {
    if (it.value().isDouble() && it.key() != "at")
      publish(it.key(), QByteArray::number(it.value().toDouble(), 'g', 12));
    else if (it.value().isString())
      publish(it.key(), it.value().toString().toUtf8());
  }
#else
  services.diagnostics["mqtt"] = QJsonObject{
      {"ok", false}, {"what", "This build does not include libmosquitto"}};
#endif
}
void Integrations::relay() {
  const auto &cfg = services.config;
  const auto r = services.archive.latest();
  const auto now = QDateTime::currentSecsSinceEpoch();
  if (!r[0] || now - *r[0] > 900)
    return;
  QSqlQuery q(services.archive.db);
  q.prepare("SELECT SUM(CASE WHEN ts>=? THEN rain END), SUM(rain) FROM obs "
            "WHERE ts>=?");
  q.addBindValue(now - 3600);
  q.addBindValue(now - 86400);
  if (!q.exec() || !q.next())
    return;
  double hour = q.value(0).toDouble(), day = q.value(1).toDouble();
  const auto id = cfg.text("cwopId");
  if (!id.isEmpty() && now - lastCwop >= 600) {
    lastCwop = now;
    const auto packet = cwopPacket(id, cfg.number("lat", 999),
                                   cfg.number("lon", 999), r, hour, day);
    if (!packet.isEmpty()) {
      auto socket = new QTcpSocket(this);
      socket->connectToHost("cwop.aprs.net", 14580);
      connect(socket, &QTcpSocket::connected, socket, [socket, id, packet] {
        socket->write(("user " + id +
                       " pass -1 vers StormDesk " STORMDESK_VERSION "\r\n" +
                       packet + "\r\n")
                          .toUtf8());
        socket->disconnectFromHost();
      });
      connect(socket, &QTcpSocket::disconnected, socket, &QObject::deleteLater);
      QTimer::singleShot(15000, socket, [socket] {
        socket->abort();
        socket->deleteLater();
      });
    }
  }
  if (now - lastRelay < 60)
    return;
  lastRelay = now;
  for (const auto &site : QStringList{"wu", "pws"}) {
    if (cfg.text(site + "Id").isEmpty() || cfg.text(site + "Key").isEmpty())
      continue;
    QUrl url(site == "wu"
                 ? "https://weatherstation.wunderground.com/weatherstation/"
                   "updateweatherstation.php"
                 : "https://www.pwsweather.com/pwsupdate/pwsupdate.php");
    QUrlQuery params;
    params.addQueryItem("ID", cfg.text(site + "Id"));
    params.addQueryItem("PASSWORD", cfg.text(site + "Key"));
    params.addQueryItem("dateutc", QDateTime::fromSecsSinceEpoch(qint64(*r[0]))
                                       .toUTC()
                                       .toString("yyyy-MM-dd HH:mm:ss"));
    params.addQueryItem("action", "updateraw");
    params.addQueryItem("softwaretype", "StormDesk");
    auto put = [&params](const QString &key, std::optional<double> value,
                         double factor = 1, double shift = 0) {
      if (value)
        params.addQueryItem(key,
                            QString::number(*value * factor + shift, 'f', 3));
    };
    put("tempf", r[7], 1.8, 32);
    put("humidity", r[8]);
    put("winddir", r[4]);
    put("windspeedmph", r[2], 1 / .44704);
    put("windgustmph", r[3], 1 / .44704);
    put("baromin", r[6], 1 / 33.8639);
    put("UV", r[10]);
    put("solarradiation", r[11]);
    put("rainin", hour, 1 / 25.4);
    put("dailyrainin", r[18], 1 / 25.4);
    url.setQuery(params);
    QNetworkRequest req(url);
    req.setTransferTimeout(15000);
    auto reply = services.network.get(req);
    connect(reply, &QNetworkReply::finished, this, [this, reply, site] {
      services.diagnostics[site] = QJsonObject{
          {"ok", reply->error() == QNetworkReply::NoError},
          {"what", reply->error() == QNetworkReply::NoError ? "Upload sent"
                                                            : "Upload failed"}};
      reply->deleteLater();
    });
  }
}
} // namespace storm
