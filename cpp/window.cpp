#include "window.h"
#include "instruments.h"
#include "radar.h"
#include "setup.h"
#include "tools.h"
#include "updates.h"
#include <QPointer>
#include <QApplication>
#include <QCheckBox>
#include <QDateTime>
#include <QDesktopServices>
#include <QDialog>
#include <QDialogButtonBox>
#include <QDir>
#include <QDoubleSpinBox>
#include <QFileDialog>
#include <QFileInfo>
#include <QFontDatabase>
#include <QFormLayout>
#include <QGroupBox>
#include <QHeaderView>
#include <QJsonDocument>
#include <QKeyEvent>
#include <QLineEdit>
#include <QMenu>
#include <QMessageBox>
#include <QMouseEvent>
#include <QNetworkReply>
#include <QPainter>
#include <QPainterPath>
#include <QPushButton>
#include <QResizeEvent>
#include <QScreen>
#include <QScrollArea>
#include <QScroller>
#include <QSpinBox>
#include <QSqlQuery>
#include <QStyle>
#include <QTabWidget>
#include <QTableWidget>
#include <QTemporaryDir>
#include <QTimer>
#include <QToolButton>
#include <QTouchEvent>
#include <QUrlQuery>
#include <algorithm>
#include <cmath>
#include <limits>
#ifdef STORMDESK_SPEECH
#include <QTextToSpeech>
#endif

namespace storm {
static QLabel *label(const QString &text, const QString &style = {},
                     QWidget *parent = nullptr) {
  auto l = new QLabel(text, parent);
  l->setTextFormat(Qt::PlainText);
  l->setWordWrap(true);
  if (!style.isEmpty())
    l->setProperty("kind", style);
  return l;
}
static QWidget *card(const QString &title, QVBoxLayout **layout) {
  auto widget = new QFrame;
  widget->setObjectName("card");
  *layout = new QVBoxLayout(widget);
  (*layout)->setSpacing(12);
  (*layout)->addWidget(label(title.toUpper(), "eyebrow"));
  return widget;
}
static QScrollArea *scrollView(QWidget *content) {
  auto view = new QScrollArea;
  view->setWidgetResizable(true);
  view->setFrameShape(QFrame::NoFrame);
  view->setWidget(content);
  QScroller::grabGesture(view->viewport(), QScroller::TouchGesture);
  return view;
}
static QString number(const QJsonValue &v, const QString &unit,
                      int decimals = 1, double factor = 1, double shift = 0) {
  return v.isDouble()
             ? QString::number(v.toDouble() * factor + shift, 'f', decimals) +
                   unit
             : "—";
}
Plot::Plot(QWidget *parent) : QWidget(parent) {
  setMinimumHeight(260);
  setAccessibleName("Weather history chart");
  setSizePolicy(QSizePolicy::Expanding, QSizePolicy::Expanding);
}
void Plot::paintEvent(QPaintEvent *) {
  QPainter p(this);
  p.setRenderHint(QPainter::Antialiasing);
  const int axisWidth = p.fontMetrics().horizontalAdvance("-9999.9") + 12;
  QRectF area = rect().adjusted(axisWidth, p.fontMetrics().height() + 12, -20,
                                -p.fontMetrics().height() * 2 - 16);
  if (points.isEmpty()) {
    p.setPen(palette().text().color());
    p.drawText(rect(), Qt::AlignCenter, "No archived readings in this period");
    return;
  }
  double low = points[0].y(), high = low, start = points[0].x(),
         end = points.last().x();
  for (const auto &point : points) {
    low = std::min(low, point.y());
    high = std::max(high, point.y());
  }
  if (low == high) {
    low -= 1;
    high += 1;
  }
  double pad = (high - low) * .1;
  low -= pad;
  high += pad;
  for (int i = 0; i < 5; ++i) {
    double y = area.bottom() - area.height() * i / 4;
    p.setPen(QColor(127, 137, 156, 45));
    p.drawLine(QPointF(area.left(), y), QPointF(area.right(), y));
    p.setPen(palette().text().color());
    p.drawText(QRectF(0, y - p.fontMetrics().height() / 2, axisWidth - 8,
                      p.fontMetrics().height()),
               Qt::AlignRight | Qt::AlignVCenter,
               QString::number(low + (high - low) * i / 4, 'f', 1));
  }
  QPainterPath line;
  bool first = true;
  for (const auto &v : points) {
    QPointF point(area.left() + area.width() * (v.x() - start) /
                                    std::max(1.0, end - start),
                  area.bottom() - area.height() * (v.y() - low) / (high - low));
    if (first)
      line.moveTo(point);
    else
      line.lineTo(point);
    first = false;
  }
  p.setPen(QPen(QColor("#a0c6f4"), 2));
  p.drawPath(line);
  p.setPen(palette().text().color());
  const auto dateFormat = width() < 700 ? "MM-dd\\nHH:mm" : "ddd d MMM HH:mm";
  p.drawText(QRectF(area.left(), area.bottom() + 8, area.width(),
                    p.fontMetrics().height() * 2 + 4),
             Qt::AlignLeft,
             QDateTime::fromSecsSinceEpoch(qint64(start)).toString(dateFormat));
  p.drawText(QRectF(area.left(), area.bottom() + 8, area.width(),
                    p.fontMetrics().height() * 2 + 4),
             Qt::AlignRight,
             QDateTime::fromSecsSinceEpoch(qint64(end)).toString(dateFormat));
  p.drawText(QRectF(area.left(), 0, area.width(), 20), Qt::AlignLeft, unit);
}
Window::Window(Services &s, HttpServer &http)
    : services(s), server(http),
      local(QSettings::defaultFormat(), QSettings::UserScope, "StormDesk",
            "Native") {
  static const int condensedFont = QFontDatabase::addApplicationFont(
      ":/fonts/barlow-semi-condensed-500.ttf");
  Q_UNUSED(condensedFont);
  setWindowTitle("STORMDESK");
  setWindowIcon(QIcon(":/app-icon.png"));
  setMinimumSize(240, 240);
  auto root = new QWidget;
  auto layout = new QVBoxLayout(root);
  layout->setSizeConstraint(QLayout::SetNoConstraint);
  layout->setContentsMargins(20, 18, 20, 18);
  layout->setSpacing(16);
  auto shell = new QStackedWidget;
  shell->setObjectName("appShell");
  shell->addWidget(root);
  setCentralWidget(shell);
  auto header = new QHBoxLayout;
  auto brand = new QVBoxLayout;
  brand->setSpacing(2);
  brand->addWidget(label("STORMDESK", "brand"));
  location = label("Your weather, at a glance", "muted");
  brand->addWidget(location);
  location->hide();
  header->addLayout(brand, 1);
  auto clockLayout = new QVBoxLayout;
  clockLayout->setSpacing(0);
  clock = label({}, "clock");
  clock->setObjectName("dashboardClock");
  clock->setAlignment(Qt::AlignRight);
  clockDate = label({}, "muted");
  clockDate->setAlignment(Qt::AlignRight);
  clockLayout->addWidget(clock);
  clockLayout->addWidget(clockDate);
  header->addLayout(clockLayout);
  auto updateClock = [this] {
    const auto now = QDateTime::currentDateTime();
    clock->setText(now.toString("h:mm:ss AP"));
    clockDate->setText(now.toString("ddd d MMM"));
  };
  updateClock();
  auto timer = new QTimer(this);
  timer->start(1000);
  connect(timer, &QTimer::timeout, this, updateClock);
  layout->addLayout(header);
  navigation = new QGridLayout;
#ifdef STORMDESK_SPEECH
  new QTextToSpeech(this);
#endif
  pages = new QStackedWidget;
  pages->setObjectName("dashboardPages");
  pages->setSizePolicy(QSizePolicy::Ignored, QSizePolicy::Preferred);
  const QStringList titles = {"Dashboard", "Radar", "History", "Settings",
                              "Tools"};
  for (int i = 0; i < titles.size(); ++i) {
    auto button = new QPushButton(titles[i]);
    button->setCheckable(true);
    button->setChecked(i == 0);
    button->setProperty("nav", true);
    connect(button, &QPushButton::clicked, this, [this, i] {
      pages->setCurrentIndex(i);
      if (i == 1)
        openRadar();
      if (i == 2)
        renderHistory();
      if (i == 3)
        loadSettings();
    });
    connect(pages, &QStackedWidget::currentChanged, button,
            [button, i](int selected) { button->setChecked(i == selected); });
    navigation->addWidget(button, 0, i);
    navButtons << button;
  }
  navigation->setColumnStretch(5, 1);
  pageSelect = new QComboBox;
  pageSelect->addItems(titles);
  pageSelect->setAccessibleName("Dashboard page");
  pageSelect->hide();
  connect(pageSelect, &QComboBox::activated, this, [this](int i) {
    pages->setCurrentIndex(i);
    if (i == 1)
      openRadar();
    if (i == 2)
      renderHistory();
    if (i == 3)
      loadSettings();
  });
  connect(pages, &QStackedWidget::currentChanged, pageSelect,
          &QComboBox::setCurrentIndex);
  scaleBox = new QComboBox;
  scaleBox->setAccessibleName("Interface size");
  scaleBox->setToolTip(
      "UI size, in addition to your display’s automatic DPI scaling");
  for (int percent : {70, 85, 100, 115, 125, 150, 175, 200})
    scaleBox->addItem(QString::number(percent) + "%", percent / 100.0);
  connect(scaleBox, &QComboBox::activated, this,
          [this](int i) { applyScale(scaleBox->itemData(i).toDouble()); });
  navigation->addWidget(scaleBox, 0, 7);
  refreshButton = new QPushButton("Refresh");
  connect(refreshButton, &QPushButton::clicked, &services, &Services::refresh);
  navigation->addWidget(refreshButton, 0, 6);
  setupButton = new QPushButton("Connect station");
  setupButton->setObjectName("connectStation");
  connect(setupButton, &QPushButton::clicked, this, &Window::setup);

  layout->addLayout(navigation);
  pages->addWidget(makeWeather());
  radarPage = makeRadar();
  pages->addWidget(radarPage);
  pages->addWidget(makeHistory());
  pages->addWidget(makeSettings());
  tools = new Tools(services);
  pages->addWidget(scrollView(tools));
  connect(radarPage->findChild<Radar *>(), &Radar::warningsRequested, this,
          &Window::openWarnings);
  connect(tools, &Tools::dashboardChanged, this, [this] {
    arrange();
    render();
  });
  connect(refreshButton, &QPushButton::clicked, this, [this] {
    if (pages->currentIndex() == 4)
      tools->refresh(true);
  });
  layout->addWidget(pages, 1);
  status = label({}, "muted");
  status->setTextInteractionFlags(Qt::TextSelectableByMouse);
  layout->addWidget(status);
  connect(&services, &Services::changed, this, &Window::render);
  connect(&services, &Services::notification, this, &Window::notify);
#ifdef STORMDESK_SPEECH
  auto speech = findChild<QTextToSpeech *>();
  connect(speech, &QTextToSpeech::errorOccurred, this,
          [this](QTextToSpeech::ErrorReason, const QString &) {
            status->setText(
                "Speech unavailable. Check the system voice and audio output.");
          });
#endif
#ifndef QT_NO_SYSTEMTRAYICON
  if (QSystemTrayIcon::isSystemTrayAvailable()) {
    tray = new QSystemTrayIcon(QIcon::fromTheme("weather-few-clouds"), this);
    tray->setToolTip("StormDesk");
    auto menu = new QMenu(this);
    menu->addAction("Show StormDesk", this, [this] {
      showNormal();
      raise();
      activateWindow();
    });
    menu->addAction("Quit", qApp, &QApplication::quit);
    tray->setContextMenu(menu);
    tray->show();
  }
#endif
  auto fullscreen = new QAction(this);
  fullscreen->setShortcut(QKeySequence(Qt::Key_F11));
  addAction(fullscreen);
  connect(fullscreen, &QAction::triggered, this,
          [this] { isFullScreen() ? showNormal() : showFullScreen(); });
  auto escape = new QAction(this);
  escape->setShortcut(QKeySequence(Qt::Key_Escape));
  addAction(escape);
  connect(escape, &QAction::triggered, this, [this] {
    if (isFullScreen())
      showNormal();
  });
  applyScale(
      local.value("scale", services.config.number("fontScale", 1)).toDouble());
  auto initialSize = local.value("size", QSize(1440, 950)).toSize();
  if (auto screen = QGuiApplication::primaryScreen())
    initialSize = initialSize.boundedTo(screen->availableGeometry().size() -
                                        QSize(40, 80));
  resize(initialSize.expandedTo(minimumSize()));
  render();
  QTimer::singleShot(10000, this, [this] { checkUpdates(); });
  auto updateTimer = new QTimer(this);
  updateTimer->setObjectName("appUpdateTimer");
  updateTimer->start(86400000);
  connect(updateTimer, &QTimer::timeout, this, [this] { checkUpdates(); });
  connect(qApp, &QCoreApplication::aboutToQuit, this,
          [this] { local.setValue("size", size()); });
}
QWidget *Window::makeWeather() {
  auto page = new QWidget;
  auto layout = new QVBoxLayout(page);
  layout->setContentsMargins(0, 0, 0, 0);
  layout->setSpacing(6);
  alerts = label(
      "Choose a location in Settings to load weather and official warnings.",
      "notice");
  alerts->setObjectName("nwsAlertBanner");
  alerts->setAccessibleName("National Weather Service alerts");
  alerts->setTextInteractionFlags(Qt::NoTextInteraction);
  alerts->setAttribute(Qt::WA_TransparentForMouseEvents);
  alertButton = new QPushButton;
  alertButton->setObjectName("openNwsAlerts");
  alertButton->setAccessibleName("View National Weather Service alert details");
  alertButton->setToolTip(
      "Read affected areas, expiration and official instructions");
  alertButton->setCursor(Qt::PointingHandCursor);
  auto bannerPolicy =
      QSizePolicy(QSizePolicy::Expanding, QSizePolicy::Preferred);
  bannerPolicy.setHeightForWidth(true);
  alertButton->setSizePolicy(bannerPolicy);
  alertButton->setMinimumWidth(0);
  alertButton->setStyleSheet(
      "QPushButton#openNwsAlerts "
      "{border:0;padding:0;min-height:0;background:transparent;}"
      "QPushButton#openNwsAlerts:focus {border:2px solid "
      "palette(highlight);border-radius:8px;}");
  auto bannerLayout = new QVBoxLayout(alertButton);
  bannerLayout->setContentsMargins(0, 0, 0, 0);
  bannerLayout->addWidget(alerts);
  connect(alertButton, &QPushButton::clicked, this, &Window::openWarnings);
  metrics = new QGridLayout;
  metrics->setSpacing(12);
  layout->addLayout(metrics);
  const QStringList names = {"Rain today",         "Lightning", "Wind",
                             "Heat stress / WBGT", "UV index",  "Pressure",
                             "Humidity",           "Dew point"};
  for (int i = 0; i < names.size(); ++i) {
    QVBoxLayout *box;
    auto widget = card(names[i], &box);
    auto title = box->takeAt(0);
    auto heading = new QHBoxLayout;
    heading->addWidget(title->widget(), 1);
    delete title;
    auto handle = new QToolButton;
    handle->setText("⠿");
    handle->setObjectName("gaugeHandle" + QString::number(i));
    handle->setProperty("gaugeIndex", i);
    handle->setAccessibleName("Move " + names[i]);
    handle->setToolTip("Drag within the gauge row, or use Alt + Left / Right");
    handle->setFocusPolicy(Qt::StrongFocus);
    handle->setCursor(Qt::OpenHandCursor);
    handle->setAttribute(Qt::WA_AcceptTouchEvents);
    handle->installEventFilter(this);
    heading->addWidget(handle);
    box->insertLayout(0, heading);
    widget->setMinimumWidth(0);
    box->setSpacing(2);
    box->setContentsMargins(8, 5, 8, 5);
    faces[i] = new InstrumentFace(i);
    faces[i]->setObjectName("instrumentFace" + QString::number(i));
    faces[i]->setAccessibleName(names[i] + " details");
    box->addWidget(faces[i]);
    connect(faces[i], &QAbstractButton::clicked, this,
            [this, i] { showInstrument(i); });
    metricValues[i] = label("—", "metric");
    metricValues[i]->setAccessibleName(names[i]);
    box->addWidget(metricValues[i]);
    metricSources[i] = label("Unavailable", "muted");
    box->addWidget(metricSources[i]);
    metricCards << widget;
  }
  body = new QGridLayout;
  body->setSpacing(16);
  layout->addLayout(body);
  QVBoxLayout *currentLayout;
  currentCard = card("Current conditions", &currentLayout);
  heroSource = label("Forecast-only mode", "muted");
  currentLayout->addWidget(heroSource);
  heroTemperature = label("—", "temperature");
  currentLayout->addWidget(heroTemperature);
  heroCondition = label("Connect your weather", "subtitle");
  currentLayout->addWidget(heroCondition);
  auto details = label("Set a location for forecasts, or connect a personal "
                       "station for local measurements.",
                       "muted");
  details->setObjectName("conditionsDetail");
  currentLayout->addWidget(details);
  currentLayout->addStretch();
  auto radar = new QPushButton("Live radar →");
  connect(radar, &QPushButton::clicked, this, [this] {
    pages->setCurrentIndex(1);
    openRadar();
  });
  currentLayout->addWidget(radar);
  auto speak = new QPushButton("Speak");
  speak->setToolTip("Read the current forecast aloud");
  currentLayout->addWidget(speak);
  connect(speak, &QPushButton::clicked, this, [this] {
#ifdef STORMDESK_SPEECH
    auto engine = findChild<QTextToSpeech *>();
    if (!engine || engine->state() == QTextToSpeech::Error) {
      status->setText(
          "Speech unavailable. Check the system voice and audio output.");
      return;
    }
    for (const auto &voice : engine->availableVoices())
      if (voice.name() == services.config.text("nativeVoice"))
        engine->setVoice(voice);
    engine->setRate(services.config.text("speechRate", "0").toDouble());
    const auto d = services.forecast.value("daily").toObject();
    const bool metric = services.config.text("units") == "metric";
    auto first = [](const QJsonValue &v) { return v.toArray().at(0); };
    const auto high = first(d.value("temperature_2m_max")),
               low = first(d.value("temperature_2m_min")),
               pop = first(d.value("precipitation_probability_max"));
    QString briefing = services.config.location().value("name").toString() +
                       ". " + heroCondition->text() + ". " +
                       heroTemperature->text() + ".";
    if (high.isDouble() && low.isDouble())
      briefing +=
          " Today's forecast high " +
          number(high, " degrees", 0, metric ? 1 : 1.8, metric ? 0 : 32) +
          ", low " +
          number(low, " degrees", 0, metric ? 1 : 1.8, metric ? 0 : 32) + ".";
    if (pop.isDouble())
      briefing += " Rain chance " + number(pop, " percent", 0) + ".";
    engine->say(briefing);
#else
        status->setText("This build has no speech engine. Install Qt TextToSpeech and rebuild to enable system voices.");
#endif
  });
  QVBoxLayout *context;
  contextCard = card("Your local context", &context);
  auto source = label({}, "muted");
  source->setObjectName("stationDetail");
  context->addWidget(source);
  auto actions = new QHBoxLayout;
  actions->setObjectName("contextActions");
  context->addLayout(actions);
  auto link = new QPushButton("Tools →");
  connect(link, &QPushButton::clicked, this,
          [this] { pages->setCurrentIndex(4); });
  actions->addWidget(link);
  context->setContentsMargins(8, 5, 8, 5);
  context->setSpacing(3);
  currentCard->setObjectName("instrumentHero");
  heroHeading = label("Current conditions", "subtitle");
  weatherGlyph = new WeatherGlyph;
  heroLayout = new QGridLayout;
  for (auto w : {heroSource, heroTemperature, heroCondition, details})
    currentLayout->removeWidget(w);
  heroLayout->addWidget(heroHeading, 0, 0);
  heroLayout->addWidget(heroSource, 1, 0);
  heroLayout->addWidget(details, 2, 0);
  heroLayout->addWidget(heroTemperature, 0, 1, 2, 1);
  heroLayout->addWidget(heroCondition, 2, 1);
  heroLayout->addWidget(weatherGlyph, 0, 2, 3, 1);
  if (auto title = currentLayout->takeAt(0)) {
    delete title->widget();
    delete title;
  }
  currentLayout->removeWidget(radar);
  currentLayout->removeWidget(speak);
  actions->addWidget(radar);
  actions->addWidget(speak);
  heroLayout->setColumnStretch(0, 1);
  currentLayout->insertLayout(0, heroLayout);
  currentLayout->setContentsMargins(8, 0, 8, 0);
  heroLayout->setSpacing(2);
  sunCycle = new SunCycle;
  sunCycle->setObjectName("sunCycle");
  body->addWidget(currentCard, 0, 0);
  body->addWidget(sunCycle, 0, 1);
  body->addWidget(contextCard, 0, 2);
  auto liveRadar = new Radar(services, nullptr, true);
  liveRadar->setObjectName("dashboardRadar");
  dashboardRadarCard = liveRadar;
  connect(liveRadar, &Radar::warningsRequested, this, &Window::openWarnings);
  layout->addStretch();
  radarStage = new RadarStage(liveRadar, scrollView(page));
  auto dashboard = new QWidget;
  auto dashboardLayout = new QVBoxLayout(dashboard);
  dashboardLayout->setContentsMargins(0, 0, 0, 0);
  dashboardLayout->addWidget(alertButton);
  dashboardLayout->addWidget(radarStage, 1);
  arrange();
  return dashboard;
}
QWidget *Window::makeRadar() { return scrollView(new Radar(services)); }
void Window::openWarnings() {
  tools->findChild<QComboBox *>("nativeTool")->setCurrentIndex(6);
  pages->setCurrentIndex(4);
}
void Window::openRadar() {
  if (auto radar = radarPage->findChild<Radar *>())
    radar->refresh();
}
QWidget *Window::makeHistory() {
  auto page = new QWidget;
  auto layout = new QVBoxLayout(page);
  layout->addWidget(label("Your weather archive", "subtitle"));
  historySummary = label({}, "muted");
  layout->addWidget(historySummary);
  auto controls = new QVBoxLayout;
  historyMetric = new QComboBox;
  historyMetric->setSizeAdjustPolicy(
      QComboBox::AdjustToMinimumContentsLengthWithIcon);
  historyMetric->setMinimumContentsLength(5);
  historyMetric->setAccessibleName("History measurement");
  historyMetric->addItems(
      {"Temperature", "Rain", "Wind gust", "Pressure", "Humidity", "UV index"});
  controls->addWidget(historyMetric);
  historyRange = new QComboBox;
  historyRange->setSizeAdjustPolicy(
      QComboBox::AdjustToMinimumContentsLengthWithIcon);
  historyRange->setMinimumContentsLength(5);
  historyRange->setAccessibleName("History period");
  historyRange->addItem("Last 24 hours", 24);
  historyRange->addItem("Last 7 days", 168);
  historyRange->addItem("Last 30 days", 720);
  controls->addWidget(historyRange);
  auto csv = new QPushButton("Export CSV");
  connect(csv, &QPushButton::clicked, this, &Window::exportCsv);
  controls->addWidget(csv);
  layout->addLayout(controls);
  plot = new Plot;
  layout->addWidget(plot, 1);
  historyTable = new QTableWidget(0, 5);
  historyTable->setHorizontalHeaderLabels(
      {"Day", "Low", "High", "Max gust", "Rain"});
  historyTable->horizontalHeader()->setSectionResizeMode(QHeaderView::Stretch);
  historyTable->verticalHeader()->hide();
  historyTable->setEditTriggers(QAbstractItemView::NoEditTriggers);
  historyTable->setAccessibleName("Daily weather records");
  historyTable->setMinimumHeight(240);
  layout->addWidget(historyTable);
  connect(historyMetric, &QComboBox::currentIndexChanged, this,
          [this] { renderHistory(); });
  connect(historyRange, &QComboBox::currentIndexChanged, this,
          [this] { renderHistory(); });
  return scrollView(page);
}
QWidget *Window::makeSettings() {
  auto page = new QWidget;
  auto layout = new QVBoxLayout(page);
  layout->addWidget(label("Settings", "subtitle"));
  auto tabs = new QTabWidget;
  tabs->setMinimumHeight(360);
  tabs->setUsesScrollButtons(true);
  layout->addWidget(tabs, 1);
  auto section = [tabs](const QString &title) {
    auto content = new QWidget;
    auto form = new QFormLayout(content);
    form->setRowWrapPolicy(QFormLayout::WrapLongRows);
    form->setFieldGrowthPolicy(QFormLayout::AllNonFixedFieldsGrow);
    tabs->addTab(scrollView(content), title);
    return form;
  };
  auto text = [this](QFormLayout *form, const QString &title,
                     const QString &key, bool secret = false) {
    auto edit = new QLineEdit;
    edit->setAccessibleName(title);
    if (secret)
      edit->setEchoMode(QLineEdit::Password);
    form->addRow(title, edit);
    editors[key] = edit;
    return edit;
  };
  auto choice = [this](QFormLayout *form, const QString &title,
                       const QString &key,
                       const QList<QPair<QString, QString>> &values) {
    auto box = new QComboBox;
    box->setSizeAdjustPolicy(QComboBox::AdjustToMinimumContentsLengthWithIcon);
    box->setMinimumContentsLength(5);
    box->setAccessibleName(title);
    for (const auto &v : values)
      box->addItem(v.first, v.second);
    form->addRow(title, box);
    editors[key] = box;
    return box;
  };
  auto check = [this](QFormLayout *form, const QString &title,
                      const QString &key) {
    auto box = new QCheckBox(title);
    form->addRow(box);
    editors[key] = box;
    return box;
  };
  auto general = section("Location");
  auto searchLine = new QHBoxLayout;
  auto search = new QLineEdit;
  search->setPlaceholderText("Town or postcode");
  search->setAccessibleName("Search weather location");
  auto find = new QPushButton("Find");
  searchLine->addWidget(search);
  searchLine->addWidget(find);
  general->addRow("Find your weather", searchLine);
  auto results = new QComboBox;
  results->setSizeAdjustPolicy(
      QComboBox::AdjustToMinimumContentsLengthWithIcon);
  results->setMinimumContentsLength(5);
  results->setAccessibleName("Matching locations");
  general->addRow("Search results", results);
  text(general, "Location name", "stationName");
  for (const auto &p : QList<QPair<QString, QString>>{{"Latitude", "lat"},
                                                      {"Longitude", "lon"}}) {
    auto spin = new QDoubleSpinBox;
    spin->setDecimals(5);
    spin->setRange(p.second == "lat" ? -90 : -180,
                   p.second == "lat" ? 90 : 180);
    spin->setAccessibleName(p.first);
    general->addRow(p.first, spin);
    editors[p.second] = spin;
    connect(spin, &QDoubleSpinBox::editingFinished, spin,
            [spin] { spin->setProperty("locationEdited", true); });
  }
  choice(general, "Units", "units",
         {{"Imperial", "imperial"}, {"Metric", "metric"}});
  choice(general, "Wind units", "windUnit",
         {{"Follow main units", ""},
          {"Miles per hour", "mph"},
          {"Kilometres per hour", "km/h"},
          {"Metres per second", "m/s"},
          {"Knots", "kt"}});
  general->addRow(label(
      "Forecasts: Open-Meteo. Official warning coverage: US National Weather "
      "Service. Outside the US, consult your local weather service.",
      "muted"));
  connect(find, &QPushButton::clicked, this, [this, search, results, find] {
    if (search->text().trimmed().size() < 2)
      return;
    QUrl url("https://geocoding-api.open-meteo.com/v1/search");
    QUrlQuery q;
    q.addQueryItem("name", search->text().trimmed());
    q.addQueryItem("count", "8");
    q.addQueryItem("language", "en");
    url.setQuery(q);
    find->setEnabled(false);
    services.request(
        url, [this, results, find](QJsonDocument doc, const QString &error) {
          find->setEnabled(true);
          results->clear();
          if (!error.isEmpty()) {
            settingsMessage->setText(error);
            return;
          }
          for (const auto &v : doc.object().value("results").toArray()) {
            const auto place = v.toObject();
            results->addItem(place.value("name").toString() + ", " +
                                 place.value("admin1").toString() + ", " +
                                 place.value("country").toString(),
                             place.toVariantMap());
          }
          settingsMessage->setText(results->count()
                                       ? "Choose a result, then save changes."
                                       : "No matching locations found.");
        });
  });
  connect(results, &QComboBox::activated, this, [this, results](int i) {
    const auto place = results->itemData(i).toMap();
    qobject_cast<QDoubleSpinBox *>(editors.value("lat"))
        ->setValue(place.value("latitude").toDouble());
    editors.value("lat")->setProperty("locationEdited", true);
    editors.value("lon")->setProperty("locationEdited", true);
    qobject_cast<QDoubleSpinBox *>(editors.value("lon"))
        ->setValue(place.value("longitude").toDouble());
    qobject_cast<QLineEdit *>(editors.value("stationName"))
        ->setText(place.value("name").toString());
  });
  auto station = section("My station");
  station->addRow(setupButton);
  body->removeWidget(contextCard);
  station->addRow(contextCard);
  choice(station, "Station source", "stationSource",
         {{"Forecast only", ""},
          {"WeatherFlow Tempest", "tempest"},
          {"Ecowitt / Wittboy", "ecowitt"},
          {"Ambient custom upload", "ambient"},
          {"Davis WeatherLink Live", "wll"},
          {"Ambient cloud", "awn"},
          {"La Crosse cloud", "lacrosse"},
          {"AcuRite / rtl_433 / WeeWX / WU", "wu"}});
  text(station, "Station ID / MAC", "stationId");
  text(station, "Tempest device ID", "deviceId");
  text(station, "Tempest personal token", "token", true);
  auto importTempest = new QPushButton("Import Tempest");
  importTempest->setObjectName("importTempest");
  importTempest->setAccessibleName("Import Tempest");
  station->addRow(importTempest);
  connect(importTempest, &QPushButton::clicked, this, &Window::setup);
  choice(station, "Tempest feed", "nativeTempestConnection",
         {{"Local hub / cloud backup", "local"}, {"Cloud only", "cloud"}});
  text(station, "Tempest serial (optional)", "tempestSerial");
  text(station, "Davis host / IP", "wllHost");
  auto consoles = new QComboBox;
  consoles->setAccessibleName("Discovered Davis consoles");
  consoles->setSizeAdjustPolicy(
      QComboBox::AdjustToMinimumContentsLengthWithIcon);
  consoles->setMinimumContentsLength(5);
  station->addRow("Davis consoles on this network", consoles);
  auto scan = new QPushButton("Find console");
  station->addRow(scan);
  connect(scan, &QPushButton::clicked, this, [this] {
    emit services.discoveryRequested();
    settingsMessage->setText(
        "Looking for Davis consoles on the local network. Multicast must be "
        "allowed; you can also enter the address.");
  });
  connect(&services, &Services::changed, consoles, [this, consoles] {
    auto current = consoles->currentData().toString();
    consoles->clear();
    for (const auto &v : services.discovered) {
      auto p = v.toObject();
      consoles->addItem(p.value("name").toString() + " · " +
                            p.value("host").toString(),
                        p.value("host"));
    }
    consoles->setCurrentIndex(std::max(0, consoles->findData(current)));
  });
  connect(consoles, &QComboBox::activated, this, [this, consoles](int i) {
    qobject_cast<QLineEdit *>(editors.value("wllHost"))
        ->setText(consoles->itemData(i).toString());
  });
  auto elevation = new QLineEdit;
  elevation->setAccessibleName("Elevation in metres");
  elevation->setPlaceholderText("Optional, metres above sea level");
  station->addRow("Elevation (metres)", elevation);
  editors["elevationM"] = elevation;
  text(station, "Ambient API key", "awnApiKey", true);
  text(station, "Ambient application key", "awnAppKey", true);
  text(station, "La Crosse email", "lacrosseEmail");
  text(station, "La Crosse password", "lacrossePass", true);
  text(station, "Upload key", "ingestKey", true);
  station->addRow(
      label("For custom uploads, use this computer’s LAN address, port " +
                QString::number(server.serverPort()) +
                ", and /ingest/ followed by your upload key. Set a station ID "
                "to protect the archive from mixed stations.",
            "muted"));
  auto appearance = section("Appearance");
  choice(appearance, "Theme", "theme",
         {{"Graphite Silver", "graphite"},
          {"Midnight Violet", "violet"},
          {"Carbon Lime", "carbon"},
          {"Ocean Abyss", "abyss"},
          {"Night Spruce", "spruce"},
          {"Oxblood Rose", "oxblood"},
          {"Burnished Copper", "copper"},
          {"Electric Indigo", "indigo"},
          {"Petrol Citron", "petrol"},
          {"Espresso Gold", "espresso"},
          {"OLED black", "dark"},
          {"Light", "light"},
          {"High contrast", "contrast"}});
  auto themes = qobject_cast<QComboBox *>(editors.value("theme"));
  themes->addItem("Follow daylight", "auto");
  text(appearance, "Accent color (optional)", "accent");
  check(appearance, "Icon animation", "nativeMotion")
      ->setObjectName("iconAnimation");
#ifdef STORMDESK_SPEECH
  QList<QPair<QString, QString>> voices{{"System default", ""}};
  for (const auto &voice : findChild<QTextToSpeech *>()->availableVoices())
    voices.append({voice.name(), voice.name()});
  choice(appearance, "System voice", "nativeVoice", voices);
  choice(appearance, "Speech speed", "speechRate",
         {{"Normal", "0"}, {"Slower", "-0.3"}, {"Faster", "0.3"}});
#endif
  appearance->addRow(
      label("Change interface size in the toolbar: 70–200%. The choice is "
            "saved on this device. Display DPI is handled automatically. Press "
            "F11 for a full-screen wall display; Escape leaves full screen.",
            "muted"));
  text(appearance, "NEXRAD WSR-88D site (automatic when blank)", "radarSite");
  editors.value("radarSite")
      ->setToolTip("For example KFWS. Airport TDWR sites are excluded.");
  auto alert = section("Alerts");
  check(alert, "Local alerts", "nativeNotifications");
  check(alert, "Push warnings", "pushOfficial");
  auto speak = check(alert, "Speak warnings", "speakAlerts");
#ifndef STORMDESK_SPEECH
  speak->setEnabled(false);
  speak->setToolTip("This build does not include Qt TextToSpeech");
#else
  Q_UNUSED(speak);
#endif
  text(alert, "ntfy server", "ntfyUrl");
  text(alert, "ntfy topic", "ntfyTopic", true);
  text(alert, "Webhook URL", "webhookUrl", true);
  auto test = new QPushButton("Test push");
  alert->addRow(test);
  connect(test, &QPushButton::clicked, this, [this] {
    services.push("StormDesk test",
                  "Your weather notification channel is working.");
    notify("StormDesk test", "Native notifications are enabled.");
  });
  alert->addRow(label("Save changes before testing delivery. Rule thresholds "
                      "use your display units.",
                      "muted"));
  ruleTable = new QTableWidget(0, 5);
  ruleTable->setHorizontalHeaderLabels(
      {"Measurement", "When", "Threshold", "Minutes", "Second condition"});
  ruleTable->setAccessibleName("Weather alert rules");
  ruleTable->setMinimumHeight(220);
  ruleTable->horizontalHeader()->setSectionResizeMode(
      QHeaderView::ResizeToContents);
  alert->addRow(ruleTable);
  auto ruleButtons = new QVBoxLayout;
  auto add = new QPushButton("Add rule"),
       remove = new QPushButton("Remove rule");
  ruleButtons->addWidget(add);
  ruleButtons->addWidget(remove);
  alert->addRow(ruleButtons);
  connect(add, &QPushButton::clicked, this, [this] {
    addRule({{"metric", "gust"}, {"op", ">"}, {"value", 30}, {"durMin", 0}});
  });
  connect(remove, &QPushButton::clicked, this, [this] {
    if (ruleTable->currentRow() >= 0)
      ruleTable->removeRow(ruleTable->currentRow());
  });
  text(alert, "Quiet hours start (HH:mm)", "quietStart");
  text(alert, "Quiet hours end (HH:mm)", "quietEnd");
  auto integrations = section("Integrations");
  text(integrations, "MQTT broker", "mqttUrl")
      ->setPlaceholderText("mqtt://broker:1883 or mqtts://broker:8883");
  text(integrations, "MQTT username", "mqttUser");
  text(integrations, "MQTT password", "mqttPass", true);
  text(integrations, "Discovery prefix", "haDiscoveryPrefix");
  text(integrations, "Home Assistant URL", "haUrl");
  text(integrations, "Home Assistant token", "haToken", true);
  text(integrations, "CWOP station ID", "cwopId");
  text(integrations, "Weather Underground ID", "wuId");
  text(integrations, "Weather Underground key", "wuKey", true);
  text(integrations, "PWSweather ID", "pwsId");
  text(integrations, "PWSweather key", "pwsKey", true);
  auto data = section("Archive & sharing");
  auto backupButton = new QPushButton("Back up…");
  connect(backupButton, &QPushButton::clicked, this, &Window::backup);
  data->addRow(backupButton);
  auto restoreButton = new QPushButton("Restore…");
  connect(restoreButton, &QPushButton::clicked, this, &Window::restore);
  data->addRow(restoreButton);
  auto exportButton = new QPushButton("Export CSV…");
  connect(exportButton, &QPushButton::clicked, this, &Window::exportCsv);
  data->addRow(exportButton);
  auto importButton = new QPushButton("Import JSONL…");
  data->addRow(importButton);
  connect(importButton, &QPushButton::clicked, this, [this] {
    auto folder = QFileDialog::getExistingDirectory(
        this, "Choose the old station’s log folder");
    if (folder.isEmpty())
      return;
    if (QMessageBox::question(
            this, "Import station archive",
            "Import these observations into the configured station’s archive? "
            "Only use files from this station. Original files are kept.") !=
        QMessageBox::Yes)
      return;
    QString error;
    int count = services.archive.importJsonl(
        folder, fingerprint(services.config.settings()), &error);
    settingsMessage->setText(
        count < 0 ? error
                  : QString::number(count) +
                        " readings imported. Original files kept.");
    if (count >= 0) {
      services.resetRuntime();
      services.refresh();
    }
  });
  auto pair = new QPushButton("Pair screen");
  data->addRow(pair);
  connect(pair, &QPushButton::clicked, this, [this] {
    auto result = server.pairCode();
    QMessageBox::information(
        this, "Pair screen",
        "Pairing code: " + result.value("code").toString() +
            "\nValid for 10 minutes. Open the home network dashboard on the "
            "other screen and choose Join my home.");
  });
  for (const auto &path : QList<QPair<QString, QString>>{
           {"Archive file", services.archive.path},
           {"Settings file", services.config.path}}) {
    auto value = new QLineEdit(path.second);
    value->setReadOnly(true);
    value->setAccessibleName(path.first);
    data->addRow(path.first, value);
  }
  data->addRow(
      label("LAN port: " + QString::number(server.serverPort()), "muted"));
  data->addRow(
      label("Backups include credentials. Keep them private. Restoring creates "
            "a recovery backup first. The original Rust app’s files are kept "
            "separate from this native preview.",
            "muted"));
  auto updates = section("App updates");
  updates->addRow(label("Installed: " STORMDESK_RELEASE_VERSION, "muted"));
  auto automatic = new QCheckBox("Daily checks");
  automatic->setObjectName("automaticUpdates");
  automatic->setAccessibleName("Check for app updates automatically");
  automatic->setToolTip("Check official GitHub releases once a day");
  automatic->setChecked(local.value("automaticUpdates", true).toBool());
  connect(automatic, &QCheckBox::toggled, this, [this](bool enabled) {
    local.setValue("automaticUpdates", enabled);
  });
  updates->addRow(automatic);
  auto previews = new QCheckBox("Preview builds");
  previews->setObjectName("previewUpdates");
  previews->setChecked(local.value("previewUpdates",
                                  QString(STORMDESK_RELEASE_VERSION).contains('-')).toBool());
  connect(previews, &QCheckBox::toggled, this, [this](bool enabled) {
    local.setValue("previewUpdates", enabled);
    checkUpdates(true);
  });
  updates->addRow(previews);
  updateStatus = label("Checks the official GitHub releases once a day. "
                       "Downloads and installation stay under your control.", "muted");
  updateStatus->setObjectName("appUpdateStatus");
  updates->addRow(updateStatus);
  updateCheck = new QPushButton("Check now");
  updateCheck->setObjectName("checkUpdates");
  connect(updateCheck, &QPushButton::clicked, this, [this] { checkUpdates(true); });
  updates->addRow(updateCheck);
  updateDownload = new QPushButton("Download…");
  updateDownload->setObjectName("downloadUpdate");
  updateDownload->hide();
  connect(updateDownload, &QPushButton::clicked, this, [this] {
    if (!updateUrl.isEmpty())
      QDesktopServices::openUrl(updateUrl);
  });
  updates->addRow(updateDownload);
  settingsMessage = label({}, "notice");
  layout->addWidget(settingsMessage);
  auto save = new QPushButton("Save changes");
  save->setProperty("primary", true);
  connect(save, &QPushButton::clicked, this, &Window::saveSettings);
  layout->addWidget(save);
  loadSettings();
  return scrollView(page);
}
void Window::checkUpdates(bool manual) {
  const auto now = QDateTime::currentSecsSinceEpoch();
  const auto last = local.value("lastUpdateCheck", 0).toLongLong();
  if (updateBusy || (!manual &&
      (!local.value("automaticUpdates", true).toBool() ||
       (last <= now && now - last < 86400))))
    return;
  updateBusy = true;
  updateCheck->setEnabled(false);
  updateStatus->setText("Checking official StormDesk releases…");
  const bool previews = local.value("previewUpdates",
      QString(STORMDESK_RELEASE_VERSION).contains('-')).toBool();
  QPointer<Window> guard(this);
  services.request(QUrl("https://api.github.com/repos/d4vid87/stormdesk/releases?per_page=30"),
      [guard, previews, manual](QJsonDocument doc, QString error) {
    if (!guard)
      return;
    guard->updateBusy = false;
    guard->updateCheck->setEnabled(true);
    if (previews != guard->local.value("previewUpdates",
        QString(STORMDESK_RELEASE_VERSION).contains('-')).toBool()) {
      guard->checkUpdates(true);
      return;
    }
    if (!error.isEmpty() || !doc.isArray()) {
      guard->updateStatus->setText("Could not check for updates. Try again later. " + error);
      return;
    }
    guard->local.setValue("lastUpdateCheck", QDateTime::currentSecsSinceEpoch());
    const auto offer = nativeUpdate(doc.array(), STORMDESK_RELEASE_VERSION, previews);
    guard->updateUrl = QUrl(offer.value("url").toString());
    guard->updateDownload->setVisible(!offer.isEmpty());
    if (offer.isEmpty()) {
      guard->updateStatus->setText("No newer release in the selected channel. Checked " +
          QDateTime::currentDateTime().toString("h:mm AP") + ".");
      return;
    }
    const auto version = offer.value("version").toString();
    guard->updateStatus->setText("StormDesk " + version + " is available. "
        "Back up your archive before installing.");
    if (!manual && guard->local.value("notifiedUpdate").toString() != version) {
      guard->local.setValue("notifiedUpdate", version);
      guard->notify("StormDesk update available", version +
          " is ready. Open Settings → App updates to download.");
    }
  });
}
void Window::addRule(const QJsonObject &rule) {
  const int row = ruleTable->rowCount();
  ruleTable->insertRow(row);
  auto metric = new QComboBox;
  const QList<QPair<QString, QString>> metrics{
      {"Temperature", "temp"},
      {"Dew point", "dew"},
      {"Wind gust", "gust"},
      {"Wind", "wind"},
      {"Humidity", "rh"},
      {"Rain rate", "rain"},
      {"UV index", "uv"},
      {"Strikes / 3 h", "strikes3h"},
      {"Pressure change / 3 h", "press3h"},
      {"Temperature change / 1 h", "temp1h"},
      {"Pressure change / 1 h", "press1h"},
      {"Humidity change / 1 h", "rh1h"},
      {"Low / 18 h", "low18h"},
      {"Rain / 6 h", "rain6h"},
      {"Gust / 24 h", "gust24h"},
      {"Tomorrow high", "hiTomorrow"}};
  for (const auto &m : metrics)
    metric->addItem(m.first, m.second);
  auto selected = metric->findData(rule.value("metric").toString());
  if (selected < 0) {
    metric->addItem("Unknown measurement", rule.value("metric").toString());
    selected = metric->count() - 1;
  }
  metric->setCurrentIndex(selected);
  metric->setProperty("savedRule", rule);
  metric->setAccessibleName("Rule measurement");
  auto op = new QComboBox;
  op->addItems({">", "<"});
  op->setCurrentText(rule.value("op").toString(">"));
  op->setAccessibleName("Rule comparison");
  auto value = new QDoubleSpinBox;
  value->setRange(-10000, 100000);
  value->setDecimals(2);
  value->setValue(rule.value("value").toDouble());
  value->setAccessibleName("Rule threshold");
  auto duration = new QDoubleSpinBox;
  duration->setRange(0, 1440);
  duration->setDecimals(2);
  duration->setValue(rule.value("durMin").toDouble());
  duration->setAccessibleName("Rule duration in minutes");
  connect(value, &QDoubleSpinBox::valueChanged, value,
          [value] { value->setProperty("edited", true); });
  connect(duration, &QDoubleSpinBox::valueChanged, duration,
          [duration] { duration->setProperty("edited", true); });
  ruleTable->setCellWidget(row, 0, metric);
  ruleTable->setCellWidget(row, 1, op);
  ruleTable->setCellWidget(row, 2, value);
  ruleTable->setCellWidget(row, 3, duration);
  auto compound = new QPushButton(
      rule.value("metric2").toString().isEmpty() ? "Add AND…" : "Edit AND…");
  ruleTable->setCellWidget(row, 4, compound);
  connect(
      compound, &QPushButton::clicked, this, [this, metric, compound, metrics] {
        auto saved = metric->property("savedRule").toJsonObject();
        QDialog dialog(this);
        dialog.setWindowTitle("Second alert condition");
        auto layout = new QVBoxLayout(&dialog);
        auto enabled = new QCheckBox("Require both conditions");
        enabled->setChecked(!saved.value("metric2").toString().isEmpty());
        layout->addWidget(enabled);
        auto field = new QComboBox;
        for (const auto &m : metrics)
          field->addItem(m.first, m.second);
        field->setCurrentIndex(
            std::max(0, field->findData(saved.value("metric2").toString())));
        layout->addWidget(field);
        auto comparison = new QComboBox;
        comparison->addItems({">", "<"});
        comparison->setCurrentText(saved.value("op2").toString(">"));
        layout->addWidget(comparison);
        auto threshold = new QDoubleSpinBox;
        threshold->setDecimals(4);
        threshold->setRange(-10000, 100000);
        threshold->setValue(saved.value("value2").toDouble());
        layout->addWidget(threshold);
        layout->addWidget(label("Threshold uses your selected display units, "
                                "just like the first condition."));
        auto buttons = new QDialogButtonBox(QDialogButtonBox::Ok |
                                            QDialogButtonBox::Cancel);
        layout->addWidget(buttons);
        connect(buttons, &QDialogButtonBox::accepted, &dialog,
                &QDialog::accept);
        connect(buttons, &QDialogButtonBox::rejected, &dialog,
                &QDialog::reject);
        if (dialog.exec() != QDialog::Accepted)
          return;
        if (enabled->isChecked()) {
          saved["metric2"] = field->currentData().toString();
          saved["op2"] = comparison->currentText();
          saved["value2"] = threshold->value();
        } else {
          saved.remove("metric2");
          saved.remove("op2");
          saved.remove("value2");
        }
        metric->setProperty("savedRule", saved);
        compound->setText(enabled->isChecked() ? "Edit AND…" : "Add AND…");
      });
}
void Window::loadSettings() {
  settingsRevision = services.config.value.value("_rev").toDouble();
  auto s = services.config.settings();
  if (ruleTable) {
    ruleTable->setRowCount(0);
    for (const auto &rule : s.value("rules").toArray())
      addRule(rule.toObject());
  }
  for (auto it = editors.begin(); it != editors.end(); ++it) {
    auto v = s.value(it.key());
    if (auto e = qobject_cast<QLineEdit *>(it.value()))
      e->setText(v.toVariant().toString());
    if (auto e = qobject_cast<QDoubleSpinBox *>(it.value())) {
      e->setValue(v.toVariant().toDouble());
      e->setProperty("locationEdited", false);
    }
    if (auto e = qobject_cast<QComboBox *>(it.value())) {
      auto i = e->findData(it.key() == "stationSource"
                               ? services.config.stationSource()
                               : v.toString());
      e->setCurrentIndex(std::max(0, i));
    }
    if (auto e = qobject_cast<QCheckBox *>(it.value()))
      e->setChecked(v.toBool(it.key() == "nativeNotifications" ||
                             it.key() == "pushOfficial" ||
                             it.key() == "nativeMotion"));
  }
}
void Window::saveSettings() {
  if (settingsRevision != services.config.value.value("_rev").toDouble()) {
    settingsMessage->setText(
        "Settings changed on another screen. Reopen Settings before saving.");
    return;
  }
  auto next = services.config.value;
  auto s = services.config.settings();
  for (auto it = editors.begin(); it != editors.end(); ++it) {
    if (auto e = qobject_cast<QLineEdit *>(it.value()))
      s[it.key()] = e->echoMode() == QLineEdit::Password ? e->text()
                                                         : e->text().trimmed();
    if (auto e = qobject_cast<QDoubleSpinBox *>(it.value()))
      if (e->property("locationEdited").toBool() || !s.contains(it.key()))
        s[it.key()] = e->value();
    if (auto e = qobject_cast<QComboBox *>(it.value()))
      s[it.key()] = e->currentData().toString();
    if (auto e = qobject_cast<QCheckBox *>(it.value()))
      s[it.key()] = e->isChecked();
  }
  for (auto it = setupChanges.begin(); it != setupChanges.end(); ++it)
    s[it.key()] = it.value();
  if (!setupChanges.contains("lat") &&
      (services.config.settings().value("lat").isNull() ||
       !services.config.settings().contains("lat")) &&
      !editors.value("lat")->property("locationEdited").toBool() &&
      !editors.value("lon")->property("locationEdited").toBool()) {
    s.remove("lat");
    s.remove("lon");
  }
  s["nativeForecastOnly"] = s.value("stationSource").toString().isEmpty();
  QJsonArray rules;
  for (int i = 0; i < ruleTable->rowCount(); ++i) {
    auto metric = qobject_cast<QComboBox *>(ruleTable->cellWidget(i, 0));
    auto op = qobject_cast<QComboBox *>(ruleTable->cellWidget(i, 1));
    auto rule = metric->property("savedRule").toJsonObject();
    rule["metric"] = metric->currentData().toString();
    rule["op"] = op->currentText();
    auto value = qobject_cast<QDoubleSpinBox *>(ruleTable->cellWidget(i, 2));
    auto duration = qobject_cast<QDoubleSpinBox *>(ruleTable->cellWidget(i, 3));
    if (value->property("edited").toBool())
      rule["value"] = value->value();
    if (duration->property("edited").toBool())
      rule["durMin"] = duration->value();
    rules.append(rule);
  }
  s["rules"] = rules;
  auto elevation =
      qobject_cast<QLineEdit *>(editors.value("elevationM"))->text().trimmed();
  bool validElevation = false;
  const double metres = elevation.toDouble(&validElevation);
  if (!elevation.isEmpty() && (!validElevation || !std::isfinite(metres) ||
                               metres < -500 || metres > 10000)) {
    settingsMessage->setText(
        "Elevation must be between −500 and 10,000 metres.");
    return;
  }
  if (!setupChanges.contains("elevationM"))
    s["elevationM"] = elevation.isEmpty() ? QJsonValue() : QJsonValue(metres);
  for (const auto &key : {"quietStart", "quietEnd"}) {
    const auto text = s.value(key).toString();
    if (!text.isEmpty() && !QTime::fromString(text, "HH:mm").isValid()) {
      settingsMessage->setText("Quiet hours must use HH:mm.");
      return;
    }
  }
  if (!s.value("stationSource").toString().isEmpty() &&
      fingerprint(s) == "none") {
    settingsMessage->setText("Enter a station ID, Tempest device ID, or Davis "
                             "host before connecting a station.");
    return;
  }
  const auto bound = services.archive.meta("station_fingerprint"),
             incoming = fingerprint(s);
  next["settings"] = s;
  next["_rev"] = next.value("_rev").toDouble() + 1;
  QString error;
  if (!s.value("accent").toString().isEmpty() &&
      !QColor(s.value("accent").toString()).isValid()) {
    settingsMessage->setText(
        "Enter a color name or a #rrggbb color, or leave Accent color blank.");
    return;
  }
  QString recovery;
  if (!bound.isEmpty() && incoming != "none" && bound != incoming) {
    if (QMessageBox::question(
            this, "Replace station archive",
            "The selected station is different. Save a recovery backup and "
            "begin a new archive for this station?") != QMessageBox::Yes)
      return;
    recovery = QFileInfo(services.archive.path)
                   .dir()
                   .filePath("pre-station-replacement-" +
                             QDateTime::currentDateTime().toString(
                                 "yyyyMMdd-HHmmss-zzz") +
                             ".wdbak");
    if (!services.archive.backup(recovery, services.config.value, &error) ||
        !services.archive.clear(incoming, &error)) {
      settingsMessage->setText(error);
      return;
    }
  }
  if (!services.config.save(next, &error)) {
    if (!recovery.isEmpty()) {
      QString restoreError;
      services.archive.restore(recovery, &restoreError);
      if (!restoreError.isEmpty())
        error += "\n" + restoreError + "\nRecovery: " + recovery;
    }
    settingsMessage->setText(error);
    return;
  }
  if (!recovery.isEmpty())
    services.resetRuntime();
  settingsRevision = services.config.value.value("_rev").toDouble();
  settingsMessage->setText("Changes saved.");
  services.refresh();
  applyTheme();
  render();
}
void Window::applyScale(double value) {
  scaleFactor = uiScale(value);
  local.setValue("scale", scaleFactor);
  auto index = scaleBox->findData(scaleFactor);
  if (index < 0) {
    scaleBox->addItem(QString::number(qRound(scaleFactor * 100)) + "%",
                      scaleFactor);
    index = scaleBox->count() - 1;
  }
  scaleBox->setCurrentIndex(index);
  // Qt already applies the display pixel ratio; use logical pixels to avoid
  // scaling fonts twice.
  auto font = QApplication::font();
  font.setPixelSize(qRound(13 * scaleFactor));
  QApplication::setFont(font);
  for (auto face : faces)
    face->setScale(scaleFactor * .48);
  weatherGlyph->setScale(scaleFactor * .8);
  sunCycle->setScale(scaleFactor);
  radarStage->setScale(scaleFactor);
  for (auto radar : findChildren<Radar *>())
    radar->setScale(scaleFactor);
  applyTheme();
  arrange();
}
void Window::applyTheme() {
  auto theme = services.config.text("theme", "graphite");
  if (theme == "auto") {
    const bool day =
        services.forecast.value("current").toObject().value("is_day").toInt(
            QTime::currentTime().hour() >= 7 &&
            QTime::currentTime().hour() < 19) != 0;
    setProperty("nativeDay", day);
    theme = day ? "light" : "graphite";
  }
  const bool light = theme == "light";
  const QHash<QString, QString> accents{
      {"graphite", "#cad9eb"}, {"violet", "#c6a9ff"}, {"carbon", "#c4ec78"},
      {"abyss", "#66c9ed"},    {"spruce", "#77d4b2"}, {"oxblood", "#ef9bab"},
      {"copper", "#eab38a"},   {"indigo", "#aaa5ff"}, {"petrol", "#e2e480"},
      {"espresso", "#d8be8a"}};
  const QColor customAccent(services.config.text("accent"));
  const QString accent =
      customAccent.isValid()
          ? customAccent.name()
          : accents.value(theme, light ? "#245185" : "#bed2ee");
  QString background =
      light ? "#eef2f6"
            : (theme == "dark" || theme == "contrast" ? "#000000" : "#10131a");
  QString panel = light ? "#ffffff" : (theme == "dark" ? "#06080b" : "#191e28");
  QString foreground = light ? "#182332" : "#eef3fb",
          muted = light ? "#506177" : "#a6b2c5",
          border =
              light ? "#cbd4df" : (theme == "contrast" ? "#ffffff" : "#30394a");
  QPalette palette;
  palette.setColor(QPalette::Window, QColor(background));
  palette.setColor(QPalette::WindowText, QColor(foreground));
  palette.setColor(QPalette::Base, QColor(panel));
  palette.setColor(QPalette::AlternateBase, QColor(background));
  palette.setColor(QPalette::Text, QColor(foreground));
  palette.setColor(QPalette::Button, QColor(panel));
  palette.setColor(QPalette::ButtonText, QColor(foreground));
  palette.setColor(QPalette::Highlight, QColor(accent));
  palette.setColor(QPalette::HighlightedText, QColor(background));
  qApp->setPalette(palette);
  auto px = [this](int n) { return QString::number(qRound(n * scaleFactor)); };
  qApp->setStyleSheet(
      "QLabel[kind=brand],QLabel[kind=temperature],QLabel[kind=metric],QLabel["
      "kind=subtitle] {font-family:'Barlow Semi Condensed Medium';} QWidget { "
      "color:" +
      foreground + "; } QMainWindow,QScrollArea,QStackedWidget {background:" +
      background + ";} QScrollArea>QWidget>QWidget {background:" + background +
      ";}"
      "QFrame#card {background:" +
      panel + ";border:1px solid " + border + ";border-radius:" + px(7) +
      "px;} QFrame#card QLabel {background:transparent;border:none;}"
      "QLabel[kind=clock] {font-family:'Barlow Semi Condensed "
      "Medium';font-size:" +
      px(34) +
      "px;font-weight:600;}"
      "QLabel[kind=brand] {font-size:" +
      px(21) +
      "px;font-weight:800;letter-spacing:2px;} QLabel[kind=eyebrow] {color:" +
      muted + ";font-size:" + px(11) +
      "px;font-weight:600;}"
      "QLabel[kind=muted] {color:" +
      muted + ";} QLabel[kind=metric] {font-size:" + px(32) +
      "px;font-family:'Barlow Semi Condensed Medium','Arial Narrow','DejaVu "
      "Sans "
      "Condensed';font-weight:500;} QLabel[kind=temperature] {font-size:" +
      px(64) +
      "px;font-weight:600;}"
      "QLabel[kind=subtitle] {font-size:" +
      px(24) + "px;font-weight:600;} QLabel[kind=notice] {padding:" + px(12) +
      "px;border:1px solid " + border + ";border-radius:8px;color:" + accent +
      ";}"
      "QToolButton "
      "{background:transparent;border:0;padding:2px;min-height:24px;}"
      "QFrame#card[gaugeDrop=true] {border:2px solid " +
      accent +
      ";}"
      "QPushButton,QComboBox,QLineEdit,QDoubleSpinBox {background:" +
      panel + ";border:1px solid " + border + ";border-radius:6px;padding:" +
      px(8) + "px " + px(12) + "px;min-height:" + px(20) +
      "px;}"
      "QPushButton:hover,QPushButton:checked {border-color:" +
      accent + ";color:" + accent +
      ";} QPushButton:focus,QComboBox:focus,QLineEdit:focus {border:2px "
      "solid " +
      accent + ";} QPushButton[primary=true] {background:" + accent +
      ";color:" + background +
      ";font-weight:600;}"
      "QTableWidget {background:" +
      panel + ";gridline-color:" + border + ";border:1px solid " + border +
      ";} QHeaderView::section {background:" + background +
      ";padding:" + px(8) +
      "px;border:none;}"
      "QTabWidget::pane {border:1px solid " +
      border + ";} QTabBar::tab {padding:" + px(10) + "px;background:" + panel +
      ";} QTabBar::tab:selected {color:" + accent +
      ";} QToolTip {color:" + foreground + ";background:" + panel +
      ";}"
      "QScrollArea#instrumentShelf QLabel[kind=metric],"
      "QScrollArea#instrumentShelf QLabel[kind=temperature] {font-size:" +
      px(23) +
      "px;}"
      "QScrollArea#instrumentShelf QLabel[kind=subtitle] {font-size:" +
      px(15) +
      "px;}"
      "QScrollArea#instrumentShelf QLabel[kind=muted],"
      "QScrollArea#instrumentShelf QLabel[kind=eyebrow] {font-size:" +
      px(11) +
      "px;}"
      "QScrollArea#instrumentShelf QPushButton {padding:" +
      px(4) + "px " + px(8) +
      "px;}"
      "QScrollArea#instrumentShelf {border:1px solid " +
      border +
      ";border-radius:8px;}"
      "QScrollArea#instrumentShelf>QWidget>QWidget {background:" +
      background + ";}");
  styleAlerts();
}
void Window::styleAlerts() {
  if (!alerts)
    return;
  const QColor event(alerts->property("eventColor").toString());
  if (!event.isValid()) {
    alerts->setStyleSheet({});
    return;
  }
  const auto base = palette().color(QPalette::Window);
  QColor tint(qRound(base.red() * .92 + event.red() * .08),
              qRound(base.green() * .92 + event.green() * .08),
              qRound(base.blue() * .92 + event.blue() * .08));
  alerts->setStyleSheet(
      QString("background:%1;color:%2;border:1px solid %3;border-left:4px "
              "solid %3;border-radius:6px;padding:8px;")
          .arg(tint.name(), palette().color(QPalette::WindowText).name(),
               event.name()));
}
void Window::arrange() {
  if (!metrics || !body)
    return;
  const double available = (width() - 60) / scaleFactor;
  const bool compact = available < 1050;
  setupButton->setText(available < 260 ? "Connect\nstation"
                                       : "Connect station");
  if (auto import = findChild<QPushButton *>("importTempest"))
    import->setText(available < 260 ? "Import\nTempest" : "Import Tempest");
  clock->setVisible(!compact);
  clockDate->setVisible(!compact);
  if (pages)
    for (auto form : pages->findChildren<QFormLayout *>()) {
      form->setRowWrapPolicy(compact ? QFormLayout::WrapAllRows
                                     : QFormLayout::WrapLongRows);
      for (int row = 0; row < form->rowCount(); ++row)
        if (auto item = form->itemAt(row, QFormLayout::LabelRole))
          if (auto label = qobject_cast<QLabel *>(item->widget()))
            label->setWordWrap(true);
    }
  for (auto button : navButtons)
    button->setVisible(!compact);
  pageSelect->setVisible(compact);
  navigation->removeWidget(scaleBox);
  navigation->removeWidget(refreshButton);
  navigation->removeWidget(pageSelect);
  navigation->setColumnStretch(5, compact ? 0 : 1);
  if (compact) {
    navigation->addWidget(pageSelect, 0, 0, 1, 2);
    navigation->addWidget(refreshButton, 1, 0);
    navigation->addWidget(scaleBox, 1, 1);
  } else {
    navigation->addWidget(refreshButton, 0, 6);
    navigation->addWidget(scaleBox, 0, 7);
  }
  const int columns = available >= 1200  ? 8
                      : available >= 650 ? 4
                      : available >= 360 ? 2
                                         : 1;
  const auto dashboard =
      services.config.settings().value("nativeDashboard").toObject();
  const auto hidden = dashboard.value("hidden").toArray(),
             order = dashboard.value("order").toArray();
  const QStringList names = {"Rain today",         "Lightning", "Wind",
                             "Heat stress / WBGT", "UV index",  "Pressure",
                             "Humidity",           "Dew point"};
  QList<int> indices;
  const auto savedOrder = local.value("gaugeOrder").toStringList();
  const auto preferred =
      savedOrder.isEmpty() ? order : QJsonArray::fromStringList(savedOrder);
  for (const auto &v : preferred) {
    int i = names.indexOf(v.toString());
    if (i >= 0 && !indices.contains(i))
      indices << i;
  }
  for (int i = 0; i < metricCards.size(); ++i)
    if (!indices.contains(i))
      indices << i;
  gaugeOrder = indices;
  for (auto widget : metricCards)
    metrics->removeWidget(widget);
  int cell = 0;
  for (int i : indices) {
    auto widget = metricCards[i];
    widget->setVisible(!hidden.contains(names[i]));
    if (!widget->isHidden()) {
      metrics->addWidget(widget, cell / columns, cell % columns);
      ++cell;
    }
  }
  for (int col = 0; col < 8; ++col)
    metrics->setColumnStretch(col, col < std::min(columns, cell) ? 1 : 0);
  double density = std::clamp(dashboard.value("density").toDouble(1), .6, 1.5);
  metrics->setSpacing(qRound(6 * scaleFactor * density));
  body->setSpacing(qRound(6 * scaleFactor * density));
  if (!currentCard || !contextCard || !dashboardRadarCard)
    return;
  auto detail = currentCard->findChild<QLabel *>("conditionsDetail");
  for (auto widget :
       QList<QWidget *>{heroHeading, heroSource, detail, heroTemperature,
                        heroCondition, weatherGlyph})
    heroLayout->removeWidget(widget);
  heroHeading->show();
  heroHeading->setProperty("kind", "eyebrow");
  heroLayout->addWidget(heroHeading, 0, 0);
  heroLayout->addWidget(heroTemperature, 1, 0);
  heroLayout->addWidget(weatherGlyph, 0, 1, 3, 1);
  heroLayout->addWidget(heroCondition, 2, 0);
  heroLayout->addWidget(heroSource, 3, 0, 1, 2);
  heroLayout->addWidget(detail, 4, 0, 1, 2);
  for (auto widget : {currentCard, static_cast<QWidget *>(sunCycle)})
    body->removeWidget(widget);
  contextCard->findChild<QHBoxLayout *>("contextActions")
      ->setDirection(available < 650 ? QBoxLayout::TopToBottom
                                     : QBoxLayout::LeftToRight);
  const int contextColumns = available >= 850 ? 2 : 1;
  body->addWidget(currentCard, 0, 0);
  body->addWidget(sunCycle, 1 / contextColumns, 1 % contextColumns);
  for (int col = 0; col < 3; ++col)
    body->setColumnStretch(col, col < contextColumns ? (col == 1 ? 2 : 1) : 0);
  dashboardRadarCard->setVisible(!hidden.contains("Local radar"));
  currentCard->setVisible(!hidden.contains("Current conditions"));
}
void Window::moveGauge(int source, int target) {
  const int from = gaugeOrder.indexOf(source), to = gaugeOrder.indexOf(target);
  if (from < 0 || to < 0 || from == to)
    return;
  gaugeOrder.move(from, to);
  const QStringList names = {"Rain today",         "Lightning", "Wind",
                             "Heat stress / WBGT", "UV index",  "Pressure",
                             "Humidity",           "Dew point"};
  QStringList saved;
  for (int index : gaugeOrder)
    saved << names[index];
  local.setValue("gaugeOrder", saved);
  arrange();
  auto handle =
      findChild<QToolButton *>("gaugeHandle" + QString::number(source));
  handle->setAccessibleDescription(
      QString("Position %1 of 8. Alt + Left / Right moves this gauge.")
          .arg(to + 1));
  handle->setFocus();
}
bool Window::eventFilter(QObject *watched, QEvent *event) {
  auto handle = qobject_cast<QToolButton *>(watched);
  if (!handle || !handle->property("gaugeIndex").isValid())
    return QMainWindow::eventFilter(watched, event);
  const int index = handle->property("gaugeIndex").toInt();
  auto clear = [this] {
    movingGauge = -1;
    for (auto card : metricCards) {
      card->setProperty("gaugeDrop", false);
      card->style()->unpolish(card);
      card->style()->polish(card);
      card->update();
    }
  };
  if (event->type() == QEvent::KeyPress) {
    auto key = static_cast<QKeyEvent *>(event);
    if (key->key() == Qt::Key_Escape && movingGauge >= 0) {
      clear();
      handle->setDown(false);
      return true;
    }
    if (key->modifiers().testFlag(Qt::AltModifier) &&
        (key->key() == Qt::Key_Left || key->key() == Qt::Key_Right)) {
      int target =
          gaugeOrder.indexOf(index) + (key->key() == Qt::Key_Left ? -1 : 1);
      if (target >= 0 && target < gaugeOrder.size())
        moveGauge(index, gaugeOrder[target]);
      event->accept();
      return true;
    }
  }
  const bool touch = event->type() == QEvent::TouchBegin ||
                     event->type() == QEvent::TouchUpdate ||
                     event->type() == QEvent::TouchEnd;
  const bool mouse = event->type() == QEvent::MouseButtonPress ||
                     event->type() == QEvent::MouseMove ||
                     event->type() == QEvent::MouseButtonRelease;
  if (event->type() == QEvent::TouchCancel) {
    clear();
    return true;
  }
  if (!touch && !mouse)
    return QMainWindow::eventFilter(watched, event);
  QPoint point;
  if (touch) {
    const auto points = static_cast<QTouchEvent *>(event)->points();
    if (points.isEmpty())
      return true;
    point = points.first().globalPosition().toPoint();
  } else {
    auto mouseEvent = static_cast<QMouseEvent *>(event);
    if (event->type() != QEvent::MouseMove &&
        mouseEvent->button() != Qt::LeftButton)
      return false;
    point = mouseEvent->globalPosition().toPoint();
  }
  if (event->type() == QEvent::MouseButtonPress ||
      event->type() == QEvent::TouchBegin) {
    movingGauge = index;
    gaugeDragStart = point;
    gaugeDragged = false;
    handle->setFocus();
    if (!touch)
      return false;
  } else if (movingGauge == index) {
    gaugeDragged |= (point - gaugeDragStart).manhattanLength() >=
                    QApplication::startDragDistance();
    int target = -1;
    for (int i = 0; i < metricCards.size(); ++i) {
      auto card = metricCards[i];
      const bool hit = card->isVisible() &&
                       card->rect().contains(card->mapFromGlobal(point));
      if (hit)
        target = i;
      card->setProperty("gaugeDrop", gaugeDragged && hit && i != movingGauge);
      card->style()->unpolish(card);
      card->style()->polish(card);
      card->update();
    }
    if (event->type() == QEvent::MouseButtonRelease ||
        event->type() == QEvent::TouchEnd) {
      const int source = movingGauge;
      clear();
      handle->setDown(false);
      if (gaugeDragged && target >= 0)
        moveGauge(source, target);
    }
  }
  event->accept();
  return true;
}
void Window::resizeEvent(QResizeEvent *event) {
  QMainWindow::resizeEvent(event);
  arrange();
}
void Window::render() {
  if (services.config.text("theme") == "auto" &&
      property("nativeDay").toBool() !=
          (services.forecast.value("current").toObject().value("is_day").toInt(
               QTime::currentTime().hour() >= 7 &&
               QTime::currentTime().hour() < 19) != 0))
    applyTheme();
  const auto &f = services.forecast;
  const bool staleForecast =
      f.contains("_at") &&
      QDateTime::currentSecsSinceEpoch() - f.value("_at").toDouble() > 3600;
  const auto current =
      staleForecast ? QJsonObject() : f.value("current").toObject();
  const auto daily = f.value("daily").toObject();
  const auto obs = services.observation;
  bool fresh =
      obs[0] && QDateTime::currentSecsSinceEpoch() - *obs[0] <= 900 &&
      services.config.settings().value("activePlace").toString().isEmpty();
  bool metric = services.config.text("units") == "metric";
  auto value = [&](int index, const char *forecastKey = nullptr) -> QJsonValue {
    if (fresh && obs[index])
      return *obs[index];
    return forecastKey ? current.value(forecastKey) : QJsonValue();
  };
  const double tempFactor = metric ? 1 : 1.8, tempShift = metric ? 0 : 32;
  const auto windLabel = services.config.windUnit();
  const double windFactor = services.config.windFactor();
  location->setText(services.config.location().value("name").toString(
      "Your weather, at a glance"));
  heroTemperature->setText(number(value(7, "temperature_2m"),
                                  metric ? " °C" : " °F", 1, tempFactor,
                                  tempShift));
  heroCondition->setText(current.contains("weather_code")
                             ? condition(current.value("weather_code").toInt())
                             : "Waiting for weather");
  heroSource->setText(fresh && obs[7] ? "Station temperature · model sky"
                      : staleForecast ? "Forecast is stale · refresh needed"
                                      : "Open-Meteo · forecast estimate");
  auto detail = currentCard->findChild<QLabel *>("conditionsDetail");
  detail->setText(
      "Feels like " +
      number(fresh && obs[7] ? services.archive.current().value("feels_like")
                             : current.value("apparent_temperature"),
             metric ? " °C" : " °F", 1, tempFactor, tempShift) +
      "\nGusts " +
      number(value(3, "wind_gusts_10m"), " " + windLabel, 1, windFactor));
  auto rainToday = value(18), strikes = value(15);
  if (fresh) {
    QSqlQuery rain(services.archive.db);
    rain.prepare("SELECT SUM(rain) FROM obs WHERE ts>=?");
    rain.addBindValue(QDate::currentDate().startOfDay().toSecsSinceEpoch());
    if (!rainToday.isDouble() && rain.exec() && rain.next() &&
        !rain.value(0).isNull())
      rainToday = rain.value(0).toDouble();
    QSqlQuery lightning(services.archive.db);
    lightning.prepare("SELECT SUM(strikes) FROM obs WHERE ts>=?");
    lightning.addBindValue(QDateTime::currentSecsSinceEpoch() - 10800);
    if (lightning.exec() && lightning.next() && !lightning.value(0).isNull())
      strikes = lightning.value(0).toDouble();
  }
  metricValues[0]->setText(number(rainToday, metric ? " mm" : " in",
                                  metric ? 1 : 2, metric ? 1 : 1 / 25.4));
  metricValues[1]->setText(number(strikes, " strikes", 0));
  metricValues[2]->setText(
      number(value(2, "wind_speed_10m"), " " + windLabel, 1, windFactor));
  const auto temperature = value(7, "temperature_2m"),
             humidity = value(8, "relative_humidity_2m");
  const auto heat =
      temperature.isDouble() && humidity.isDouble()
          ? wbgt(temperature.toDouble(), humidity.toDouble(),
                 value(11).toDouble(), value(2, "wind_speed_10m").toDouble())
          : std::nullopt;
  metricValues[3]->setText(number(heat ? QJsonValue(*heat) : QJsonValue(),
                                  metric ? " °C" : " °F", 1, tempFactor,
                                  tempShift));
  const auto uv = daily.value("uv_index_max").toArray();
  metricValues[4]->setText(number(fresh && obs[10]
                                      ? QJsonValue(*obs[10])
                                      : (!uv.isEmpty() ? uv[0] : QJsonValue()),
                                  "", 1));
  auto pressure = current.value("pressure_msl");
  auto elevation = services.config.settings().value("elevationM");
  if (!elevation.isDouble())
    elevation = f.value("elevation");
  const bool stationPressure = fresh && obs[6] && elevation.isDouble();
  if (stationPressure) {
    double metres = elevation.toDouble(),
           c = value(7, "temperature_2m").toDouble(15);
    pressure =
        *obs[6] *
        std::pow(1 - (.0065 * metres) / (c + .0065 * metres + 273.15), -5.257);
  }
  metricValues[5]->setText(number(pressure, metric ? " hPa" : " inHg",
                                  metric ? 1 : 2, metric ? 1 : 1 / 33.8639));
  metricValues[6]->setText(number(value(8, "relative_humidity_2m"), "%", 0));
  const auto dew = temperature.isDouble() && humidity.isDouble()
                       ? dewPoint(temperature.toDouble(), humidity.toDouble())
                       : std::nullopt;
  metricValues[7]->setText(number(dew ? QJsonValue(*dew) : QJsonValue(),
                                  metric ? " °C" : " °F", 1, tempFactor,
                                  tempShift));
  for (int i = 0; i < 7; ++i) {
    const int indexes[] = {18, 15, 2, 7, 10, 6, 8};
    const bool measured =
        i == 5 ? stationPressure : fresh && obs[indexes[i]].has_value();
    const bool available = metricValues[i]->text() != "—";
    metricSources[i]->setText(!available           ? "Unavailable"
                              : i == 3             ? "Estimated heat stress"
                              : i == 5 && measured ? "Station · sea level"
                              : measured           ? "Station measurement"
                              : i == 4             ? "Forecast daily maximum"
                                                   : "Forecast estimate");
    if (available && i == 0 && !obs[18])
      metricSources[i]->setText("Archive · today");
    if (available && i == 1)
      metricSources[i]->setText("Station · last 3 hours");
    if (available && i == 3 && !value(11).isDouble())
      metricSources[i]->setText("Shade estimate");
    metricValues[i]->setToolTip(metricSources[i]->text());
  }
  metricSources[7]->setText(!dew ? "Unavailable"
                            : fresh && obs[7] && obs[8]
                                ? "Calculated from station readings"
                                : "Calculated from forecast estimates");
  metricValues[7]->setToolTip(metricSources[7]->text());
  const std::array<QJsonValue, 8> readings{
      rainToday,
      strikes,
      value(2, "wind_speed_10m"),
      heat ? QJsonValue(*heat) : QJsonValue(),
      fresh && obs[10] ? QJsonValue(*obs[10])
                       : (!uv.isEmpty() ? uv[0] : QJsonValue()),
      pressure,
      humidity,
      dew ? QJsonValue(*dew) : QJsonValue()};
  for (int i = 0; i < 8; ++i) {
    faces[i]->setReading(
        readings[i].isDouble() ? std::optional<double>(readings[i].toDouble())
                               : std::nullopt,
        value(4, "wind_direction_10m")
            .toDouble(std::numeric_limits<double>::quiet_NaN()));
    faces[i]->setAccessibleDescription(metricValues[i]->text() + " · " +
                                       metricSources[i]->text());
  }
  const bool motion =
      services.config.settings().value("nativeMotion").toBool(true);
  weatherGlyph->setWeather(
      current.value("weather_code").isDouble()
          ? std::optional<int>(current.value("weather_code").toInt())
          : std::nullopt,
      current.value("is_day").toInt(1) != 0, motion);
  weatherGlyph->setAccessibleDescription(heroCondition->text());
  const auto rises = daily.value("sunrise").toArray();
  const auto sets = daily.value("sunset").toArray();
  const auto dates = daily.value("time").toArray();
  const int offset = f.value("utc_offset_seconds").toInt();
  const auto today =
      QDateTime::currentDateTimeUtc().toOffsetFromUtc(offset).date();
  qint64 rise = 0, set = 0;
  for (int i = 0; i < dates.size(); ++i)
    if (QDateTime::fromSecsSinceEpoch(qint64(dates[i].toDouble()))
            .toOffsetFromUtc(offset)
            .date() == today) {
      rise = i < rises.size() ? qint64(rises[i].toDouble()) : 0;
      set = i < sets.size() ? qint64(sets[i].toDouble()) : 0;
      break;
    }
  qint64 nextRise = 0;
  for (const auto &value : rises)
    if (value.toDouble() > QDateTime::currentSecsSinceEpoch() &&
        (!nextRise || value.toDouble() < nextRise))
      nextRise = qint64(value.toDouble());
  sunCycle->setTimes(rise, set, offset, motion, nextRise);
  auto stationDetail = contextCard->findChild<QLabel *>("stationDetail");
  stationDetail->setText(
      services.stationStatus +
      (obs[0] && !fresh ? "\nLast measurement is stale." : "") + "\n" +
      services.warningStatus);
  const QStringList severities{"Unknown", "Minor", "Moderate", "Severe",
                               "Extreme"};
  QList<QPair<int, QJsonObject>> rankedWarnings;
  for (const auto &v : services.warnings) {
    const auto p = v.toObject().value("properties").toObject();
    const int rank =
        std::max(0, int(severities.indexOf(p.value("severity").toString())));
    rankedWarnings.append({rank, p});
  }
  std::stable_sort(
      rankedWarnings.begin(), rankedWarnings.end(),
      [](const auto &a, const auto &b) { return a.first > b.first; });
  QStringList warningText;
  for (const auto &warning : rankedWarnings) {
    auto headline = warning.second.value("headline").toString().trimmed();
    if (headline.isEmpty())
      headline = warning.second.value("event").toString("Weather alert");
    warningText << "National Weather Service · " + headline;
  }
  const QHash<QString, QString> colors{
      {"Tornado Warning", "#ff0000"},
      {"Severe Thunderstorm Warning", "#ffa500"},
      {"Flash Flood Warning", "#00c800"},
      {"Flood Warning", "#00a05a"},
      {"Snow Squall Warning", "#c71585"},
      {"Tornado Watch", "#ffff00"},
      {"Severe Thunderstorm Watch", "#db7093"},
      {"Special Weather Statement", "#ffe4b5"},
      {"Flood Advisory", "#00b478"},
      {"Air Quality Alert", "#ffffff"}};
  const auto event =
      rankedWarnings.isEmpty()
          ? QString()
          : rankedWarnings.first().second.value("event").toString();
  const auto fallback =
      event.contains("warning", Qt::CaseInsensitive)    ? "#e63c3c"
      : event.contains("watch", Qt::CaseInsensitive)    ? "#c8b43c"
      : event.contains("advisory", Qt::CaseInsensitive) ? "#78b4c8"
                                                        : "#ffffff";
  alerts->setProperty("eventColor", rankedWarnings.isEmpty()
                                        ? QString()
                                        : colors.value(event, fallback));
  styleAlerts();
  const auto severity = rankedWarnings.isEmpty()
                            ? QString()
                            : severities[rankedWarnings.first().first];
  if (alerts->property("severity").toString() != severity) {
    alerts->setProperty("severity", severity);
    alerts->style()->unpolish(alerts);
    alerts->style()->polish(alerts);
    alerts->update();
  }
  alerts->setAccessibleName(
      severity.isEmpty()
          ? "National Weather Service alerts"
          : "National Weather Service alerts · Highest severity: " + severity);
  alerts->setText(
      warningText.isEmpty()
          ? (services.warningStatus.isEmpty()
                 ? "Choose a location in Settings to start."
             : services.warningStatus == "US National Weather Service"
                 ? services.warningStatus + " · No active warnings returned"
                 : services.warningStatus)
          : warningText.join("\n"));
  alerts->setText(alerts->text() + "   ·   View details →");
  alertButton->setAccessibleDescription(alerts->text());
  status->setText(services.forecastStatus + "   ·   Home network port " +
                  QString::number(server.serverPort()));
  if (pages->currentIndex() == 2)
    renderHistory();
}
void Window::setup() {
  if (auto current = findChild<SetupDialog *>("stationSetup")) {
    current->show();
    current->raise();
    current->activateWindow();
    return;
  }
  auto dialog = new SetupDialog(
      services, server.serverPort(), scaleFactor,
      [this](const QJsonObject &changes, QString *error) {
        loadSettings();
        settingsMessage->setText("Settings were not saved.");
        const auto before = services.config.value.value("_rev").toDouble();
        setupChanges = changes;
        saveSettings();
        setupChanges = {};
        if (services.config.value.value("_rev").toDouble() <= before) {
          *error = settingsMessage->text();
          return false;
        }
        if (changes.contains("fontScale"))
          applyScale(changes.value("fontScale").toDouble());
        loadSettings();
        return true;
      },
      [this] { restore(); }, this);
#ifdef Q_OS_ANDROID
  // Keep onboarding on the main surface; Android TextureView dialogs corrupt partial repaints.
  dialog->setWindowFlags(Qt::Widget);
  auto shell = qobject_cast<QStackedWidget *>(centralWidget());
  shell->addWidget(dialog);
  connect(dialog, &QDialog::finished, shell, [shell, dialog] {
    shell->setCurrentIndex(0);
    shell->removeWidget(dialog);
  });
  shell->setCurrentWidget(dialog);
#else
  dialog->open();
#endif
}
void Window::showInstrument(int index) {
  auto dialog = new QDialog(this);
  dialog->setAttribute(Qt::WA_DeleteOnClose);
  dialog->setWindowTitle(metricValues[index]->accessibleName());
  auto box = new QVBoxLayout(dialog);
  auto value = label(metricValues[index]->text(), "metric");
  auto source = label(metricSources[index]->text(), "muted");
  box->addWidget(value);
  box->addWidget(source);
  const QStringList descriptions{
      "Rain accumulated today. A connected station is required; missing "
      "observations are never treated as zero.",
      "Station lightning strikes in the last three hours. A connected "
      "lightning sensor is required.",
      "Wind speed and direction. The compass points toward the reported wind "
      "direction; its dial is a display range, not a warning threshold.",
      "Estimated wet-bulb globe temperature. Solar radiation and wind affect "
      "the estimate; shade assumptions are shown with the value.",
      "Station UV reading when available; otherwise the forecast daily "
      "maximum.",
      "Sea-level pressure. Station pressure is adjusted using elevation when "
      "available.",
      "Relative humidity from the station, or a labeled forecast estimate.",
      "Dew point calculated from the displayed temperature and relative "
      "humidity."};
  box->addWidget(label(descriptions.value(index), "muted"));
  auto close = new QPushButton("Close");
  box->addWidget(close);
  connect(close, &QPushButton::clicked, dialog, &QDialog::accept);
  connect(&services, &Services::changed, dialog, [this, index, value, source] {
    value->setText(metricValues[index]->text());
    source->setText(metricSources[index]->text());
  });
  dialog->resize(std::min(520, width()), std::min(330, height()));
  dialog->open();
}
void Window::renderHistory() {
  if (!plot || !historyTable)
    return;
  auto health = services.archive.health();
  bool metric = services.config.text("units") == "metric";
  const auto windLabel = services.config.windUnit();
  const double windFactor = services.config.windFactor();
  historySummary->setText(
      QString::number(health.value("rows").toDouble(), 'f', 0) +
      " archived readings · " +
      QString::number(health.value("bytes").toDouble() / (1024 * 1024), 'f',
                      1) +
      " MB · " + health.value("check").toString());
  QStringList keys{"temp", "rain", "wind_gust", "pressure", "humidity", "uv"};
  int selected = historyMetric->currentIndex();
  const auto key = keys.value(selected, "temp");
  qint64 hours = historyRange->currentData().toLongLong(),
         end = QDateTime::currentSecsSinceEpoch(), begin = end - hours * 3600;
  const int bucket = std::max(qint64(60), hours * 3600 / 1000);
  QSqlQuery q(services.archive.db);
  q.prepare("SELECT (ts / ?) * ?," + QString(selected == 1 ? "SUM" : "AVG") +
            "(" + key + ") FROM obs WHERE ts>=? AND ts<=? AND " + key +
            " IS NOT NULL GROUP BY 1 ORDER BY 1");
  q.addBindValue(bucket);
  q.addBindValue(bucket);
  q.addBindValue(begin);
  q.addBindValue(end);
  plot->points.clear();
  double factor = 1, shift = 0;
  if (selected == 0) {
    factor = metric ? 1 : 1.8;
    shift = metric ? 0 : 32;
    plot->unit = metric ? "°C" : "°F";
  }
  if (selected == 1) {
    factor = metric ? 1 : 1 / 25.4;
    plot->unit = metric ? "mm per chart interval" : "in per chart interval";
  }
  if (selected == 2) {
    factor = windFactor;
    plot->unit = windLabel;
  }
  if (selected == 3) {
    factor = metric ? 1 : 1 / 33.8639;
    plot->unit = metric ? "hPa" : "inHg";
  }
  if (selected == 4)
    plot->unit = "%";
  if (selected == 5)
    plot->unit = "UV index";
  if (q.exec())
    while (q.next())
      plot->points.append(QPointF(q.value(0).toDouble(),
                                  q.value(1).toDouble() * factor + shift));
  plot->update();
  auto days = services.archive.daily(
      QDateTime::currentDateTime().offsetFromUtc() / 60, begin);
  historyTable->setRowCount(days.size());
  for (int i = 0; i < days.size(); ++i) {
    auto day = days[days.size() - 1 - i].toObject();
    QStringList values{
        day.value("day").toString(),
        number(day.value("tempMin"), "°", 1, metric ? 1 : 1.8, metric ? 0 : 32),
        number(day.value("tempMax"), "°", 1, metric ? 1 : 1.8, metric ? 0 : 32),
        number(day.value("gustMax"), " " + windLabel, 1, windFactor),
        number(day.value("rain"), metric ? " mm" : " in", 2,
               metric ? 1 : 1 / 25.4)};
    for (int j = 0; j < values.size(); ++j)
      historyTable->setItem(i, j, new QTableWidgetItem(values[j]));
  }
}
void Window::backup() {
  const auto file = QFileDialog::getSaveFileName(
      this, "Save complete backup",
      "stormdesk-" + QDateTime::currentDateTime().toString("yyyyMMdd-HHmmss") +
          ".wdbak",
      "StormDesk backup (*.wdbak)");
  if (file.isEmpty())
    return;
  QString error;
  QTemporaryDir staging;
  const auto snapshot =
      file.startsWith("content:") ? staging.filePath("export.wdbak") : file;
  if (!services.archive.backup(snapshot, services.config.value, &error) ||
      (snapshot != file && !copyDocument(snapshot, file, &error)))
    QMessageBox::warning(this, "Backup failed", error);
  else
    settingsMessage->setText(
        "Backup saved. It includes credentials; keep it private.");
}
void Window::restore() {
  auto file = QFileDialog::getOpenFileName(this, "Inspect StormDesk backup", {},
                                           "StormDesk backup (*.wdbak)");
  if (file.isEmpty())
    return;
  QTemporaryDir staging;
  QString error;
  if (file.startsWith("content:")) {
    const auto copy = staging.filePath("restore.wdbak");
    if (!copyDocument(file, copy, &error)) {
      QMessageBox::warning(this, "Cannot read backup", error);
      return;
    }
    file = copy;
  }
  QJsonObject config;
  auto summary = Archive::inspect(file, &config, &error);
  if (summary.isEmpty()) {
    QMessageBox::warning(this, "Invalid backup", error);
    return;
  }
  const auto message =
      "Station: " + summary.value("station").toString() + "\nReadings: " +
      QString::number(summary.value("rows").toDouble(), 'f', 0) +
      "\n\nReplace this native app’s settings and archive? A recovery backup "
      "will be kept first.";
  if (QMessageBox::question(this, "Restore backup", message) !=
      QMessageBox::Yes)
    return;
  auto recovery = QFileInfo(services.archive.path)
                      .dir()
                      .filePath("pre-restore-" +
                                QDateTime::currentDateTime().toString(
                                    "yyyyMMdd-HHmmss-zzz") +
                                ".wdbak");
  if (!services.archive.backup(recovery, services.config.value, &error)) {
    QMessageBox::warning(this, "Recovery backup failed", error);
    return;
  }
  const auto oldConfig = services.config.value;
  if (!services.archive.restore(file, &error)) {
    QMessageBox::warning(this, "Restore failed", error);
    return;
  }
  if (!services.config.save(config, &error)) {
    QString rollbackError;
    services.archive.restore(recovery, &rollbackError);
    services.config.save(oldConfig, &rollbackError);
    QMessageBox::critical(this, "Restore failed",
                          "Could not save restored settings: " + error +
                              "\nRecovery backup: " + recovery +
                              (rollbackError.isEmpty()
                                   ? ""
                                   : "\nRecovery error: " + rollbackError));
    return;
  }
  QMessageBox::information(this, "Restore complete",
                           "Backup restored. Restart StormDesk to reconnect "
                           "station services. Recovery backup: " +
                               recovery);
  qApp->quit();
}
void Window::exportCsv() {
  const auto file = QFileDialog::getSaveFileName(
      this, "Export weather archive", "stormdesk-history.csv", "CSV (*.csv)");
  if (file.isEmpty())
    return;
  QString error;
  if (!services.archive.exportCsv(file, &error))
    QMessageBox::warning(this, "Export failed", error);
}
void Window::notify(const QString &title, const QString &message) {
  const bool enabled =
      services.config.settings().value("nativeNotifications").toBool(true);
  bool delivered = false;
#ifndef QT_NO_SYSTEMTRAYICON
  if (enabled && tray) {
    tray->showMessage(title, message, QSystemTrayIcon::Warning, 15000);
    delivered = true;
  }
#endif
  if (enabled && !delivered) {
    auto dialog = findChild<QMessageBox *>("weatherNotification");
    if (!dialog) {
      dialog = new QMessageBox(QMessageBox::Warning, title, {}, QMessageBox::Ok,
                               this);
      dialog->setObjectName("weatherNotification");
      dialog->setAttribute(Qt::WA_DeleteOnClose);
      dialog->setModal(false);
      dialog->setTextFormat(Qt::PlainText);
    }
    dialog->setWindowTitle(title);
    dialog->setText(message.left(4096));
    dialog->show();
    QTimer::singleShot(15000, dialog, &QMessageBox::close);
  }
#ifdef STORMDESK_SPEECH
  if (services.config.settings().value("speakAlerts").toBool() &&
      title != "Weather rule") {
    if (auto speech = findChild<QTextToSpeech *>()) {
      for (const auto &voice : speech->availableVoices())
        if (voice.name() == services.config.text("nativeVoice"))
          speech->setVoice(voice);
      speech->setRate(services.config.text("speechRate", "0").toDouble());
      if (speech->state() == QTextToSpeech::Error)
        status->setText(
            "Speech unavailable. Check the system voice and audio output.");
      else
        speech->say((title + ". " + message).left(4096));
    }
  }
#endif
}
} // namespace storm
