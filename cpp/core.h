#pragma once
#include <QJsonArray>
#include <QJsonObject>
#include <QSqlDatabase>
#include <QStringList>
#include <optional>
#include <array>

namespace storm {
using Reading = std::array<std::optional<double>, 19>;
extern const QStringList fields;
QJsonArray toJson(const Reading &row);
std::optional<Reading> fromJson(const QJsonArray &row);
QString fingerprint(const QJsonObject &settings);
QString defaultDataDir();
bool copyDocument(const QString &source, const QString &destination, QString *error);

class Config {
public:
    explicit Config(QString path);
    QJsonObject value;
    QString path;
    bool load(QString *error);
    bool save(const QJsonObject &next, QString *error);
    int merge(const QJsonObject &delta, QString *error);
    QJsonObject settings() const { return value.value("settings").toObject(); }
    QJsonObject publicValue() const;
    QString text(const QString &key, const QString &fallback = {}) const;
    double number(const QString &key, double fallback = 0) const;
    QString stationSource() const;
    QString windUnit() const;
    double windFactor() const;
    QJsonObject location() const;
};

class Archive {
public:
    explicit Archive(QString path);
    ~Archive();
    bool open(QString *error);
    QString path;
    QSqlDatabase db;
    bool insert(const Reading &row, int source, const QString &station, QString *error, const QJsonObject &metadata = {});
    Reading latest() const;
    QJsonArray tuples(qint64 from, qint64 to) const;
    QJsonArray daily(int offsetMinutes, qint64 from = 0) const;
    QJsonObject health() const;
    QJsonObject current() const;
    QString meta(const QString &key) const;
    bool setMeta(const QString &key, const QString &value);
    bool backup(const QString &destination, const QJsonObject &config, QString *error) const;
    static QJsonObject inspect(const QString &path, QJsonObject *config, QString *error);
    bool restore(const QString &source, QString *error);
    bool exportCsv(const QString &destination, QString *error) const;
    int importJsonl(const QString &directory, const QString &station, QString *error);
    bool clear(const QString &station, QString *error);
};

struct Counters {
    std::optional<double> rain, strikes;
    qint64 at = 0;
};
QJsonObject collectFields(const QByteArray &query, const QByteArray &body);
Reading normalize(const QJsonObject &values, qint64 timestamp, Counters &counters);
QString condition(int code);
double feelsLike(double c, double humidity, double wind);
double uiScale(double value);
std::optional<double> wbgt(double temperature, double humidity, double solar, double wind);
}
