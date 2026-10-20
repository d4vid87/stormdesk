#pragma once
#include <QAbstractButton>
#include <QElapsedTimer>
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
  bool animated() const { return timer.isActive(); }
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
class SunCycle : public QWidget {
  Q_OBJECT
public:
  explicit SunCycle(QWidget *parent = nullptr);
  void setTimes(qint64 sunrise, qint64 sunset, int utcOffset, bool motion);
  void setScale(double scale);
  bool hasTimes() const { return rise > 0 && set > rise; }
  bool animated() const { return timer.isActive(); }

protected:
  void paintEvent(QPaintEvent *) override;
  void showEvent(QShowEvent *) override;
  void hideEvent(QHideEvent *) override;

private:
  qint64 rise = 0, set = 0;
  int offset = 0;
  bool motion = true;
  double scale = 1;
  QTimer timer;
  QElapsedTimer elapsed;
  void cadence();
  QString time(qint64 seconds) const;
};
} // namespace storm
