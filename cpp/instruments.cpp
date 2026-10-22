#include "instruments.h"
#include "core.h"
#include <QGridLayout>
#include <QHBoxLayout>
#include <QLabel>
#include <QScrollBar>
#include <QScroller>
#include <QStyleOptionFocusRect>
#include <QWheelEvent>
#include <QTimeZone>
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
SunCycle::SunCycle(QWidget *parent) : QAbstractButton(parent) {
  setAccessibleName("Sun cycle. Show 24-hour forecast");
  setFocusPolicy(Qt::StrongFocus);
  setCursor(Qt::PointingHandCursor);
  setSizePolicy(QSizePolicy::Expanding, QSizePolicy::Fixed);
  hourly = new QScrollArea(this);
  hourly->setObjectName("daylightForecast");
  hourly->setAccessibleName("Next 24 hours. Swipe or scroll for more hours.");
  hourly->setFrameShape(QFrame::NoFrame);
  hourly->setVerticalScrollBarPolicy(Qt::ScrollBarAlwaysOff);
  hourly->setWidgetResizable(true);
  hourly->viewport()->installEventFilter(this);
  hourly->setStyleSheet("QScrollArea, QScrollArea > QWidget > QWidget { background:transparent; border:0; }");
  QScroller::grabGesture(hourly->viewport(), QScroller::TouchGesture);
  hourly->hide();
  connect(this, &QAbstractButton::clicked, this, [this] {
    forecastView = !forecastView;
    hourly->setVisible(forecastView);
    setAccessibleName(forecastView ? "24-hour forecast. Show sun cycle"
                                  : "Sun cycle. Show 24-hour forecast");
    if (forecastView) renderForecast();
    cadence();
    update();
  });
  elapsed.start();
  connect(&timer, &QTimer::timeout, this, [this] {
    if (forecastBucket != QDateTime::currentSecsSinceEpoch() / 3600)
      renderForecast();
    update();
  });
  setScale(1);
}
void SunCycle::placeForecast() {
  hourly->setGeometry(compact ? QRect(qRound(44 * scale), 0,
                                      std::max(0, width() - qRound(44 * scale)), height())
                             : QRect(qRound(10 * scale), qRound(32 * scale),
                                     std::max(0, width() - qRound(20 * scale)),
                                     std::max(0, height() - qRound(40 * scale))));
}
void SunCycle::resizeEvent(QResizeEvent *) { placeForecast(); }
bool SunCycle::eventFilter(QObject *object, QEvent *event) {
  if (object == hourly->viewport() && event->type() == QEvent::Wheel) {
    const auto wheel = static_cast<QWheelEvent *>(event);
    auto bar = hourly->horizontalScrollBar();
    const int before = bar->value();
    const int delta = wheel->pixelDelta().isNull()
                          ? wheel->angleDelta().x() + wheel->angleDelta().y()
                          : wheel->pixelDelta().x() + wheel->pixelDelta().y();
    bar->setValue(before - delta);
    if (bar->value() != before) return true;
  }
  return QAbstractButton::eventFilter(object, event);
}
void SunCycle::setScale(double value) {
  scale = value;
  setFixedHeight(qRound((compact ? 48 : 156) * scale));
  hourly->setHorizontalScrollBarPolicy(compact ? Qt::ScrollBarAlwaysOff
                                              : Qt::ScrollBarAsNeeded);
  placeForecast();
  renderForecast();
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
      (hasTimes() ? "Sunrise " + time(rise) + ", sunset " + time(set) +
                      ". Location local time."
                  : "Sunrise and sunset unavailable for this date and location.") +
      " Click or press Space to switch views. Forecast temperatures use your selected units.");
  cadence();
  update();
}
void SunCycle::setForecast(const QJsonObject &value, bool useMetric) {
  if (forecast == value && metric == useMetric &&
      forecastBucket == QDateTime::currentSecsSinceEpoch() / 3600)
    return;
  forecast = value;
  metric = useMetric;
  renderForecast();
  cadence();
  update();
}
void SunCycle::renderForecast() {
  forecastBucket = QDateTime::currentSecsSinceEpoch() / 3600;
  const int scroll = hourly->horizontalScrollBar()->value();
  auto row = new QWidget;
  auto layout = new QHBoxLayout(row);
  layout->setContentsMargins(0, 0, 0, 0);
  layout->setSpacing(qRound(4 * scale));
  const auto source = forecast.value("hourly").toObject();
  const auto times = source.value("time").toArray();
  const auto temperatures = source.value("temperature_2m").toArray();
  const auto codes = source.value("weather_code").toArray();
  const auto days = forecast.value("daily").toObject();
  const auto rises = days.value("sunrise").toArray();
  const auto sets = days.value("sunset").toArray();
  const qint64 now = QDateTime::currentSecsSinceEpoch();
  QList<QPair<qint64, int>> future;
  for (int i = 0; i < times.size(); ++i) {
    const double at = times[i].toDouble(0);
    if (std::isfinite(at) && at >= now && at < now + 86400)
      future.append({qint64(at), i});
  }
  std::sort(future.begin(), future.end());
  qint64 previous = 0;
  int count = 0;
  for (const auto &hour : future) {
    if (hour.first == previous) continue;
    previous = hour.first;
    if (++count > 24) break;
    const QTimeZone zone(forecast.value("timezone").toString().toUtf8());
    const auto utc = QDateTime::fromSecsSinceEpoch(hour.first);
    const auto at = zone.isValid() ? utc.toTimeZone(zone) : utc.toOffsetFromUtc(offset);
    const int i = hour.second;
    const auto temperature = i < temperatures.size() ? temperatures[i] : QJsonValue();
    const auto code = i < codes.size() && codes[i].isDouble()
                          ? std::optional<int>(codes[i].toInt()) : std::nullopt;
    bool day = false;
    for (int d = 0; d < std::min(rises.size(), sets.size()); ++d)
      day |= hour.first >= rises[d].toDouble() && hour.first < sets[d].toDouble();
    const QString degrees = temperature.isDouble() && std::isfinite(temperature.toDouble())
        ? QString::number(qRound(temperature.toDouble() * (metric ? 1 : 1.8) + (metric ? 0 : 32))) + "°"
        : "—";
    auto card = new QWidget;
    card->setObjectName("daylightHour");
    card->setFixedWidth(qRound((compact ? 76 : 88) * scale));
    auto grid = new QGridLayout(card);
    grid->setContentsMargins(qRound(4 * scale), 0, qRound(4 * scale), 0);
    grid->setSpacing(0);
    auto label = [&](const QString &text, int pixels) {
      auto item = new QLabel(text);
      item->setTextFormat(Qt::PlainText);
      item->setAlignment(Qt::AlignCenter);
      auto f = font(); f.setPixelSize(qRound(pixels * scale)); item->setFont(f);
      return item;
    };
    auto stamp = label(at.toString("h AP"), compact ? 10 : 11);
    auto reading = label(degrees, compact ? 17 : 25);
    reading->setObjectName("daylightTemperature");
    auto glyph = new WeatherGlyph;
    glyph->setFixedSize(qRound((compact ? 24 : 34) * scale),
                        qRound((compact ? 30 : 34) * scale));
    glyph->setWeather(code, day, false);
    if (compact) {
      grid->addWidget(stamp, 0, 0);
      grid->addWidget(reading, 1, 0);
      grid->addWidget(glyph, 0, 1, 2, 1);
    } else {
      grid->addWidget(stamp, 0, 0, 1, 2);
      grid->addWidget(glyph, 1, 0, Qt::AlignCenter);
      grid->addWidget(reading, 1, 1);
      grid->addWidget(label(code ? condition(*code) : "Unavailable", 10), 2, 0, 1, 2);
    }
    card->setAccessibleName(at.toString("ddd h AP") + ", " + degrees +
        (metric ? " Celsius, " : " Fahrenheit, ") + (code ? condition(*code) : "weather unavailable"));
    layout->addWidget(card);
  }
  if (count == 0) {
    auto empty = new QLabel("Hourly forecast unavailable");
    empty->setObjectName("daylightForecastEmpty");
    empty->setAlignment(Qt::AlignCenter);
    empty->setWordWrap(true);
    layout->addWidget(empty);
  }
  layout->addStretch();
  delete hourly->takeWidget();
  hourly->setWidget(row);
  hourly->horizontalScrollBar()->setValue(scroll);
}
void SunCycle::cadence() {
  if (isVisible() && (hasTimes() || !forecast.isEmpty()))
    timer.start(motion && hasTimes() && !forecastView ? 50 : 60000);
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
  const QColor ink = palette().color(QPalette::WindowText);
  const QColor gold("#ffc45d"), blue("#a9c3ef"), dusk("#dc9ab4");
  const double t = motion ? elapsed.elapsed() / 1000.0 : 0;
  QColor faint = ink; faint.setAlpha(125);
  QRadialGradient wash(QPointF(w / 2, h), w * .6);
  wash.setColorAt(0, QColor(255, 196, 93, 22));
  wash.setColorAt(1, Qt::transparent);
  p.setBrush(wash); p.setPen(QPen(QColor(105, 106, 112, 110), .7));
  p.drawRoundedRect(QRectF(1, 1, w - 2, h - 2), 9, 9);
  auto f = font(); f.setPixelSize(12); p.setFont(f); p.setPen(ink);
  const bool saved = forecast.contains("_at") &&
      QDateTime::currentSecsSinceEpoch() - forecast.value("_at").toDouble() > 3600;
  if (compact)
    p.drawText(QRectF(0, 0, 44, h), Qt::AlignCenter, forecastView ? "☀" : "⇄");
  else
    p.drawText(QRectF(14, 2, w - 28, 26), Qt::AlignVCenter | Qt::AlignLeft,
               forecastView ? QString("24-hour forecast · %1%2  ⇄  Sun cycle")
                                  .arg(metric ? "°C" : "°F", saved ? " · saved" : "")
                            : "Sun cycle  ⇄  24-hour forecast");
  if (!forecastView) {
    const auto now = QDateTime::currentSecsSinceEpoch();
    const double top = compact ? 0 : 33;
    const double left = compact ? 44 : 16, right = w - 16;
    const double side = compact ? 70 : 105;
    auto endpoint = [&](bool rising) {
      const double x = rising ? left : right - side;
      const int align = rising ? Qt::AlignLeft : Qt::AlignRight;
      f.setPixelSize(compact ? 9 : 10); p.setFont(f); p.setPen(faint);
      p.drawText(QRectF(x, top + (compact ? 2 : 7), side, 16), align, rising ? "SUNRISE" : "SUNSET");
      f.setPixelSize(compact ? 14 : 30); p.setFont(f); p.setPen(ink);
      p.drawText(QRectF(x, top + (compact ? 22 : 27), side, compact ? 22 : 36), align,
                 time(rising ? rise : set));
      if (!compact) {
        const double cx = rising ? x + side + 23 : x - 23;
        const double cy = top + 30 + (motion ? std::sin(t * 1.2) * 1.5 : 0);
        const QColor color = rising ? gold : dusk;
        QRadialGradient glow(QPointF(cx, cy), 27);
        QColor soft = color; soft.setAlpha(qRound(55 + (motion ? 8 * std::sin(t) : 0)));
        glow.setColorAt(0, soft); glow.setColorAt(1, Qt::transparent);
        p.setPen(Qt::NoPen); p.setBrush(glow); p.drawEllipse(QPointF(cx, cy), 27, 27);
        p.save(); p.setClipRect(QRectF(cx - 26, cy - 26, 52, 26));
        p.setBrush(color); p.drawEllipse(QPointF(cx, cy), 11, 11);
        p.setPen(QPen(color, 1.3));
        for (int ray = 0; ray < 8; ++ray)
          p.drawLine(QPointF(cx, cy) + polar(ray * 45, 16),
                     QPointF(cx, cy) + polar(ray * 45, 22));
        p.restore(); p.setPen(QPen(color, 1));
        p.drawLine(QPointF(cx - 22, cy + 1), QPointF(cx + 22, cy + 1));
        p.drawLine(QPointF(cx - 15, cy + 6), QPointF(cx + 15, cy + 6));
      }
    };
    endpoint(true); endpoint(false);
    const auto date = QDateTime::fromSecsSinceEpoch(now).toOffsetFromUtc(offset);
    const qint64 midnight = date.toSecsSinceEpoch() - date.time().msecsSinceStartOfDay() / 1000;
    const double currentHour = (now - midnight) / 3600.0;
    const double trackLeft = compact ? left + side + 3 : left;
    const double trackRight = compact ? right - side - 3 : right;
    const double gap = compact ? 1.5 : 3, span = (trackRight - trackLeft) / 24;
    const double y = compact ? 23 : top + 83;
    for (int i = 0; i < 24; ++i) {
      const qint64 center = midnight + i * 3600 + 1800;
      const bool daylight = hasTimes() && center >= rise && center < set;
      const bool current = hasTimes() && int(currentHour) == i;
      QColor color = daylight ? gold : blue;
      color.setAlpha(hasTimes() ? current ? 255 : daylight
          ? qRound(90 + 165 * std::sin((i + .5) / 24 * 3.141592653589793)) : 80 : 30);
      const double barHeight = current ? (compact ? 23 : 27) + (motion ? std::sin(t) : 0) : (compact ? 9 : 12);
      p.setPen(Qt::NoPen); p.setBrush(color);
      p.drawRoundedRect(QRectF(trackLeft + span * i, y - barHeight / 2,
                               std::max(.5, span - gap), barHeight), 1.5, 1.5);
    }
    if (!compact) {
      QString caption = "Sun times unavailable";
      if (hasTimes()) {
        const auto nextAt = now < rise ? rise : now < set ? set : nextRise;
        const auto remaining = std::max(qint64(0), (nextAt - now + 59) / 60);
        const auto minutes = (set - rise + 30) / 60;
        caption = nextAt > now
            ? QString("%1 in %2h %3m · %4h %5m daylight")
                  .arg(now < rise || now > set ? "Sunrise" : "Sunset")
                  .arg(remaining / 60).arg(remaining % 60).arg(minutes / 60).arg(minutes % 60)
            : QString("After sunset · %1h %2m daylight").arg(minutes / 60).arg(minutes % 60);
      }
      f.setPixelSize(11); p.setFont(f); p.setPen(faint);
      p.drawText(QRectF(left, h - 24, right - left, 19), Qt::AlignCenter, caption);
    }
  }
  if (hasFocus()) {
    p.setPen(QPen(ink, 1, Qt::DotLine)); p.setBrush(Qt::NoBrush);
    p.drawRoundedRect(QRectF(3, 3, w - 6, h - 6), 7, 7);
  }
}
} // namespace storm
