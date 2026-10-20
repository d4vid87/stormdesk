#include "core.h"
#include <QDateTime>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonDocument>
#include <QSaveFile>
#include <QSqlQuery>
#include <QSqlError>
#include <QStandardPaths>
#include <QUuid>
#include <QUrlQuery>
#include <cmath>
#include <algorithm>

namespace storm {
const QStringList fields = {"wind_lull", "wind_avg", "wind_gust", "wind_dir", "wind_interval",
    "pressure", "temp", "humidity", "lux", "uv", "solar", "rain", "precip_type", "strike_dist",
    "strikes", "battery", "report_interval", "day_rain"};
static bool fail(QString *error, const QString &message) { if (error) *error = message; return false; }
static QJsonValue jsonNumber(const QVariant &v) { return v.isNull() ? QJsonValue() : QJsonValue(v.toDouble()); }
QJsonArray toJson(const Reading &row) {
    QJsonArray out;
    for (const auto &n : row) out.append(n ? QJsonValue(*n) : QJsonValue());
    return out;
}
std::optional<Reading> fromJson(const QJsonArray &row) {
    if (row.size() < 2 || !row[0].isDouble() || row[0].toDouble() <= 0 || row[0].toDouble() > 4102444800.0) return {};
    Reading out{};
    for (int i = 0; i < std::min(19, int(row.size())); ++i) {
        if (row[i].isDouble() && std::isfinite(row[i].toDouble())) out[i] = row[i].toDouble();
        else if (!row[i].isNull() && !row[i].isUndefined()) return {};
    }
    return out;
}
QString fingerprint(const QJsonObject &s) {
    QString source = s.value("stationSource").toString();
    if (source.isEmpty()) source = "tempest";
    QString id;
    if (source == "tempest") id = s.value("deviceId").toVariant().toString();
    if (source == "wll") id = s.value("wllHost").toString();
    if (source == "lacrosse") id = s.value("lacrosseEmail").toString();
    if (id.isEmpty()) id = s.value("stationId").toVariant().toString();
    if (id.isEmpty()) id = s.value("ingestKey").toString();
    return id.isEmpty() ? "none" : source + ":" + id;
}
QString defaultDataDir() {
    const auto override = qEnvironmentVariable("WD_DATA_DIR");
    if (!override.isEmpty()) return override;
    return QStandardPaths::writableLocation(QStandardPaths::AppLocalDataLocation);
}
bool copyDocument(const QString &source, const QString &destination, QString *error) {
    QFile input(source); QSaveFile output(destination);
    // shortcut: Android document providers lack atomic replacement; only newly chosen export documents use direct writes.
    output.setDirectWriteFallback(destination.startsWith("content:"));
    if (!input.open(QIODevice::ReadOnly)) return fail(error, input.errorString());
    if (!output.open(QIODevice::WriteOnly)) return fail(error, output.errorString());
    char buffer[65536];
    while (!input.atEnd()) {
        auto count = input.read(buffer, sizeof(buffer));
        if (count < 0) return fail(error, input.errorString());
        if (output.write(buffer, count) != count) return fail(error, output.errorString());
    }
    return output.commit() || fail(error, output.errorString());
}
Config::Config(QString file) : path(std::move(file)) {}
bool Config::load(QString *error) {
    QFile file(path);
    if (!file.exists()) { value = {{"settings", QJsonObject{}}}; return true; }
    if (!file.open(QIODevice::ReadOnly)) return fail(error, file.errorString());
    if (file.size() > 4 * 1024 * 1024) return fail(error, "Settings file is too large");
    QJsonParseError parse;
    auto doc = QJsonDocument::fromJson(file.readAll(), &parse);
    if (!doc.isObject() || parse.error != QJsonParseError::NoError) return fail(error, "Invalid settings file; original file kept");
    value = doc.object();
    return true;
}
bool Config::save(const QJsonObject &next, QString *error) {
    if (!QDir().mkpath(QFileInfo(path).absolutePath())) return fail(error, "Cannot create settings directory");
    QSaveFile file(path);
    if (!file.open(QIODevice::WriteOnly)) return fail(error, file.errorString());
    file.setPermissions(QFileDevice::ReadOwner | QFileDevice::WriteOwner);
    const auto bytes = QJsonDocument(next).toJson();
    if (file.write(bytes) != bytes.size() || !file.commit()) return fail(error, file.errorString());
    value = next;
    return true;
}
int Config::merge(const QJsonObject &delta, QString *error) {
    bool revisioned = delta.contains("_rev");
    double revision = value.value("_rev").toDouble();
    if (revisioned && delta.value("_rev").toDouble(-1) != revision) return 409;
    auto next = revisioned ? value : delta;
    if (revisioned) {
        for (auto it = delta.begin(); it != delta.end(); ++it) {
            if (it.key() == "_access" || it.key() == "_rev") continue;
            if (it.key() == "settings") {
                auto s = next.value("settings").toObject();
                const auto patch = it.value().toObject();
                for (auto p = patch.begin(); p != patch.end(); ++p) s[p.key()] = p.value();
                next["settings"] = s;
            } else next[it.key()] = it.value();
        }
    }
    if (value.contains("_access")) next["_access"] = value.value("_access");
    else next.remove("_access");
    next["_rev"] = revision + 1;
    return save(next, error) ? (revisioned ? 200 : 204) : 500;
}
QString Config::text(const QString &key, const QString &fallback) const {
    const auto v = settings().value(key);
    return v.isUndefined() || v.isNull() ? fallback : v.toVariant().toString();
}
double Config::number(const QString &key, double fallback) const {
    bool ok = false;
    double n = settings().value(key).toVariant().toDouble(&ok);
    return ok && std::isfinite(n) ? n : fallback;
}
QString Config::stationSource() const {
    auto source = text("stationSource");
    if (source.isEmpty() && !settings().value("nativeForecastOnly").toBool() && (!text("deviceId").isEmpty() || !text("token").isEmpty())) return "tempest";
    return source;
}
QString Config::windUnit() const { auto unit = text("windUnit"); return unit.isEmpty() ? (text("units") == "metric" ? "km/h" : "mph") : unit; }
double Config::windFactor() const { auto unit = windUnit(); return unit == "m/s" ? 1 : unit == "kt" ? 1.94384 : unit == "km/h" ? 3.6 : 1/.44704; }
QJsonObject Config::publicValue() const {
    auto out = value;
    auto s = settings();
    const QStringList secrets = {"token", "mqttUser", "mqttPass", "haToken", "ntfyTopic", "webhookUrl", "awnApiKey", "awnAppKey",
        "lacrosseEmail", "lacrossePass", "ingestKey", "wuKey", "pwsKey"};
    for (const auto &key : secrets) s.remove(key);
    out["settings"] = s;
    out.remove("_access");
    out["readOnly"] = true;
    return out;
}
Archive::Archive(QString file) : path(std::move(file)) {
    db = QSqlDatabase::addDatabase("QSQLITE", QUuid::createUuid().toString());
    db.setDatabaseName(path);
    db.setConnectOptions("QSQLITE_BUSY_TIMEOUT=10000");
}
Archive::~Archive() {
    const auto name = db.connectionName();
    db.close(); db = QSqlDatabase(); QSqlDatabase::removeDatabase(name);
}
bool Archive::open(QString *error) {
    if (!QDir().mkpath(QFileInfo(path).absolutePath()) || !db.open()) return fail(error, db.lastError().text());
    QSqlQuery q(db);
    QStringList columns;
    for (const auto &f : fields) columns << f + " REAL";
    for (const auto &sql : QStringList{"PRAGMA journal_mode=WAL", "PRAGMA synchronous=NORMAL",
        "CREATE TABLE IF NOT EXISTS obs (ts INTEGER PRIMARY KEY," + columns.join(',') + ",src INTEGER NOT NULL DEFAULT 0)",
        "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)"}) {
        if (!q.exec(sql)) return fail(error, q.lastError().text());
    }
    return true;
}
QString Archive::meta(const QString &key) const {
    QSqlQuery q(db); q.prepare("SELECT value FROM meta WHERE key=?"); q.addBindValue(key);
    return q.exec() && q.next() ? q.value(0).toString() : QString();
}
bool Archive::setMeta(const QString &key, const QString &value) {
    QSqlQuery q(db); q.prepare("INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
    q.addBindValue(key); q.addBindValue(value); return q.exec();
}
bool Archive::insert(const Reading &row, int source, const QString &station, QString *error, const QJsonObject &metadata) {
    if (!row[0] || !std::isfinite(*row[0]) || *row[0] <= 0) return fail(error, "Invalid observation time");
    if (station.isEmpty() || station == "none") return fail(error, "Set a station ID before archiving readings");
    const auto bound = meta("station_fingerprint");
    if (!bound.isEmpty() && bound != station) return fail(error, "Archive belongs to another station; export a backup before changing station");
    if (!db.transaction()) return fail(error, db.lastError().text());
    QSqlQuery q(db);
    q.prepare("INSERT OR IGNORE INTO obs(ts," + fields.join(',') + ",src) VALUES(" + QString("?,").repeated(19) + "?)");
    for (const auto &v : row) q.addBindValue(v && std::isfinite(*v) ? QVariant(*v) : QVariant());
    q.addBindValue(source);
    if (!q.exec() || (bound.isEmpty() && !setMeta("station_fingerprint", station))) {
        db.rollback(); return fail(error, q.lastError().text());
    }
    for (auto entry = metadata.begin(); entry != metadata.end(); ++entry) {
        if (!setMeta(entry.key(), entry.value().toString())) { db.rollback(); return fail(error, "Cannot update archive counters"); }
    }
    if (!db.commit()) { db.rollback(); return fail(error, db.lastError().text()); }
    return true;
}
Reading Archive::latest() const {
    QSqlQuery q(db); Reading out{};
    if (q.exec("SELECT ts," + fields.join(',') + " FROM obs ORDER BY ts DESC LIMIT 1") && q.next()) {
        for (int i = 0; i < 19; ++i) if (!q.value(i).isNull()) out[i] = q.value(i).toDouble();
    }
    return out;
}
QJsonObject Archive::current() const {
    const auto row = latest();
    if (!row[0]) return {};
    QJsonObject out{{"at", *row[0]}};
    for (int i = 1; i < 19; ++i) out[fields[i - 1]] = row[i] ? QJsonValue(*row[i]) : QJsonValue();
    if (row[7]) out["feels_like"] = feelsLike(*row[7], row[8].value_or(0), row[2].value_or(0));
    if (row[6]) {
        QSqlQuery q(db); q.prepare("SELECT pressure FROM obs WHERE ts<=? AND pressure IS NOT NULL ORDER BY ts DESC LIMIT 1"); q.addBindValue(qint64(*row[0]) - 10800);
        if (q.exec() && q.next()) { double change = *row[6] - q.value(0).toDouble(); out["pressure_trend"] = change <= -2 ? "falling rapidly" : change <= -.5 ? "falling" : change >= 2 ? "rising rapidly" : change >= .5 ? "rising" : "steady"; }
    }
    return out;
}
QJsonArray Archive::tuples(qint64 from, qint64 to) const {
    QSqlQuery q(db); q.prepare("SELECT ts," + fields.join(',') + " FROM obs WHERE ts>=? AND ts<=? ORDER BY ts");
    q.addBindValue(from); q.addBindValue(to); QJsonArray out;
    if (q.exec()) while (q.next()) { QJsonArray row; for (int i = 0; i < 19; ++i) row.append(jsonNumber(q.value(i))); out.append(row); }
    return out;
}
QJsonArray Archive::daily(int offsetMinutes, qint64 from) const {
    QSqlQuery q(db);
    q.prepare("SELECT strftime('%Y-%m-%d',ts+?,'unixepoch'),MIN(temp),MAX(temp),MAX(wind_gust),SUM(rain),SUM(strikes),MIN(battery) FROM obs WHERE ts>=? GROUP BY 1 ORDER BY 1");
    q.addBindValue(std::clamp(offsetMinutes, -840, 840) * 60); q.addBindValue(from);
    const QStringList keys = {"tempMin", "tempMax", "gustMax", "rain", "strikes", "battMin"};
    QJsonArray out;
    if (q.exec()) while (q.next()) {
        QJsonObject day{{"day", q.value(0).toString()}};
        for (int i = 0; i < keys.size(); ++i) day[keys[i]] = jsonNumber(q.value(i + 1));
        out.append(day);
    }
    return out;
}
QJsonObject Archive::health() const {
    QSqlQuery q(db); QJsonObject out{{"ok", false}};
    if (q.exec("PRAGMA quick_check") && q.next()) { out["check"] = q.value(0).toString(); out["ok"] = q.value(0).toString() == "ok"; }
    if (q.exec("SELECT COUNT(*),MIN(ts),MAX(ts) FROM obs") && q.next()) {
        out["rows"] = q.value(0).toDouble(); out["first"] = jsonNumber(q.value(1)); out["last"] = jsonNumber(q.value(2));
    }
    out["bytes"] = double(QFileInfo(path).size()); return out;
}
bool Archive::backup(const QString &dest, const QJsonObject &config, QString *error) const {
    if (QFileInfo::exists(dest)) return fail(error, "Destination already exists; choose a new backup filename");
    QSqlQuery q(db); q.prepare("VACUUM INTO ?"); q.addBindValue(dest);
    if (!q.exec()) return fail(error, q.lastError().text());
    if (!QFile::setPermissions(dest, QFileDevice::ReadOwner | QFileDevice::WriteOwner)) { QFile::remove(dest); return fail(error, "Cannot secure backup permissions"); }
    Archive bundle(dest);
    if (!bundle.open(error)) return false;
    if (!bundle.setMeta("backup:manifest", QJsonDocument(QJsonObject{{"format", 1}, {"app", STORMDESK_VERSION}, {"created", double(QDateTime::currentSecsSinceEpoch())}}).toJson(QJsonDocument::Compact)) ||
        !bundle.setMeta("backup:config", QJsonDocument(config).toJson(QJsonDocument::Compact))) return fail(error, "Could not write backup metadata");
    QSqlQuery checkpoint(bundle.db); checkpoint.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    return true;
}
QJsonObject Archive::inspect(const QString &file, QJsonObject *config, QString *error) {
    Archive bundle(file); bundle.db.setConnectOptions("QSQLITE_OPEN_READONLY;QSQLITE_BUSY_TIMEOUT=10000");
    if (!bundle.db.open()) { fail(error, "Cannot open backup"); return {}; }
    const auto manifest = QJsonDocument::fromJson(bundle.meta("backup:manifest").toUtf8()).object();
    const auto cfg = QJsonDocument::fromJson(bundle.meta("backup:config").toUtf8());
    if (manifest.value("format").toInt() != 1 || !cfg.isObject()) { fail(error, "Invalid or unsupported backup"); return {}; }
    auto health = bundle.health();
    if (health.value("first").toDouble() < 0 || health.value("last").toDouble() < health.value("first").toDouble()) { fail(error, "Invalid backup timestamps"); return {}; }
    if (!health.value("ok").toBool()) { fail(error, "Backup integrity check failed"); return {}; }
    QSqlQuery q(bundle.db); QStringList columns;
    if (q.exec("PRAGMA table_info(obs)")) while (q.next()) columns << q.value(1).toString();
    auto required = fields;
    required << "ts" << "src";
    for (const auto &f : required) {
        if (!columns.contains(f)) { fail(error, "Backup archive schema is incomplete"); return {}; }
    }
    if (config) *config = cfg.object();
    health["station"] = cfg.object().value("settings").toObject().value("stationName");
    return health;
}
bool Archive::restore(const QString &source, QString *error) {
    QJsonObject config;
    if (inspect(source, &config, error).isEmpty()) return false;
    QSqlQuery q(db); q.prepare("ATTACH DATABASE ? AS incoming"); q.addBindValue(source);
    if (!q.exec()) return fail(error, q.lastError().text());
    bool ok = db.transaction();
    const QString columns = "ts," + fields.join(',') + ",src";
    for (const auto &sql : QStringList{"DELETE FROM obs", "INSERT INTO obs(" + columns + ") SELECT " + columns + " FROM incoming.obs",
        "DELETE FROM meta", "INSERT INTO meta SELECT key,value FROM incoming.meta WHERE key NOT LIKE 'backup:%'"}) {
        if (ok) ok = q.exec(sql);
    }
    if (ok) ok = db.commit();
    const QString message = q.lastError().text();
    if (!ok) db.rollback();
    q.exec("DETACH DATABASE incoming");
    return ok || fail(error, message);
}
bool Archive::exportCsv(const QString &dest, QString *error) const {
    QSaveFile file(dest); file.setDirectWriteFallback(dest.startsWith("content:"));
    if (!file.open(QIODevice::WriteOnly)) return fail(error, file.errorString());
    file.write(("time," + fields.join(',') + '\n').toUtf8());
    QSqlQuery q(db);
    q.setForwardOnly(true);
    if (!q.exec("SELECT ts," + fields.join(',') + " FROM obs ORDER BY ts")) return fail(error, q.lastError().text());
    while (q.next()) {
        QStringList row;
        for (int i = 0; i < 19; ++i) row << (q.value(i).isNull() ? QString() : QString::number(q.value(i).toDouble(), 'g', 15));
        if (file.write((row.join(',') + '\n').toUtf8()) < 0) return fail(error, file.errorString());
    }
    return file.commit() || fail(error, file.errorString());
}
QJsonObject collectFields(const QByteArray &query, const QByteArray &body) {
    QJsonObject out;
    auto pairs = [&out](const QByteArray &bytes) {
        const QUrlQuery q(QString::fromUtf8(bytes).replace('+', ' '));
        for (const auto &p : q.queryItems(QUrl::FullyDecoded)) out[p.first.toLower()] = p.second;
    };
    pairs(query);
    if (body.trimmed().startsWith('{')) {
        const auto o = QJsonDocument::fromJson(body).object();
        for (auto it = o.begin(); it != o.end(); ++it) out[it.key().toLower()] = it.value();
    } else pairs(body);
    return out;
}
static std::optional<double> num(const QJsonObject &v, std::initializer_list<const char *> keys) {
    for (auto key : keys) {
        bool ok = false; const auto x = v.value(key).toVariant().toDouble(&ok);
        if (ok && std::isfinite(x)) return x;
    }
    return {};
}
Reading normalize(const QJsonObject &f, qint64 ts, Counters &m) {
    auto convert = [](std::optional<double> v, double factor, double shift = 0) -> std::optional<double> { return v ? std::optional<double>(*v * factor + shift) : std::nullopt; };
    auto first = [](auto a, auto b) { return a ? a : b; };
    Reading r{}; r[0] = double(ts);
    r[7] = first(convert(num(f, {"tempf", "temp_out_f"}), 1 / 1.8, -32 / 1.8), num(f, {"temperature_c", "temp_c", "temp"}));
    r[2] = first(convert(num(f, {"windspeedmph"}), .44704), num(f, {"wind_avg_m_s", "wind_speed_m_s"}));
    r[3] = first(convert(num(f, {"windgustmph"}), .44704), num(f, {"wind_max_m_s", "wind_gust_m_s"}));
    r[4] = num(f, {"winddir", "wind_dir_deg"});
    r[6] = first(convert(num(f, {"baromabsin", "baromrelin", "baromin"}), 33.8639), num(f, {"pressure_hpa", "pressure_mb"}));
    r[8] = num(f, {"humidity", "humidity_out"}); r[10] = num(f, {"uv", "uvi", "uv_index"}); r[11] = num(f, {"solarradiation", "solar_rad"});
    r[18] = first(convert(num(f, {"drain_piezo", "dailyrainin"}), 25.4), num(f, {"rain_mm", "dailyrainmm"}));
    auto delta = [](std::optional<double> current, std::optional<double> &previous) -> std::optional<double> {
        if (!current || *current < 0) return {};
        double n = previous ? (*current >= *previous ? *current - *previous : *current) : 0;
        previous = current; return n;
    };
    if (ts - m.at > 86400) { m.rain.reset(); m.strikes.reset(); }
    r[12] = delta(r[18], m.rain); if (r[12]) r[13] = *r[12] > 0 ? 1 : 0;
    r[14] = num(f, {"lightning", "storm_dist_km", "lightning_distance"});
    r[15] = delta(num(f, {"lightning_num", "strike_count", "lightning_day"}), m.strikes);
    r[17] = m.at ? std::clamp(std::round(double(ts - m.at) / 60), 1.0, 30.0) : 1;
    m.at = ts;
    return r;
}
QString condition(int code) {
    if (code == 0) return "Clear";
    if (code <= 2) return "Partly cloudy";
    if (code == 3) return "Overcast";
    if (code < 50) return "Fog";
    if (code < 60) return "Drizzle";
    if (code < 70) return "Rain";
    if (code < 80) return "Snow";
    if (code < 90) return "Showers";
    return "Thunderstorms";
}
double feelsLike(double c, double rh, double wind) {
    double f = c * 1.8 + 32;
    if (c <= 10 && wind > 1.34) { double v = std::pow(wind * 3.6, .16); return 13.12 + .6215 * c - 11.37 * v + .3965 * c * v; }
    if (f >= 80 && rh >= 40) return (-42.379 + 2.04901523 * f + 10.14333127 * rh - .22475541 * f * rh - .00683783 * f*f - .05481717 * rh*rh + .00122874 * f*f*rh + .00085282 * f*rh*rh - .00000199 * f*f*rh*rh - 32) / 1.8;
    return c;
}
std::optional<double> wbgt(double c, double rh, double solar, double wind) {
    if (!std::isfinite(c) || !(rh > 0) || rh > 100) return {};
    double wet = c * std::atan(.151977 * std::sqrt(rh + 8.313659)) + std::atan(c + rh) - std::atan(rh - 1.676331) + .00391838 * std::pow(rh, 1.5) * std::atan(.023101 * rh) - 4.686035;
    if (solar < 100) return .7 * wet + .3 * c;
    double globe = c + .021 * solar - .42 * std::max(wind, 0.0) + 3.6;
    return .7 * wet + .2 * globe + .1 * c;
}
double uiScale(double value) { return std::isfinite(value) ? std::clamp(value, .7, 2.0) : 1.0; }
}
