#include "radar.h"
#include <QCheckBox>
#include <QDateTime>
#include <QGridLayout>
#include <QJsonDocument>
#include <QMouseEvent>
#include <QNetworkDiskCache>
#include <QNetworkReply>
#include <QPainter>
#include <QPointer>
#include <QPushButton>
#include <QStandardPaths>
#include <QVBoxLayout>
#include <QWheelEvent>
#include <algorithm>
#include <cmath>

namespace storm {
static constexpr double pi = 3.14159265358979323846;
QPointF mercator(double lat, double lon, int zoom) {
  lat = std::clamp(lat, -85.05112878, 85.05112878);
  double size = 256.0 * (1 << std::clamp(zoom, 0, 18)),
         s = std::sin(lat * pi / 180);
  return {(lon + 180) / 360 * size,
          (.5 - std::log((1 + s) / (1 - s)) / (4 * pi)) * size};
}
class Radar::Canvas : public QWidget {
public:
  Radar &radar;
  int zoom = 6;
  QPointF center;
  QPoint last;
  QString path;
  bool coverage = false;
  QCache<QString, QImage> images{256};
  QSet<QString> pending;
  QHash<QString, qint64> failed;
  explicit Canvas(Radar &r) : QWidget(&r), radar(r) {
    setMinimumHeight(300);
    setSizePolicy(QSizePolicy::Ignored, QSizePolicy::Expanding);
    setAccessibleName(
        "Native weather radar; drag to pan and use plus or minus to zoom");
  }
  void setZoom(int next) {
    next = std::clamp(next, 2, 7);
    center *= std::pow(2, next - zoom);
    zoom = next;
    update();
  }
  void tile(QPainter &p, const QString &address, const QRectF &rect,
            bool overlay = false) {
    if (auto image = images.object(address)) {
      if (overlay)
        p.setOpacity(.72);
      if (!overlay && palette().color(QPalette::Window).lightness() < 128) {
        const auto key = address + ":dark";
        if (!images.object(key)) {
          auto dark = image->convertToFormat(QImage::Format_Grayscale8);
          dark.invertPixels();
          dark = dark.convertToFormat(QImage::Format_RGB32);
          QPainter shade(&dark);
          shade.fillRect(dark.rect(), QColor(17, 23, 31, 85));
          shade.end();
          images.insert(key, new QImage(dark));
        }
        p.drawImage(rect, *images.object(key));
      } else
        p.drawImage(rect, *image);
      p.setOpacity(1);
      return;
    }
    if (pending.contains(address) || pending.size() >= 12 ||
        failed.value(address) > QDateTime::currentSecsSinceEpoch() - 60)
      return;
    pending.insert(address);
    QNetworkRequest request{QUrl(address)};
    request.setTransferTimeout(15000);
    request.setRawHeader("User-Agent",
                         "StormDesk/" STORMDESK_VERSION " (native radar)");
    auto reply = radar.tiles.get(request);
    connect(reply, &QNetworkReply::readyRead, reply, [reply] {
      if (reply->bytesAvailable() > 2 * 1024 * 1024)
        reply->abort();
    });
    QPointer<Canvas> guard(this);
    connect(reply, &QNetworkReply::finished, reply, [guard, reply, address] {
      if (guard) {
        guard->pending.remove(address);
        auto bytes = reply->readAll();
        QImage image;
        if (reply->error() == QNetworkReply::NoError &&
            image.loadFromData(bytes) && image.width() <= 1024 &&
            image.height() <= 1024)
          guard->images.insert(address, new QImage(image));
        else
          guard->failed[address] = QDateTime::currentSecsSinceEpoch();
        guard->update();
      }
      reply->deleteLater();
    });
  }
  void paintEvent(QPaintEvent *) override {
    QPainter p(this);
    p.fillRect(rect(), QColor("#172131"));
    const auto place = radar.services.config.location();
    if (!place.value("lat").isDouble() || !place.value("lon").isDouble() ||
        std::abs(place.value("lat").toDouble()) > 90 ||
        std::abs(place.value("lon").toDouble()) > 180) {
      p.setPen(palette().text().color());
      p.drawText(rect(), Qt::AlignCenter, "Choose a location in Settings");
      return;
    }
    int tiles = 1 << zoom;
    auto corner = center - QPointF(width() / 2.0, height() / 2.0);
    int left = int(std::floor(corner.x() / 256)),
        top = int(std::floor(corner.y() / 256));
    for (int y = top; y <= top + height() / 256 + 1; ++y)
      for (int x = left; x <= left + width() / 256 + 1; ++x) {
        if (y < 0 || y >= tiles)
          continue;
        int wrapped = (x % tiles + tiles) % tiles;
        QRectF target(x * 256 - corner.x(), y * 256 - corner.y(), 256, 256);
        auto xyz = QString("/%1/%2/%3").arg(zoom).arg(wrapped).arg(y);
        tile(p, "https://tile.openstreetmap.org" + xyz + ".png", target);
        if (!path.isEmpty())
          tile(p, radar.host + path + "/256" + xyz + "/2/1_1.png", target,
               true);
        if (coverage)
          tile(p, radar.host + "/v2/coverage/0/256" + xyz + "/0/0_0.png",
               target, true);
      }
    auto point =
        mercator(radar.services.config.location().value("lat").toDouble(),
                 radar.services.config.location().value("lon").toDouble(),
                 zoom) -
        corner;
    p.setBrush(Qt::cyan);
    p.setPen(QPen(Qt::black, 2));
    p.drawEllipse(point, 5, 5);
    p.fillRect(QRect(0, height() - 28, width(), 28), QColor(0, 0, 0, 185));
    p.setPen(Qt::white);
    p.drawText(QRect(5, height() - 28, width() - 10, 28), Qt::AlignVCenter,
               p.fontMetrics().elidedText(
                   "© OpenStreetMap contributors · Radar © RainViewer",
                   Qt::ElideRight, width() - 10));
  }
  void mousePressEvent(QMouseEvent *e) override {
    last = e->position().toPoint();
    setCursor(Qt::ClosedHandCursor);
  }
  void mouseMoveEvent(QMouseEvent *e) override {
    if (e->buttons() & Qt::LeftButton) {
      center -= QPointF(e->position().toPoint() - last);
      last = e->position().toPoint();
      center.setY(std::clamp(center.y(), 0.0, double(256 * (1 << zoom))));
      center.setX(std::fmod(center.x() + 256 * (1 << zoom), 256 * (1 << zoom)));
      update();
    }
  }
  void mouseReleaseEvent(QMouseEvent *) override { unsetCursor(); }
  void wheelEvent(QWheelEvent *e) override {
    setZoom(zoom + (e->angleDelta().y() > 0 ? 1 : -1));
    e->accept();
  }
};
Radar::Radar(Services &s, QWidget *parent, bool compactMode)
    : QWidget(parent), services(s), compact(compactMode) {
  auto cache = new QNetworkDiskCache(&tiles);
  cache->setCacheDirectory(
      QStandardPaths::writableLocation(QStandardPaths::CacheLocation) +
      "/map-tiles");
  cache->setMaximumCacheSize(64 * 1024 * 1024);
  tiles.setCache(cache);
  auto layout = new QVBoxLayout(this);
  warnings = new QLabel;
  warnings->setTextFormat(Qt::PlainText);
  warnings->setWordWrap(true);
  warnings->setProperty("kind", "notice");
  layout->addWidget(warnings);
  auto details = new QPushButton("Warnings");
  layout->addWidget(details);
  connect(details, &QPushButton::clicked, this, &Radar::warningsRequested);
  auto updateWarnings = [this, details] {
    const auto alerts = services.warnings;
    warnings->setVisible(!compact && !alerts.isEmpty());
    details->setVisible(!compact && !alerts.isEmpty());
    if (!alerts.isEmpty()) {
      const auto first = alerts[0].toObject().value("properties").toObject();
      warnings->setText(QString::number(alerts.size()) +
                        " active US weather warning(s)\n" +
                        first.value("event").toString());
    }
  };
  connect(&services, &Services::changed, this, updateWarnings);
  updateWarnings();
  status = new QLabel("Radar · choose a location in Settings");
  status->setTextFormat(Qt::PlainText);
  status->setWordWrap(true);
  layout->addWidget(status);
  canvas = new Canvas(*this);
  layout->addWidget(canvas, 1);
  controls = new QGridLayout;
  int cell = 0;
  for (const auto &name :
       {QString("−"), QString("+"), QString("Center"), QString("Update")}) {
    auto button = new QPushButton(name);
    buttons << button;
    controls->addWidget(button, cell / 2, cell % 2);
    ++cell;
    connect(button, &QPushButton::clicked, this, [this, name] {
      if (name == "−")
        canvas->setZoom(canvas->zoom - 1);
      else if (name == "+")
        canvas->setZoom(canvas->zoom + 1);
      else if (name == "Center") {
        canvas->center = mercator(
            services.config.location().value("lat").toDouble(),
            services.config.location().value("lon").toDouble(), canvas->zoom);
        canvas->update();
      } else {
        fetched = 0;
        refresh();
      }
    });
  }
  layout->addLayout(controls);
  frames = new QSlider(Qt::Horizontal);
  frames->setAccessibleName("Radar frame");
  layout->addWidget(frames);
  auto play = new QPushButton("Play / pause");
  layout->addWidget(play);
  connect(play, &QPushButton::clicked, this, [this] {
    animation.isActive() ? animation.stop() : animation.start(700);
  });
  animation.setInterval(700);
  connect(&animation, &QTimer::timeout, this, [this] {
    if (isVisible() && frames->maximum() > 0)
      frames->setValue((frames->value() + 1) % (frames->maximum() + 1));
  });
  auto coverage = new QCheckBox("Coverage");
  coverage->setToolTip("Show areas without radar coverage");
  layout->addWidget(coverage);
  if (compact) {
    layout->setContentsMargins(0, 0, 0, 0);
    canvas->setMinimumHeight(240);
    for (auto button : buttons)
      button->hide();
    frames->hide();
    coverage->hide();
  }
  connect(coverage, &QCheckBox::toggled, this, [this](bool enabled) {
    canvas->coverage = enabled;
    canvas->update();
  });
  connect(frames, &QSlider::valueChanged, this, [this](int i) {
    if (i >= past.size())
      return;
    auto frame = past[i].toObject();
    canvas->path = frame.value("path").toString();
    status->setText(
        "Radar frame generated " +
        QDateTime::fromSecsSinceEpoch(qint64(frame.value("time").toDouble()))
            .toString("ddd HH:mm") +
        " · Reflectivity / snow · zoom " + QString::number(canvas->zoom) +
        " · Internet required");
    canvas->update();
  });
  cadence.start(600000);
  connect(&cadence, &QTimer::timeout, this, [this] {
    if (isVisible())
      refresh();
  });
}
void Radar::showEvent(QShowEvent *event) {
  QWidget::showEvent(event);
  refresh();
}
void Radar::resizeEvent(QResizeEvent *event) {
  QWidget::resizeEvent(event);
  const int columns = width() < 500 ? 1 : 2;
  for (auto button : buttons)
    controls->removeWidget(button);
  for (int i = 0; i < buttons.size(); ++i)
    controls->addWidget(buttons[i], i / columns, i % columns);
}
void Radar::refresh() {
  if (!services.config.location().contains("lat"))
    return;
  const auto here =
      QString::number(services.config.location().value("lat").toDouble(), 'g',
                      12) +
      "," +
      QString::number(services.config.location().value("lon").toDouble(), 'g',
                      12);
  if (here != location) {
    location = here;
    canvas->center = mercator(
        services.config.location().value("lat").toDouble(),
        services.config.location().value("lon").toDouble(), canvas->zoom);
    canvas->update();
  }
  if (busy || QDateTime::currentSecsSinceEpoch() - fetched < 600)
    return;
  busy = true;
  QPointer<Radar> guard(this);
  services.request(
      QUrl("https://api.rainviewer.com/public/weather-maps.json"),
      [guard](QJsonDocument doc, QString error) {
        if (!guard)
          return;
        auto &r = *guard;
        r.busy = false;
        if (!error.isEmpty()) {
          r.status->setText("Radar unavailable: " + error);
          return;
        }
        auto host = QUrl(doc.object().value("host").toString());
        if (host.scheme() != "https" ||
            host.host() != "tilecache.rainviewer.com") {
          r.status->setText("Unexpected radar tile host");
          return;
        }
        r.host = host.toString(QUrl::RemovePath | QUrl::RemoveQuery |
                               QUrl::RemoveFragment);
        r.past = {};
        for (const auto &v :
             doc.object().value("radar").toObject().value("past").toArray()) {
          auto frame = v.toObject();
          if (frame.value("path").toString().startsWith("/v2/radar/") &&
              frame.value("time").isDouble())
            r.past.append(frame);
        }
        r.fetched = QDateTime::currentSecsSinceEpoch();
        r.frames->setMaximum(std::max(0, int(r.past.size()) - 1));
        r.frames->setValue(r.frames->maximum());
        emit r.frames->valueChanged(r.frames->value());
        if (r.past.isEmpty())
          r.status->setText("No radar frames available");
      });
}
} // namespace storm
