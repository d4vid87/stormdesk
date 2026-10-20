#include "window.h"
#include <QApplication>
#include <QCheckBox>
#include <QDateTime>
#include <QDesktopServices>
#include <QDialog>
#include <QDialogButtonBox>
#include <QDoubleSpinBox>
#include <QFileDialog>
#include <QFormLayout>
#include <QGroupBox>
#include <QHeaderView>
#include <QFileInfo>
#include <QDir>
#include <QJsonDocument>
#include <QLineEdit>
#include <QMenu>
#include <QMessageBox>
#include <QNetworkReply>
#include <QPainter>
#include <QPainterPath>
#include <QPushButton>
#include <QResizeEvent>
#include <QScrollArea>
#include <QSpinBox>
#include <QSqlQuery>
#include <QTableWidget>
#include <QTabWidget>
#include <QTimer>
#include <QTemporaryDir>
#include <QToolButton>
#include <QUrlQuery>
#include <cmath>
#ifdef STORMDESK_SPEECH
#include <QTextToSpeech>
#endif
#ifdef STORMDESK_RADAR
#include <QWebEngineView>
#include <QWebEngineSettings>
#endif

namespace storm {
static QLabel *label(const QString &text, const QString &style = {}, QWidget *parent = nullptr) {
    auto l = new QLabel(text, parent); l->setTextFormat(Qt::PlainText); l->setWordWrap(true);
    if (!style.isEmpty()) l->setProperty("kind", style); return l;
}
static QWidget *card(const QString &title, QVBoxLayout **layout) {
    auto widget = new QFrame; widget->setObjectName("card");
    *layout = new QVBoxLayout(widget); (*layout)->setSpacing(12); (*layout)->addWidget(label(title.toUpper(), "eyebrow"));
    return widget;
}
static QScrollArea *scrollView(QWidget *content) {
    auto view = new QScrollArea; view->setWidgetResizable(true); view->setFrameShape(QFrame::NoFrame); view->setWidget(content); return view;
}
static QString number(const QJsonValue &v, const QString &unit, int decimals = 1, double factor = 1, double shift = 0) {
    return v.isDouble() ? QString::number(v.toDouble() * factor + shift, 'f', decimals) + unit : "—";
}
Plot::Plot(QWidget *parent) : QWidget(parent) { setMinimumHeight(260); setAccessibleName("Weather history chart"); setSizePolicy(QSizePolicy::Expanding, QSizePolicy::Expanding); }
void Plot::paintEvent(QPaintEvent *) {
    QPainter p(this); p.setRenderHint(QPainter::Antialiasing);
    const int axisWidth = p.fontMetrics().horizontalAdvance("-9999.9") + 12;
    QRectF area = rect().adjusted(axisWidth, p.fontMetrics().height() + 12, -20, -p.fontMetrics().height() * 2 - 16);
    if (points.isEmpty()) { p.setPen(palette().text().color()); p.drawText(rect(), Qt::AlignCenter, "No archived readings in this period"); return; }
    double low = points[0].y(), high = low, start = points[0].x(), end = points.last().x();
    for (const auto &point : points) { low = std::min(low, point.y()); high = std::max(high, point.y()); }
    if (low == high) { low -= 1; high += 1; }
    double pad = (high - low) * .1; low -= pad; high += pad;
    for (int i = 0; i < 5; ++i) {
        double y = area.bottom() - area.height() * i / 4;
        p.setPen(QColor(127, 137, 156, 45)); p.drawLine(QPointF(area.left(), y), QPointF(area.right(), y));
        p.setPen(palette().text().color());
        p.drawText(QRectF(0, y - p.fontMetrics().height() / 2, axisWidth - 8, p.fontMetrics().height()), Qt::AlignRight | Qt::AlignVCenter, QString::number(low + (high - low) * i / 4, 'f', 1));
    }
    QPainterPath line; bool first = true;
    for (const auto &v : points) {
        QPointF point(area.left() + area.width() * (v.x() - start) / std::max(1.0, end - start), area.bottom() - area.height() * (v.y() - low) / (high - low));
        if (first) line.moveTo(point); else line.lineTo(point); first = false;
    }
    p.setPen(QPen(QColor("#a0c6f4"), 2)); p.drawPath(line);
    p.setPen(palette().text().color());
    const auto dateFormat = width() < 700 ? "MM-dd\\nHH:mm" : "ddd d MMM HH:mm";
    p.drawText(QRectF(area.left(), area.bottom() + 8, area.width(), p.fontMetrics().height() * 2 + 4), Qt::AlignLeft, QDateTime::fromSecsSinceEpoch(qint64(start)).toString(dateFormat));
    p.drawText(QRectF(area.left(), area.bottom() + 8, area.width(), p.fontMetrics().height() * 2 + 4), Qt::AlignRight, QDateTime::fromSecsSinceEpoch(qint64(end)).toString(dateFormat));
    p.drawText(QRectF(area.left(), 0, area.width(), 20), Qt::AlignLeft, unit);
}
Window::Window(Services &s, HttpServer &http) : services(s), server(http), local("StormDesk", "Native") {
    setWindowTitle("StormDesk · Native"); setWindowIcon(QIcon(":/app-icon.png"));
    setMinimumSize(240, 240);
    auto root = new QWidget; auto layout = new QVBoxLayout(root); layout->setSizeConstraint(QLayout::SetNoConstraint); layout->setContentsMargins(20, 18, 20, 18); layout->setSpacing(16); setCentralWidget(root);
    auto header = new QHBoxLayout;
    auto brand = new QVBoxLayout; brand->setSpacing(2); brand->addWidget(label("STORMDESK", "brand"));
    location = label("Your weather, at a glance", "muted"); brand->addWidget(location); header->addLayout(brand, 1);
    clock = label({}, "clock"); clock->setAlignment(Qt::AlignRight); header->addWidget(clock);
    auto timer = new QTimer(this); timer->start(1000);
    connect(timer, &QTimer::timeout, this, [this] { clock->setText(QDateTime::currentDateTime().toString("ddd d MMM  •  HH:mm:ss")); });
    layout->addLayout(header);
    navigation = new QGridLayout;
    pages = new QStackedWidget; pages->setSizePolicy(QSizePolicy::Ignored, QSizePolicy::Preferred);
    const QStringList titles = {"Weather", "Radar", "History", "Settings"};
    for (int i = 0; i < titles.size(); ++i) {
        auto button = new QPushButton(titles[i]); button->setCheckable(true); button->setChecked(i == 0); button->setProperty("nav", true);
        connect(button, &QPushButton::clicked, this, [this, i] { pages->setCurrentIndex(i); if (i == 1) openRadar(); if (i == 2) renderHistory(); if (i == 3) loadSettings(); });
        connect(pages, &QStackedWidget::currentChanged, button, [button, i](int selected) { button->setChecked(i == selected); });
        navigation->addWidget(button, 0, i); navButtons << button;
    }
    navigation->setColumnStretch(4, 1);
    pageSelect = new QComboBox; pageSelect->addItems(titles); pageSelect->setAccessibleName("Dashboard page"); pageSelect->hide();
    connect(pageSelect, &QComboBox::activated, this, [this](int i) { pages->setCurrentIndex(i); if (i == 1) openRadar(); if (i == 2) renderHistory(); if (i == 3) loadSettings(); });
    connect(pages, &QStackedWidget::currentChanged, pageSelect, &QComboBox::setCurrentIndex);
    scaleBox = new QComboBox; scaleBox->setAccessibleName("Interface size"); scaleBox->setToolTip("UI size, in addition to your display’s automatic DPI scaling");
    for (int percent : {70, 85, 100, 115, 125, 150, 175, 200}) scaleBox->addItem(QString::number(percent) + "%", percent / 100.0);
    connect(scaleBox, &QComboBox::activated, this, [this](int i) { applyScale(scaleBox->itemData(i).toDouble()); });
    navigation->addWidget(scaleBox, 0, 5);
    refreshButton = new QPushButton("Refresh"); connect(refreshButton, &QPushButton::clicked, &services, &Services::refresh); navigation->addWidget(refreshButton, 0, 6);
    layout->addLayout(navigation);
    pages->addWidget(makeWeather()); radarPage = makeRadar(); pages->addWidget(radarPage); pages->addWidget(makeHistory()); pages->addWidget(makeSettings());
    layout->addWidget(pages, 1); status = label({}, "muted"); status->setTextInteractionFlags(Qt::TextSelectableByMouse); layout->addWidget(status);
    connect(&services, &Services::changed, this, &Window::render);
    connect(&services, &Services::notification, this, &Window::notify);
#ifdef STORMDESK_SPEECH
    auto speech = new QTextToSpeech(this);
    connect(speech, &QTextToSpeech::errorOccurred, this, [this](QTextToSpeech::ErrorReason, const QString &) { status->setText("Speech unavailable. Check the system voice and audio output."); });
#endif
#ifndef QT_NO_SYSTEMTRAYICON
    if (QSystemTrayIcon::isSystemTrayAvailable()) {
        tray = new QSystemTrayIcon(QIcon::fromTheme("weather-few-clouds"), this); tray->setToolTip("StormDesk");
        auto menu = new QMenu(this); menu->addAction("Show StormDesk", this, [this] { showNormal(); raise(); activateWindow(); });
        menu->addAction("Quit", qApp, &QApplication::quit); tray->setContextMenu(menu); tray->show();
    }
#endif
    auto fullscreen = new QAction(this); fullscreen->setShortcut(QKeySequence(Qt::Key_F11)); addAction(fullscreen);
    connect(fullscreen, &QAction::triggered, this, [this] { isFullScreen() ? showNormal() : showFullScreen(); });
    auto escape = new QAction(this); escape->setShortcut(QKeySequence(Qt::Key_Escape)); addAction(escape);
    connect(escape, &QAction::triggered, this, [this] { if (isFullScreen()) showNormal(); });
    applyScale(local.value("scale", services.config.number("fontScale", 1)).toDouble());
    resize(local.value("size", QSize(1440, 950)).toSize()); render();
    connect(qApp, &QCoreApplication::aboutToQuit, this, [this] { local.setValue("size", size()); });
}
QWidget *Window::makeWeather() {
    auto page = new QWidget; auto layout = new QVBoxLayout(page); layout->setContentsMargins(0, 0, 0, 0); layout->setSpacing(16);
    alerts = label("Choose a location in Settings to load weather and official warnings.", "notice"); alerts->setTextInteractionFlags(Qt::TextSelectableByMouse); layout->addWidget(alerts);
    metrics = new QGridLayout; metrics->setSpacing(12); layout->addLayout(metrics);
    const QStringList names = {"Rain today", "Lightning", "Wind", "Heat stress / WBGT", "UV index", "Pressure", "Humidity"};
    for (int i = 0; i < names.size(); ++i) {
        QVBoxLayout *box; auto widget = card(names[i], &box); widget->setMinimumWidth(0);
        metricValues[i] = label("—", "metric"); metricValues[i]->setAccessibleName(names[i]); box->addWidget(metricValues[i]);
        metricSources[i] = label("Unavailable", "muted"); box->addWidget(metricSources[i]);
        metricCards << widget;
    }
    body = new QGridLayout; body->setSpacing(16); layout->addLayout(body);
    QVBoxLayout *currentLayout; currentCard = card("Current conditions", &currentLayout);
    heroSource = label("Forecast-only mode", "muted"); currentLayout->addWidget(heroSource);
    heroTemperature = label("—", "temperature"); currentLayout->addWidget(heroTemperature);
    heroCondition = label("Connect your weather", "subtitle"); currentLayout->addWidget(heroCondition);
    auto details = label("Set a location for forecasts, or connect a personal station for local measurements.", "muted"); details->setObjectName("conditionsDetail"); currentLayout->addWidget(details); currentLayout->addStretch();
    auto radar = new QPushButton("Live radar →"); connect(radar, &QPushButton::clicked, this, [this] { pages->setCurrentIndex(1); openRadar(); }); currentLayout->addWidget(radar);
    QVBoxLayout *forecastLayout; forecastCard = card("10-day outlook", &forecastLayout);
    forecastNote = label("Forecast estimates · Open-Meteo", "muted"); forecastLayout->addWidget(forecastNote);
    forecastRows = new QVBoxLayout; forecastRows->setSpacing(8); forecastLayout->addLayout(forecastRows); forecastLayout->addStretch();
    QVBoxLayout *context; contextCard = card("Your local context", &context);
    sun = label("Sunrise and sunset will appear here."); context->addWidget(sun);
    auto source = label({}, "muted"); source->setObjectName("stationDetail"); context->addWidget(source); context->addStretch();
    auto link = new QPushButton("Home dashboard");
    connect(link, &QPushButton::clicked, this, [this] { QDesktopServices::openUrl(QUrl("http://127.0.0.1:" + QString::number(server.serverPort()))); }); context->addWidget(link);
    auto hint = label("Weather readings are labeled by source. Missing sensor data remains unavailable.", "muted"); context->addWidget(hint);
    layout->addStretch(); arrange(); return scrollView(page);
}
QWidget *Window::makeRadar() {
    auto page = new QWidget; auto layout = new QVBoxLayout(page);
    layout->addWidget(label("Live radar", "subtitle"));
    layout->addWidget(label("HookEcho radar · Internet connection required", "muted"));
    auto open = new QPushButton("Open radar in system browser"); connect(open, &QPushButton::clicked, this, [this] { QDesktopServices::openUrl(services.radarUrl()); }); layout->addWidget(open);
#ifndef STORMDESK_RADAR
    layout->addWidget(label("This build uses your system browser for radar. On Android this keeps radar compatible with the device’s browser.")); layout->addStretch();
#endif
    return page;
}
void Window::openRadar() {
#ifdef STORMDESK_RADAR
    auto view = radarPage->findChild<QWebEngineView *>();
    if (!view) {
        view = new QWebEngineView(radarPage); view->setAccessibleName("HookEcho live weather radar");
        view->settings()->setAttribute(QWebEngineSettings::JavascriptCanOpenWindows, false);
        view->settings()->setAttribute(QWebEngineSettings::LocalContentCanAccessFileUrls, false);
        radarPage->layout()->addWidget(view);
        connect(view, &QWebEngineView::loadFinished, this, [this](bool ok) { if (!ok) status->setText("Radar could not load. Check the connection or open radar in your system browser."); });
    }
    const auto url = services.radarUrl();
    if (url != radarLocation) { radarLocation = url; view->load(url); }
    view->setZoomFactor(scaleFactor);
#endif
    radarLoaded = true;
}
QWidget *Window::makeHistory() {
    auto page = new QWidget; auto layout = new QVBoxLayout(page);
    layout->addWidget(label("Your weather archive", "subtitle"));
    historySummary = label({}, "muted"); layout->addWidget(historySummary);
    auto controls = new QVBoxLayout;
    historyMetric = new QComboBox; historyMetric->setSizeAdjustPolicy(QComboBox::AdjustToMinimumContentsLengthWithIcon); historyMetric->setMinimumContentsLength(5); historyMetric->setAccessibleName("History measurement");
    historyMetric->addItems({"Temperature", "Rain", "Wind gust", "Pressure", "Humidity", "UV index"}); controls->addWidget(historyMetric);
    historyRange = new QComboBox; historyRange->setSizeAdjustPolicy(QComboBox::AdjustToMinimumContentsLengthWithIcon); historyRange->setMinimumContentsLength(5); historyRange->setAccessibleName("History period");
    historyRange->addItem("Last 24 hours", 24); historyRange->addItem("Last 7 days", 168); historyRange->addItem("Last 30 days", 720); controls->addWidget(historyRange);
    auto csv = new QPushButton("Export CSV"); connect(csv, &QPushButton::clicked, this, &Window::exportCsv); controls->addWidget(csv);
    layout->addLayout(controls);
    plot = new Plot; layout->addWidget(plot, 1);
    historyTable = new QTableWidget(0, 5); historyTable->setHorizontalHeaderLabels({"Day", "Low", "High", "Max gust", "Rain"});
    historyTable->horizontalHeader()->setSectionResizeMode(QHeaderView::Stretch); historyTable->verticalHeader()->hide();
    historyTable->setEditTriggers(QAbstractItemView::NoEditTriggers); historyTable->setAccessibleName("Daily weather records"); historyTable->setMinimumHeight(240); layout->addWidget(historyTable);
    connect(historyMetric, &QComboBox::currentIndexChanged, this, [this] { renderHistory(); });
    connect(historyRange, &QComboBox::currentIndexChanged, this, [this] { renderHistory(); });
    return scrollView(page);
}
QWidget *Window::makeSettings() {
    auto page = new QWidget; auto layout = new QVBoxLayout(page); layout->addWidget(label("Make StormDesk yours", "subtitle"));
    auto tabs = new QTabWidget; tabs->setUsesScrollButtons(true); layout->addWidget(tabs, 1);
    auto section = [tabs](const QString &title) { auto content = new QWidget; auto form = new QFormLayout(content); form->setRowWrapPolicy(QFormLayout::WrapLongRows); form->setFieldGrowthPolicy(QFormLayout::AllNonFixedFieldsGrow); tabs->addTab(scrollView(content), title); return form; };
    auto text = [this](QFormLayout *form, const QString &title, const QString &key, bool secret = false) {
        auto edit = new QLineEdit; edit->setAccessibleName(title); if (secret) edit->setEchoMode(QLineEdit::Password);
        form->addRow(title, edit); editors[key] = edit; return edit;
    };
    auto choice = [this](QFormLayout *form, const QString &title, const QString &key, const QList<QPair<QString, QString>> &values) {
        auto box = new QComboBox; box->setSizeAdjustPolicy(QComboBox::AdjustToMinimumContentsLengthWithIcon); box->setMinimumContentsLength(5); box->setAccessibleName(title); for (const auto &v : values) box->addItem(v.first, v.second);
        form->addRow(title, box); editors[key] = box; return box;
    };
    auto check = [this](QFormLayout *form, const QString &title, const QString &key) {
        auto box = new QCheckBox(title); form->addRow(box); editors[key] = box; return box;
    };
    auto general = section("Location");
    auto searchLine = new QHBoxLayout; auto search = new QLineEdit; search->setPlaceholderText("Town or postcode"); search->setAccessibleName("Search weather location");
    auto find = new QPushButton("Find"); searchLine->addWidget(search); searchLine->addWidget(find); general->addRow("Find your weather", searchLine);
    auto results = new QComboBox; results->setSizeAdjustPolicy(QComboBox::AdjustToMinimumContentsLengthWithIcon); results->setMinimumContentsLength(5); results->setAccessibleName("Matching locations"); general->addRow("Search results", results);
    text(general, "Location name", "stationName");
    for (const auto &p : QList<QPair<QString, QString>>{{"Latitude", "lat"}, {"Longitude", "lon"}}) {
        auto spin = new QDoubleSpinBox; spin->setDecimals(5); spin->setRange(p.second == "lat" ? -90 : -180, p.second == "lat" ? 90 : 180); spin->setAccessibleName(p.first); general->addRow(p.first, spin); editors[p.second] = spin;
        connect(spin, &QDoubleSpinBox::editingFinished, spin, [spin] { spin->setProperty("locationEdited", true); });
    }
    choice(general, "Units", "units", {{"Imperial", "imperial"}, {"Metric", "metric"}});
    choice(general, "Wind units", "windUnit", {{"Follow main units", ""}, {"Miles per hour", "mph"}, {"Kilometres per hour", "km/h"}, {"Metres per second", "m/s"}, {"Knots", "kt"}});
    general->addRow(label("Forecasts: Open-Meteo. Official warning coverage: US National Weather Service. Outside the US, consult your local weather service.", "muted"));
    connect(find, &QPushButton::clicked, this, [this, search, results, find] {
        if (search->text().trimmed().size() < 2) return;
        QUrl url("https://geocoding-api.open-meteo.com/v1/search"); QUrlQuery q; q.addQueryItem("name", search->text().trimmed()); q.addQueryItem("count", "8"); q.addQueryItem("language", "en"); url.setQuery(q);
        find->setEnabled(false);
        services.request(url, [this, results, find](QJsonDocument doc, const QString &error) {
            find->setEnabled(true); results->clear();
            if (!error.isEmpty()) { settingsMessage->setText(error); return; }
            for (const auto &v : doc.object().value("results").toArray()) { const auto place = v.toObject(); results->addItem(place.value("name").toString() + ", " + place.value("admin1").toString() + ", " + place.value("country").toString(), place.toVariantMap()); }
            settingsMessage->setText(results->count() ? "Choose a result, then save changes." : "No matching locations found.");
        });
    });
    connect(results, &QComboBox::activated, this, [this, results](int i) {
        const auto place = results->itemData(i).toMap();
        qobject_cast<QDoubleSpinBox *>(editors.value("lat"))->setValue(place.value("latitude").toDouble());
        editors.value("lat")->setProperty("locationEdited", true); editors.value("lon")->setProperty("locationEdited", true);
        qobject_cast<QDoubleSpinBox *>(editors.value("lon"))->setValue(place.value("longitude").toDouble());
        qobject_cast<QLineEdit *>(editors.value("stationName"))->setText(place.value("name").toString());
    });
    auto station = section("My station");
    choice(station, "Station source", "stationSource", {{"Forecast only", ""}, {"WeatherFlow Tempest", "tempest"}, {"Ecowitt / Wittboy", "ecowitt"}, {"Ambient custom upload", "ambient"}, {"Davis WeatherLink Live", "wll"}, {"Ambient cloud", "awn"}, {"La Crosse cloud", "lacrosse"}, {"AcuRite / rtl_433 / WeeWX / WU", "wu"}});
    text(station, "Station ID / MAC", "stationId"); text(station, "Tempest device ID", "deviceId"); text(station, "Tempest personal token", "token", true);
    text(station, "Tempest serial (optional)", "tempestSerial"); text(station, "Davis host / IP", "wllHost");
    auto elevation = new QLineEdit; elevation->setAccessibleName("Elevation in metres"); elevation->setPlaceholderText("Optional, metres above sea level"); station->addRow("Elevation (metres)", elevation); editors["elevationM"] = elevation;
    text(station, "Ambient API key", "awnApiKey", true); text(station, "Ambient application key", "awnAppKey", true); text(station, "La Crosse email", "lacrosseEmail"); text(station, "La Crosse password", "lacrossePass", true); text(station, "Upload key", "ingestKey", true);
    station->addRow(label("For custom uploads, use this computer’s LAN address, port " + QString::number(server.serverPort()) + ", and /ingest/ followed by your upload key. Set a station ID to protect the archive from mixed stations.", "muted"));
    auto appearance = section("Appearance");
    choice(appearance, "Theme", "theme", {{"Graphite Silver", "graphite"}, {"Midnight Violet", "violet"}, {"Carbon Lime", "carbon"}, {"Ocean Abyss", "abyss"}, {"Night Spruce", "spruce"}, {"Oxblood Rose", "oxblood"}, {"Burnished Copper", "copper"}, {"Electric Indigo", "indigo"}, {"Petrol Citron", "petrol"}, {"Espresso Gold", "espresso"}, {"OLED black", "dark"}, {"Light", "light"}, {"High contrast", "contrast"}});
    appearance->addRow(label("Change interface size in the toolbar: 70–200%. The choice is saved on this device. Display DPI is handled automatically. Press F11 for a full-screen wall display; Escape leaves full screen.", "muted"));
    text(appearance, "Radar site (optional, e.g. KFWS)", "radarSite");
    auto alert = section("Alerts");
    check(alert, "Notify on desktop", "nativeNotifications"); check(alert, "Push warnings", "pushOfficial");
    auto speak = check(alert, "Speak warnings", "speakAlerts");
#ifndef STORMDESK_SPEECH
    speak->setEnabled(false); speak->setToolTip("This build does not include Qt TextToSpeech");
#else
    Q_UNUSED(speak);
#endif
    text(alert, "ntfy server", "ntfyUrl"); text(alert, "ntfy topic", "ntfyTopic", true); text(alert, "Webhook URL", "webhookUrl", true);
    auto test = new QPushButton("Test notification"); alert->addRow(test);
    connect(test, &QPushButton::clicked, this, [this] { services.push("StormDesk test", "Your weather notification channel is working."); notify("StormDesk test", "Native notifications are enabled."); });
    alert->addRow(label("Save changes before testing delivery. Rule thresholds use your display units.", "muted"));
    ruleTable = new QTableWidget(0, 4); ruleTable->setHorizontalHeaderLabels({"Measurement", "When", "Threshold", "Minutes"});
    ruleTable->setAccessibleName("Weather alert rules"); ruleTable->setMinimumHeight(220); ruleTable->horizontalHeader()->setSectionResizeMode(QHeaderView::ResizeToContents);
    alert->addRow(ruleTable);
    auto ruleButtons = new QVBoxLayout; auto add = new QPushButton("Add rule"), remove = new QPushButton("Remove rule");
    ruleButtons->addWidget(add); ruleButtons->addWidget(remove); alert->addRow(ruleButtons);
    connect(add, &QPushButton::clicked, this, [this] { addRule({{"metric", "gust"}, {"op", ">"}, {"value", 30}, {"durMin", 0}}); });
    connect(remove, &QPushButton::clicked, this, [this] { if (ruleTable->currentRow() >= 0) ruleTable->removeRow(ruleTable->currentRow()); });
    text(alert, "Quiet hours start (HH:mm)", "quietStart"); text(alert, "Quiet hours end (HH:mm)", "quietEnd");
    auto integrations = section("Integrations");
    text(integrations, "MQTT broker", "mqttUrl"); text(integrations, "MQTT username", "mqttUser"); text(integrations, "MQTT password", "mqttPass", true);
    text(integrations, "Discovery prefix", "haDiscoveryPrefix"); text(integrations, "Home Assistant URL", "haUrl"); text(integrations, "Home Assistant token", "haToken", true);
    text(integrations, "CWOP station ID", "cwopId"); text(integrations, "Weather Underground ID", "wuId"); text(integrations, "Weather Underground key", "wuKey", true);
    text(integrations, "PWSweather ID", "pwsId"); text(integrations, "PWSweather key", "pwsKey", true);
    auto data = section("Archive & sharing");
    auto backupButton = new QPushButton("Back up…"); connect(backupButton, &QPushButton::clicked, this, &Window::backup); data->addRow(backupButton);
    auto restoreButton = new QPushButton("Restore…"); connect(restoreButton, &QPushButton::clicked, this, &Window::restore); data->addRow(restoreButton);
    auto exportButton = new QPushButton("Export CSV…"); connect(exportButton, &QPushButton::clicked, this, &Window::exportCsv); data->addRow(exportButton);
    auto pair = new QPushButton("Pair screen"); data->addRow(pair);
    connect(pair, &QPushButton::clicked, this, [this] { auto result = server.pairCode(); QMessageBox::information(this, "Pair screen", "Pairing code: " + result.value("code").toString() + "\nValid for 10 minutes. Open the home network dashboard on the other screen and choose Join my home."); });
    for (const auto &path : QList<QPair<QString, QString>>{{"Archive file", services.archive.path}, {"Settings file", services.config.path}}) {
        auto value = new QLineEdit(path.second); value->setReadOnly(true); value->setAccessibleName(path.first); data->addRow(path.first, value);
    }
    data->addRow(label("LAN port: " + QString::number(server.serverPort()), "muted"));
    data->addRow(label("Backups include credentials. Keep them private. Restoring creates a recovery backup first. The original Rust app’s files are kept separate from this native preview.", "muted"));
    settingsMessage = label({}, "notice"); layout->addWidget(settingsMessage);
    auto save = new QPushButton("Save changes"); save->setProperty("primary", true); connect(save, &QPushButton::clicked, this, &Window::saveSettings); layout->addWidget(save);
    loadSettings(); return page;
}
void Window::addRule(const QJsonObject &rule) {
    const int row = ruleTable->rowCount(); ruleTable->insertRow(row);
    auto metric = new QComboBox; const QList<QPair<QString, QString>> metrics{{"Temperature", "temp"}, {"Dew point", "dew"}, {"Wind gust", "gust"}, {"Wind", "wind"}, {"Humidity", "rh"}, {"Rain rate", "rain"}, {"UV index", "uv"}, {"Strikes / 3 h", "strikes3h"}, {"Pressure change / 3 h", "press3h"}, {"Temperature change / 1 h", "temp1h"}, {"Pressure change / 1 h", "press1h"}, {"Humidity change / 1 h", "rh1h"}, {"Low / 18 h", "low18h"}, {"Rain / 6 h", "rain6h"}, {"Gust / 24 h", "gust24h"}, {"Tomorrow high", "hiTomorrow"}};
    for (const auto &m : metrics) metric->addItem(m.first, m.second);
    auto selected = metric->findData(rule.value("metric").toString());
    if (selected < 0) { metric->addItem("Unknown measurement", rule.value("metric").toString()); selected = metric->count() - 1; }
    metric->setCurrentIndex(selected);
    metric->setProperty("savedRule", rule); metric->setAccessibleName("Rule measurement");
    auto op = new QComboBox; op->addItems({">", "<"}); op->setCurrentText(rule.value("op").toString(">")); op->setAccessibleName("Rule comparison");
    auto value = new QDoubleSpinBox; value->setRange(-10000, 100000); value->setDecimals(2); value->setValue(rule.value("value").toDouble()); value->setAccessibleName("Rule threshold");
    auto duration = new QDoubleSpinBox; duration->setRange(0, 1440); duration->setDecimals(2); duration->setValue(rule.value("durMin").toDouble()); duration->setAccessibleName("Rule duration in minutes");
    connect(value, &QDoubleSpinBox::valueChanged, value, [value] { value->setProperty("edited", true); });
    connect(duration, &QDoubleSpinBox::valueChanged, duration, [duration] { duration->setProperty("edited", true); });
    ruleTable->setCellWidget(row, 0, metric); ruleTable->setCellWidget(row, 1, op); ruleTable->setCellWidget(row, 2, value); ruleTable->setCellWidget(row, 3, duration);
}
void Window::loadSettings() {
    settingsRevision = services.config.value.value("_rev").toDouble();
    auto s = services.config.settings();
    if (ruleTable) { ruleTable->setRowCount(0); for (const auto &rule : s.value("rules").toArray()) addRule(rule.toObject()); }
    for (auto it = editors.begin(); it != editors.end(); ++it) {
        auto v = s.value(it.key());
        if (auto e = qobject_cast<QLineEdit *>(it.value())) e->setText(v.toVariant().toString());
        if (auto e = qobject_cast<QDoubleSpinBox *>(it.value())) { e->setValue(v.toVariant().toDouble()); e->setProperty("locationEdited", false); }
        if (auto e = qobject_cast<QComboBox *>(it.value())) { auto i = e->findData(it.key() == "stationSource" ? services.config.stationSource() : v.toString()); e->setCurrentIndex(std::max(0, i)); }
        if (auto e = qobject_cast<QCheckBox *>(it.value())) e->setChecked(v.toBool(it.key() == "nativeNotifications"));
    }
}
void Window::saveSettings() {
    if (settingsRevision != services.config.value.value("_rev").toDouble()) { settingsMessage->setText("Settings changed on another screen. Reopen Settings before saving."); return; }
    auto next = services.config.value; auto s = services.config.settings();
    for (auto it = editors.begin(); it != editors.end(); ++it) {
        if (auto e = qobject_cast<QLineEdit *>(it.value())) s[it.key()] = e->echoMode() == QLineEdit::Password ? e->text() : e->text().trimmed();
        if (auto e = qobject_cast<QDoubleSpinBox *>(it.value())) if (e->property("locationEdited").toBool() || !s.contains(it.key())) s[it.key()] = e->value();
        if (auto e = qobject_cast<QComboBox *>(it.value())) s[it.key()] = e->currentData().toString();
        if (auto e = qobject_cast<QCheckBox *>(it.value())) s[it.key()] = e->isChecked();
    }
    if ((services.config.settings().value("lat").isNull() || !services.config.settings().contains("lat")) && !editors.value("lat")->property("locationEdited").toBool() && !editors.value("lon")->property("locationEdited").toBool()) { s.remove("lat"); s.remove("lon"); }
    s["nativeForecastOnly"] = s.value("stationSource").toString().isEmpty();
    QJsonArray rules;
    for (int i = 0; i < ruleTable->rowCount(); ++i) {
        auto metric = qobject_cast<QComboBox *>(ruleTable->cellWidget(i, 0)); auto op = qobject_cast<QComboBox *>(ruleTable->cellWidget(i, 1));
        auto rule = metric->property("savedRule").toJsonObject();
        rule["metric"] = metric->currentData().toString(); rule["op"] = op->currentText();
        auto value = qobject_cast<QDoubleSpinBox *>(ruleTable->cellWidget(i, 2));
        auto duration = qobject_cast<QDoubleSpinBox *>(ruleTable->cellWidget(i, 3));
        if (value->property("edited").toBool()) rule["value"] = value->value();
        if (duration->property("edited").toBool()) rule["durMin"] = duration->value();
        rules.append(rule);
    }
    s["rules"] = rules;
    auto elevation = qobject_cast<QLineEdit *>(editors.value("elevationM"))->text().trimmed();
    bool validElevation = false; const double metres = elevation.toDouble(&validElevation);
    if (!elevation.isEmpty() && (!validElevation || !std::isfinite(metres) || metres < -500 || metres > 10000)) { settingsMessage->setText("Elevation must be between −500 and 10,000 metres."); return; }
    s["elevationM"] = elevation.isEmpty() ? QJsonValue() : QJsonValue(metres);
    for (const auto &key : {"quietStart", "quietEnd"}) {
        const auto text = s.value(key).toString();
        if (!text.isEmpty() && !QTime::fromString(text, "HH:mm").isValid()) { settingsMessage->setText("Quiet hours must use HH:mm."); return; }
    }
    if (!s.value("stationSource").toString().isEmpty() && fingerprint(s) == "none") { settingsMessage->setText("Enter a station ID, Tempest device ID, or Davis host before connecting a station."); return; }
    const auto bound = services.archive.meta("station_fingerprint"), incoming = fingerprint(s);
    if (!bound.isEmpty() && incoming != "none" && bound != incoming) { settingsMessage->setText("This archive belongs to another station. Use a separate data directory for a different station; export a backup first."); return; }
    next["settings"] = s; next["_rev"] = next.value("_rev").toDouble() + 1;
    QString error;
    if (!services.config.save(next, &error)) { settingsMessage->setText(error); return; }
    settingsRevision = services.config.value.value("_rev").toDouble();
    settingsMessage->setText("Changes saved."); services.refresh(); applyTheme(); render();
}
void Window::applyScale(double value) {
    scaleFactor = uiScale(value); local.setValue("scale", scaleFactor);
    auto index = scaleBox->findData(scaleFactor);
    if (index < 0) { scaleBox->addItem(QString::number(qRound(scaleFactor * 100)) + "%", scaleFactor); index = scaleBox->count() - 1; }
    scaleBox->setCurrentIndex(index);
    auto font = QApplication::font(); font.setPointSizeF(10 * scaleFactor); QApplication::setFont(font);
    applyTheme(); arrange();
#ifdef STORMDESK_RADAR
    if (radarLoaded) if (auto view = radarPage->findChild<QWebEngineView *>()) view->setZoomFactor(scaleFactor);
#endif
}
void Window::applyTheme() {
    const auto theme = services.config.text("theme", "graphite");
    const bool light = theme == "light";
    const QHash<QString, QString> accents{{"graphite", "#bed2ee"}, {"violet", "#c6a9ff"}, {"carbon", "#c4ec78"}, {"abyss", "#66c9ed"}, {"spruce", "#77d4b2"}, {"oxblood", "#ef9bab"}, {"copper", "#eab38a"}, {"indigo", "#aaa5ff"}, {"petrol", "#e2e480"}, {"espresso", "#d8be8a"}};
    const QString accent = accents.value(theme, light ? "#245185" : "#bed2ee");
    QString background = light ? "#eef2f6" : (theme == "dark" || theme == "contrast" ? "#000000" : "#10131a");
    QString panel = light ? "#ffffff" : (theme == "dark" ? "#06080b" : "#191e28");
    QString foreground = light ? "#182332" : "#eef3fb", muted = light ? "#506177" : "#a6b2c5", border = light ? "#cbd4df" : (theme == "contrast" ? "#ffffff" : "#30394a");
    QPalette palette; palette.setColor(QPalette::Window, QColor(background)); palette.setColor(QPalette::WindowText, QColor(foreground));
    palette.setColor(QPalette::Base, QColor(panel)); palette.setColor(QPalette::AlternateBase, QColor(background)); palette.setColor(QPalette::Text, QColor(foreground));
    palette.setColor(QPalette::Button, QColor(panel)); palette.setColor(QPalette::ButtonText, QColor(foreground)); palette.setColor(QPalette::Highlight, QColor(accent)); palette.setColor(QPalette::HighlightedText, QColor(background));
    qApp->setPalette(palette);
    auto px = [this](int n) { return QString::number(qRound(n * scaleFactor)); };
    qApp->setStyleSheet("QWidget { color:" + foreground + "; } QMainWindow,QScrollArea,QStackedWidget {background:" + background + ";} QScrollArea>QWidget>QWidget {background:" + background + ";}"
        "QFrame#card {background:" + panel + ";border:1px solid " + border + ";border-radius:" + px(12) + "px;} QFrame#card QLabel {background:transparent;border:none;}"
        "QLabel[kind=brand] {font-size:" + px(21) + "px;font-weight:800;letter-spacing:2px;} QLabel[kind=eyebrow] {color:" + muted + ";font-size:" + px(11) + "px;font-weight:600;}"
        "QLabel[kind=muted] {color:" + muted + ";} QLabel[kind=metric] {font-size:" + px(24) + "px;font-weight:600;} QLabel[kind=temperature] {font-size:" + px(76) + "px;font-weight:600;}"
        "QLabel[kind=subtitle] {font-size:" + px(24) + "px;font-weight:600;} QLabel[kind=notice] {padding:" + px(12) + "px;border:1px solid " + border + ";border-radius:8px;color:" + accent + ";}"
        "QPushButton,QComboBox,QLineEdit,QDoubleSpinBox {background:" + panel + ";border:1px solid " + border + ";border-radius:6px;padding:" + px(8) + "px " + px(12) + "px;min-height:" + px(20) + "px;}"
        "QPushButton:hover,QPushButton:checked {border-color:" + accent + ";color:" + accent + ";} QPushButton:focus,QComboBox:focus,QLineEdit:focus {border:2px solid " + accent + ";} QPushButton[primary=true] {background:" + accent + ";color:" + background + ";font-weight:600;}"
        "QTableWidget {background:" + panel + ";gridline-color:" + border + ";border:1px solid " + border + ";} QHeaderView::section {background:" + background + ";padding:" + px(8) + "px;border:none;}"
        "QTabWidget::pane {border:1px solid " + border + ";} QTabBar::tab {padding:" + px(10) + "px;background:" + panel + ";} QTabBar::tab:selected {color:" + accent + ";} QToolTip {color:" + foreground + ";background:" + panel + ";}");
}
void Window::arrange() {
    if (!metrics || !body) return;
    const double available = (width() - 60) / scaleFactor;
    const bool compact = available < 650;
    clock->setVisible(!compact);
    if (pages) for (auto form : pages->findChildren<QFormLayout *>()) {
        form->setRowWrapPolicy(compact ? QFormLayout::WrapAllRows : QFormLayout::WrapLongRows);
        for (int row = 0; row < form->rowCount(); ++row) if (auto item = form->itemAt(row, QFormLayout::LabelRole))
            if (auto label = qobject_cast<QLabel *>(item->widget())) label->setWordWrap(true);
    }
    for (auto button : navButtons) button->setVisible(!compact);
    pageSelect->setVisible(compact);
    navigation->removeWidget(scaleBox); navigation->removeWidget(refreshButton); navigation->removeWidget(pageSelect);
    navigation->setColumnStretch(4, compact ? 0 : 1);
    if (compact) {
        navigation->addWidget(pageSelect, 0, 0, 1, 2);
        navigation->addWidget(scaleBox, 1, 0); navigation->addWidget(refreshButton, 1, 1);
    } else { navigation->addWidget(scaleBox, 0, 5); navigation->addWidget(refreshButton, 0, 6); }
    const int columns = available >= 1280 ? 7 : (available >= 800 ? 4 : (available >= 480 ? 2 : 1));
    for (auto widget : metricCards) metrics->removeWidget(widget);
    for (int i = 0; i < metricCards.size(); ++i) metrics->addWidget(metricCards[i], i / columns, i % columns);
    if (!currentCard || !forecastCard || !contextCard) return;
    body->removeWidget(currentCard); body->removeWidget(forecastCard); body->removeWidget(contextCard);
    for (int i = 0; i < 3; ++i) body->setColumnStretch(i, 0);
    if (available >= 1050) {
        body->addWidget(currentCard, 0, 0); body->addWidget(forecastCard, 0, 1); body->addWidget(contextCard, 0, 2);
        body->setColumnStretch(0, 4); body->setColumnStretch(1, 5); body->setColumnStretch(2, 3);
    } else if (available >= 680) {
        body->addWidget(currentCard, 0, 0); body->addWidget(forecastCard, 0, 1); body->addWidget(contextCard, 1, 0, 1, 2);
        body->setColumnStretch(0, 1); body->setColumnStretch(1, 1);
    } else { body->addWidget(currentCard, 0, 0); body->addWidget(forecastCard, 1, 0); body->addWidget(contextCard, 2, 0); body->setColumnStretch(0, 1); }
}
void Window::resizeEvent(QResizeEvent *event) { QMainWindow::resizeEvent(event); arrange();
    heroTemperature->setStyleSheet("font-size:" + QString::number(qRound(std::min(76 * scaleFactor, std::max(36.0, (width() - 100) / 5.5)))) + "px;font-weight:600;");
}
void Window::render() {
    const auto &f = services.forecast;
    const bool staleForecast = f.contains("_at") && QDateTime::currentSecsSinceEpoch() - f.value("_at").toDouble() > 3600;
    const auto current = staleForecast ? QJsonObject() : f.value("current").toObject(); const auto daily = f.value("daily").toObject();
    const auto obs = services.observation;
    bool fresh = obs[0] && QDateTime::currentSecsSinceEpoch() - *obs[0] <= 900;
    bool metric = services.config.text("units") == "metric";
    auto value = [&](int index, const char *forecastKey = nullptr) -> QJsonValue {
        if (fresh && obs[index]) return *obs[index];
        return forecastKey ? current.value(forecastKey) : QJsonValue();
    };
    const double tempFactor = metric ? 1 : 1.8, tempShift = metric ? 0 : 32;
    const auto windLabel = services.config.windUnit(); const double windFactor = services.config.windFactor();
    location->setText(services.config.text("stationName", "Your weather, at a glance"));
    heroTemperature->setText(number(value(7, "temperature_2m"), metric ? " °C" : " °F", 1, tempFactor, tempShift));
    heroCondition->setText(current.contains("weather_code") ? condition(current.value("weather_code").toInt()) : "Waiting for weather");
    heroSource->setText(fresh && obs[7] ? "Station temperature · model sky" : staleForecast ? "Forecast is stale · refresh needed" : "Open-Meteo · forecast estimate");
    auto detail = currentCard->findChild<QLabel *>("conditionsDetail");
    detail->setText("Feels like " + number(fresh && obs[7] ? services.archive.current().value("feels_like") : current.value("apparent_temperature"), metric ? " °C" : " °F", 1, tempFactor, tempShift) +
        "\nGusts " + number(value(3, "wind_gusts_10m"), " " + windLabel, 1, windFactor));
    auto rainToday = value(18), strikes = value(15);
    if (fresh) {
        QSqlQuery rain(services.archive.db); rain.prepare("SELECT SUM(rain) FROM obs WHERE ts>=?"); rain.addBindValue(QDate::currentDate().startOfDay().toSecsSinceEpoch());
        if (!rainToday.isDouble() && rain.exec() && rain.next() && !rain.value(0).isNull()) rainToday = rain.value(0).toDouble();
        QSqlQuery lightning(services.archive.db); lightning.prepare("SELECT SUM(strikes) FROM obs WHERE ts>=?"); lightning.addBindValue(QDateTime::currentSecsSinceEpoch() - 10800);
        if (lightning.exec() && lightning.next() && !lightning.value(0).isNull()) strikes = lightning.value(0).toDouble();
    }
    metricValues[0]->setText(number(rainToday, metric ? " mm" : " in", metric ? 1 : 2, metric ? 1 : 1 / 25.4));
    metricValues[1]->setText(number(strikes, " strikes", 0));
    metricValues[2]->setText(number(value(2, "wind_speed_10m"), " " + windLabel, 1, windFactor));
    const auto temperature = value(7, "temperature_2m"), humidity = value(8, "relative_humidity_2m");
    const auto heat = temperature.isDouble() && humidity.isDouble() ? wbgt(temperature.toDouble(), humidity.toDouble(), value(11).toDouble(), value(2, "wind_speed_10m").toDouble()) : std::nullopt;
    metricValues[3]->setText(number(heat ? QJsonValue(*heat) : QJsonValue(), metric ? " °C" : " °F", 1, tempFactor, tempShift));
    const auto uv = daily.value("uv_index_max").toArray();
    metricValues[4]->setText(number(fresh && obs[10] ? QJsonValue(*obs[10]) : (!uv.isEmpty() ? uv[0] : QJsonValue()), "", 1));
    auto pressure = current.value("pressure_msl");
    auto elevation = services.config.settings().value("elevationM");
    if (!elevation.isDouble()) elevation = f.value("elevation");
    const bool stationPressure = fresh && obs[6] && elevation.isDouble();
    if (stationPressure) {
        double metres = elevation.toDouble(), c = value(7, "temperature_2m").toDouble(15);
        pressure = *obs[6] * std::pow(1 - (.0065 * metres) / (c + .0065 * metres + 273.15), -5.257);
    }
    metricValues[5]->setText(number(pressure, metric ? " hPa" : " inHg", metric ? 1 : 2, metric ? 1 : 1 / 33.8639));
    metricValues[6]->setText(number(value(8, "relative_humidity_2m"), "%", 0));
    for (int i = 0; i < 7; ++i) {
        const int indexes[] = {18, 15, 2, 7, 10, 6, 8};
        const bool measured = i == 5 ? stationPressure : fresh && obs[indexes[i]].has_value();
        const bool available = metricValues[i]->text() != "—";
        metricSources[i]->setText(!available ? "Unavailable" : i == 3 ? "Estimated heat stress" : i == 5 && measured ? "Station · sea level" : measured ? "Station measurement" : i == 4 ? "Forecast daily maximum" : "Forecast estimate");
        if (available && i == 0 && !obs[18]) metricSources[i]->setText("Archive · today");
        if (available && i == 1) metricSources[i]->setText("Station · last 3 hours");
        if (available && i == 3 && !value(11).isDouble()) metricSources[i]->setText("Shade estimate");
        metricValues[i]->setToolTip(metricSources[i]->text());
    }
    while (auto item = forecastRows->takeAt(0)) { delete item->widget(); delete item; }
    const auto times = daily.value("time").toArray();
    auto at = [&daily](const char *key, int i) { const auto a = daily.value(key).toArray(); return i < a.size() ? a[i] : QJsonValue(); };
    for (int i = 0; i < times.size(); ++i) {
        const auto date = QDateTime::fromSecsSinceEpoch(qint64(times[i].toDouble())).toOffsetFromUtc(f.value("utc_offset_seconds").toInt());
        QString day = date.date() == QDateTime::currentDateTimeUtc().toOffsetFromUtc(f.value("utc_offset_seconds").toInt()).date() ? "Today" : date.toString("ddd d");
        auto row = label(day + "   ·   " + condition(at("weather_code", i).toInt()) + "\n" + number(at("temperature_2m_max", i), "°", 0, tempFactor, tempShift) + " / " + number(at("temperature_2m_min", i), "°", 0, tempFactor, tempShift) + "   ·   " + number(at("precipitation_probability_max", i), "% rain", 0));
        forecastRows->addWidget(row);
    }
    forecastNote->setText(services.forecastStatus + (staleForecast ? "\nOlder forecast · refresh needed" : "\nOpen-Meteo · forecast estimates"));
    auto time = [&at, &f](const char *key) { auto n = at(key, 0); return n.isDouble() ? QDateTime::fromSecsSinceEpoch(qint64(n.toDouble())).toOffsetFromUtc(f.value("utc_offset_seconds").toInt()).toString("HH:mm") : "—"; };
    sun->setText("SUNRISE  " + time("sunrise") + "\nSUNSET   " + time("sunset") + "\nLocation local time");
    auto stationDetail = contextCard->findChild<QLabel *>("stationDetail");
    stationDetail->setText(services.stationStatus + (obs[0] && !fresh ? "\nLast measurement is stale." : "") + "\n" + services.warningStatus);
    QStringList warningText;
    for (const auto &v : services.warnings) { auto p = v.toObject().value("properties").toObject(); warningText << p.value("headline").toString(p.value("event").toString()); }
    alerts->setText(warningText.isEmpty() ? (services.warningStatus.isEmpty() ? "Choose a location in Settings to start." : services.warningStatus + " · No active warnings returned") : warningText.join("\n"));
    status->setText("C++ / Qt " QT_VERSION_STR "   ·   " + services.forecastStatus + "   ·   LAN :" + QString::number(server.serverPort()));
    if (pages->currentIndex() == 2) renderHistory();
}
void Window::renderHistory() {
    if (!plot || !historyTable) return;
    auto health = services.archive.health(); bool metric = services.config.text("units") == "metric";
    const auto windLabel = services.config.windUnit(); const double windFactor = services.config.windFactor();
    historySummary->setText(QString::number(health.value("rows").toDouble(), 'f', 0) + " archived readings · " + QString::number(health.value("bytes").toDouble() / (1024 * 1024), 'f', 1) + " MB · " + health.value("check").toString());
    QStringList keys{"temp", "rain", "wind_gust", "pressure", "humidity", "uv"};
    int selected = historyMetric->currentIndex(); const auto key = keys.value(selected, "temp");
    qint64 hours = historyRange->currentData().toLongLong(), end = QDateTime::currentSecsSinceEpoch(), begin = end - hours * 3600;
    const int bucket = std::max(qint64(60), hours * 3600 / 1000);
    QSqlQuery q(services.archive.db);
    q.prepare("SELECT (ts / ?) * ?," + QString(selected == 1 ? "SUM" : "AVG") + "(" + key + ") FROM obs WHERE ts>=? AND ts<=? AND " + key + " IS NOT NULL GROUP BY 1 ORDER BY 1");
    q.addBindValue(bucket); q.addBindValue(bucket); q.addBindValue(begin); q.addBindValue(end); plot->points.clear();
    double factor = 1, shift = 0;
    if (selected == 0) { factor = metric ? 1 : 1.8; shift = metric ? 0 : 32; plot->unit = metric ? "°C" : "°F"; }
    if (selected == 1) { factor = metric ? 1 : 1 / 25.4; plot->unit = metric ? "mm per chart interval" : "in per chart interval"; }
    if (selected == 2) { factor = windFactor; plot->unit = windLabel; }
    if (selected == 3) { factor = metric ? 1 : 1 / 33.8639; plot->unit = metric ? "hPa" : "inHg"; }
    if (selected == 4) plot->unit = "%";
    if (selected == 5) plot->unit = "UV index";
    if (q.exec()) while (q.next()) plot->points.append(QPointF(q.value(0).toDouble(), q.value(1).toDouble() * factor + shift));
    plot->update();
    auto days = services.archive.daily(QDateTime::currentDateTime().offsetFromUtc() / 60, begin);
    historyTable->setRowCount(days.size());
    for (int i = 0; i < days.size(); ++i) {
        auto day = days[days.size() - 1 - i].toObject(); QStringList values{day.value("day").toString(), number(day.value("tempMin"), "°", 1, metric ? 1 : 1.8, metric ? 0 : 32), number(day.value("tempMax"), "°", 1, metric ? 1 : 1.8, metric ? 0 : 32), number(day.value("gustMax"), " " + windLabel, 1, windFactor), number(day.value("rain"), metric ? " mm" : " in", 2, metric ? 1 : 1 / 25.4)};
        for (int j = 0; j < values.size(); ++j) historyTable->setItem(i, j, new QTableWidgetItem(values[j]));
    }
}
void Window::backup() {
    const auto file = QFileDialog::getSaveFileName(this, "Save complete backup", "stormdesk-" + QDateTime::currentDateTime().toString("yyyyMMdd-HHmmss") + ".wdbak", "StormDesk backup (*.wdbak)");
    if (file.isEmpty()) return; QString error;
    QTemporaryDir staging;
    const auto snapshot = file.startsWith("content:") ? staging.filePath("export.wdbak") : file;
    if (!services.archive.backup(snapshot, services.config.value, &error) || (snapshot != file && !copyDocument(snapshot, file, &error))) QMessageBox::warning(this, "Backup failed", error);
    else settingsMessage->setText("Backup saved. It includes credentials; keep it private.");
}
void Window::restore() {
    auto file = QFileDialog::getOpenFileName(this, "Inspect StormDesk backup", {}, "StormDesk backup (*.wdbak)");
    if (file.isEmpty()) return;
    QTemporaryDir staging; QString error;
    if (file.startsWith("content:")) {
        const auto copy = staging.filePath("restore.wdbak");
        if (!copyDocument(file, copy, &error)) { QMessageBox::warning(this, "Cannot read backup", error); return; }
        file = copy;
    }
    QJsonObject config; auto summary = Archive::inspect(file, &config, &error);
    if (summary.isEmpty()) { QMessageBox::warning(this, "Invalid backup", error); return; }
    const auto message = "Station: " + summary.value("station").toString() + "\nReadings: " + QString::number(summary.value("rows").toDouble(), 'f', 0) + "\n\nReplace this native app’s settings and archive? A recovery backup will be kept first.";
    if (QMessageBox::question(this, "Restore backup", message) != QMessageBox::Yes) return;
    auto recovery = QFileInfo(services.archive.path).dir().filePath("pre-restore-" + QDateTime::currentDateTime().toString("yyyyMMdd-HHmmss-zzz") + ".wdbak");
    if (!services.archive.backup(recovery, services.config.value, &error)) { QMessageBox::warning(this, "Recovery backup failed", error); return; }
    const auto oldConfig = services.config.value;
    if (!services.archive.restore(file, &error)) { QMessageBox::warning(this, "Restore failed", error); return; }
    if (!services.config.save(config, &error)) {
        QString rollbackError;
        services.archive.restore(recovery, &rollbackError); services.config.save(oldConfig, &rollbackError);
        QMessageBox::critical(this, "Restore failed", "Could not save restored settings: " + error + "\nRecovery backup: " + recovery + (rollbackError.isEmpty() ? "" : "\nRecovery error: " + rollbackError)); return;
    }
    QMessageBox::information(this, "Restore complete", "Backup restored. Restart StormDesk to reconnect station services. Recovery backup: " + recovery);
    qApp->quit();
}
void Window::exportCsv() {
    const auto file = QFileDialog::getSaveFileName(this, "Export weather archive", "stormdesk-history.csv", "CSV (*.csv)");
    if (file.isEmpty()) return; QString error;
    if (!services.archive.exportCsv(file, &error)) QMessageBox::warning(this, "Export failed", error);
}
void Window::notify(const QString &title, const QString &message) {
#ifndef QT_NO_SYSTEMTRAYICON
    if (services.config.settings().value("nativeNotifications").toBool(true) && tray) tray->showMessage(title, message, QSystemTrayIcon::Warning, 15000);
#endif
#ifdef STORMDESK_SPEECH
    if (services.config.settings().value("speakAlerts").toBool() && title != "Weather rule") {
        if (auto speech = findChild<QTextToSpeech *>()) {
            if (speech->state() == QTextToSpeech::Error) status->setText("Speech unavailable. Check the system voice and audio output.");
            else speech->say((title + ". " + message).left(4096));
        }
    }
#endif
}
}
