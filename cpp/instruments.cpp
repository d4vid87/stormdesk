#include "instruments.h"
#include <QDateTime>
#include <QPainter>
#include <QPainterPath>
#include <algorithm>
#include <cmath>
#include <limits>

namespace storm {
static QPointF polar(double angle, double radius) {
  const double radians = angle * 3.141592653589793 / 180;
  return {std::sin(radians) * radius, -std::cos(radians) * radius};
}
InstrumentFace::InstrumentFace(int k, QWidget *parent)
    : QAbstractButton(parent), kind(k) {
  setFocusPolicy(Qt::StrongFocus);
  setCursor(Qt::PointingHandCursor);
  setSizePolicy(QSizePolicy::Expanding, QSizePolicy::Fixed);
  setScale(1);
}
void InstrumentFace::setScale(double scale) {
  setFixedHeight(qRound(86 * scale));
}
void InstrumentFace::setReading(std::optional<double> next, double bearing) {
  value = next && std::isfinite(*next) ? next : std::nullopt;
  direction = bearing >= 0 && bearing <= 360
                  ? bearing
                  : std::numeric_limits<double>::quiet_NaN();
  update();
}
void InstrumentFace::paintEvent(QPaintEvent *) {
  QPainter p(this);
  p.setRenderHint(QPainter::Antialiasing);
  const double size = std::min(width(), height()) - 8;
  if (size <= 0)
    return;
  p.translate(width() / 2.0, height() / 2.0);
  p.scale(size / 90, size / 90);
  QColor ink = palette().color(QPalette::Highlight);
  QColor muted = palette().color(QPalette::WindowText);
  muted.setAlpha(65);
  QColor empty = palette().color(QPalette::Window);
  p.setPen(QPen(muted, 1));
  p.setBrush(empty);
  const double maximum[] = {25, 10, 30, 40, 12, 1050, 100, 30};
  const double low[] = {0, 0, 0, -10, 0, 950, 0, -10};
  double fraction =
      value ? std::clamp((*value - low[kind]) / (maximum[kind] - low[kind]),
                         0.0, 1.0)
            : 0;
  if (kind == 0 || kind == 3) {
    QRectF tube(-10, -39, 20, 78);
    p.drawRoundedRect(tube, kind == 3 ? 10 : 4, kind == 3 ? 10 : 4);
    if (value) {
      p.save();
      QPainterPath clip;
      clip.addRoundedRect(tube.adjusted(2, 2, -2, -2), 8, 8);
      p.setClipPath(clip);
      QColor fill = kind == 3 ? QColor("#e5c998") : ink;
      fill.setAlpha(175);
      p.fillRect(QRectF(-9, 38 - 75 * fraction, 18, 75 * fraction), fill);
      p.restore();
    }
    for (int i = 0; i <= 5; ++i)
      p.drawLine(QPointF(16, 35 - i * 14),
                 QPointF(i % 2 ? 20 : 23, 35 - i * 14));
  } else {
    p.drawEllipse(QPointF(), 39, 39);
    p.drawEllipse(QPointF(), 30, 30);
    for (int i = 0; i < 24; ++i)
      p.drawLine(polar(i * 15, 33), polar(i * 15, i % 3 ? 36 : 39));
    if (value) {
      p.setPen(QPen(ink, 2, Qt::SolidLine, Qt::RoundCap));
      if (kind == 6) {
        p.setPen(QPen(ink, 7, Qt::SolidLine, Qt::RoundCap));
        p.drawArc(QRectF(-34, -34, 68, 68), 90 * 16,
                  -qRound(fraction * 360 * 16));
      } else if (kind == 1) {
        if (*value > 0) {
          QPainterPath bolt;
          bolt.moveTo(4, -18);
          bolt.lineTo(-10, 3);
          bolt.lineTo(1, 1);
          bolt.lineTo(-4, 18);
          bolt.lineTo(11, -4);
          bolt.lineTo(1, -2);
          p.drawPath(bolt);
        } else {
          p.drawLine(QPointF(-8, 0), QPointF(8, 0));
        }
      } else if (kind == 7) {
        QPainterPath drop;
        drop.moveTo(0, -19);
        drop.cubicTo(-28, 9, -9, 27, 8, 16);
        drop.cubicTo(22, 6, 4, -14, 0, -19);
        p.drawPath(drop);
      } else if (kind != 2 || std::isfinite(direction)) {
        const double angle = kind == 2 ? direction : -125 + 250 * fraction;
        p.drawLine(polar(angle + 180, 7), polar(angle, 27));
        p.setBrush(ink);
        p.drawEllipse(QPointF(), 2, 2);
        if (kind == 2) {
          p.setPen(muted);
          QFont f = p.font();
          f.setPixelSize(9);
          p.setFont(f);
          p.drawText(QRectF(-8, -27, 16, 12), Qt::AlignCenter, "N");
        }
      }
    }
  }
  if (!value) {
    p.setPen(palette().color(QPalette::WindowText));
    p.drawText(QRectF(-25, -12, 50, 24), Qt::AlignCenter, "—");
  }
  if (hasFocus()) {
    p.setPen(QPen(ink, 1, Qt::DashLine));
    p.setBrush(Qt::NoBrush);
    p.drawRoundedRect(QRectF(-44, -44, 88, 88), 5, 5);
  }
}

WeatherGlyph::WeatherGlyph(QWidget *parent) : QWidget(parent) {
  setAccessibleName("Current weather icon");
  setSizePolicy(QSizePolicy::Preferred, QSizePolicy::Preferred);
  elapsed.start();
  timer.setInterval(50);
  connect(&timer, &QTimer::timeout, this, qOverload<>(&QWidget::update));
  setScale(1);
}
void WeatherGlyph::setScale(double scale) {
  setMinimumSize(0, qRound(115 * scale));
  setMaximumWidth(qRound(170 * scale));
}
void WeatherGlyph::cadence() {
  if (motion && code && isVisible())
    timer.start();
  else
    timer.stop();
}
void WeatherGlyph::setWeather(std::optional<int> next, bool daylight,
                              bool animate) {
  code = next;
  day = daylight;
  motion = animate;
  cadence();
  update();
}
void WeatherGlyph::showEvent(QShowEvent *) { cadence(); }
void WeatherGlyph::hideEvent(QHideEvent *) { timer.stop(); }
void WeatherGlyph::paintEvent(QPaintEvent *) {
  if (!code)
    return;
  QPainter p(this);
  p.setRenderHint(QPainter::Antialiasing);
  double size = std::min(width(), height());
  p.translate((width() - size) / 2, (height() - size) / 2);
  p.scale(size / 130, size / 130);
  const double t = motion ? elapsed.elapsed() / 1000.0 : 0;
  const bool wet = *code >= 51, snow = *code >= 71 && *code <= 86;
  QColor silver = palette().color(QPalette::Highlight);
  if (*code <= 2) {
    p.save();
    p.translate(48, 43);
    p.setPen(QPen(day ? QColor("#e5c998") : silver, 2.2, Qt::SolidLine,
                  Qt::RoundCap));
    p.setBrush(Qt::NoBrush);
    if (day) {
      p.rotate(std::fmod(t * 5, 360));
      p.drawEllipse(QPointF(), 15, 15);
      for (int i = 0; i < 8; ++i)
        p.drawLine(polar(i * 45, 23), polar(i * 45, 30));
    } else {
      QPainterPath moon;
      moon.moveTo(7, -18);
      moon.cubicTo(-30, -23, -26, 26, 8, 18);
      moon.cubicTo(-9, 14, -11, -4, 7, -18);
      p.drawPath(moon);
    }
    p.restore();
  }
  if (*code > 0) {
    p.save();
    p.translate(std::sin(t * .8) * 3, 0);
    QPainterPath cloud;
    cloud.moveTo(38, 87);
    cloud.cubicTo(14, 85, 15, 57, 39, 56);
    cloud.cubicTo(42, 28, 82, 27, 88, 54);
    cloud.cubicTo(115, 45, 131, 86, 103, 87);
    cloud.closeSubpath();
    p.setPen(QPen(silver, 2.3, Qt::SolidLine, Qt::RoundCap));
    p.setBrush(palette().color(QPalette::Window));
    p.drawPath(cloud);
    if (*code == 45 || *code == 48) {
      p.drawLine(QPointF(32, 98), QPointF(103, 98));
      p.drawLine(QPointF(44, 106), QPointF(111, 106));
    } else if (wet) {
      for (int i = 0; i < 3; ++i) {
        double x = 49 + i * 21, y = 96 + std::fmod(t * 12 + i * 4, 16.0);
        if (snow) {
          p.drawLine(QPointF(x - 3, y), QPointF(x + 3, y));
          p.drawLine(QPointF(x, y - 3), QPointF(x, y + 3));
        } else
          p.drawLine(QPointF(x, y), QPointF(x - 3, y + 7));
      }
      if (*code >= 95) {
        QPainterPath bolt;
        bolt.moveTo(77, 79);
        bolt.lineTo(65, 98);
        bolt.lineTo(76, 94);
        bolt.lineTo(69, 114);
        p.setPen(QPen(QColor("#e5c998"), 3, Qt::SolidLine, Qt::RoundCap));
        p.drawPath(bolt);
      }
    }
    p.restore();
  }
}
SunCycle::SunCycle(QWidget *parent) : QWidget(parent) {
  setAccessibleName("Sunrise and sunset");
  setSizePolicy(QSizePolicy::Expanding, QSizePolicy::Fixed);
  elapsed.start();
  timer.setInterval(50);
  connect(&timer, &QTimer::timeout, this, qOverload<>(&QWidget::update));
  setScale(1);
}
void SunCycle::setScale(double value) {
  scale = value;
  setFixedHeight(qRound(156 * scale));
}
QString SunCycle::time(qint64 seconds) const {
  return hasTimes() ? QDateTime::fromSecsSinceEpoch(seconds)
                          .toOffsetFromUtc(offset)
                          .toString("HH:mm")
                    : "—";
}
void SunCycle::setTimes(qint64 sunrise, qint64 sunset, int utcOffset,
                        bool animate) {
  rise = sunrise;
  set = sunset;
  offset = utcOffset;
  motion = animate;
  setAccessibleDescription(
      hasTimes()
          ? "Sunrise " + time(rise) + ", sunset " + time(set) +
                ". Location local time."
          : "Sunrise and sunset unavailable for this date and location.");
  cadence();
  update();
}
void SunCycle::cadence() {
  if (motion && hasTimes() && isVisible())
    timer.start();
  else
    timer.stop();
}
void SunCycle::showEvent(QShowEvent *) { cadence(); }
void SunCycle::hideEvent(QHideEvent *) { timer.stop(); }
void SunCycle::paintEvent(QPaintEvent *) {
  QPainter p(this);
  p.setRenderHint(QPainter::Antialiasing);
  p.scale(scale, scale);
  const double w = width() / scale;
  const bool wide = w >= 560;
  const double side = wide ? 180 : w / 2;
  const QColor ink = palette().color(QPalette::WindowText);
  const QColor gold("#e5c998"), dusk("#d6a6a0");
  QColor faint = ink;
  faint.setAlpha(65);
  const double t = motion && timer.isActive() ? elapsed.elapsed() / 1000.0 : 0;
  auto endpoint = [&](bool rising, double x) {
    const QColor color = rising ? gold : dusk;
    const double cx = x + side / 2, horizon = 48;
    // The small icons animate decoratively; the central marker shows actual
    // time.
    const double y = horizon - 11 + (rising ? -1 : 1) * std::sin(t * 1.3) * 3;
    p.save();
    p.setClipRect(QRectF(x, 0, side, horizon));
    p.setPen(QPen(hasTimes() ? color : faint, 1.6));
    p.setBrush(Qt::NoBrush);
    p.drawEllipse(QPointF(cx, y), 14, 14);
    for (int i = 0; i < 8; ++i) {
      const auto a = polar(i * 45 + t * 8, 20);
      const auto b = polar(i * 45 + t * 8, 25);
      p.drawLine(QPointF(cx, y) + a, QPointF(cx, y) + b);
    }
    p.restore();
    p.setPen(QPen(faint, 1));
    p.drawLine(QPointF(cx - 42, horizon), QPointF(cx + 42, horizon));
    p.setPen(color);
    auto f = font();
    f.setPixelSize(11);
    p.setFont(f);
    p.drawText(QRectF(x, 60, side, 18), Qt::AlignCenter,
               rising ? "SUNRISE" : "SUNSET");
    f.setPixelSize(30);
    p.setFont(f);
    p.setPen(ink);
    p.drawText(QRectF(x, 78, side, 40), Qt::AlignCenter,
               time(rising ? rise : set));
    f.setPixelSize(10);
    p.setFont(f);
    p.setPen(faint);
    p.drawText(QRectF(x, 119, side, 18), Qt::AlignCenter,
               "LOCATION LOCAL TIME");
  };
  endpoint(true, 0);
  endpoint(false, w - side);
  if (!wide)
    return;
  const double left = side + 24, span = w - 2 * side - 48;
  const double base = 91, height = 63;
  QPainterPath arc;
  for (int i = 0; i <= 80; ++i) {
    double f = i / 80.0;
    QPointF point(left + span * f,
                  base - std::sin(f * 3.141592653589793) * height);
    i == 0 ? arc.moveTo(point) : arc.lineTo(point);
  }
  p.setPen(QPen(faint, 1, Qt::DashLine));
  p.setBrush(Qt::NoBrush);
  p.drawPath(arc);
  p.drawLine(QPointF(left, base), QPointF(left + span, base));
  QString caption = "Sun times unavailable";
  if (hasTimes()) {
    const auto now = QDateTime::currentSecsSinceEpoch();
    const double fraction =
        std::clamp(double(now - rise) / double(set - rise), 0.0, 1.0);
    QPointF point(left + span * fraction,
                  base - std::sin(fraction * 3.141592653589793) * height);
    if (now >= rise && now <= set) {
      QColor glow = gold;
      glow.setAlpha(35 + qRound(12 * std::sin(t * 2)));
      p.setPen(Qt::NoPen);
      p.setBrush(glow);
      p.drawEllipse(point, 18, 18);
      p.setBrush(gold);
      p.drawEllipse(point, 6, 6);
    }
    const auto duration = (set - rise) / 60;
    caption =
        QString("%1h %2m of daylight").arg(duration / 60).arg(duration % 60);
    if (now < rise)
      caption += " · Before sunrise";
    else if (now > set)
      caption += " · After sunset";
  }
  auto f = font();
  f.setPixelSize(12);
  p.setFont(f);
  p.setPen(ink);
  p.drawText(QRectF(left, 113, span, 24), Qt::AlignCenter, caption);
}
} // namespace storm
