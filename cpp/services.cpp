#include "services.h"
#include <QCryptographicHash>
#include <QDateTime>
#include <QDir>
#include <QFile>
#include <QJsonDocument>
#include <QNetworkDatagram>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QRegularExpression>
#include <QSqlQuery>
#include <QUrlQuery>
#include <algorithm>
#include <cmath>

namespace storm {
static QJsonValue item(const QJsonArray &a, int i) {
  return i >= 0 && i < a.size() ? a[i] : QJsonValue();
}
static qint64 now() { return QDateTime::currentSecsSinceEpoch(); }
static QUrl queryUrl(const QString &base,
                     const QList<QPair<QString, QString>> &params) {
  QUrl url(base);
  QUrlQuery q;
  for (const auto &p : params)
    q.addQueryItem(p.first, p.second);
  url.setQuery(q);
  return url;
}
Services::Services(Config &cfg, Archive &db, QObject *parent)
    : QObject(parent), config(cfg), archive(db) {
  connect(this, &Services::notification, this,
          [this](const QString &title, const QString &message) {
            auto log = QJsonDocument::fromJson(
                           archive.meta("native_notifications").toUtf8())
                           .array();
            log.prepend(QJsonObject{
                {"at", double(now())}, {"title", title}, {"message", message}});
            while (log.size() > 100)
              log.removeLast();
            archive.setMeta("native_notifications",
                            QString::fromUtf8(QJsonDocument(log).toJson(
                                QJsonDocument::Compact)));
          });
  connect(&stationTimer, &QTimer::timeout, this, &Services::pollStation);
  connect(&forecastTimer, &QTimer::timeout, this, &Services::pollForecast);
  connect(&warningTimer, &QTimer::timeout, this, &Services::pollWarnings);
  connect(&rulesTimer, &QTimer::timeout, this, &Services::checkRules);
  connect(&udp, &QUdpSocket::readyRead, this, [this] {
    while (udp.hasPendingDatagrams()) {
      auto d = udp.receiveDatagram(65536);
      const auto doc = QJsonDocument::fromJson(d.data());
      if (doc.isObject())
        receivePacket(doc.object());
    }
  });
}
bool Services::start(QString *error, bool listenUdp) {
  observation = archive.latest();
  if (listenUdp &&
      !udp.bind(QHostAddress::AnyIPv4, 50222,
                QUdpSocket::ShareAddress | QUdpSocket::ReuseAddressHint)) {
    stationStatus = "UDP unavailable: " + udp.errorString();
    if (error)
      *error = stationStatus;
  }
  stationTimer.start(10000);
  forecastTimer.start(900000);
  warningTimer.start(120000);
  rulesTimer.start(60000);
  QTimer::singleShot(0, this, &Services::refresh);
  return true;
}
void Services::request(const QUrl &url,
                       std::function<void(QJsonDocument, QString)> callback,
                       const QByteArray &body, const QByteArray &authorization,
                       const QByteArray &method) {
  if (!url.isValid() || (url.scheme() != "https" && url.scheme() != "http") ||
      url.host().isEmpty() || !url.userInfo().isEmpty()) {
    callback({}, "Invalid HTTP address");
    return;
  }
  QNetworkRequest req(url);
  req.setTransferTimeout(20000);
  req.setAttribute(QNetworkRequest::RedirectPolicyAttribute,
                   QNetworkRequest::NoLessSafeRedirectPolicy);
  req.setRawHeader("User-Agent",
                   "StormDesk/" STORMDESK_VERSION " (weather dashboard)");
  req.setRawHeader("Accept", "application/geo+json, application/json");
  if (!authorization.isEmpty())
    req.setRawHeader("Authorization", authorization);
  if (method != "GET")
    req.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
  QNetworkReply *reply = network.sendCustomRequest(req, method, body);
  auto timer = new QTimer(reply);
  timer->setSingleShot(true);
  timer->start(25000);
  connect(timer, &QTimer::timeout, reply, &QNetworkReply::abort);
  connect(reply, &QNetworkReply::readyRead, reply, [reply] {
    if (reply->bytesAvailable() > 8 * 1024 * 1024)
      reply->abort();
  });
  connect(
      reply, &QNetworkReply::finished, this,
      [reply, callback = std::move(callback)] {
        const int status =
            reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        QString error;
        if (reply->error() != QNetworkReply::NoError || status >= 400)
          error = "Request failed (HTTP " + QString::number(status) +
                  ", transport " + QString::number(reply->error()) + ")";
        const auto bytes = reply->readAll();
        QJsonParseError parse;
        auto doc = QJsonDocument::fromJson(bytes, &parse);
        if (error.isEmpty() && !bytes.isEmpty() &&
            parse.error != QJsonParseError::NoError)
          error = "Provider returned invalid JSON";
        reply->deleteLater();
        callback(doc, error);
      });
}
void Services::refresh() {
  const auto place = config.location();
  const auto key = QString::number(place.value("lat").toDouble(), 'g', 12) +
                   "," +
                   QString::number(place.value("lon").toDouble(), 'g', 12);
  if (forecast.contains("_location") &&
      forecast.value("_location").toString() != key) {
    forecast = {};
    warnings = {};
    emit changed();
  }
  pollStation();
  pollForecast();
  pollWarnings();
}
void Services::resetRuntime() {
  observation = archive.latest();
  counters.clear();
  keptAt.clear();
  rawAt.clear();
  ruleSince.clear();
  latched.clear();
  packets = {};
  diagnostics = {};
  laCrosseToken.clear();
  lastRulesAt = 0;
  backfillEmpty = 0;
  forecast = {};
  warnings = {};
  emit changed();
}
void Services::pollForecast() {
  if (forecastBusy)
    return;
  const auto settings = config.location();
  if (settings.value("lat").isNull() || !settings.contains("lat") ||
      !settings.contains("lon"))
    return;
  const double lat = config.location().value("lat").toDouble(999),
               lon = config.location().value("lon").toDouble(999);
  if (std::abs(lat) > 90 || std::abs(lon) > 180) {
    forecastStatus = "Invalid location";
    emit changed();
    return;
  }
  const auto location =
      QString::number(lat, 'g', 12) + "," + QString::number(lon, 'g', 12);
  forecastBusy = true;
  forecastStatus = "Updating forecast…";
  emit changed();
  auto url = queryUrl(
      "https://api.open-meteo.com/v1/forecast",
      {{"latitude", QString::number(lat, 'g', 12)},
       {"longitude", QString::number(lon, 'g', 12)},
       {"current",
        "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,"
        "precipitation,rain,weather_code,cloud_cover,pressure_msl,surface_"
        "pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m"},
       {"daily",
        "weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_"
        "index_max,precipitation_sum,precipitation_probability_max,wind_speed_"
        "10m_max,wind_gusts_10m_max,snowfall_sum"},
       {"hourly",
        "temperature_2m,relative_humidity_2m,precipitation_probability,"
        "precipitation,weather_code,pressure_msl,wind_speed_10m,wind_gusts_10m,"
        "uv_index,shortwave_radiation,dew_point_2m,wet_bulb_temperature_2m"},
       {"wind_speed_unit", "ms"},
       {"forecast_days", "10"},
       {"timezone", "auto"},
       {"timeformat", "unixtime"}});
  request(url, [this, location](QJsonDocument doc, const QString &error) {
    forecastBusy = false;
    if (location !=
        QString::number(config.location().value("lat").toDouble(), 'g', 12) +
            "," +
            QString::number(config.location().value("lon").toDouble(), 'g',
                            12)) {
      pollForecast();
      return;
    }
    if (!error.isEmpty() || !doc.object().contains("current"))
      forecastStatus = error.isEmpty() ? "Forecast unavailable" : error;
    else {
      forecast = doc.object();
      forecast["_at"] = double(now());
      forecast["_location"] = location;
      forecastStatus =
          "Forecast updated " + QDateTime::currentDateTime().toString("HH:mm");
    }
    emit changed();
  });
}
void Services::pollWarnings() {
  if (warningsBusy || !config.location().contains("lat"))
    return;
  double lat = config.location().value("lat").toDouble(999),
         lon = config.location().value("lon").toDouble(999);
  if (std::abs(lat) > 90 || std::abs(lon) > 180)
    return;
  warningsBusy = true;
  auto url = queryUrl("https://api.weather.gov/alerts/active",
                      {{"point", QString::number(lat, 'f', 4) + "," +
                                     QString::number(lon, 'f', 4)}});
  request(url, [this, lat, lon](QJsonDocument doc, const QString &error) {
    warningsBusy = false;
    if (lat != config.location().value("lat").toDouble() ||
        lon != config.location().value("lon").toDouble()) {
      pollWarnings();
      return;
    }
    if (!error.isEmpty())
      warningStatus =
          "US official warnings unavailable; check your local weather service";
    else {
      warnings = doc.object().value("features").toArray();
      warningStatus = "US National Weather Service";
      QStringList seen;
      const auto old = archive.meta("warning_ids").split('\n');
      for (const auto &v : warnings) {
        auto f = v.toObject();
        auto p = f.value("properties").toObject();
        auto id = f.value("id").toString();
        seen << id;
        if (!old.contains(id) && (p.value("severity") == "Severe" ||
                                  p.value("severity") == "Extreme")) {
          const auto title = p.value("event").toString();
          const auto text = p.value("headline").toString();
          emit notification(title, text);
          if (config.settings().value("pushOfficial").toBool(true))
            push(title, text);
        }
      }
      archive.setMeta("warning_ids", seen.join('\n'));
    }
    emit changed();
  });
}
bool Services::accept(const Reading &row, int source, const QString &identity,
                      const QString &origin, const QJsonObject &metadata) {
  if (!row[0] || *row[0] > now() + 300 || *row[0] < 946684800 ||
      (!row[7] && !row[2]))
    return false;
  QString error;
  const QString configured = fingerprint(config.settings());
  if (!archive.insert(row, source, configured == "none" ? identity : configured,
                      &error, metadata)) {
    stationStatus = error;
    diagnostics[origin] =
        QJsonObject{{"at", double(now())}, {"ok", false}, {"what", error}};
    emit changed();
    return false;
  }
  observation = row;
  auto packet = QJsonObject{{"type", "obs_st"},
                            {"obs", QJsonArray{QJsonValue(toJson(row))}},
                            {"_at", double(now())}};
  packets["obs_st"] = packet;
  stationStatus =
      "Live · " + origin + " · " +
      QDateTime::fromSecsSinceEpoch(qint64(*row[0])).toString("HH:mm:ss");
  diagnostics[origin] = QJsonObject{
      {"at", double(now())}, {"ok", true}, {"what", "Reading saved"}};
  emit packetReceived(packet);
  emit changed();
  if (config.stationSource() == "tempest")
    QTimer::singleShot(0, this, &Services::backfill);
  return true;
}
void Services::receivePacket(QJsonObject p) {
  if (config.stationSource() != "tempest" || config.text("nativeTempestConnection") == "cloud")
    return;
  auto type = p.value("type").toString();
  if (type.isEmpty() || type.size() > 64)
    return;
  const auto serial = p.value("serial_number").toString();
  const auto configuredSerial = config.text("tempestSerial");
  if (!configuredSerial.isEmpty() && serial != configuredSerial)
    return;
  if (type == "obs_st") {
    auto r = fromJson(item(p.value("obs").toArray(), 0).toArray());
    if (!r)
      return;
    auto configured = fingerprint(config.settings());
    const auto expected = archive.meta("tempest_serial");
    if (configured == "none" || (!expected.isEmpty() && serial != expected))
      return;
    if (accept(*r, 0, configured, "Tempest UDP") && !serial.isEmpty())
      archive.setMeta("tempest_serial", serial);
  } else {
    if (!QStringList{"rapid_wind", "evt_strike", "device_status", "hub_status",
                     "evt_precip"}
             .contains(type))
      return;
    p["_at"] = double(now());
    packets[type] = p;
    emit packetReceived(p);
    emit changed();
  }
}
void Services::pollLaCrosse() {
  if (stationBusy || config.text("lacrosseEmail").isEmpty() ||
      config.text("lacrossePass").isEmpty())
    return;
  const auto credentials = QString::fromLatin1(
      QCryptographicHash::hash((config.text("lacrosseEmail") + QChar::Null +
                                config.text("lacrossePass"))
                                   .toUtf8(),
                               QCryptographicHash::Sha256)
          .toHex());
  if (credentials != laCrosseCredentials) {
    laCrosseToken.clear();
    laCrosseCredentials = credentials;
  }
  stationBusy = true;
  const auto identity = fingerprint(config.settings());
  if (laCrosseToken.isEmpty() || now() - laCrosseTokenAt > 3000) {
    const QJsonObject login{{"email", config.text("lacrosseEmail")},
                            {"password", config.text("lacrossePass")},
                            {"returnSecureToken", true}};
    request(
        QUrl("https://www.googleapis.com/identitytoolkit/v3/relyingparty/"
             "verifyPassword?key=AIzaSyD-Uo0hkRIeDYJhyyIg-TvAv8HhExARIO4"),
        [this, identity](QJsonDocument doc, const QString &error) {
          stationBusy = false;
          if (identity != fingerprint(config.settings()))
            return;
          laCrosseToken = doc.object().value("idToken").toString();
          laCrosseTokenAt = now();
          if (!error.isEmpty() || laCrosseToken.isEmpty()) {
            stationStatus = "La Crosse sign-in failed";
            emit changed();
            return;
          }
          pollLaCrosse();
        },
        QJsonDocument(login).toJson(QJsonDocument::Compact), {}, "POST");
    return;
  }
  const QString gateway =
      "https://lax-gateway.appspot.com/_ah/api/lacrosseClient/v1.1/active-user";
  const QByteArray auth = "Bearer " + laCrosseToken.toUtf8();
  request(
      QUrl(gateway + "/locations"),
      [this, auth, gateway, identity](QJsonDocument doc, const QString &error) {
        auto locations = doc.object().value("items").toArray();
        auto id =
            item(locations, 0).toObject().value("id").toVariant().toString();
        if (!error.isEmpty() || id.isEmpty() ||
            identity != fingerprint(config.settings())) {
          stationBusy = false;
          stationStatus = "La Crosse location unavailable";
          emit changed();
          return;
        }
        request(
            QUrl(gateway + "/location/" +
                 QString::fromLatin1(QUrl::toPercentEncoding(id)) +
                 "/sensorAssociations?prettyPrint=false"),
            [this, auth, identity](QJsonDocument devices,
                                   const QString &error) {
              auto entries = devices.object().value("items").toArray();
              auto sensor = item(entries, 0)
                                .toObject()
                                .value("sensor")
                                .toObject()
                                .value("id")
                                .toString();
              if (!error.isEmpty() || sensor.isEmpty() ||
                  identity != fingerprint(config.settings())) {
                stationBusy = false;
                stationStatus = "La Crosse sensor unavailable";
                emit changed();
                return;
              }
              auto url =
                  QUrl("https://ingv2.lacrossetechnology.com/api/v1.1/"
                       "active-user/device-association/ref.user-device." +
                       QString::fromLatin1(QUrl::toPercentEncoding(sensor)) +
                       "/feed?fields=temperature,humidity,barometric_pressure,"
                       "wind_speed,wind_heading,rain_total&aggregates=ai.ticks."
                       "1&types=spot");
              request(
                  url,
                  [this, identity](QJsonDocument feed, const QString &error) {
                    stationBusy = false;
                    if (!error.isEmpty() ||
                        identity != fingerprint(config.settings())) {
                      stationStatus = "La Crosse feed unavailable";
                      emit changed();
                      return;
                    }
                    const QHash<QString, QString> names{
                        {"temperature", "temperature_c"},
                        {"humidity", "humidity"},
                        {"barometric_pressure", "pressure_hpa"},
                        {"wind_speed", "wind_avg_m_s"},
                        {"wind_heading", "wind_dir_deg"},
                        {"rain_total", "rain_mm"}};
                    QJsonObject fields;
                    qint64 timestamp = now();
                    const auto root = feed.object();
                    for (auto d = root.begin(); d != root.end(); ++d) {
                      const auto readings = d.value().toObject();
                      for (auto field = readings.begin();
                           field != readings.end(); ++field) {
                        auto values =
                            field.value().toObject().value("values").toArray();
                        auto last = values.isEmpty() ? QJsonObject()
                                                     : values.last().toObject();
                        if (names.contains(field.key()) &&
                            last.value("s").isDouble())
                          fields[names.value(field.key())] = last.value("s");
                        if (last.value("u").isDouble())
                          timestamp = qint64(last.value("u").toDouble());
                      }
                    }
                    if (!fields.isEmpty())
                      takeFields(fields, timestamp, 4, "lacrosse");
                  },
                  {}, auth);
            },
            {}, auth);
      },
      {}, auth);
}
void Services::backfill() {
  if (backfillBusy || config.stationSource() != "tempest" ||
      config.text("token").isEmpty() || config.text("deviceId").isEmpty() ||
      !archive.meta("backfill_done").isEmpty())
    return;
  auto identity = fingerprint(config.settings());
  if (archive.meta("station_fingerprint") != identity)
    return;
  qint64 cursor = archive.meta("backfill_cursor").toLongLong();
  if (!cursor) {
    QSqlQuery q(archive.db);
    if (q.exec("SELECT MIN(ts) FROM obs") && q.next())
      cursor = q.value(0).toLongLong();
  }
  if (cursor <= 946684800)
    return;
  backfillBusy = true;
  const qint64 start = cursor - 4 * 86400;
  auto url = queryUrl(
      "https://swd.weatherflow.com/swd/rest/observations/device/" +
          QString::fromLatin1(QUrl::toPercentEncoding(config.text("deviceId"))),
      {{"token", config.text("token")},
       {"time_start", QString::number(start)},
       {"time_end", QString::number(cursor)}});
  request(url, [this, start, identity](QJsonDocument doc,
                                       const QString &error) {
    backfillBusy = false;
    if (identity != fingerprint(config.settings()))
      return;
    if (!error.isEmpty() || !doc.object().value("obs").isArray()) {
      archive.setMeta("backfill_error", "Provider unavailable; retrying later");
      QTimer::singleShot(60000, this, &Services::backfill);
      return;
    }
    const auto rows = doc.object().value("obs").toArray();
    QString writeError;
    for (const auto &v : rows) {
      auto row = fromJson(v.toArray());
      if (!row || !archive.insert(*row, 1, identity, &writeError)) {
        archive.setMeta("backfill_error",
                        "Archive write failed; window will retry");
        QTimer::singleShot(60000, this, &Services::backfill);
        return;
      }
    }
    backfillEmpty = rows.isEmpty() ? backfillEmpty + 1 : 0;
    archive.setMeta("backfill_cursor", QString::number(start));
    archive.setMeta("backfill_error", "");
    if (backfillEmpty >= 3)
      archive.setMeta("backfill_done", "1");
    else
      QTimer::singleShot(1000, this, &Services::backfill);
    emit changed();
  });
}
void Services::takeFields(const QJsonObject &f, qint64 timestamp, int source,
                          const QString &origin) {
  if ((rawAt.contains(origin) && rawAt.value(origin) == timestamp) ||
      (keptAt.contains(origin) && now() - keptAt.value(origin) < 55))
    return;
  if (!counters.contains(origin)) {
    const auto saved =
        QJsonDocument::fromJson(archive.meta("counters:" + origin).toUtf8())
            .object();
    Counters seed;
    seed.at = qint64(saved.value("at").toDouble());
    if (saved.value("rain").isDouble())
      seed.rain = saved.value("rain").toDouble();
    if (saved.value("strikes").isDouble())
      seed.strikes = saved.value("strikes").toDouble();
    counters[origin] = seed;
  }
  auto next = counters.value(origin);
  auto row = normalize(f, std::clamp(timestamp, now() - 300, now()), next);
  const auto saved =
      QJsonDocument(
          QJsonObject{
              {"rain", next.rain ? QJsonValue(*next.rain) : QJsonValue()},
              {"strikes",
               next.strikes ? QJsonValue(*next.strikes) : QJsonValue()},
              {"at", double(next.at)}})
          .toJson(QJsonDocument::Compact);
  if (accept(row, source, fingerprint(config.settings()), origin,
             {{"counters:" + origin, QString::fromUtf8(saved)}})) {
    counters[origin] = next;
    keptAt[origin] = now();
    rawAt[origin] = double(timestamp);
  }
}
int Services::ingest(const QUrl &url, const QByteArray &body) {
  const auto key = config.text("ingestKey");
  if (!key.isEmpty() && QUrlQuery(url).queryItemValue("key") != key &&
      !url.path().endsWith('/' + key))
    return 401;
  const auto f = collectFields(url.query(QUrl::FullyEncoded).toUtf8(), body);
  Counters probe;
  auto row = normalize(f, now(), probe);
  if (!row[7] && !row[2])
    return 400;
  const auto source = config.stationSource();
  if (source.isEmpty() || source == "tempest" || source == "wll" ||
      source == "awn" || source == "lacrosse")
    return 409;
  if (fingerprint(config.settings()) == "none")
    return 409;
  takeFields(f, now(), 3, "push");
  return diagnostics.value("push").toObject().value("ok").toBool() ? 200 : 409;
}
void Services::pollStation() {
  if (stationBusy)
    return;
  const auto source = config.stationSource();
  const auto identity = fingerprint(config.settings());
  QUrl url;
  if (source == "tempest" && !config.text("token").isEmpty() &&
      !config.text("deviceId").isEmpty()) {
    url = queryUrl("https://swd.weatherflow.com/swd/rest/observations/device/" +
                       QString::fromLatin1(
                           QUrl::toPercentEncoding(config.text("deviceId"))),
                   {{"token", config.text("token")}});
  } else if (source == "wll" && !config.text("wllHost").isEmpty()) {
    url = QUrl("http://" + config.text("wllHost") + "/v1/current_conditions");
    if (url.path() != "/v1/current_conditions" || !url.userInfo().isEmpty()) {
      stationStatus = "Invalid Davis host";
      emit changed();
      return;
    }
  } else if (source == "awn" && !config.text("awnApiKey").isEmpty()) {
    url = queryUrl("https://rt.ambientweather.net/v1/devices",
                   {{"applicationKey", config.text("awnAppKey")},
                    {"apiKey", config.text("awnApiKey")}});
  } else if (source == "lacrosse") {
    pollLaCrosse();
    return;
  } else
    return;
  stationBusy = true;
  request(url, [this, source, identity](QJsonDocument doc,
                                        const QString &error) {
    stationBusy = false;
    if (identity != fingerprint(config.settings())) {
      pollStation();
      return;
    }
    if (!error.isEmpty()) {
      stationStatus = source + ": " + error;
      emit changed();
      return;
    }
    if (source == "tempest") {
      auto rows = doc.object().value("obs").toArray();
      if (!rows.isEmpty()) {
        auto row = fromJson(rows.last().toArray());
        if (row)
          accept(*row, 1, identity, "Tempest cloud");
      }
    } else if (source == "awn") {
      const auto list = doc.array();
      QJsonObject last;
      for (const auto &entry : list) {
        auto device = entry.toObject();
        if (last.isEmpty() || device.value("macAddress")
                                      .toString()
                                      .compare(config.text("stationId"),
                                               Qt::CaseInsensitive) == 0)
          last = device.value("lastData").toObject();
      }
      if (!last.isEmpty())
        takeFields(last, qint64(last.value("dateutc").toDouble() / 1000), 4,
                   "awn");
    } else if (source == "wll") {
      const auto data = doc.object().value("data").toObject();
      QJsonObject f;
      auto put = [&f](const QJsonObject &c, const char *from, const char *to) {
        if (c.value(from).isDouble())
          f[to] = c.value(from);
      };
      for (const auto &entry : data.value("conditions").toArray()) {
        const auto c = entry.toObject();
        if (c.value("data_structure_type").toInt() == 1) {
          put(c, "temp", "tempf");
          put(c, "hum", "humidity");
          put(c, "wind_speed_avg_last_1_min", "windspeedmph");
          put(c, "wind_speed_hi_last_2_min", "windgustmph");
          put(c, "wind_dir_scalar_avg_last_1_min", "winddir");
          put(c, "solar_rad", "solarradiation");
          put(c, "uv_index", "uv");
          const double bucket[] = {.254, .254, .2, .1, .0254};
          if (c.value("rainfall_daily").isDouble())
            f["dailyrainmm"] =
                c.value("rainfall_daily").toDouble() *
                bucket[std::clamp(c.value("rain_size").toInt(1), 1, 4)];
        } else if (c.value("data_structure_type").toInt() == 3)
          put(c, "bar_absolute", "baromabsin");
      }
      takeFields(f, qint64(data.value("ts").toDouble(now())), 3, "wll");
    }
  });
}
QJsonObject Services::snapshot() const {
  const auto s = config.settings();
  QJsonArray days;
  const auto d = forecast.value("daily").toObject();
  const auto times = d.value("time").toArray();
  for (int i = 0; i < times.size(); ++i)
    days.append(QJsonObject{
        {"at", times[i]},
        {"high_c", item(d.value("temperature_2m_max").toArray(), i)},
        {"low_c", item(d.value("temperature_2m_min").toArray(), i)},
        {"precip_chance",
         item(d.value("precipitation_probability_max").toArray(), i)},
        {"wmo_code", item(d.value("weather_code").toArray(), i)}});
  auto current = archive.current();
  return {{"api", 1},
          {"version", STORMDESK_VERSION},
          {"units", "si"},
          {"station", QJsonObject{{"id", s.value("stationId")},
                                  {"name", s.value("stationName")},
                                  {"source", s.value("stationSource")},
                                  {"lat", s.value("lat")},
                                  {"lon", s.value("lon")}}},
          {"current", current.isEmpty() ? QJsonValue() : QJsonValue(current)},
          {"forecast",
           QJsonObject{{"days", days},
                       {"location",
                        QJsonObject{{"name", config.location().value("name")},
                                    {"lat", config.location().value("lat")},
                                    {"lon", config.location().value("lon")}}}}},
          {"health", diagnostics}};
}
QUrl Services::radarUrl() const {
  QUrl url("https://app.hookecho.io/");
  url.setQuery("embed");
  const auto place = config.location();
  const auto lat = place.value("lat"), lon = place.value("lon");
  if (lat.isDouble() && lon.isDouble() && std::isfinite(lat.toDouble()) &&
      std::isfinite(lon.toDouble()) && std::abs(lat.toDouble()) <= 90 &&
      std::abs(lon.toDouble()) <= 180) {
    auto site = place.value("radarSite").toString().trimmed().toUpper();
    if (!QRegularExpression("^[A-Z0-9]{4}$").match(site).hasMatch())
      site.clear();
    if (site.isEmpty()) {
      static const QJsonArray sites = [] {
        QFile file(":/site/sites.json");
        return file.open(QIODevice::ReadOnly)
                   ? QJsonDocument::fromJson(file.readAll()).array()
                   : QJsonArray();
      }();
      double best = 2;
      constexpr double rad = 3.14159265358979323846 / 180;
      for (const auto &v : sites) {
        const auto candidate = v.toObject();
        const double a = lat.toDouble() * rad;
        const double b = candidate.value("lat").toDouble() * rad;
        const double dLon =
            (lon.toDouble() - candidate.value("lon").toDouble()) * rad;
        const double distance =
            std::pow(std::sin((a - b) / 2), 2) +
            std::cos(a) * std::cos(b) * std::pow(std::sin(dLon / 2), 2);
        if (distance < best) {
          best = distance;
          site = candidate.value("id").toString();
        }
      }
    }
    url.setFragment("goto=" + site + "," +
                    QString::number(lon.toDouble(), 'g', 12) + "," +
                    QString::number(lat.toDouble(), 'g', 12) + ",7,bm:dark");
  }
  return url;
}
void Services::push(const QString &title, const QString &message) {
  const auto topic = config.text("ntfyTopic");
  auto send = [this](const QUrl &url, const QJsonObject &data) {
    request(
        url,
        [this](QJsonDocument, const QString &error) {
          diagnostics["alerts"] = QJsonObject{
              {"at", double(now())},
              {"ok", error.isEmpty()},
              {"what", error.isEmpty() ? "Notification sent" : error}};
          emit changed();
        },
        QJsonDocument(data).toJson(QJsonDocument::Compact), {}, "POST");
  };
  if (!topic.isEmpty())
    send(QUrl(config.text("ntfyUrl", "https://ntfy.sh")),
         {{"topic", topic}, {"title", title}, {"message", message}});
  if (!config.text("webhookUrl").isEmpty())
    send(QUrl(config.text("webhookUrl")),
         {{"title", title}, {"message", message}, {"source", "StormDesk"}});
}
void Services::checkRules() {
  if (!observation[0] || now() - *observation[0] > 900) {
    ruleSince.clear();
    return;
  }
  if (now() - lastRulesAt > 180)
    ruleSince.clear();
  lastRulesAt = now();
  const auto rules = config.settings().value("rules").toArray();
  const auto revision =
      QString::fromUtf8(QJsonDocument(rules).toJson(QJsonDocument::Compact));
  if (revision != rulesRevision) {
    ruleSince.clear();
    latched.clear();
    rulesRevision = revision;
  }
  QHash<QString, double> metrics;
  const bool metric = config.text("units") == "metric";
  auto put = [&metrics](const QString &k, std::optional<double> n,
                        double factor = 1, double shift = 0) {
    if (n)
      metrics[k] = *n * factor + shift;
  };
  put("temp", observation[7], metric ? 1 : 1.8, metric ? 0 : 32);
  put("rh", observation[8]);
  put("uv", observation[10]);
  put("wind", observation[2], config.windFactor());
  put("gust", observation[3], config.windFactor());
  if (observation[7] && observation[8] && *observation[8] > 0) {
    put("dew", dewPoint(*observation[7], *observation[8]), metric ? 1 : 1.8,
        metric ? 0 : 32);
  }
  QSqlQuery q(archive.db);
  q.prepare(
      "SELECT SUM(rain),SUM(strikes),MAX(wind_gust) FROM obs WHERE ts>=?");
  q.addBindValue(now() - 3600);
  if (q.exec() && q.next() && !q.value(0).isNull())
    metrics["rain"] = q.value(0).toDouble() / (metric ? 1 : 25.4);
  for (int hours : {1, 3}) {
    QSqlQuery before(archive.db);
    before.prepare("SELECT temp,pressure,humidity FROM obs WHERE ts<=? ORDER "
                   "BY ts DESC LIMIT 1");
    before.addBindValue(now() - hours * 3600);
    if (before.exec() && before.next()) {
      if (hours == 1 && observation[7] && !before.value(0).isNull())
        metrics["temp1h"] =
            (*observation[7] - before.value(0).toDouble()) * (metric ? 1 : 1.8);
      if (observation[6] && !before.value(1).isNull())
        metrics[hours == 1 ? "press1h" : "press3h"] =
            (*observation[6] - before.value(1).toDouble()) /
            (metric ? 1 : 33.8639);
      if (hours == 1 && observation[8] && !before.value(2).isNull())
        metrics["rh1h"] = *observation[8] - before.value(2).toDouble();
    }
  }
  for (const auto &aggregate :
       QList<QPair<QString, QString>>{{"strikes3h", "SUM(strikes)"},
                                      {"rain6h", "SUM(rain)"},
                                      {"gust24h", "MAX(wind_gust)"},
                                      {"low18h", "MIN(temp)"}}) {
    const int hours = aggregate.first == "strikes3h" ? 3
                      : aggregate.first == "rain6h"  ? 6
                      : aggregate.first == "gust24h" ? 24
                                                     : 18;
    QSqlQuery query(archive.db);
    query.prepare("SELECT " + aggregate.second + " FROM obs WHERE ts>=?");
    query.addBindValue(now() - hours * 3600);
    if (query.exec() && query.next() && !query.value(0).isNull()) {
      double value = query.value(0).toDouble();
      if (aggregate.first == "rain6h")
        value /= metric ? 1 : 25.4;
      if (aggregate.first == "gust24h")
        value *= config.windFactor();
      if (aggregate.first == "low18h" && !metric)
        value = value * 1.8 + 32;
      metrics[aggregate.first] = value;
    }
  }
  auto tomorrow = item(
      forecast.value("daily").toObject().value("temperature_2m_max").toArray(),
      1);
  if (tomorrow.isDouble() && config.text("activePlace").isEmpty() &&
      forecast.value("_at").toDouble() > now() - 3600)
    metrics["hiTomorrow"] =
        tomorrow.toDouble() * (metric ? 1 : 1.8) + (metric ? 0 : 32);
  if (observation[12] && observation[17] && *observation[17] > 0)
    metrics["rain"] =
        *observation[12] * 60 / *observation[17] / (metric ? 1 : 25.4);
  const auto currentTime = QTime::currentTime();
  const auto start = QTime::fromString(config.text("quietStart"), "HH:mm"),
             end = QTime::fromString(config.text("quietEnd"), "HH:mm");
  const bool quiet = start.isValid() && end.isValid() &&
                     (start <= end ? currentTime >= start && currentTime < end
                                   : currentTime >= start || currentTime < end);
  for (int i = 0; i < rules.size(); ++i) {
    auto rule = rules[i].toObject();
    const auto id = QString::number(i), key = rule.value("metric").toString();
    if (!metrics.contains(key) || !rule.value("value").isDouble()) {
      ruleSince.remove(id);
      continue;
    }
    double value = metrics.value(key), target = rule.value("value").toDouble();
    bool below = rule.value("op") == "<";
    bool holds = below ? value < target : value > target;
    const auto second = rule.value("metric2").toString();
    if (!second.isEmpty())
      holds = holds && metrics.contains(second) &&
              (rule.value("op2") == "<"
                   ? metrics.value(second) < rule.value("value2").toDouble()
                   : metrics.value(second) > rule.value("value2").toDouble());
    if (!holds) {
      ruleSince.remove(id);
      if (latched.value(id) &&
          (below ? value > target * 1.1 : value < target * .9))
        latched[id] = false;
    }
    if (holds && !ruleSince.contains(id))
      ruleSince[id] = now();
    if (holds && !latched.value(id) &&
        now() - ruleSince.value(id) >= rule.value("durMin").toDouble() * 60 &&
        !quiet) {
      latched[id] = true;
      const auto text = key + " " + QString::number(value, 'f', 1) +
                        " (threshold " + QString::number(target) + ")";
      emit notification("Weather rule", text);
      push("StormDesk weather rule", text);
    }
  }
}
} // namespace storm
