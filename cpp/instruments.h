#pragma once
#include <QAbstractButton>
#include <QElapsedTimer>
#include <QJsonObject>
#include <QScrollArea>
#include <QTimer>
#include <optional>

namespace storm {
class InstrumentFace : public QAbstractButton {
  Q_OBJECT
public:
  InstrumentFace(int kind, QWidget *parent = nullptr);
  void setReading(std::optional<double> value, double direction = 0);
  void setScale(double scale);
  std::optional<double> reading() const { return value; }

protected:
  void paintEvent(QPaintEvent *) override;

private:
  int kind;
  std::optional<double> value;
  double direction = 0;
};

class WeatherGlyph : public QWidget {
  Q_OBJECT
public:
  explicit WeatherGlyph(QWidget *parent = nullptr);
  void setWeather(std::optional<int> code, bool day, bool motion);
  void setScale(double scale);
  bool animated() const { return motion && timer.isActive(); }
  QSize sizeHint() const override { return {maximumWidth(), minimumHeight()}; }

protected:
  void paintEvent(QPaintEvent *) override;
  void showEvent(QShowEvent *) override;
  void hideEvent(QHideEvent *) override;

private:
  QTimer timer;
  QElapsedTimer elapsed;
  std::optional<int> code;
  bool day = true, motion = true;
  void cadence();
};
class SunCycle : public QAbstractButton {
  Q_OBJECT
public:
  explicit SunCycle(QWidget *parent = nullptr);
  void setTimes(qint64 sunrise, qint64 sunset, int utcOffset, bool motion,
                qint64 nextSunrise = 0);
  void setScale(double scale);
  void setCompact(bool enabled) { compact = enabled; setScale(scale); }
  void setForecast(const QJsonObject &forecast, bool metric);
  bool hasTimes() const { return rise > 0 && set > rise; }
  bool animated() const { return hasTimes() && motion && !forecastView && timer.isActive(); }

protected:
  void paintEvent(QPaintEvent *) override;
  void showEvent(QShowEvent *) override;
  void hideEvent(QHideEvent *) override;

private:
  void resizeEvent(QResizeEvent *) override;
  bool eventFilter(QObject *, QEvent *) override;
  QScrollArea *hourly;
  QJsonObject forecast;
  bool metric = false, forecastView = false;
  qint64 forecastBucket = -1;
  void renderForecast();
  void placeForecast();
  qint64 rise = 0, set = 0, nextRise = 0;
  int offset = 0;
  bool motion = true;
  double scale = 1;
  bool compact = false;
  QTimer timer;
  QElapsedTimer elapsed;
  void cadence();
  QString time(qint64 seconds) const;
};
} // namespace storm
