#include "advanced.h"
#include <QDateTime>
#include <QJsonDocument>
#include <QPointer>
#include <QUrlQuery>
#include <algorithm>
#include <cmath>

namespace storm {
static constexpr double pi = 3.14159265358979323846, rad = pi / 180;
static QJsonValue valueAt(const QJsonObject &o, const QString &key, int i) {
  return o.value(key).toArray().at(i);
}
static qint64 epoch() { return QDateTime::currentSecsSinceEpoch(); }
static QUrl url(const QString &base, const QMap<QString, QString> &args) {
  QUrl out(base);
  QUrlQuery q;
  for (auto i = args.begin(); i != args.end(); ++i)
    q.addQueryItem(i.key(), i.value());
  out.setQuery(q);
  return out;
}
double solarAltitude(qint64 at, double lat, double lon) {
  double d = at / 86400.0 - 10957.5, l = std::fmod(280.460 + .9856474 * d, 360),
         g = std::fmod(357.528 + .9856003 * d, 360) * rad;
  double lambda = (l + 1.915 * std::sin(g) + .020 * std::sin(2 * g)) * rad,
         eps = (23.439 - .0000004 * d) * rad;
  double ra = std::atan2(std::cos(eps) * std::sin(lambda), std::cos(lambda)) /
              rad,
         dec = std::asin(std::sin(eps) * std::sin(lambda));
  double ha =
      (std::fmod(std::fmod(18.697374558 + 24.06570982441908 * d, 24) * 15 +
                     lon - ra + 900,
                 360) -
       180) *
      rad;
  return std::asin(std::sin(lat * rad) * std::sin(dec) +
                   std::cos(lat * rad) * std::cos(dec) * std::cos(ha)) /
         rad;
}
qint64 solarCrossing(qint64 around, double lat, double lon, double altitude,
                     bool rising) {
  double previous = solarAltitude(around - 10800, lat, lon);
  for (qint64 at = around - 10740; at <= around + 10800; at += 60) {
    double current = solarAltitude(at, lat, lon);
    if ((current > previous) == rising &&
        (previous - altitude) * (current - altitude) <= 0)
      return at;
    previous = current;
  }
  return 0;
}
QJsonObject moonPhase(qint64 at) {
  constexpr double synodic = 29.530588853;
  const double reference =
      QDateTime::fromString("2000-01-06T18:14:00Z", Qt::ISODate)
          .toSecsSinceEpoch();
  double age = std::fmod(std::fmod((at - reference) / 86400, synodic) + synodic,
                         synodic);
  QStringList names{
      "New",  "Waxing crescent", "First quarter", "Waxing gibbous",
      "Full", "Waning gibbous",  "Last quarter",  "Waning crescent"};
  double full = std::fmod(synodic / 2 - age + synodic, synodic),
         next = std::min(synodic - age, full);
  return {{"age", age},
          {"illumination", (1 - std::cos(2 * pi * age / synodic)) * 50},
          {"phase", names[int(std::floor(age / synodic * 8 + .5)) % 8]},
          {"next", full < synodic - age ? "Full moon" : "New moon"},
          {"nextAt", at + next * 86400}};
}
static bool inRing(double lon, double lat, const QJsonArray &ring) {
  bool inside = false;
  for (int i = 0, j = ring.size() - 1; i < ring.size(); j = i++) {
    auto a = ring[i].toArray(), b = ring[j].toArray();
    if (a.size() < 2 || b.size() < 2)
      continue;
    double x = a[0].toDouble(), y = a[1].toDouble(), bx = b[0].toDouble(),
           by = b[1].toDouble();
    if ((y > lat) != (by > lat) && lon < (bx - x) * (lat - y) / (by - y) + x)
      inside = !inside;
  }
  return inside;
}
bool pointInGeometry(double lon, double lat, const QJsonObject &geometry) {
  const auto type = geometry.value("type").toString();
  auto polys = geometry.value("coordinates").toArray();
  if (type == "Polygon")
    polys = QJsonArray{QJsonValue(polys)};
  else if (type != "MultiPolygon")
    return false;
  for (const auto &p : polys) {
    auto rings = p.toArray();
    if (rings.isEmpty() || !inRing(lon, lat, rings[0].toArray()))
      continue;
    bool hole = false;
    for (int i = 1; i < rings.size(); ++i)
      if (inRing(lon, lat, rings[i].toArray()))
        hole = true;
    if (!hole)
      return true;
  }
  return false;
}
QString outlookRisk(const QJsonObject &geo, double lat, double lon) {
  QString risk;
  int rank = -1;
  const QStringList codes{"TSTM", "MRGL", "SLGT", "ENH", "MDT", "HIGH"};
  for (const auto &f : geo.value("features").toArray()) {
    auto feature = f.toObject(), prop = feature.value("properties").toObject();
    const auto code = prop.value("LABEL").toString();
    int r = codes.indexOf(code);
    if (r >= rank &&
        pointInGeometry(lon, lat, feature.value("geometry").toObject())) {
      rank = r;
      risk = prop.value("LABEL2").toString(code);
    }
  }
  return risk;
}
QJsonObject newestDrought(const QJsonArray &rows) {
  QJsonObject best;
  QDate latest;
  for (const auto &v : rows) {
    auto row = v.toObject();
    auto s = row.value("mapDate").toString();
    QDate date = QDate::fromString(s.left(10), Qt::ISODate);
    if (!date.isValid())
      date = QDate::fromString(s.section('T', 0, 0), "M/d/yyyy");
    if (date.isValid() && (!latest.isValid() || date > latest)) {
      best = row;
      latest = date;
    }
  }
  return best;
}
QJsonObject modelConfidence(const QJsonObject &models, const QJsonObject &event,
                            qint64 fetched, qint64 at) {
  const auto source = event.value("source").toString(),
             kind = event.value("kind").toString();
  if (source.startsWith("Station"))
    return {{"level", "Observed"}, {"reason", "Measured by this station"}};
  if (kind == "sun")
    return {{"level", "High"}, {"reason", "Calculated astronomy"}};
  if (kind == "alert")
    return {{"level", "Official"}, {"reason", "NWS warning"}};
  if (source.contains("nowcast"))
    return {{"level", "Medium"}, {"reason", "Near-term guidance"}};
  auto h = models.value("hourly").toObject();
  auto times = h.value("time").toArray();
  int index = -1;
  for (int i = 0; i < times.size(); ++i)
    if (std::abs(times[i].toDouble() - event.value("start").toDouble()) <=
        1800) {
      index = i;
      break;
    }
  const bool rain = kind == "precip" || kind == "storm" || kind == "winter";
  const QString field = rain             ? "precipitation"
                        : kind == "wind" ? "wind_speed_10m"
                                         : "temperature_2m";
  QList<double> vals;
  if (kind != "aqi" && index >= 0)
    for (auto it = h.begin(); it != h.end(); ++it)
      if (it.key().startsWith(field + "_") &&
          it.value().toArray().at(index).isDouble())
        vals << it.value().toArray().at(index).toDouble();
  if (vals.size() < 2)
    return {{"level", "Unavailable"},
            {"reason", "Fewer than two usable models"}};
  auto mm = std::minmax_element(vals.begin(), vals.end());
  double spread = *mm.second - *mm.first;
  QString reason = QString::number(vals.size()) + " models · spread " +
                   QString::number(spread, 'f', 1) +
                   (rain             ? " mm"
                    : kind == "wind" ? " m/s"
                                     : " °C");
  if (at - fetched > 43200 ||
      spread > (rain             ? 6
                : kind == "wind" ? 8
                                 : 4) ||
      (rain && *mm.first <= 0 && *mm.second > 0))
    return {{"level", "Low"},
            {"reason",
             at - fetched > 43200 ? "Guidance older than 12 hours" : reason}};
  return {{"level", spread > (rain             ? 2
                              : kind == "wind" ? 3.5
                                               : 1.7)
                        ? "Medium"
                        : "High"},
          {"reason", reason}};
}
QJsonArray weatherTimeline(const QJsonObject &forecast,
                           const QJsonArray &observations,
                           const QJsonArray &warnings, const QJsonObject &air,
                           const QJsonObject &nowcast, const QJsonObject &prefs,
                           qint64 at) {
  QJsonArray raw;
  QStringList defaults{"precip", "storm", "winter", "freeze", "heat",
                       "wind",   "aqi",   "change", "sun",    "alert"};
  auto enabled = prefs.contains("categories")
                     ? prefs.value("categories").toArray()
                     : QJsonArray::fromStringList(defaults);
  auto add = [&](QString kind, qint64 start, QString title, QString text,
                 QString source, qint64 end = 0) {
    if (!enabled.contains(kind) || start < at - 86400 || start > at + 172800)
      return;
    raw.append(QJsonObject{{"kind", kind},
                           {"start", double(start)},
                           {"end", double(end ? end : start + 3600)},
                           {"title", title},
                           {"detail", text},
                           {"source", source}});
  };
  double freeze = prefs.value("freezeC").toDouble(0),
         heat = prefs.value("heatC").toDouble(35),
         wind = prefs.value("gustMs").toDouble(13.4112),
         precip = prefs.value("precip").toDouble(30);
  auto classify = [&](qint64 t, QJsonValue temp, QJsonValue humidity,
                      QJsonValue gust, QJsonValue rain, QJsonValue pop,
                      int code, bool observed) {
    QString src = observed ? "Station · observed" : "Open-Meteo · forecast";
    if (temp.isDouble() && temp.toDouble() <= freeze)
      add("freeze", t, "Freezing conditions",
          QString::number(temp.toDouble(), 'f', 1) + " °C", src);
    if (temp.isDouble() && humidity.isDouble() &&
        feelsLike(temp.toDouble(), humidity.toDouble(), 0) >= heat)
      add("heat", t, "Dangerous heat",
          "Heat index at or above " + QString::number(heat) + " °C", src);
    if (gust.isDouble() && gust.toDouble() >= wind)
      add("wind", t, "Strong wind",
          QString::number(gust.toDouble(), 'f', 1) + " m/s gust", src);
    if ((observed && rain.toDouble() > 0) ||
        (!observed && pop.isDouble() && pop.toDouble() >= precip))
      add("precip", t, observed ? "Rain observed" : "Precipitation window",
          observed ? QString::number(rain.toDouble(), 'f', 2) + " mm"
                   : QString::number(pop.toDouble()) + "% chance",
          src);
    if (!observed && code >= 95)
      add("storm", t, "Thunderstorms possible", condition(code), src);
    if (!observed && ((code >= 71 && code <= 77) || code == 56 || code == 57 ||
                      code == 66 || code == 67 || code == 85 || code == 86))
      add("winter", t, "Wintry weather possible", condition(code), src);
  };
  for (const auto &v : observations) {
    auto r = v.toArray();
    if (r.size() < 19)
      continue;
    classify(qint64(r[0].toDouble()), r[7], r[8], r[3], r[12], {}, 0, true);
  }
  auto h = forecast.value("hourly").toObject();
  auto times = h.value("time").toArray();
  for (int i = 0; i < times.size(); ++i)
    if (times[i].toDouble() >= at)
      classify(qint64(times[i].toDouble()), valueAt(h, "temperature_2m", i),
               valueAt(h, "relative_humidity_2m", i),
               valueAt(h, "wind_gusts_10m", i), valueAt(h, "precipitation", i),
               valueAt(h, "precipitation_probability", i),
               valueAt(h, "weather_code", i).toInt(), false);
  for (const auto &v : observations) {
    auto r = v.toArray();
    if (r.size() < 19)
      continue;
    const auto t = qint64(r[0].toDouble());
    for (const auto &old : observations) {
      auto o = old.toArray();
      if (o.size() < 19 || o[0].toDouble() < t - 3900 ||
          o[0].toDouble() > t - 3300)
        continue;
      if (r[7].isDouble() && o[7].isDouble() &&
          std::abs(r[7].toDouble() - o[7].toDouble()) >= 3)
        add("change", t, "Temperature changing quickly",
            "At least 3 °C in an hour", "Station · observed");
      if (r[6].isDouble() && o[6].isDouble() &&
          std::abs(r[6].toDouble() - o[6].toDouble()) >= 2)
        add("change", t, "Pressure changing quickly",
            "At least 2 hPa in an hour", "Station · observed");
      break;
    }
  }
  auto daily = forecast.value("daily").toObject();
  for (const auto &k : {QString("sunrise"), QString("sunset")})
    for (const auto &t : daily.value(k).toArray())
      if (t.isDouble())
        add("sun", qint64(t.toDouble()), k == "sunrise" ? "Sunrise" : "Sunset",
            "Calculated for the selected location", "Astronomy");
  for (const auto &v : warnings) {
    auto p = v.toObject().value("properties").toObject();
    auto start = QDateTime::fromString(
                     p.value("onset").toString(p.value("effective").toString()),
                     Qt::ISODate)
                     .toSecsSinceEpoch();
    auto end = QDateTime::fromString(
                   p.value("ends").toString(p.value("expires").toString()),
                   Qt::ISODate)
                   .toSecsSinceEpoch();
    if (end >= at)
      add("alert", std::max(start, at), p.value("event").toString(),
          p.value("headline").toString(), "NWS · official", end);
  }
  auto aq = air.value("hourly").toObject();
  auto aqTimes = aq.value("time").toArray();
  for (int i = 0; i < aqTimes.size(); ++i)
    if (aqTimes[i].toDouble() >= at &&
        valueAt(aq, "us_aqi", i).toDouble() >= prefs.value("aqi").toDouble(101))
      add("aqi", qint64(aqTimes[i].toDouble()), "Unhealthy air quality",
          "US AQI " + QString::number(valueAt(aq, "us_aqi", i).toDouble()),
          "Open-Meteo · forecast");
  auto nc = nowcast.value("minutely_15").toObject();
  auto nt = nc.value("time").toArray();
  for (int i = 0; i < nt.size(); ++i)
    if (nt[i].toDouble() >= at &&
        valueAt(nc, "precipitation", i).toDouble() > 0)
      add("precip", qint64(nt[i].toDouble()), "Near-term precipitation",
          QString::number(valueAt(nc, "precipitation", i).toDouble(), 'f', 2) +
              " mm / 15 min",
          "Open-Meteo · nowcast", qint64(nt[i].toDouble()) + 900);
  QVector<QJsonObject> sorted;
  for (const auto &v : raw)
    sorted << v.toObject();
  std::sort(sorted.begin(), sorted.end(), [](const auto &a, const auto &b) {
    return a.value("start").toDouble() < b.value("start").toDouble();
  });
  QVector<QJsonObject> merged;
  for (auto e : sorted) {
    bool found = false;
    for (auto &m : merged)
      if (m.value("title") == e.value("title") &&
          m.value("source") == e.value("source") &&
          m.value("end").toDouble() + 1800 >= e.value("start").toDouble()) {
        m["end"] =
            std::max(m.value("end").toDouble(), e.value("end").toDouble());
        found = true;
        break;
      }
    if (!found)
      merged << e;
  }
  QJsonArray out;
  for (const auto &e : merged)
    out.append(e);
  return out;
}
QJsonObject archiveSummary(const QJsonArray &days) {
  QJsonObject out;
  double gdd = 0, rain30 = 0;
  int dry = 0;
  const QMap<QString, bool> metrics{{"tempMax", true},
                                    {"tempMin", false},
                                    {"gustMax", true},
                                    {"rain", true},
                                    {"strikes", true}};
  for (const auto &v : days) {
    auto d = v.toObject();
    for (auto it = metrics.begin(); it != metrics.end(); ++it) {
      if (!d.value(it.key()).isDouble())
        continue;
      auto old = out.value(it.key()).toObject();
      if (old.isEmpty() ||
          (it.value()
               ? d.value(it.key()).toDouble() > old.value(it.key()).toDouble()
               : d.value(it.key()).toDouble() < old.value(it.key()).toDouble()))
        out[it.key()] = d;
    }
    if (d.value("day").toString().left(4) ==
            QString::number(QDate::currentDate().year()) &&
        d.value("tempMin").isDouble() && d.value("tempMax").isDouble())
      gdd +=
          std::max(0.0, (std::min(30.0, d.value("tempMax").toDouble()) +
                         std::clamp(d.value("tempMin").toDouble(), 0.0, 30.0)) /
                                2 -
                            10);
  }
  for (int i = std::max(0, int(days.size()) - 30); i < days.size(); ++i)
    rain30 += days[i].toObject().value("rain").toDouble();
  for (int i = days.size() - 1;
       i >= 0 && days[i].toObject().value("rain").toDouble() == 0; --i)
    ++dry;
  out["gdd"] = gdd;
  out["rain30"] = rain30;
  out["dryDays"] = dry;
  out["days"] = days.size();
  return out;
}
Advanced::Advanced(Services &s, bool track) : QObject(&s), services(s) {
  locationKey = key();
  if (track)
    connect(&s, &Services::changed, this, &Advanced::recordForecast);
}
QString Advanced::key() const {
  return QString::number(services.config.location().value("lat").toDouble(999),
                         'g', 12) +
         "," +
         QString::number(services.config.location().value("lon").toDouble(999),
                         'g', 12);
}
void Advanced::fetch(const QString &kind, const QUrl &address, bool force,
                     int lifetime, const QByteArray &auth) {
  if (busy.contains(kind) ||
      (!force && fetched.value(kind) + lifetime > epoch()))
    return;
  busy.insert(kind);
  errors[kind] = "Updating…";
  emit changed();
  const auto place = key();
  QPointer<Advanced> guard(this);
  services.request(
      address,
      [this, guard, kind, place](QJsonDocument doc, const QString &error) {
        if (!guard)
          return;
        busy.remove(kind);
        if (place != key())
          return;
        if (error.isEmpty() && !doc.isNull()) {
          data[kind] = doc;
          fetched[kind] = epoch();
          errors.remove(kind);
        } else
          errors[kind] = error.isEmpty() ? "Provider returned no data" : error;
        if (kind == "official" && error.isEmpty()) {
          auto todo = pending;
          pending.clear();
          for (const auto &k : todo)
            load(k);
        }
        emit changed();
      },
      {}, auth);
}
void Advanced::load(const QString &kind, bool force) {
  const auto place = key();
  if (place != locationKey) {
    data.clear();
    errors.clear();
    fetched.clear();
    locationKey = place;
  }
  if (std::abs(services.config.location().value("lat").toDouble(999)) > 90 ||
      std::abs(services.config.location().value("lon").toDouble(999)) > 180) {
    errors[kind] = "Choose a location in Settings";
    emit changed();
    return;
  }
  QMap<QString, QString> args{
      {"latitude",
       QString::number(services.config.location().value("lat").toDouble(), 'g',
                       12)},
      {"longitude",
       QString::number(services.config.location().value("lon").toDouble(), 'g',
                       12)},
      {"timezone", "auto"},
      {"timeformat", "unixtime"},
      {"wind_speed_unit", "ms"}};
  QString base = "https://api.open-meteo.com/v1/forecast";
  if (kind == "models") {
    args["models"] = "gfs_seamless,ecmwf_ifs025,icon_seamless,gem_seamless";
    const double lat = services.config.location().value("lat").toDouble(),
                 lon = services.config.location().value("lon").toDouble();
    if (lat >= 21 && lat <= 53 && lon >= -135 && lon <= -60)
      args["models"] += ",gfs_hrrr";
    args["hourly"] = "temperature_2m,precipitation,wind_speed_10m";
    args["forecast_days"] = "3";
  } else if (kind == "ensemble") {
    base = "https://ensemble-api.open-meteo.com/v1/ensemble";
    args["models"] = "gfs025";
    args["hourly"] = "temperature_2m";
    args["forecast_days"] = "3";
  } else if (kind == "air") {
    base = "https://air-quality-api.open-meteo.com/v1/air-quality";
    args.remove("wind_speed_unit");
    args["hourly"] = "us_aqi,pm2_5,ozone";
    args["forecast_days"] = "2";
  } else if (kind == "nowcast") {
    args["minutely_15"] = "precipitation";
    args["forecast_minutely_15"] = "48";
  } else if (kind == "severe") {
    args["hourly"] = "cape,convective_inhibition,lifted_index";
    args["forecast_days"] = "2";
  } else if (kind == "garden") {
    args["daily"] = "et0_fao_evapotranspiration,precipitation_sum";
    args["past_days"] = "7";
    args["forecast_days"] = "1";
  } else if (kind == "normals") {
    base = "https://archive-api.open-meteo.com/v1/archive";
    args["start_date"] = "1991-01-01";
    args["end_date"] = "2020-12-31";
    args["daily"] = "temperature_2m_max,temperature_2m_min";
    args.remove("timeformat");
  } else if (kind.startsWith("spc")) {
    fetch(kind,
          QUrl("https://www.spc.noaa.gov/products/outlook/day" + kind.right(1) +
               "otlk_cat.lyr.geojson"),
          force, 3600);
    return;
  } else if (kind == "tropical") {
    fetch(kind, QUrl("https://www.nhc.noaa.gov/CurrentStorms.json"), force,
          3600);
    return;
  } else if (kind == "reports") {
    fetch(
        kind,
        QUrl("https://mesonet.agron.iastate.edu/geojson/lsr.geojson?hours=24"),
        force, 1800);
    return;
  } else if (kind == "moon") {
    int offset = services.forecast.value("utc_offset_seconds").toInt();
    QString tz = QString(offset < 0 ? "-" : "+") +
                 QString("%1:%2")
                     .arg(std::abs(offset) / 3600, 2, 10, QChar('0'))
                     .arg(std::abs(offset) % 3600 / 60, 2, 10, QChar('0'));
    fetch(kind,
          url("https://api.met.no/weatherapi/sunrise/3.0/moon",
              {{"lat", args["latitude"]},
               {"lon", args["longitude"]},
               {"date", QDateTime::fromSecsSinceEpoch(epoch() + offset, Qt::UTC)
                            .date()
                            .toString(Qt::ISODate)},
               {"offset", tz}}),
          force, 86400);
    return;
  } else if (kind == "official") {
    fetch(kind,
          url("https://api.weather.gov/points/" + QString::number(services.config.location().value("lat").toDouble(),'f',4) + "," +
                  QString::number(services.config.location().value("lon").toDouble(),'f',4),
              {}),
          force, 86400);
    return;
  } else if (kind == "nwsForecast" || kind == "airports") {
    auto p = data.value("official").object().value("properties").toObject();
    auto address =
        p.value(kind == "airports" ? "observationStations" : "forecast")
            .toString();
    if (address.isEmpty()) {
      pending.insert(kind);
      load("official", force);
      return;
    }
    fetch(kind, QUrl(address), force, kind == "airports" ? 86400 : 3600);
    return;
  } else if (kind == "drought") {
    drought(force);
    return;
  } else if (kind == "ha") {
    fetch(kind, QUrl(services.config.text("haUrl") + "/api/states"), force, 60,
          "Bearer " + services.config.text("haToken").toUtf8());
    return;
  } else
    return;
  fetch(kind, url(base, args), force, kind == "normals" ? 2592000 : 900);
}
void Advanced::drought(bool force) {
  if (busy.contains("drought") ||
      (!force && fetched.value("drought") + 21600 > epoch()))
    return;
  const auto place = key();
  busy.insert("drought");
  errors["drought"] = "Updating…";
  emit changed();
  QPointer<Advanced> guard(this);
  services.request(
      url("https://geo.fcc.gov/api/census/block/find",
          {{"latitude",
            QString::number(services.config.location().value("lat").toDouble(),
                            'g', 12)},
           {"longitude",
            QString::number(services.config.location().value("lon").toDouble(),
                            'g', 12)},
           {"format", "json"}}),
      [this, guard, place](QJsonDocument doc, QString error) {
        if (!guard)
          return;
        if (place != key()) {
          busy.remove("drought");
          return;
        }
        auto county = doc.object().value("County").toObject();
        auto fips = county.value("FIPS").toString();
        if (!error.isEmpty() || fips.size() != 5) {
          busy.remove("drought");
          errors["drought"] = error.isEmpty()
                                  ? "US county not available at this location"
                                  : error;
          emit changed();
          return;
        }
        auto today = QDate::currentDate();
        services.request(
            url("https://usdmdataservices.unl.edu/api/CountyStatistics/"
                "GetDroughtSeverityStatisticsByAreaPercent",
                {{"aoi", fips},
                 {"startdate", today.addDays(-42).toString("M/d/yyyy")},
                 {"enddate", today.toString("M/d/yyyy")},
                 {"statisticsType", "1"}}),
            [this, guard, place, county](QJsonDocument result, QString error) {
              if (!guard)
                return;
              busy.remove("drought");
              if (place != key())
                return;
              auto best = newestDrought(result.array());
              if (error.isEmpty() && best.isEmpty())
                error = "No drought map published";
              if (error.isEmpty()) {
                best["countyName"] = county.value("name");
                data["drought"] = QJsonDocument(best);
                fetched["drought"] = epoch();
                errors.remove("drought");
              } else
                errors["drought"] = error;
              emit changed();
            });
      });
}
QJsonArray Advanced::snapshots() const {
  return QJsonDocument::fromJson(
             services.archive.meta("native_forecasts:" + key()).toUtf8())
      .array();
}
QJsonArray Advanced::verification() const {
  return QJsonDocument::fromJson(
             services.archive.meta("native_verification:" + key()).toUtf8())
      .array();
}
void Advanced::recordForecast() {
  auto fc = services.forecast;
  if (fc.isEmpty() ||
      (fc.contains("_location") && fc.value("_location").toString() != key()))
    return;
  const auto at = epoch();
  auto snaps = snapshots();
  if (snaps.isEmpty() ||
      at - snaps.last().toObject().value("at").toDouble() >= 10800) {
    snaps.append(QJsonObject{{"at", double(at)}, {"daily", fc.value("daily")}});
    while (snaps.size() > 60)
      snaps.removeFirst();
    services.archive.setMeta(
        "native_forecasts:" + key(),
        QString::fromUtf8(QJsonDocument(snaps).toJson(QJsonDocument::Compact)));
  }
  auto scores = verification();
  auto hourly = fc.value("hourly").toObject();
  auto times = hourly.value("time").toArray();
  for (int i = 0; i < times.size(); ++i)
    if (times[i].toDouble() > at + 86400 &&
        valueAt(hourly, "temperature_2m", i).isDouble()) {
      bool exists = false;
      for (const auto &v : scores)
        if (v.toObject().value("target") == times[i])
          exists = true;
      if (!exists)
        scores.append(QJsonObject{
            {"target", times[i]},
            {"temperature", valueAt(hourly, "temperature_2m", i)},
            {"pop", valueAt(hourly, "precipitation_probability", i)}});
      break;
    }
  auto obs = services.observation;
  for (int i = 0; i < scores.size(); ++i) {
    auto v = scores[i].toObject();
    if (services.config.settings().value("activePlace").toString().isEmpty() &&
        !v.contains("observed") && obs[0] && obs[7] &&
        std::abs(*obs[0] - v.value("target").toDouble()) < 1800) {
      v["observed"] = *obs[7];
      scores[i] = v;
    }
  }
  while (scores.size() > 200)
    scores.removeFirst();
  const auto encoded =
      QString::fromUtf8(QJsonDocument(scores).toJson(QJsonDocument::Compact));
  if (services.archive.meta("native_verification:" + key()) != encoded)
    services.archive.setMeta("native_verification:" + key(), encoded);
}
} // namespace storm
