#include "tools.h"
#include <QApplication>
#include <QCheckBox>
#include <QDateTime>
#include <QDesktopServices>
#include <QDoubleSpinBox>
#include <QFormLayout>
#include <QGraphicsPixmapItem>
#include <QGraphicsView>
#include <QHeaderView>
#include <QJsonDocument>
#include <QLineEdit>
#include <QListWidget>
#include <QNetworkReply>
#include <QPainter>
#include <QPainterPath>
#include <QPointer>
#include <QPushButton>
#include <QRegularExpression>
#include <QScrollArea>
#include <QScroller>
#include <QSignalBlocker>
#include <QSqlQuery>
#include <QTableWidget>
#include <QUrlQuery>
#include <QWheelEvent>
#include <algorithm>
#include <cmath>

namespace storm {
static QLabel *text(const QString &s) {
  auto l = new QLabel(s);
  l->setTextFormat(Qt::PlainText);
  l->setWordWrap(true);
  l->setTextInteractionFlags(Qt::TextSelectableByMouse);
  return l;
}
static QString n(QJsonValue v, int digits = 1, double factor = 1,
                 double shift = 0) {
  return v.isDouble()
             ? QString::number(v.toDouble() * factor + shift, 'f', digits)
             : QString("—");
}
static QJsonValue vAt(const QJsonObject &o, const QString &k, int i) {
  return o.value(k).toArray().at(i);
}
static QString stamp(qint64 at, int offset) {
  return QDateTime::fromSecsSinceEpoch(at + offset, Qt::UTC)
      .toString("ddd d MMM HH:mm");
}
static QTableWidget *table(QVBoxLayout *body, const QStringList &headers,
                           const QList<QStringList> &rows) {
  auto t = new QTableWidget(rows.size(), headers.size());
  t->setHorizontalHeaderLabels(headers);
  t->setEditTriggers(QAbstractItemView::NoEditTriggers);
  QScroller::grabGesture(t->viewport(), QScroller::TouchGesture);
  t->setWordWrap(true);
  t->verticalHeader()->hide();
  t->horizontalHeader()->setSectionResizeMode(QHeaderView::Interactive);
  t->horizontalHeader()->setStretchLastSection(true);
  for (int i = 0; i < rows.size(); ++i)
    for (int j = 0; j < rows[i].size(); ++j)
      t->setItem(i, j, new QTableWidgetItem(rows[i][j]));
  t->resizeColumnsToContents();
  for (int j = 0; j < headers.size(); ++j)
    t->setColumnWidth(j, std::clamp(t->columnWidth(j), 110, 480));
  t->resizeRowsToContents();
  t->setMinimumHeight(260);
  t->setSizePolicy(QSizePolicy::Ignored, QSizePolicy::Preferred);
  body->addWidget(t);
  return t;
}
struct Line {
  QString name;
  QVector<QPointF> points;
  QColor color;
};
class Chart : public QWidget {
public:
  QList<Line> lines;
  QString unit;
  int offset = 0;
  bool rose = false;
  void fit() {
    setMinimumHeight(
        std::max(320, fontMetrics().height() * (int(lines.size()) + 10)));
  }
  void changeEvent(QEvent *event) override {
    QWidget::changeEvent(event);
    if (event->type() == QEvent::FontChange)
      fit();
  }
  explicit Chart(QWidget *p = nullptr) : QWidget(p) {
    setMinimumHeight(320);
    setSizePolicy(QSizePolicy::Ignored, QSizePolicy::Preferred);
    setAccessibleName("Native weather chart");
  }
  void paintEvent(QPaintEvent *) override {
    QPainter p(this);
    p.setRenderHint(QPainter::Antialiasing);
    p.setPen(palette().text().color());
    if (lines.isEmpty()) {
      p.drawText(rect(), Qt::AlignCenter, "No data available for this chart");
      return;
    }
    const int fh = p.fontMetrics().height();
    if (rose) {
      auto center = QPointF(width() / 2.0, height() / 2.0);
      double radius =
          std::max(10.0, std::min(width(), height()) / 2.0 - fh * 2);
      double max = 1;
      for (auto point : lines[0].points)
        max = std::max(max, point.y());
      p.setPen(QColor(127, 137, 156, 90));
      for (int i = 1; i <= 4; ++i)
        p.drawEllipse(center, radius * i / 4, radius * i / 4);
      p.setBrush(QColor("#7bb9e8"));
      for (auto point : lines[0].points) {
        QPainterPath path;
        path.moveTo(center);
        double r = radius * point.y() / max, angle = point.x() - 90;
        QRectF box(center.x() - r, center.y() - r, 2 * r, 2 * r);
        path.arcTo(box, -angle + 9, -18);
        path.closeSubpath();
        p.drawPath(path);
      }
      p.setPen(palette().text().color());
      p.drawText(QRectF(0, 0, width(), fh * 2), Qt::AlignCenter,
                 "N · Wind frequency by direction");
      return;
    }
    double xmin = 1e30, xmax = -1e30, ymin = 1e30, ymax = -1e30;
    int count = 0;
    for (const auto &line : lines)
      for (auto point : line.points) {
        xmin = std::min(xmin, point.x());
        xmax = std::max(xmax, point.x());
        ymin = std::min(ymin, point.y());
        ymax = std::max(ymax, point.y());
        ++count;
      }
    if (!count) {
      p.drawText(rect(), Qt::AlignCenter, "No data available for this chart");
      return;
    }
    if (ymin == ymax) {
      ymin -= 1;
      ymax += 1;
    }
    double pad = (ymax - ymin) * .08;
    ymin -= pad;
    ymax += pad;
    int legendRows = std::max(1, int(lines.size()));
    QRectF a(p.fontMetrics().horizontalAdvance("-9999.9") + 12,
             fh * (legendRows + 1),
             width() - p.fontMetrics().horizontalAdvance("-9999.9") - 30,
             height() - fh * (legendRows + 4));
    if (a.width() < 20 || a.height() < 20)
      return;
    for (int i = 0; i <= 4; ++i) {
      double y = a.bottom() - a.height() * i / 4;
      p.setPen(QColor(127, 137, 156, 65));
      p.drawLine(QPointF(a.left(), y), QPointF(a.right(), y));
      p.setPen(palette().text().color());
      p.drawText(QRectF(0, y - fh / 2, a.left() - 8, fh), Qt::AlignRight,
                 QString::number(ymin + (ymax - ymin) * i / 4, 'f', 1));
    }
    int row = 0;
    for (const auto &line : lines) {
      p.setPen(line.color);
      p.drawText(QRectF(a.left(), row++ * fh, a.width(), fh), Qt::AlignLeft,
                 p.fontMetrics().elidedText(line.name + " · " + unit,
                                            Qt::ElideRight, int(a.width())));
      QPainterPath path;
      bool first = true;
      double previous = 0;
      for (auto point : line.points) {
        QPointF q(a.left() + (point.x() - xmin) / std::max(1.0, xmax - xmin) *
                                 a.width(),
                  a.bottom() - (point.y() - ymin) / (ymax - ymin) * a.height());
        if (first || point.x() - previous > 7200)
          path.moveTo(q);
        else
          path.lineTo(q);
        first = false;
        previous = point.x();
      }
      p.setPen(QPen(line.color, 2));
      p.drawPath(path);
    }
    p.setPen(palette().text().color());
    const auto fmt = width() < 650 ? "MM-dd\nHH:mm" : "ddd d MMM HH:mm";
    p.drawText(QRectF(a.left(), a.bottom() + 8, a.width(), fh * 2 + 4),
               Qt::AlignLeft,
               QDateTime::fromSecsSinceEpoch(qint64(xmin) + offset, Qt::UTC)
                   .toString(fmt));
    p.drawText(QRectF(a.left(), a.bottom() + 8, a.width(), fh * 2 + 4),
               Qt::AlignRight,
               QDateTime::fromSecsSinceEpoch(qint64(xmax) + offset, Qt::UTC)
                   .toString(fmt));
  }
};
class MapView : public QGraphicsView {
public:
  explicit MapView(QWidget *p = nullptr) : QGraphicsView(p) {
    setScene(new QGraphicsScene(this));
    setMinimumHeight(340);
    setSizePolicy(QSizePolicy::Ignored, QSizePolicy::Preferred);
    setDragMode(ScrollHandDrag);
    setTransformationAnchor(AnchorUnderMouse);
    setAccessibleName("Weather map; drag to pan, scroll to zoom");
  }
  void wheelEvent(QWheelEvent *e) override {
    double f = e->angleDelta().y() > 0 ? 1.2 : 1 / 1.2;
    if ((transform().m11() < 100 || f < 1) &&
        (transform().m11() > .001 || f > 1))
      scale(f, f);
    e->accept();
  }
  void resizeEvent(QResizeEvent *e) override {
    QGraphicsView::resizeEvent(e);
    if (!scene()->items().isEmpty())
      fitInView(scene()->itemsBoundingRect(), Qt::KeepAspectRatio);
  }
  void geo(const QJsonObject &geo, double lat, double lon) {
    const QHash<QString, QColor> colors{
        {"TSTM", QColor("#c1e9c1")}, {"MRGL", QColor("#66a366")},
        {"SLGT", QColor("#ffe066")}, {"ENH", QColor("#ff9d5c")},
        {"MDT", QColor("#ff5c5c")},  {"HIGH", QColor("#ff5cf0")}};
    for (const auto &f : geo.value("features").toArray()) {
      auto feature = f.toObject(), g = feature.value("geometry").toObject(),
           props = feature.value("properties").toObject();
      auto polys = g.value("coordinates").toArray();
      if (g.value("type") == "Polygon")
        polys = QJsonArray{QJsonValue(polys)};
      else if (g.value("type") == "Point" && polys.size() >= 2) {
        auto item = scene()->addEllipse(
            polys[0].toDouble() - .12, -polys[1].toDouble() - .12, .24, .24,
            QPen(Qt::NoPen), QBrush(QColor("#ff9d5c")));
        item->setToolTip(props.value("typetext").toString() + " " +
                         props.value("remark").toString());
        continue;
      } else if (g.value("type") != "MultiPolygon")
        continue;
      QPainterPath path;
      path.setFillRule(Qt::OddEvenFill);
      for (const auto &poly : polys)
        for (const auto &ring : poly.toArray()) {
          bool first = true;
          for (const auto &v : ring.toArray()) {
            auto a = v.toArray();
            if (a.size() < 2)
              continue;
            QPointF pt(a[0].toDouble(), -a[1].toDouble());
            if (first)
              path.moveTo(pt);
            else
              path.lineTo(pt);
            first = false;
          }
          path.closeSubpath();
        }
      auto item =
          scene()->addPath(path, QPen(QColor("#65748b"), 0),
                           QBrush(colors.value(props.value("LABEL").toString(),
                                               QColor("#c0a96c"))));
      item->setToolTip(
          props.value("LABEL2").toString(props.value("LABEL").toString()));
    }
    scene()->addEllipse(lon - .15, -lat - .15, .3, .3, QPen(Qt::black, 0),
                        QBrush(Qt::cyan));
    fitInView(scene()->itemsBoundingRect(), Qt::KeepAspectRatio);
  }
};
Tools::Tools(Services &s, QWidget *parent)
    : QWidget(parent), advanced(s, false) {
  auto layout = new QVBoxLayout(this);
  layout->setSizeConstraint(QLayout::SetMinimumSize);
  topic = new QComboBox;
  topic->setObjectName("nativeTool");
  topic->setAccessibleName("Weather tool");
  topic->setSizeAdjustPolicy(QComboBox::AdjustToMinimumContentsLengthWithIcon);
  topic->setMinimumContentsLength(7);
  topic->addItems(
      {"Weather timeline", "Hourly & precipitation", "Models & ensemble",
       "Forecast changes & accuracy", "Sun, moon & solar", "Air, fire & garden",
       "Severe, winter & tropics", "Drought map", "Local signals & sensors",
       "Almanac & archive explorer", "Home Assistant",
       "Station health & diagnostics", "Customize dashboard", "Saved places"});
  layout->addWidget(topic);
  metric = new QComboBox;
  metric->setAccessibleName("Tool measurement");
  metric->addItems({"Temperature", "Precipitation", "Wind", "Pressure",
                    "Humidity", "UV index"});
  metric->setSizeAdjustPolicy(QComboBox::AdjustToMinimumContentsLengthWithIcon);
  metric->setMinimumContentsLength(5);
  layout->addWidget(metric);
  filter = new QComboBox;
  filter->setAccessibleName("Timeline category");
  filter->addItem("All events", "");
  for (auto k : {"precip", "storm", "winter", "freeze", "heat", "wind", "aqi",
                 "change", "sun", "alert"})
    filter->addItem(k, k);
  layout->addWidget(filter);
  from = new QDateEdit(QDate::currentDate().addMonths(-1));
  from->setCalendarPopup(true);
  from->setAccessibleName("Archive start date");
  to = new QDateEdit(QDate::currentDate());
  to->setCalendarPopup(true);
  to->setAccessibleName("Archive end date");
  layout->addWidget(from);
  layout->addWidget(to);
  auto update = new QPushButton("Update tool");
  connect(update, &QPushButton::clicked, this, [this] { refresh(true); });
  layout->addWidget(update);
  note = text({});
  layout->addWidget(note);
  content = new QWidget;
  content->setObjectName("toolBody");
  body = new QVBoxLayout(content);
  body->setSizeConstraint(QLayout::SetMinimumSize);
  body->setContentsMargins(0, 0, 0, 0);
  layout->addWidget(content, 1);
  debounce.setSingleShot(true);
  debounce.setInterval(150);
  // A background reading must not replace controls while someone is editing
  // them.
  connect(&debounce, &QTimer::timeout, this, [this] {
    if (!content->isAncestorOf(QApplication::focusWidget()))
      render();
  });
  connect(&advanced, &Advanced::changed, this, [this] {
    if (isVisible() && topic->currentIndex() < 12)
      debounce.start();
  });
  connect(&s, &Services::changed, this, [this] {
    if (isVisible() && topic->currentIndex() < 12)
      debounce.start();
  });
  connect(topic, &QComboBox::currentIndexChanged, this, [this] { refresh(); });
  connect(metric, &QComboBox::currentIndexChanged, this, [this] { render(); });
  connect(filter, &QComboBox::currentIndexChanged, this, [this] { render(); });
  connect(from, &QDateEdit::dateChanged, this, [this] { render(); });
  connect(to, &QDateEdit::dateChanged, this, [this] { render(); });
  cadence.setInterval(900000);
  connect(&cadence, &QTimer::timeout, this, [this] {
    if (isVisible())
      refresh();
  });
  cadence.start();
}
void Tools::showEvent(QShowEvent *event) {
  QWidget::showEvent(event);
  refresh();
}
void Tools::refresh(bool force) {
  const int group = topic->currentIndex() == 2   ? 2
                    : topic->currentIndex() == 9 ? 9
                                                 : 1;
  if (metric->property("group").toInt() != group) {
    QSignalBlocker blocker(metric);
    metric->clear();
    if (group == 2)
      metric->addItems({"Temperature", "Precipitation", "Wind"});
    else if (group == 9)
      metric->addItems({"High temperature", "Rain", "Wind gust", "Pressure",
                        "Humidity", "UV index", "Low temperature",
                        "Lightning strikes"});
    else
      metric->addItems({"Temperature", "Precipitation", "Wind", "Pressure",
                        "Humidity", "UV index", "Solar radiation", "Dew point",
                        "Wet bulb"});
    metric->setProperty("group", group);
  }
  QStringList providers;
  switch (topic->currentIndex()) {
  case 0:
    providers = {"air", "nowcast", "models"};
    break;
  case 1:
    providers = {"nowcast"};
    break;
  case 2:
    providers = {"models", "ensemble"};
    break;
  case 4:
    providers = {"moon"};
    break;
  case 5:
    providers = {"air", "garden", "drought"};
    break;
  case 6:
    providers = {"spc1", "spc2", "spc3", "severe", "tropical", "reports"};
    break;
  case 7:
    providers = {"drought"};
    break;
  case 8:
    providers = {"official", "airports"};
    break;
  case 9:
    providers = {"normals"};
    break;
  case 10:
    if (!advanced.services.config.text("haUrl").isEmpty())
      providers = {"ha"};
    break;
  }
  if (topic->currentIndex() == 9 || topic->currentIndex() == 8) {
    advanced.load("official", force);
    advanced.load("nwsForecast", force);
  }
  for (const auto &kind : providers)
    advanced.load(kind, force);
  currentProviders = providers;
  render();
}
void Tools::render() {
  while (auto item = body->takeAt(0)) {
    if (item->widget()) {
      item->widget()->hide();
      item->widget()->deleteLater();
    }
    delete item;
  }
  const int index = topic->currentIndex();
  metric->setVisible(index == 1 || index == 2 || index == 9);
  filter->setVisible(index == 0);
  from->setVisible(index == 9);
  to->setVisible(index == 9);
  auto &s = advanced.services;
  const bool metricUnits = s.config.text("units", "imperial") == "metric";
  const double tf = metricUnits ? 1 : 1.8, ts = metricUnits ? 0 : 32,
               rf = metricUnits ? 1 : 1 / 25.4, wf = s.config.windFactor();
  const QString tu = metricUnits ? "°C" : "°F", ru = metricUnits ? "mm" : "in",
                wu = s.config.windUnit();
  auto fc = s.forecast, h = fc.value("hourly").toObject(),
       d = fc.value("daily").toObject();
  auto times = h.value("time").toArray();
  const auto at = QDateTime::currentSecsSinceEpoch();
  const int offset = fc.value("utc_offset_seconds").toInt();
  QStringList notices;
  for (const auto &kind : currentProviders) {
    if (advanced.errors.contains(kind))
      notices << kind + ": " + advanced.errors.value(kind);
    if (advanced.fetched.contains(kind))
      notices << kind + " updated " +
                     stamp(advanced.fetched.value(kind), offset);
  }
  if (fc.contains("_at") && at - fc.value("_at").toDouble() > 3600)
    notices << "Forecast is older than one hour; refresh needed.";
  note->setText(
      notices.isEmpty()
          ? "Weather guidance · Open-Meteo / NOAA / US Drought Monitor. "
            "Forecasts are estimates; provider coverage varies."
          : notices.join("\n"));
  auto heading = [this](const QString &title) {
    auto l = text(title);
    auto f = l->font();
    f.setBold(true);
    l->setFont(f);
    body->addWidget(l);
  };
  auto chart = [this, offset](const QJsonObject &o, const QStringList &keys,
                              const QStringList &names, double factor,
                              double shift, const QString &unit,
                              qint64 begin = 0) {
    auto c = new Chart;
    c->offset = offset;
    c->unit = unit;
    auto t = o.value("time").toArray();
    const QStringList colors{"#a0c6f4", "#f3b478", "#94d5a5", "#d9a4f1",
                             "#ebdd8b"};
    for (int k = 0; k < keys.size(); ++k) {
      Line line{names.value(k, keys[k]), {}, QColor(colors[k % colors.size()])};
      auto values = o.value(keys[k]).toArray();
      for (int i = 0; i < std::min(t.size(), values.size()); ++i)
        if (values[i].isDouble() && t[i].isDouble() && t[i].toDouble() >= begin)
          line.points << QPointF(t[i].toDouble(),
                                 values[i].toDouble() * factor + shift);
      if (!line.points.isEmpty())
        c->lines << line;
    }
    c->fit();
    body->addWidget(c);
    return c;
  };
  if (index == 0) {
    auto events =
        weatherTimeline(fc, s.archive.tuples(at - 86400, at), s.warnings,
                        advanced.data.value("air").object(),
                        advanced.data.value("nowcast").object(),
                        s.config.settings().value("timeline").toObject(), at);
    QList<QStringList> rows;
    for (const auto &v : events) {
      auto e = v.toObject();
      auto confidence =
          modelConfidence(advanced.data.value("models").object(), e,
                          advanced.fetched.value("models"), at);
      if (!filter->currentData().toString().isEmpty() &&
          e.value("kind") != filter->currentData().toString())
        continue;
      rows << QStringList{stamp(qint64(e.value("start").toDouble()), offset),
                          stamp(qint64(e.value("end").toDouble()), offset),
                          e.value("title").toString(),
                          e.value("detail").toString(),
                          e.value("source").toString(),
                          confidence.value("level").toString() + " · " +
                              confidence.value("reason").toString()};
    }
    heading("Your weather timeline · past 24 hours / next 48 hours");
    table(body,
          {"Starts", "Ends", "Event", "Details (SI)", "Source", "Confidence"},
          rows);
    if (rows.isEmpty())
      body->addWidget(text(fc.isEmpty()
                               ? "Choose a location to load the timeline."
                               : "No events cross your selected thresholds."));
    auto prefs = s.config.settings().value("timeline").toObject();
    auto form = new QFormLayout;
    auto values = new QWidget;
    values->setLayout(form);
    body->addWidget(values);
    QMap<QString, QDoubleSpinBox *> spins;
    for (const auto &spec : QList<QPair<QString, double>>{{"precip", 30},
                                                          {"freezeC", 0},
                                                          {"heatC", 35},
                                                          {"gustMs", 13.4112},
                                                          {"aqi", 101}}) {
      auto spin = new QDoubleSpinBox;
      spin->setRange(-100, 500);
      spin->setDecimals(2);
      spin->setValue(prefs.value(spec.first).toDouble(spec.second));
      spins[spec.first] = spin;
      form->addRow(QMap<QString, QString>{{"precip", "Rain chance (%)"},
                                          {"freezeC", "Freeze (°C)"},
                                          {"heatC", "Heat index (°C)"},
                                          {"gustMs", "Wind gust (m/s)"},
                                          {"aqi", "US AQI"}}
                       .value(spec.first),
                   spin);
    }
    auto categories = new QListWidget;
    categories->setAccessibleName("Timeline categories");
    categories->setMinimumHeight(180);
    form->addRow("Event categories", categories);
    auto selected = prefs.value("categories").isArray()
                        ? prefs.value("categories").toArray()
                        : QJsonArray();
    for (int i = 1; i < filter->count(); ++i) {
      auto item = new QListWidgetItem(filter->itemText(i), categories);
      item->setData(Qt::UserRole, filter->itemData(i));
      item->setFlags(item->flags() | Qt::ItemIsUserCheckable);
      item->setCheckState(
          !prefs.value("categories").isArray() ||
                  selected.contains(filter->itemData(i).toString())
              ? Qt::Checked
              : Qt::Unchecked);
    }
    for (const auto &v : selected)
      if (filter->findData(v.toString()) < 0) {
        auto item = new QListWidgetItem(v.toString(), categories);
        item->setData(Qt::UserRole, v.toString());
        item->setFlags(item->flags() | Qt::ItemIsUserCheckable);
        item->setCheckState(Qt::Checked);
      }
    auto save = new QPushButton("Save thresholds");
    form->addRow(save);
    connect(save, &QPushButton::clicked, this, [this, spins, categories] {
      auto prefs =
          advanced.services.config.settings().value("timeline").toObject();
      for (auto i = spins.begin(); i != spins.end(); ++i)
        prefs[i.key()] = i.value()->value();
      QJsonArray enabled;
      for (int i = 0; i < categories->count(); ++i)
        if (categories->item(i)->checkState() == Qt::Checked)
          enabled.append(categories->item(i)->data(Qt::UserRole).toString());
      prefs["categories"] = enabled;
      QString error;
      advanced.services.config.merge(
          {{"_rev", advanced.services.config.value.value("_rev")},
           {"settings", QJsonObject{{"timeline", prefs}}}},
          &error);
      note->setText(error.isEmpty() ? "Timeline thresholds saved" : error);
    });
  } else if (index == 1) {
    const QStringList keys{"temperature_2m",         "precipitation",
                           "wind_speed_10m",         "pressure_msl",
                           "relative_humidity_2m",   "uv_index",
                           "shortwave_radiation",    "dew_point_2m",
                           "wet_bulb_temperature_2m"};
    int m = metric->currentIndex();
    double factor = m == 0 || m >= 7 ? tf
                    : m == 1         ? rf
                    : m == 2         ? wf
                    : m == 3         ? (metricUnits ? 1 : 1 / 33.8639)
                                     : 1,
           shift = m == 0 || m >= 7 ? ts : 0;
    chart(h, {keys[m]}, {metric->currentText()}, factor, shift,
          QStringList{tu, ru, wu, metricUnits ? "hPa" : "inHg", "%", "UV",
                      "W/m²", tu, tu}[m],
          at);
    QList<QStringList> rows;
    for (int i = 0; i < times.size(); ++i)
      if (times[i].toDouble() >= at && times[i].toDouble() <= at + 172800)
        rows << QStringList{stamp(qint64(times[i].toDouble()), offset),
                            n(vAt(h, "temperature_2m", i), 1, tf, ts),
                            n(vAt(h, "precipitation_probability", i), 0),
                            n(vAt(h, "precipitation", i), 2, rf),
                            n(vAt(h, "wind_speed_10m", i), 1, wf),
                            n(vAt(h, "wind_gusts_10m", i), 1, wf),
                            condition(vAt(h, "weather_code", i).toInt(-1))};
    table(body,
          {"Hour", tu, "Rain %", ru, "Wind " + wu, "Gust " + wu, "Conditions"},
          rows);
    heading("Next 12 hours · 15-minute precipitation guidance");
    auto nc =
        advanced.data.value("nowcast").object().value("minutely_15").toObject();
    chart(nc, {"precipitation"}, {"Precipitation / 15 min"}, rf, 0, ru, at);
  } else if (index == 2) {
    heading("Model comparison · 72 hours");
    auto models =
        advanced.data.value("models").object().value("hourly").toObject();
    int m = std::min(metric->currentIndex(), 2);
    QString field =
        QStringList{"temperature_2m", "precipitation", "wind_speed_10m"}[m];
    QStringList keys, names;
    for (auto it = models.begin(); it != models.end(); ++it)
      if (it.key().startsWith(field + "_")) {
        keys << it.key();
        names << it.key().mid(field.size() + 1);
      }
    chart(models, keys, names,
          m == 0   ? tf
          : m == 1 ? rf
                   : wf,
          m == 0 ? ts : 0,
          m == 0   ? tu
          : m == 1 ? ru
                   : wu,
          at);
    QList<QStringList> rows;
    auto mt = models.value("time").toArray();
    for (int i = 0; i < mt.size(); ++i)
      if (mt[i].toDouble() >= at) {
        QList<double> values;
        QStringList r{stamp(qint64(mt[i].toDouble()), offset)};
        for (const auto &k : keys) {
          auto v = vAt(models, k, i);
          r << n(v, 1, m == 0 ? tf : m == 1 ? rf : wf, m == 0 ? ts : 0);
          if (v.isDouble())
            values << v.toDouble();
        }
        if (values.size() > 1) {
          auto mm = std::minmax_element(values.begin(), values.end());
          r << QString::number((*mm.second - *mm.first) * (m == 0   ? tf
                                                           : m == 1 ? rf
                                                                    : wf),
                               'f', 1);
        } else
          r << "—";
        rows << r;
      }
    QStringList headers{"Hour"};
    headers << names << "Spread";
    table(body, headers, rows);
    heading("GFS ensemble · 10th / 50th / 90th percentile temperature");
    auto en =
        advanced.data.value("ensemble").object().value("hourly").toObject();
    auto et = en.value("time").toArray();
    QStringList members;
    for (auto it = en.begin(); it != en.end(); ++it)
      if (it.key().startsWith("temperature_2m_member"))
        members << it.key();
    QJsonArray lo, mid, hi;
    for (int i = 0; i < et.size(); ++i) {
      QList<double> vals;
      for (const auto &k : members)
        if (vAt(en, k, i).isDouble())
          vals << vAt(en, k, i).toDouble();
      std::sort(vals.begin(), vals.end());
      if (vals.isEmpty()) {
        lo.append(QJsonValue());
        mid.append(QJsonValue());
        hi.append(QJsonValue());
      } else {
        lo.append(vals[int(vals.size() * .1)]);
        mid.append(vals[vals.size() / 2]);
        hi.append(vals[std::min(int(vals.size() - 1), int(vals.size() * .9))]);
      }
    }
    chart(QJsonObject{{"time", et}, {"lo", lo}, {"median", mid}, {"hi", hi}},
          {"lo", "median", "hi"}, {"10%", "Median", "90%"}, tf, ts, tu, at);
    body->addWidget(text(
        "Model agreement describes spread, not the probability that a forecast "
        "is correct. Missing regional model values are omitted."));
  } else if (index == 3) {
    heading("Forecast changes · compared with at least 20 hours ago");
    auto snaps = advanced.snapshots();
    QJsonObject old;
    for (const auto &v : snaps)
      if (v.toObject().value("at").toDouble() <= at - 72000)
        old = v.toObject();
    QList<QStringList> changes;
    auto oldD = old.value("daily").toObject();
    auto dt = d.value("time").toArray(), ot = oldD.value("time").toArray();
    for (int i = 0; i < dt.size(); ++i) {
      int j = -1;
      for (int k = 0; k < ot.size(); ++k)
        if (ot[k] == dt[i]) {
          j = k;
          break;
        }
      if (j < 0)
        continue;
      for (const auto &key :
           {QString("temperature_2m_max"), QString("temperature_2m_min"),
            QString("precipitation_probability_max"),
            QString("weather_code")}) {
        auto a = vAt(oldD, key, j), b = vAt(d, key, i);
        if (!a.isDouble() || !b.isDouble())
          continue;
        if ((key.startsWith("temperature") &&
             std::abs(a.toDouble() - b.toDouble()) >= 3 / tf) ||
            (key.startsWith("precipitation") &&
             std::abs(a.toDouble() - b.toDouble()) >= 20) ||
            (key == "weather_code" && a != b))
          changes << QStringList{
              stamp(qint64(dt[i].toDouble()), offset), key,
              key == "weather_code"
                  ? condition(a.toInt())
                  : n(a, 1, key.startsWith("temperature") ? tf : 1,
                      key.startsWith("temperature") ? ts : 0),
              key == "weather_code"
                  ? condition(b.toInt())
                  : n(b, 1, key.startsWith("temperature") ? tf : 1,
                      key.startsWith("temperature") ? ts : 0)};
      }
    }
    table(body, {"Day", "Measurement", "Earlier", "Latest"}, changes);
    if (old.isEmpty())
      body->addWidget(text("Collecting forecast snapshots. The first "
                           "comparison appears after 20 hours."));
    heading("24-hour lead forecast accuracy · scored against this station");
    QList<QStringList> rows;
    double error = 0;
    int count = 0;
    QJsonObject points;
    QJsonArray st, err;
    for (const auto &v : advanced.verification()) {
      auto score = v.toObject();
      if (!score.value("observed").isDouble())
        continue;
      double diff = std::abs(score.value("temperature").toDouble() -
                             score.value("observed").toDouble());
      error += diff;
      ++count;
      st.append(score.value("target"));
      err.append(diff);
      rows << QStringList{
          stamp(qint64(score.value("target").toDouble()), offset),
          n(score.value("temperature"), 1, tf, ts),
          n(score.value("observed"), 1, tf, ts),
          QString::number(diff * tf, 'f', 1)};
    }
    body->addWidget(text(
        count ? QString("Mean absolute error: %1 %2 · %3 scored hours")
                    .arg(error / count * tf, 0, 'f', 1)
                    .arg(tu)
                    .arg(count)
              : "Collecting 24-hour predictions. A fresh station reading "
                "within 30 minutes of the target hour is needed for a score."));
    chart({{"time", st}, {"error", err}}, {"error"},
          {"Absolute temperature error"}, tf, 0, tu);
    table(body,
          {"Target hour", "Forecast " + tu, "Station " + tu, "Error " + tu},
          rows);
  } else if (index == 4) {
    heading("Sun & moon · selected location");
    auto phase = moonPhase(at);
    QList<QStringList> rows{
        {"Moon phase", phase.value("phase").toString() + " · " +
                           n(phase.value("illumination"), 0) +
                           "% illuminated (approximate)"},
        {phase.value("next").toString(),
         stamp(qint64(phase.value("nextAt").toDouble()), offset)},
        {"Sun altitude",
         !s.config.location().value("lat").isDouble()
             ? QString("Choose a location")
             : QString::number(
                   solarAltitude(at,
                                 s.config.location().value("lat").toDouble(),
                                 s.config.location().value("lon").toDouble()),
                   'f', 1) +
                   "°"}};
    int today = 0;
    auto dates = d.value("time").toArray();
    const auto date =
        QDateTime::fromSecsSinceEpoch(at + offset, Qt::UTC).date();
    for (int i = 0; i < dates.size(); ++i)
      if (QDateTime::fromSecsSinceEpoch(qint64(dates[i].toDouble()) + offset,
                                        Qt::UTC)
              .date() == date)
        today = i;
    qint64 rise = qint64(vAt(d, "sunrise", today).toDouble()),
           set = qint64(vAt(d, "sunset", today).toDouble());
    auto time = [offset](qint64 t) {
      return t ? stamp(t, offset) : QString("Does not occur / unavailable");
    };
    rows << QStringList{"Sunrise", time(rise)}
         << QStringList{"Sunset", time(set)};
    if (rise && set) {
      rows << QStringList{"Daylight",
                          QString::number((set - rise) / 3600) + "h " +
                              QString::number((set - rise) % 3600 / 60) + "m"};
      for (const auto &spec : QList<QPair<QString, double>>{
               {"Blue hour", -4}, {"Civil twilight", -6}, {"Golden hour", 6}}) {
        rows << QStringList{spec.first + " · morning",
                            time(solarCrossing(
                                rise,
                                s.config.location().value("lat").toDouble(),
                                s.config.location().value("lon").toDouble(),
                                spec.second, true))}
             << QStringList{
                    spec.first + " · evening",
                    time(solarCrossing(
                        set, s.config.location().value("lat").toDouble(),
                        s.config.location().value("lon").toDouble(),
                        spec.second, false))};
      }
    }
    auto moon =
        advanced.data.value("moon").object().value("properties").toObject();
    for (auto key : {"moonrise", "moonset"})
      rows << QStringList{key,
                          moon.value(key).toObject().value("time").toString(
                              "Does not occur / unavailable")};
    table(body, {"Event", "Time at location"}, rows);
    heading("Sun strength");
    chart(h, {"uv_index"}, {"UV index"}, 1, 0, "UV", at);
    chart(h, {"shortwave_radiation"}, {"Solar radiation"}, 1, 0, "W/m²", at);
    double energy = 0;
    int solarHours = 0;
    for (int i = 0; i < times.size(); ++i)
      if (QDateTime::fromSecsSinceEpoch(qint64(times[i].toDouble()) + offset,
                                        Qt::UTC)
                  .date() == date &&
          vAt(h, "shortwave_radiation", i).isDouble()) {
        energy += vAt(h, "shortwave_radiation", i).toDouble() / 1000;
        ++solarHours;
      }
    body->addWidget(
        text("Forecast solar energy today: " +
             (solarHours ? QString::number(energy, 'f', 2) + " kWh/m²"
                         : "Unavailable")));
  } else if (index == 5) {
    heading("Air quality · US AQI");
    auto air = advanced.data.value("air").object().value("hourly").toObject();
    chart(air, {"us_aqi"}, {"US AQI"}, 1, 0, "AQI", at);
    QList<QStringList> rows;
    auto t = air.value("time").toArray();
    for (int i = 0; i < t.size(); ++i)
      if (t[i].toDouble() >= at && t[i].toDouble() < at + 86400)
        rows << QStringList{stamp(qint64(t[i].toDouble()), offset),
                            n(vAt(air, "us_aqi", i), 0),
                            n(vAt(air, "pm2_5", i)), n(vAt(air, "ozone", i))};
    table(body, {"Hour", "US AQI", "PM2.5 µg/m³", "Ozone µg/m³"}, rows);
    heading("Garden water balance · previous 7 days");
    auto gd = advanced.data.value("garden").object().value("daily").toObject();
    double et = 0, rain = 0;
    bool hasEt = false, hasRain = false;
    for (int i = 0; i < 7; ++i) {
      auto a = vAt(gd, "et0_fao_evapotranspiration", i),
           b = vAt(gd, "precipitation_sum", i);
      if (a.isDouble()) {
        et += a.toDouble();
        hasEt = true;
      }
      if (b.isDouble()) {
        rain += b.toDouble();
        hasRain = true;
      }
    }
    auto days = s.archive.daily(offset / 60);
    auto summary = archiveSummary(days);
    QList<QStringList> garden{
        {"Reference evapotranspiration",
         hasEt ? QString::number(et * rf, 'f', 2) + " " + ru : "Unavailable"},
        {"Model rainfall", hasRain
                               ? QString::number(rain * rf, 'f', 2) + " " + ru
                               : "Unavailable"},
        {"Watering shortfall",
         hasEt && hasRain
             ? QString::number(std::max(0.0, et - rain) * rf, 'f', 2) + " " + ru
             : "Unavailable"},
        {"Growing degree days · base 10°C / 50°F",
         days.isEmpty()
             ? "No station archive"
             : n(summary.value("gdd"), 0, tf) + " (recorded days this year)"},
        {"Rain · last 30 recorded days",
         days.isEmpty() ? "Unavailable"
                        : n(summary.value("rain30"), 2, rf) + " " + ru},
        {"Dry spell",
         n(summary.value("dryDays"), 0) + " consecutive recorded days"}};
    table(body, {"Measure", "Value"}, garden);
    heading("Fire weather");
    QStringList fire;
    for (const auto &v : s.warnings) {
      auto p = v.toObject().value("properties").toObject();
      if (p.value("event").toString().contains("fire", Qt::CaseInsensitive) ||
          p.value("event").toString().contains("red flag", Qt::CaseInsensitive))
        fire << p.value("headline").toString();
    }
    body->addWidget(
        text(fire.isEmpty()
                 ? s.warningStatus + " · no fire warning in the current feed"
                 : fire.join("\n")));
  } else if (index == 6) {
    heading("Official warnings");
    for (const auto &v : s.warnings) {
      auto p = v.toObject().value("properties").toObject();
      body->addWidget(text(p.value("headline").toString() + "\n" +
                           p.value("description").toString() + "\n" +
                           p.value("instruction").toString()));
    }
    if (s.warnings.isEmpty())
      body->addWidget(
          text(s.warningStatus + " · no active warnings in the current feed"));
    for (int day = 1; day <= 3; ++day) {
      auto geo = advanced.data.value("spc" + QString::number(day)).object();
      auto risk = outlookRisk(geo, s.config.location().value("lat").toDouble(),
                              s.config.location().value("lon").toDouble());
      heading("SPC day " + QString::number(day) + " · " +
              (geo.isEmpty()    ? "Unavailable"
               : risk.isEmpty() ? "Outside categorical risk polygons"
                                : risk));
      if (!geo.isEmpty()) {
        auto map = new MapView;
        body->addWidget(map);
        map->geo(geo, s.config.location().value("lat").toDouble(),
                 s.config.location().value("lon").toDouble());
      }
    }
    auto severe =
        advanced.data.value("severe").object().value("hourly").toObject();
    chart(severe, {"cape", "convective_inhibition"}, {"CAPE", "CIN"}, 1, 0,
          "J/kg", at);
    heading("Winter · snowfall in next 7 days");
    QList<QStringList> snow;
    for (int i = 0; i < std::min(7, int(d.value("time").toArray().size())); ++i)
      snow << QStringList{
          stamp(qint64(vAt(d, "time", i).toDouble()), offset),
          n(vAt(d, "snowfall_sum", i), 1, metricUnits ? 1 : 1 / 2.54)};
    table(body, {"Day", metricUnits ? "Snow (cm)" : "Snow (in)"}, snow);
    heading("Tropics · National Hurricane Center");
    QList<QStringList> storms;
    for (const auto &v : advanced.data.value("tropical")
                             .object()
                             .value("activeStorms")
                             .toArray()) {
      auto p = v.toObject();
      storms << QStringList{
          p.value("name").toString(), p.value("classification").toString(),
          p.value("intensity").toVariant().toString(),
          p.value("movementDir").toString(), p.value("lastUpdate").toString()};
    }
    table(body,
          {"Storm", "Classification", "Intensity (kt)", "Movement", "Updated"},
          storms);
    heading("Local storm reports · past 24 hours");
    auto reports = advanced.data.value("reports").object();
    if (!reports.isEmpty()) {
      auto map = new MapView;
      body->addWidget(map);
      map->geo(reports, s.config.location().value("lat").toDouble(),
               s.config.location().value("lon").toDouble());
    }
    QList<QStringList> reportRows;
    for (const auto &v : reports.value("features").toArray()) {
      auto p = v.toObject().value("properties").toObject();
      reportRows << QStringList{p.value("valid").toString(),
                                p.value("typetext").toString(),
                                p.value("city").toString(),
                                p.value("magnitude").toVariant().toString(),
                                p.value("remark").toString()};
    }
    table(body, {"Time", "Type", "Place", "Magnitude", "Report"}, reportRows);
  } else if (index == 7) {
    heading("US Drought Monitor · latest weekly map");
    auto map = new MapView;
    body->addWidget(map);
    if (!droughtImage.isNull()) {
      map->scene()->addPixmap(droughtImage);
      map->fitInView(map->scene()->itemsBoundingRect(), Qt::KeepAspectRatio);
    }
    if (!droughtImageBusy && at - droughtImageAt >= 21600) {
      droughtImageBusy = true;
      auto &network = s.network;
      QNetworkRequest request(QUrl(
          "https://droughtmonitor.unl.edu/data/png/current/current_usdm.png"));
      request.setTransferTimeout(20000);
      request.setRawHeader("User-Agent", "StormDesk/" STORMDESK_VERSION);
      auto reply = network.get(request);
      QPointer<MapView> guard(map);
      connect(reply, &QNetworkReply::readyRead, reply, [reply] {
        if (reply->bytesAvailable() > 8 * 1024 * 1024)
          reply->abort();
      });
      connect(reply, &QNetworkReply::finished, this, [this, reply, guard] {
        droughtImageBusy = false;
        QPixmap image;
        if (reply->error() == QNetworkReply::NoError &&
            image.loadFromData(reply->readAll()) && image.width() <= 8192 &&
            image.height() <= 8192) {
          droughtImage = image;
          droughtImageAt = QDateTime::currentSecsSinceEpoch();
        }
        if (guard) {
          if (!droughtImage.isNull()) {
            guard->scene()->clear();
            image = droughtImage;
            guard->scene()->addPixmap(image);
            guard->fitInView(guard->scene()->itemsBoundingRect(),
                             Qt::KeepAspectRatio);
          } else
            guard->scene()->addText(
                "Drought map unavailable; check the connection");
        }
        reply->deleteLater();
      });
    }
    auto dr = advanced.data.value("drought").object();
    heading(dr.value("countyName").toString("Selected county") + " · " +
            dr.value("mapDate").toString());
    QList<QStringList> rows;
    for (auto k : {"none", "d0", "d1", "d2", "d3", "d4"}) {
      auto v = dr.value(k);
      rows << QStringList{k, v.isDouble() ? n(v, 1) + "%"
                                          : v.toString("Unavailable")};
    }
    table(body, {"Drought class (cumulative)", "County area"}, rows);
    body->addWidget(
        text("D0 abnormally dry · D1 moderate · D2 severe · D3 extreme · D4 "
             "exceptional. Map: US Drought Monitor, UNL / USDA / NOAA. Drag to "
             "pan; use the wheel or touchpad to zoom."));
  } else if (index == 8) {
    heading("Local signals · native station feed");
    auto obs = s.archive.current();
    QList<QStringList> rows;
    for (auto k : {"temp", "humidity", "wind_avg", "wind_gust", "wind_lull",
                   "wind_dir", "pressure", "pressure_trend", "strikes",
                   "strike_dist", "day_rain", "solar", "uv", "lux", "battery"})
      rows << QStringList{k, obs.value(k).toVariant().toString()};
    if (obs.value("temp").isDouble() && obs.value("humidity").isDouble()) {
      auto dew = dewPoint(obs.value("temp").toDouble(),
                          obs.value("humidity").toDouble()),
           wet = wetBulb(obs.value("temp").toDouble(),
                         obs.value("humidity").toDouble());
      rows << QStringList{"Dew point estimate (°C)",
                          dew ? QString::number(*dew, 'f', 1) : "Unavailable"}
           << QStringList{"Wet bulb estimate (°C)",
                          wet ? QString::number(*wet, 'f', 1) : "Unavailable"};
    }
    table(body, {"Live reading (SI)", "Value"}, rows);
    heading("Best outdoor window · next 24 hours");
    double best = 1e30;
    int bestI = -1;
    for (int i = 0; i < times.size(); ++i) {
      if (times[i].toDouble() < at || times[i].toDouble() > at + 86400 ||
          !vAt(h, "temperature_2m", i).isDouble() ||
          !vAt(h, "precipitation_probability", i).isDouble() ||
          !vAt(h, "wind_speed_10m", i).isDouble())
        continue;
      double score = std::abs(vAt(h, "temperature_2m", i).toDouble() - 21) * 2 +
                     vAt(h, "precipitation_probability", i).toDouble() +
                     vAt(h, "wind_speed_10m", i).toDouble() * 3;
      if (score < best) {
        best = score;
        bestI = i;
      }
    }
    body->addWidget(
        text(bestI < 0
                 ? "Forecast unavailable"
                 : stamp(qint64(times[bestI].toDouble()), offset) + " · " +
                       n(vAt(h, "temperature_2m", bestI), 1, tf, ts) + tu +
                       ", " + n(vAt(h, "precipitation_probability", bestI), 0) +
                       "% rain, " + n(vAt(h, "wind_speed_10m", bestI), 1, wf) +
                       " " + wu +
                       " wind. Relative comfort score; check warnings before "
                       "going out."));
    heading("Nearby public stations");
    auto entry = new QLineEdit;
    entry->setAccessibleName("Airport code or public Tempest station ID");
    entry->setPlaceholderText("Airport code or Tempest ID");
    body->addWidget(entry);
    auto add = new QPushButton("Read station");
    body->addWidget(add);
    auto stationResult = text({});
    body->addWidget(stationResult);
    QPointer<QLabel> result(stationResult);
    connect(
        add, &QPushButton::clicked, this,
        [this, entry, result, tf, ts, tu, wf, wu] {
          const auto id = entry->text().trimmed().toUpper();
          if (id.size() > 12 ||
              !QRegularExpression("^[A-Z0-9]+$").match(id).hasMatch()) {
            if (result)
              result->setText("Enter a valid airport code or station number");
            return;
          }
          const bool wfStation = id.toLongLong() > 0;
          QUrl url(wfStation ? "https://swd.weatherflow.com/swd/rest/"
                               "observations/station/" +
                                   id
                             : "https://api.weather.gov/stations/" + id +
                                   "/observations/latest");
          if (wfStation) {
            QUrlQuery q;
            q.addQueryItem("token", advanced.services.config.text("token"));
            url.setQuery(q);
          }
          if (result)
            result->setText("Reading station…");
          advanced.services.request(url, [result, wfStation, tf, ts, tu, wf, wu,
                                          id](QJsonDocument doc,
                                              QString error) {
            if (!result)
              return;
            if (!error.isEmpty()) {
              result->setText(error + " · station must be shared publicly");
              return;
            }
            auto p = wfStation
                         ? doc.object().value("obs").toArray().at(0).toObject()
                         : doc.object().value("properties").toObject();
            auto temp = wfStation
                            ? p.value("air_temperature")
                            : p.value("temperature").toObject().value("value");
            auto wind = wfStation
                            ? p.value("wind_avg")
                            : p.value("windSpeed").toObject().value("value");
            result->setText(
                id + " · " + n(temp, 1, tf, ts) + tu + " · " +
                n(wind, 1, wfStation ? wf : wf / 3.6) + " " + wu + " · " +
                (wfStation
                     ? QString::number(p.value("timestamp").toDouble(), 'f', 0)
                     : p.value("timestamp").toString()));
          });
        });
    auto airports =
        advanced.data.value("airports").object().value("features").toArray();
    QList<QStringList> airportsRows;
    for (int i = 0; i < std::min(10, int(airports.size())); ++i) {
      auto p = airports[i].toObject().value("properties").toObject();
      airportsRows << QStringList{p.value("stationIdentifier").toString(),
                                  p.value("name").toString()};
    }
    table(body, {"Nearby NWS station", "Name"}, airportsRows);
    heading("Recent notifications");
    auto notifications =
        QJsonDocument::fromJson(s.archive.meta("native_notifications").toUtf8())
            .array();
    QList<QStringList> logs;
    for (const auto &v : notifications) {
      auto e = v.toObject();
      logs << QStringList{stamp(qint64(e.value("at").toDouble()), offset),
                          e.value("title").toString(),
                          e.value("message").toString()};
    }
    table(body, {"Time", "Title", "Message"}, logs);
  } else if (index == 9) {
    heading("All-time almanac · station archive");
    auto days = s.archive.daily(offset / 60);
    auto summary = archiveSummary(days);
    QList<QStringList> records;
    for (auto k : {"tempMax", "tempMin", "gustMax", "rain", "strikes"}) {
      auto r = summary.value(k).toObject();
      bool temp = QString(k).startsWith("temp");
      double factor = temp                      ? tf
                      : QString(k) == "rain"    ? rf
                      : QString(k) == "gustMax" ? wf
                                                : 1;
      records << QStringList{k, n(r.value(k), 1, factor, temp ? ts : 0),
                             r.value("day").toString()};
    }
    records << QStringList{
        "Days on record", QString::number(days.size()),
        days.isEmpty() ? "" : days[0].toObject().value("day").toString()};
    table(body, {"Record", "Value", "Date"}, records);
    heading("Archive explorer");
    QJsonObject series;
    QJsonArray x, y;
    const QStringList keys{"tempMax",      "rain",  "gustMax", "pressureMean",
                           "humidityMean", "uvMax", "tempMin", "strikes"};
    QString field = keys[metric->currentIndex()];
    QList<QStringList> rows;
    QMap<QString, QJsonObject> months;
    for (const auto &v : days) {
      auto row = v.toObject();
      auto date = QDate::fromString(row.value("day").toString(), Qt::ISODate);
      if (date >= from->date() && date <= to->date()) {
        x.append(
            double(QDateTime(date, QTime(12, 0), Qt::UTC).toSecsSinceEpoch() -
                   offset));
        y.append(row.value(field));
        rows << QStringList{row.value("day").toString(),
                            n(row.value("tempMin"), 1, tf, ts),
                            n(row.value("tempMax"), 1, tf, ts),
                            n(row.value("rain"), 2, rf),
                            n(row.value("gustMax"), 1, wf),
                            n(row.value("strikes"), 0)};
      }
      QString month = row.value("day").toString().left(7);
      auto m = months[month];
      m["count"] = m.value("count").toInt() + 1;
      if (row.value("tempMax").isDouble()) {
        m["high"] =
            m.value("high").toDouble() + row.value("tempMax").toDouble();
        m["highCount"] = m.value("highCount").toInt() + 1;
      }
      if (row.value("tempMin").isDouble()) {
        m["low"] = m.value("low").toDouble() + row.value("tempMin").toDouble();
        m["lowCount"] = m.value("lowCount").toInt() + 1;
      }
      m["rain"] = m.value("rain").toDouble() + row.value("rain").toDouble();
      months[month] = m;
    }
    int m = metric->currentIndex();
    chart({{"time", x}, {"value", y}}, {"value"}, {metric->currentText()},
          m == 0 || m == 6 ? tf
          : m == 1         ? rf
          : m == 2         ? wf
          : m == 3         ? (metricUnits ? 1 : 1 / 33.8639)
                           : 1,
          m == 0 || m == 6 ? ts : 0,
          m == 0 || m == 6 ? tu
          : m == 1         ? ru
          : m == 2         ? wu
          : m == 3         ? (metricUnits ? "hPa" : "inHg")
          : m == 4         ? "%"
          : m == 5         ? "UV"
                           : "strikes");
    table(body,
          {"Day", "Low " + tu, "High " + tu, "Rain " + ru, "Gust " + wu,
           "Strikes"},
          rows);
    heading("Month by month");
    QList<QStringList> monthly;
    for (auto it = months.begin(); it != months.end(); ++it) {
      auto m = it.value();
      monthly << QStringList{
          it.key(), QString::number(m.value("count").toInt()),
          m.value("highCount").toInt()
              ? QString::number(m.value("high").toDouble() /
                                        m.value("highCount").toInt() * tf +
                                    ts,
                                'f', 1)
              : "—",
          m.value("lowCount").toInt()
              ? QString::number(m.value("low").toDouble() /
                                        m.value("lowCount").toInt() * tf +
                                    ts,
                                'f', 1)
              : "—",
          n(m.value("rain"), 2, rf)};
    }
    table(body,
          {"Month", "Recorded days", "Mean high " + tu, "Mean low " + tu,
           "Rain " + ru},
          monthly);
    heading("Wind rose · selected dates");
    auto rose = new Chart;
    rose->rose = true;
    Line bins{"Frequency", {}, QColor("#a0c6f4")};
    std::array<int, 16> counts{};
    QSqlQuery q(s.archive.db);
    q.prepare("SELECT wind_dir FROM obs WHERE ts>=? AND ts<? AND wind_avg>0.5 "
              "AND wind_dir IS NOT NULL");
    q.addBindValue(
        QDateTime(from->date(), QTime(0, 0), Qt::UTC).toSecsSinceEpoch() -
        offset);
    q.addBindValue(QDateTime(to->date().addDays(1), QTime(0, 0), Qt::UTC)
                       .toSecsSinceEpoch() -
                   offset);
    if (q.exec())
      while (q.next())
        ++counts[int(std::floor((q.value(0).toDouble() + 11.25) / 22.5)) % 16];
    for (int i = 0; i < 16; ++i)
      bins.points << QPointF(i * 22.5, counts[i]);
    rose->lines << bins;
    body->addWidget(rose);
    heading("Climate normals · 1991–2020 reanalysis");
    auto normal =
        advanced.data.value("normals").object().value("daily").toObject();
    double high = 0, low = 0;
    int count = 0;
    auto nt = normal.value("time").toArray();
    QString md = QDate::currentDate().toString("MM-dd");
    for (int i = 0; i < nt.size(); ++i)
      if (nt[i].toString().endsWith(md) &&
          vAt(normal, "temperature_2m_max", i).isDouble() &&
          vAt(normal, "temperature_2m_min", i).isDouble()) {
        high += vAt(normal, "temperature_2m_max", i).toDouble();
        low += vAt(normal, "temperature_2m_min", i).toDouble();
        ++count;
      }
    body->addWidget(text(
        count ? QString("Normal high %1%3 · low %2%3 for %4 (model reanalysis)")
                    .arg(high / count * tf + ts, 0, 'f', 1)
                    .arg(low / count * tf + ts, 0, 'f', 1)
                    .arg(tu)
                    .arg(md)
              : "Normals unavailable / updating"));
    heading("This day, other years");
    QList<QStringList> years;
    for (const auto &v : days) {
      auto r = v.toObject();
      if (r.value("day").toString().endsWith(md))
        years << QStringList{
            r.value("day").toString(), n(r.value("tempMax"), 1, tf, ts),
            n(r.value("tempMin"), 1, tf, ts), n(r.value("rain"), 2, rf)};
    }
    table(body, {"Date", "High " + tu, "Low " + tu, "Rain " + ru}, years);
    heading("NWS forecast vs local forecast · matched by calendar day");
    auto official = advanced.data.value("nwsForecast")
                        .object()
                        .value("properties")
                        .toObject()
                        .value("periods")
                        .toArray();
    QList<QStringList> comparison;
    for (const auto &v : official) {
      auto p = v.toObject();
      auto date =
          QDateTime::fromString(p.value("startTime").toString(), Qt::ISODate)
              .date();
      QJsonValue ref;
      for (int i = 0; i < d.value("time").toArray().size(); ++i)
        if (QDateTime::fromSecsSinceEpoch(
                qint64(vAt(d, "time", i).toDouble()) + offset, Qt::UTC)
                .date() == date)
          ref = vAt(d,
                    p.value("isDaytime").toBool() ? "temperature_2m_max"
                                                  : "temperature_2m_min",
                    i);
      double c = p.value("temperature").toDouble();
      if (p.value("temperatureUnit") == "F")
        c = (c - 32) / 1.8;
      comparison << QStringList{
          p.value("name").toString(), QString::number(c * tf + ts, 'f', 1),
          n(ref, 1, tf, ts), p.value("shortForecast").toString()};
    }
    table(body, {"Period", "NWS " + tu, "Local forecast " + tu, "Conditions"},
          comparison);
  } else if (index == 10) {
    heading("Home Assistant · native entity board");
    body->addWidget(
        text(s.config.text("haUrl").isEmpty()
                 ? "Add your Home Assistant URL and token in Settings → "
                   "Integrations."
                 : "Read-only entity states from your Home Assistant server."));
    auto entities = new QLineEdit(s.config.text("haEntities"));
    entities->setAccessibleName("Home Assistant entities (comma separated)");
    body->addWidget(entities);
    auto save = new QPushButton("Save entities");
    body->addWidget(save);
    connect(save, &QPushButton::clicked, this, [this, entities] {
      QString error;
      advanced.services.config.merge(
          {{"_rev", advanced.services.config.value.value("_rev")},
           {"settings", QJsonObject{{"haEntities", entities->text()}}}},
          &error);
      note->setText(error.isEmpty() ? "Entity selection saved" : error);
      render();
    });
    auto ids = s.config.text("haEntities")
                   .split(QRegularExpression("[\\s,]+"), Qt::SkipEmptyParts);
    QList<QStringList> rows;
    for (const auto &v : advanced.data.value("ha").array()) {
      auto e = v.toObject(), a = e.value("attributes").toObject();
      if (!ids.isEmpty() && !ids.contains(e.value("entity_id").toString()))
        continue;
      rows << QStringList{e.value("entity_id").toString(),
                          a.value("friendly_name").toString(),
                          e.value("state").toString() + " " +
                              a.value("unit_of_measurement").toString(),
                          e.value("last_updated").toString()};
    }
    table(body, {"Entity", "Name", "State", "Updated"}, rows);
    heading("MQTT sensor subscriptions");
    QList<QStringList> sensors;
    for (auto it = s.mqttValues.begin(); it != s.mqttValues.end(); ++it) {
      auto p = it.value().toObject();
      sensors << QStringList{it.key(), p.value("value").toString(),
                             stamp(qint64(p.value("at").toDouble()), offset)};
    }
    table(body, {"Topic", "Value", "Received"}, sensors);
    auto topics = new QLineEdit;
    topics->setAccessibleName("MQTT subscription topics (comma separated)");
    QStringList savedTopics;
    for (const auto &v : s.config.settings().value("mqttSubs").toArray())
      savedTopics << v.toObject().value("topic").toString();
    topics->setText(savedTopics.join(", "));
    body->addWidget(topics);
    auto subscribe = new QPushButton("Save topics");
    body->addWidget(subscribe);
    connect(subscribe, &QPushButton::clicked, this, [this, topics] {
      auto &cfg = advanced.services.config;
      QJsonArray subs;
      auto old = cfg.settings().value("mqttSubs").toArray();
      for (const auto &topic : topics->text().split(',', Qt::SkipEmptyParts)) {
        auto value = topic.trimmed();
        if (value.size() > 256 || subs.size() >= 30) {
          note->setText("Use at most 30 topics, each under 256 characters");
          return;
        }
        QJsonObject entry{{"topic", value}, {"label", value}};
        for (const auto &v : old)
          if (v.toObject().value("topic") == value)
            entry = v.toObject();
        subs.append(entry);
      }
      QString error;
      cfg.merge({{"_rev", cfg.value.value("_rev")},
                 {"settings", QJsonObject{{"mqttSubs", subs}}}},
                &error);
      note->setText(error.isEmpty()
                        ? "Subscriptions saved; reconnecting within 10 seconds"
                        : error);
    });
  } else if (index == 11) {
    heading("Station health & source diagnostics");
    QList<QStringList> rows;
    auto health = s.archive.health();
    for (auto it = health.begin(); it != health.end(); ++it)
      rows << QStringList{it.key(), it.value().toVariant().toString()};
    rows << QStringList{"Station", s.stationStatus}
         << QStringList{"Forecast", s.forecastStatus}
         << QStringList{"Warnings", s.warningStatus};
    for (auto it = s.diagnostics.begin(); it != s.diagnostics.end(); ++it)
      rows << QStringList{
          it.key(), QString::fromUtf8(QJsonDocument(it.value().toObject())
                                          .toJson(QJsonDocument::Compact))};
    table(body, {"Check", "Status"}, rows);
    heading("Sensor / hub packets");
    for (auto it = s.packets.begin(); it != s.packets.end(); ++it)
      if (it.key() != "obs_st")
        body->addWidget(
            text(it.key() + "\n" +
                 QString::fromUtf8(QJsonDocument(it.value().toObject())
                                       .toJson(QJsonDocument::Indented))));
    heading("Connectivity checks");
    auto run = new QPushButton("Test providers");
    body->addWidget(run);
    auto results =
        text("Checks use read-only requests and do not send station uploads.");
    body->addWidget(results);
    QPointer<QLabel> result(results);
    connect(run, &QPushButton::clicked, this, [this, result] {
      if (result)
        result->setText("Testing…");
      for (const auto &check : QList<QPair<QString, QString>>{
               {"Open-Meteo",
                "https://api.open-meteo.com/v1/"
                "forecast?latitude=0&longitude=0&current=temperature_2m"},
               {"NWS", "https://api.weather.gov/"},
               {"RainViewer",
                "https://api.rainviewer.com/public/weather-maps.json"}})
        advanced.services.request(
            QUrl(check.second),
            [result, name = check.first](QJsonDocument, QString error) {
              if (result)
                result->setText(result->text() + "\n" + name + ": " +
                                (error.isEmpty() ? "OK" : error));
            });
    });
  } else if (index == 12)
    customization();
  else if (index == 13) {
    heading("Saved weather locations");
    auto places = new QComboBox;
    places->setAccessibleName("Saved weather location");
    places->setSizeAdjustPolicy(
        QComboBox::AdjustToMinimumContentsLengthWithIcon);
    places->setMinimumContentsLength(5);
    places->addItem("Home · " + s.config.text("stationName"), "");
    for (const auto &v : s.config.settings().value("places").toArray()) {
      auto p = v.toObject();
      places->addItem(p.value("name").toString(), p.value("id").toString());
    }
    places->setCurrentIndex(
        std::max(0, places->findData(s.config.text("activePlace"))));
    body->addWidget(places);
    auto use = new QPushButton("Show location");
    body->addWidget(use);
    connect(use, &QPushButton::clicked, this, [this, places] {
      auto &s = advanced.services;
      QString error;
      s.config.merge(
          {{"_rev", s.config.value.value("_rev")},
           {"settings",
            QJsonObject{{"activePlace", places->currentData().toString()}}}},
          &error);
      if (error.isEmpty()) {
        s.forecast = {};
        s.warnings = {};
        s.refresh();
        emit s.changed();
      }
      note->setText(
          error.isEmpty()
              ? "Weather location selected. The station archive stays at home."
              : error);
    });
    auto remove = new QPushButton("Remove place");
    body->addWidget(remove);
    connect(remove, &QPushButton::clicked, this, [this, places] {
      const auto id = places->currentData().toString();
      if (id.isEmpty())
        return;
      auto &s = advanced.services;
      QJsonArray kept;
      for (const auto &v : s.config.settings().value("places").toArray())
        if (v.toObject().value("id").toString() != id)
          kept.append(v);
      QString error;
      QJsonObject delta{{"places", kept}};
      if (s.config.text("activePlace") == id)
        delta["activePlace"] = "";
      s.config.merge(
          {{"_rev", s.config.value.value("_rev")}, {"settings", delta}},
          &error);
      if (error.isEmpty()) {
        s.forecast = {};
        s.warnings = {};
        s.refresh();
        emit s.changed();
        render();
      } else
        note->setText(error);
    });
    auto search = new QLineEdit;
    search->setAccessibleName("Search for a saved place");
    search->setPlaceholderText("Town or postcode");
    body->addWidget(search);
    auto find = new QPushButton("Find place");
    body->addWidget(find);
    auto results = new QComboBox;
    results->setAccessibleName("Place search results");
    results->setSizeAdjustPolicy(
        QComboBox::AdjustToMinimumContentsLengthWithIcon);
    results->setMinimumContentsLength(5);
    body->addWidget(results);
    connect(find, &QPushButton::clicked, this, [this, search, results] {
      if (search->text().trimmed().size() < 2)
        return;
      QUrl address("https://geocoding-api.open-meteo.com/v1/search");
      QUrlQuery query;
      query.addQueryItem("name", search->text().trimmed());
      query.addQueryItem("count", "8");
      address.setQuery(query);
      QPointer<QComboBox> guard(results);
      advanced.services.request(
          address, [guard](QJsonDocument doc, QString error) {
            if (!guard)
              return;
            guard->clear();
            if (!error.isEmpty()) {
              guard->addItem(error);
              return;
            }
            for (const auto &v : doc.object().value("results").toArray()) {
              auto p = v.toObject();
              guard->addItem(p.value("name").toString() + ", " +
                                 p.value("admin1").toString() + ", " +
                                 p.value("country").toString(),
                             p);
            }
          });
    });
    auto add = new QPushButton("Save place");
    body->addWidget(add);
    connect(add, &QPushButton::clicked, this, [this, results] {
      auto p = results->currentData().toJsonObject();
      if (!p.value("latitude").isDouble() || !p.value("longitude").isDouble())
        return;
      auto &cfg = advanced.services.config;
      auto list = cfg.settings().value("places").toArray();
      list.append(QJsonObject{
          {"id", QString::number(QDateTime::currentMSecsSinceEpoch())},
          {"name",
           p.value("name").toString() + ", " + p.value("admin1").toString()},
          {"lat", p.value("latitude")},
          {"lon", p.value("longitude")}});
      QString error;
      cfg.merge({{"_rev", cfg.value.value("_rev")},
                 {"settings", QJsonObject{{"places", list}}}},
                &error);
      if (error.isEmpty())
        render();
      else
        note->setText(error);
    });
  }
  for (auto form : content->findChildren<QFormLayout *>()) {
    form->setRowWrapPolicy(QFormLayout::WrapAllRows);
    form->setFieldGrowthPolicy(QFormLayout::AllNonFixedFieldsGrow);
    for (int row = 0; row < form->rowCount(); ++row)
      if (auto item = form->itemAt(row, QFormLayout::LabelRole))
        if (auto label = qobject_cast<QLabel *>(item->widget()))
          label->setWordWrap(true);
  }
  body->addStretch();
}
void Tools::customization() {
  auto &s = advanced.services;
  auto saved = s.config.settings().value("nativeDashboard").toObject();
  body->addWidget(text("Choose and reorder Weather cards. Official warnings "
                       "always stay visible."));
  auto order = new QListWidget;
  order->setObjectName("dashboardCards");
  order->setAccessibleName("Dashboard card order");
  order->setDragDropMode(QAbstractItemView::InternalMove);
  order->setMinimumHeight(320);
  body->addWidget(order);
  const QStringList defaults{
      "Rain today",     "Lightning",         "Wind",     "Heat stress / WBGT",
      "UV index",       "Pressure",          "Humidity", "Current conditions",
      "10-day outlook", "Your local context"};
  auto ids = saved.value("order").toArray();
  for (const auto &name : defaults)
    if (!ids.contains(name))
      ids.append(name);
  auto hidden = saved.value("hidden").toArray();
  for (const auto &v : ids) {
    auto name = v.toString();
    if (!defaults.contains(name))
      continue;
    auto item = new QListWidgetItem(name, order);
    item->setFlags(item->flags() | Qt::ItemIsUserCheckable);
    item->setCheckState(hidden.contains(name) ? Qt::Unchecked : Qt::Checked);
  }
  auto up = new QPushButton("Move up"), down = new QPushButton("Move down");
  body->addWidget(up);
  body->addWidget(down);
  connect(up, &QPushButton::clicked, this, [order] {
    int row = order->currentRow();
    if (row > 0) {
      auto item = order->takeItem(row);
      order->insertItem(row - 1, item);
      order->setCurrentRow(row - 1);
    }
  });
  connect(down, &QPushButton::clicked, this, [order] {
    int row = order->currentRow();
    if (row >= 0 && row < order->count() - 1) {
      auto item = order->takeItem(row);
      order->insertItem(row + 1, item);
      order->setCurrentRow(row + 1);
    }
  });
  auto density = new QComboBox;
  density->setAccessibleName("Dashboard density");
  density->addItem("Comfortable", 1.0);
  density->addItem("Compact", .6);
  density->addItem("Spacious", 1.5);
  density->setCurrentIndex(
      std::max(0, density->findData(saved.value("density").toDouble(1))));
  body->addWidget(density);
  auto save = new QPushButton("Apply dashboard");
  body->addWidget(save);
  connect(save, &QPushButton::clicked, this, [this, order, density] {
    QJsonArray ids, hidden;
    for (int i = 0; i < order->count(); ++i) {
      auto item = order->item(i);
      ids.append(item->text());
      if (item->checkState() != Qt::Checked)
        hidden.append(item->text());
    }
    auto &cfg = advanced.services.config;
    QString error;
    cfg.merge(
        {{"_rev", cfg.value.value("_rev")},
         {"settings",
          QJsonObject{
              {"nativeDashboard",
               QJsonObject{{"order", ids},
                           {"hidden", hidden},
                           {"density", density->currentData().toDouble()}}}}}},
        &error);
    note->setText(error.isEmpty() ? "Dashboard saved" : error);
    if (error.isEmpty())
      emit dashboardChanged();
  });
  auto reset = new QPushButton("Reset dashboard");
  body->addWidget(reset);
  connect(reset, &QPushButton::clicked, this, [this] {
    auto &cfg = advanced.services.config;
    QString error;
    cfg.merge({{"_rev", cfg.value.value("_rev")},
               {"settings", QJsonObject{{"nativeDashboard", QJsonObject()}}}},
              &error);
    if (error.isEmpty()) {
      emit dashboardChanged();
      render();
    } else
      note->setText(error);
  });
}
} // namespace storm
