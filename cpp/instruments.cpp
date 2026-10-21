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
  QRadialGradient aura(QPointF(65, 60), 62);
  QColor glow = day ? QColor("#efbd67") : QColor("#9bbce8");
  glow.setAlpha(qRound(25 + 6 * std::sin(t)));
  aura.setColorAt(0, glow);
  aura.setColorAt(1, Qt::transparent);
  p.setPen(Qt::NoPen);
  p.setBrush(aura);
  p.drawEllipse(QPointF(65, 60), 62, 62);
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
      QRadialGradient sun(QPointF(-4, -5), 22);
      sun.setColorAt(0, QColor("#fff2cb"));
      sun.setColorAt(1, QColor("#f3b56b"));
      p.setBrush(sun);
      p.drawEllipse(QPointF(), 19, 19);
      for (int i = 0; i < 8; ++i)
        p.drawLine(polar(i * 45, 23), polar(i * 45, 30));
    } else {
      p.translate(17, 20);
      QPainterPath moon, cutout;
      moon.addEllipse(QPointF(), 34, 34);
      cutout.addEllipse(QPointF(19, -18), 31, 31);
      moon = moon.subtracted(cutout);
      QLinearGradient shade(-28, -25, 26, 30);
      shade.setColorAt(0, QColor("#f2f1dd"));
      shade.setColorAt(1, QColor("#9daedc"));
      p.setPen(Qt::NoPen);
      p.fillPath(moon, shade);
      p.save();
      p.setClipPath(moon);
      p.setBrush(QColor(111, 133, 184, 65));
      p.drawEllipse(QPointF(-20, 4), 5, 7);
      p.drawEllipse(QPointF(-10, 21), 7, 5);
      p.restore();
      for (const QPointF star :
           {QPointF(-32, -30), QPointF(33, -34), QPointF(39, 17)}) {
        QColor gold("#f6e7c3");
        gold.setAlpha(qRound(150 + 80 * std::sin(t + star.x())));
        p.setBrush(gold);
        QPainterPath glint;
        glint.moveTo(star + QPointF(0, -4));
        glint.lineTo(star + QPointF(1, -1));
        glint.lineTo(star + QPointF(4, 0));
        glint.lineTo(star + QPointF(1, 1));
        glint.lineTo(star + QPointF(0, 4));
        glint.lineTo(star + QPointF(-1, 1));
        glint.lineTo(star + QPointF(-4, 0));
        glint.lineTo(star + QPointF(-1, -1));
        p.drawPath(glint);
      }
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
  setFixedHeight(qRound((compact ? 48 : 156) * scale));
}
QString SunCycle::time(qint64 seconds) const {
  return hasTimes() ? QDateTime::fromSecsSinceEpoch(seconds)
                          .toOffsetFromUtc(offset)
                          .toString("h:mm AP")
                    : "—";
}
void SunCycle::setTimes(qint64 sunrise, qint64 sunset, int utcOffset,
                        bool animate, qint64 nextSunrise) {
  nextRise = nextSunrise;
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
  if (hasTimes() && isVisible())
    timer.start(motion ? 50 : 60000);
  else
    timer.stop();
}
void SunCycle::showEvent(QShowEvent *) { cadence(); }
void SunCycle::hideEvent(QHideEvent *) { timer.stop(); }
void SunCycle::paintEvent(QPaintEvent *) {
  QPainter p(this);
  p.setRenderHint(QPainter::Antialiasing);
  p.scale(scale, scale);
  const double w = width() / scale, h = height() / scale;
  if (compact) {
    const QColor ink = palette().color(QPalette::WindowText);
    const QColor gold("#ffc45d"), dusk("#dc9ab4");
    const double side = std::min(82.0, w * .28);
    auto f = font(); f.setPixelSize(10); p.setFont(f);
    p.setPen(palette().color(QPalette::PlaceholderText));
    p.drawText(QRectF(0, 1, side, 15), Qt::AlignLeft, "SUNRISE");
    p.drawText(QRectF(w - side, 1, side, 15), Qt::AlignRight, "SUNSET");
    f.setPixelSize(14); p.setFont(f); p.setPen(ink);
    p.drawText(QRectF(0, 20, side, 22), Qt::AlignLeft, time(rise));
    p.drawText(QRectF(w - side, 20, side, 22), Qt::AlignRight, time(set));
    const double left = side + 5, right = w - side - 5;
    QPainterPath path;
    path.moveTo(left, 34); path.quadTo(w / 2, 0, right, 34);
    QLinearGradient colors(left, 0, right, 0);
    colors.setColorAt(0, gold); colors.setColorAt(1, dusk);
    p.setPen(QPen(QBrush(colors), 1.5)); p.drawPath(path);
    if (hasTimes()) {
      const double fraction = std::clamp(
          double(QDateTime::currentSecsSinceEpoch() - rise) / double(set - rise), 0.0, 1.0);
      const QPointF point(left + (right - left) * fraction,
                          34 - 68 * fraction * (1 - fraction));
      QRadialGradient glow(point, 12);
      QColor soft = gold;
      soft.setAlpha(motion ? qRound(65 + 15 * std::sin(elapsed.elapsed() / 500.0)) : 65);
      glow.setColorAt(0, soft); glow.setColorAt(1, Qt::transparent);
      p.setPen(Qt::NoPen); p.setBrush(glow); p.drawEllipse(point, 12, 12);
      p.setBrush(ink); p.drawEllipse(point, 3, 3);
    }
    return;
  }
  const bool wide = w >= 440;
  const double side = wide ? 104 : w / 2;
  const QColor ink = palette().color(QPalette::WindowText);
  const QColor gold("#ffbc67"), dusk("#dc86a4");
  QColor faint = ink;
  faint.setAlpha(70);
  const double t = motion && timer.isActive() ? elapsed.elapsed() / 1000.0 : 0;
  QLinearGradient wash(0, 0, w, h);
  QColor warm = gold, rose = dusk;
  warm.setAlpha(20);
  rose.setAlpha(16);
  wash.setColorAt(0, warm);
  wash.setColorAt(1, rose);
  p.setBrush(wash);
  p.setPen(QPen(faint, .7));
  p.drawRoundedRect(QRectF(1, 1, w - 2, h - 2), 10, 10);
  for (int i = 0; i < 6; ++i) {
    QColor star = ink;
    star.setAlpha(qRound(25 + 18 * (1 + std::sin(t + i))));
    p.setBrush(star);
    p.setPen(Qt::NoPen);
    p.drawEllipse(QPointF(w * (.16 + i * .13), 18 + (i % 3) * 12), 1, 1);
  }
  auto endpoint = [&](bool rising, double x) {
    const QColor color = rising ? gold : dusk;
    const double cx = x + side / 2, horizon = 62;
    const double cy = horizon - 8 + std::sin(t * 1.2) * (rising ? -2 : 2);
    QRadialGradient glow(QPointF(cx, cy), 34);
    QColor light = color;
    light.setAlpha(50);
    glow.setColorAt(0, light);
    glow.setColorAt(1, Qt::transparent);
    p.setBrush(glow);
    p.setPen(Qt::NoPen);
    p.drawEllipse(QPointF(cx, cy), 34, 34);
    p.save();
    p.setClipRect(QRectF(x, 8, side, horizon - 8));
    QLinearGradient orb(0, cy - 15, 0, cy + 15);
    orb.setColorAt(0, QColor("#fff2cb"));
    orb.setColorAt(1, color);
    p.setBrush(hasTimes() ? QBrush(orb) : QBrush(faint));
    p.drawEllipse(QPointF(cx, cy), 15, 15);
    p.setPen(QPen(color, 1.8, Qt::SolidLine, Qt::RoundCap));
    for (int i = 0; i < 8; ++i)
      p.drawLine(QPointF(cx, cy) + polar(i * 45, 21),
                 QPointF(cx, cy) + polar(i * 45, 27));
    p.restore();
    p.setPen(QPen(color, 1, Qt::SolidLine, Qt::RoundCap));
    for (int i = 0; i < 3; ++i)
      p.drawLine(QPointF(cx - 28 + i * 7, horizon + i * 5),
                 QPointF(cx + 28 - i * 7, horizon + i * 5));
    auto f = font();
    f.setPixelSize(10);
    p.setFont(f);
    p.setPen(faint);
    p.drawText(QRectF(x, 79, side, 15), Qt::AlignCenter,
               rising ? "SUNRISE" : "SUNSET");
    f.setPixelSize(wide ? 24 : 22);
    p.setFont(f);
    p.setPen(ink);
    p.drawText(QRectF(x, 98, side, 30), Qt::AlignCenter,
               time(rising ? rise : set));
  };
  endpoint(true, 0);
  endpoint(false, w - side);
  const auto now = QDateTime::currentSecsSinceEpoch();
  QString caption = "Sun times unavailable", next = "Your daylight";
  if (hasTimes()) {
    const auto duration = qRound64(double(set - rise) / 60);
    caption = QString("%1h %2m daylight · %3")
                  .arg(duration / 60)
                  .arg(duration % 60)
                  .arg(now < rise  ? "Before sunrise"
                       : now > set ? "After sunset"
                                   : "Daylight");
    const qint64 nextAt = now < rise ? rise : now < set ? set : nextRise;
    if (nextAt > now) {
      const qint64 remaining = (nextAt - now + 59) / 60;
      next = QString("%1 in %2h %3m")
                 .arg(now < rise || now > set ? "Sunrise" : "Sunset")
                 .arg(remaining / 60)
                 .arg(remaining % 60);
    } else if (now > set)
      next = "After sunset";
  }
  auto f = font();
  if (wide) {
    const double left = side + 12, span = w - 2 * side - 24, base = 111;
    QPainterPath arc;
    arc.moveTo(left, base);
    arc.quadTo(left + span / 2, -9, left + span, base);
    QLinearGradient colors(left, 0, left + span, 0);
    colors.setColorAt(0, gold);
    colors.setColorAt(.5, QColor("#f6df9c"));
    colors.setColorAt(1, dusk);
    auto fill = arc;
    fill.lineTo(left + span, 130);
    fill.lineTo(left, 130);
    fill.closeSubpath();
    QLinearGradient fade(0, 45, 0, 132);
    fade.setColorAt(0, QColor(248, 189, 98, 40));
    fade.setColorAt(1, Qt::transparent);
    p.fillPath(fill, fade);
    p.setPen(QPen(faint, 1, Qt::DotLine));
    p.drawLine(QPointF(left, base), QPointF(left + span, base));
    p.setPen(QPen(QBrush(colors), 1.8));
    p.drawPath(arc);
    if (hasTimes()) {
      const double fraction =
          std::clamp(double(now - rise) / double(set - rise), 0.0, 1.0);
      const QPointF point(left + span * fraction,
                          base - 240 * fraction * (1 - fraction));
      const QColor marker = now > set ? QColor("#d7dffa") : gold;
      QRadialGradient glow(point, 20);
      QColor soft = marker;
      soft.setAlpha(qRound(65 + 12 * std::sin(t * 2)));
      glow.setColorAt(0, soft);
      glow.setColorAt(1, Qt::transparent);
      p.setPen(Qt::NoPen);
      p.setBrush(glow);
      p.drawEllipse(point, 20, 20);
      p.setPen(QPen(QColor("#f1ecff"), 1.5));
      p.setBrush(marker);
      p.drawEllipse(point, 5, 5);
    }
    f.setPixelSize(15);
    p.setFont(f);
    p.setPen(ink);
    p.drawText(QRectF(left, 14, span, 24), Qt::AlignLeft, next);
  }
  f.setPixelSize(10);
  p.setFont(f);
  p.setPen(ink);
  p.drawText(QRectF(8, 133, w - 16, 17), Qt::AlignCenter,
             wide ? caption : next);
}
} // namespace storm
