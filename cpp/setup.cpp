#include "setup.h"
#include <QApplication>
#include <QCheckBox>
#include <QComboBox>
#include <QDateTime>
#include <QDoubleSpinBox>
#include <QFormLayout>
#include <QGridLayout>
#include <QJsonDocument>
#include <QLabel>
#include <QLineEdit>
#include <QPointer>
#include <QPushButton>
#include <QResizeEvent>
#include <QScreen>
#include <QScrollArea>
#include <QScroller>
#include <QStackedWidget>
#include <QTimer>
#include <QUrlQuery>
#include <QVBoxLayout>

namespace storm {
static QLabel *copy(const QString &text, const char *kind = "muted") {
  auto l = new QLabel(text);
  l->setWordWrap(true);
  l->setTextFormat(Qt::PlainText);
  l->setProperty("kind", kind);
  return l;
}
SetupDialog::SetupDialog(Services &s, quint16 port, double scale, Apply save,
                         std::function<void()> restore, QWidget *parent)
    : QDialog(parent), services(s), apply(std::move(save)) {
  setObjectName("stationSetup");
  setWindowTitle("Welcome to StormDesk · Instrument");
  setAttribute(Qt::WA_DeleteOnClose);
  setMinimumSize(240, 240);
  resize(850, 760);
  if (parent)
    resize(size().boundedTo(parent->size()));
  auto root = new QVBoxLayout(this);
  root->setSizeConstraint(QLayout::SetNoConstraint);
  progress = copy({}, "eyebrow");
  root->addWidget(progress);
  auto content = new QWidget;
  auto layout = new QVBoxLayout(content);
  heading = copy("Welcome to StormDesk.", "subtitle");
  layout->addWidget(heading);
  pages = new QStackedWidget;
  pages->setSizePolicy(QSizePolicy::Ignored, QSizePolicy::Preferred);
  layout->addWidget(pages);
  auto scroll = new QScrollArea;
  scroll->setWidgetResizable(true);
  scroll->setFrameShape(QFrame::NoFrame);
  scroll->setWidget(content);
  QScroller::grabGesture(scroll->viewport(), QScroller::TouchGesture);
  root->addWidget(scroll, 1);
  message = copy({});
  message->setObjectName("setupMessage");
  root->addWidget(message);
  navigation = new QGridLayout;
  auto buttons = navigation;
  back = new QPushButton("Back");
  back->setObjectName("setupBack");
  next = new QPushButton("Continue");
  next->setProperty("primary", true);
  next->setObjectName("setupNext");
  skip = new QPushButton("Finish while waiting");
  skip->hide();
  auto close = new QPushButton("Close");
  closeButton = close;
  buttons->addWidget(back, 0, 0);
  buttons->addWidget(next, 0, 1);
  buttons->addWidget(close, 1, 0);
  buttons->addWidget(skip, 1, 1);
  root->addLayout(buttons);
  connect(close, &QPushButton::clicked, this, &QDialog::reject);
  connect(back, &QPushButton::clicked, this, [this] {
    int i = pages->currentIndex();
    showStep(i == 3 && path == "forecast" ? 1 : i - 1);
  });
  connect(next, &QPushButton::clicked, this, &SetupDialog::advance);
  connect(skip, &QPushButton::clicked, this, [this] { showStep(4); });
  auto page = [this]() {
    auto w = new QWidget;
    auto l = new QVBoxLayout(w);
    l->setContentsMargins(0, 16, 0, 16);
    l->setSpacing(16);
    pages->addWidget(w);
    return l;
  };
  auto start = page();
  start->addWidget(
      copy("Your weather, closer. Choose how you’d like to start."));
  for (const auto &option : QList<QPair<QString, QString>>{
           {"Connect WeatherFlow\nTempest", "tempest"},
           {"Connect my station", "station"},
           {"Find my weather", "forecast"},
           {"Restore a backup", "restore"}}) {
    auto b = new QPushButton(option.first);
    b->setMinimumHeight(64);
    b->setObjectName("setup-" + option.second);
    start->addWidget(b);
    connect(b, &QPushButton::clicked, this, [this, option, restore] {
      if (option.second == "restore") {
        restore();
        accept();
        return;
      }
      if (option.second == "tempest") {
        path = "station";
        source->setCurrentIndex(source->findData("tempest"));
        method->setCurrentIndex(1);
        showStep(2);
        return;
      }
      path = option.second;
      showStep(1);
    });
  }
  start->addWidget(copy(
      "Forecasts work without a station. Add a device whenever you’re ready."));
  start->addStretch();
  auto select = page();
  auto form = new QFormLayout;
  form->setRowWrapPolicy(QFormLayout::WrapAllRows);
  source = new QComboBox;
  source->setObjectName("setupSource");
  for (const auto &a : QList<QPair<QString, QString>>{
           {"WeatherFlow Tempest", "tempest"},
           {"Ecowitt / Wittboy", "ecowitt"},
           {"Davis WeatherLink Live", "wll"},
           {"Ambient cloud", "awn"},
           {"Ambient custom upload", "ambient"},
           {"La Crosse cloud", "lacrosse"},
           {"AcuRite / WeeWX / compatible upload", "wu"}})
    source->addItem(a.first, a.second);
  source->setSizeAdjustPolicy(QComboBox::AdjustToMinimumContentsLengthWithIcon);
  source->setMinimumContentsLength(8);
  source->setCurrentIndex(
      std::max(0, source->findData(services.config.stationSource())));
  form->addRow("Station", source);
  select->addLayout(form);
  locationFields = new QWidget;
  form = new QFormLayout(locationFields);
  form->setContentsMargins(0, 0, 0, 0);
  form->setRowWrapPolicy(QFormLayout::WrapAllRows);
  name = new QLineEdit(services.config.text("stationName"));
  name->setObjectName("setupName");
  form->addRow("Location name", name);
  auto search = new QLineEdit;
  search->setPlaceholderText("Town or postcode");
  search->setAccessibleName("Find a location");
  form->addRow("Find my weather", search);
  auto findPlace = new QPushButton("Find location");
  form->addRow(findPlace);
  places = new QComboBox;
  places->setAccessibleName("Matching locations");
  places->setMinimumContentsLength(6);
  places->setSizeAdjustPolicy(QComboBox::AdjustToMinimumContentsLengthWithIcon);
  form->addRow(places);
  latitude = new QDoubleSpinBox;
  longitude = new QDoubleSpinBox;
  latitude->setRange(-90, 90);
  longitude->setRange(-180, 180);
  latitude->setDecimals(5);
  longitude->setDecimals(5);
  latitude->setObjectName("setupLatitude");
  longitude->setObjectName("setupLongitude");
  const auto settings = services.config.settings();
  locationSet =
      settings.value("lat").isDouble() && settings.value("lon").isDouble();
  latitude->setValue(settings.value("lat").toDouble());
  longitude->setValue(settings.value("lon").toDouble());
  form->addRow("Latitude", latitude);
  form->addRow("Longitude", longitude);
  select->addWidget(locationFields);
  locationHint = copy({});
  select->addWidget(locationHint);
  select->addStretch();
  connect(latitude, &QDoubleSpinBox::valueChanged, this,
          [this] { locationSet = true; });
  connect(longitude, &QDoubleSpinBox::valueChanged, this,
          [this] { locationSet = true; });
  connect(findPlace, &QPushButton::clicked, this, [this, search] {
    if (search->text().trimmed().isEmpty()) {
      message->setText("Enter a town or postcode first.");
      return;
    }
    QUrl url("https://geocoding-api.open-meteo.com/v1/search");
    QUrlQuery q;
    q.addQueryItem("name", search->text().trimmed());
    q.addQueryItem("count", "8");
    url.setQuery(q);
    message->setText("Finding locations…");
    QPointer<SetupDialog> guard(this);
    services.request(url, [guard](QJsonDocument doc, QString error) {
      if (!guard)
        return;
      guard->places->clear();
      if (!error.isEmpty()) {
        guard->message->setText(error);
        return;
      }
      for (const auto &v : doc.object().value("results").toArray()) {
        const auto p = v.toObject();
        guard->places->addItem(p.value("name").toString() + ", " +
                                   p.value("admin1").toString() + " · " +
                                   p.value("country").toString(),
                               p);
      }
      guard->message->setText(
          guard->places->count()
              ? "Choose your location below."
              : "No results. Try a nearby town or enter coordinates.");
    });
  });
  connect(places, &QComboBox::activated, this, [this](int i) {
    auto p = places->itemData(i).toJsonObject();
    latitude->setValue(p.value("latitude").toDouble());
    longitude->setValue(p.value("longitude").toDouble());
    name->setText(p.value("name").toString());
    locationSet = true;
  });
  auto connectPage = page();
  instructions = copy({});
  connectPage->addWidget(instructions);
  auto credentials = new QFormLayout;
  credentials->setRowWrapPolicy(QFormLayout::WrapAllRows);
  method = new QComboBox;
  method->addItems({"Local hub (UDP)", "WeatherFlow cloud"});
  method->setObjectName("setupMethod");
  method->setCurrentIndex(
      services.config.text("nativeTempestConnection", "cloud") == "local" ? 0
                                                                          : 1);
  auto methodLabel = copy("Tempest connection");
  methodLabel->setObjectName("setupMethodLabel");
  credentials->addRow(methodLabel, method);
  const QList<QPair<QString, QString>> specs{
      {"token", "WeatherFlow personal access token"},
      {"stationId", "Station ID / MAC"},
      {"tempestSerial", "Tempest serial (local hub)"},
      {"deviceId", "Tempest device ID (cloud)"},
      {"wllHost", "Davis host / IP"},
      {"awnApiKey", "Ambient API key"},
      {"awnAppKey", "Ambient application key"},
      {"lacrosseEmail", "La Crosse email"},
      {"lacrossePass", "La Crosse password"},
      {"ingestKey", "Upload key"}};
  for (const auto &f : specs) {
    auto edit = new QLineEdit(services.config.text(f.first));
    edit->setObjectName("setup-" + f.first);
    edit->setAccessibleName(f.second);
    if (QStringList{"token", "awnApiKey", "awnAppKey", "lacrossePass",
                    "ingestKey"}
            .contains(f.first))
      edit->setEchoMode(QLineEdit::Password);
    auto l = copy(f.second);
    credentials->addRow(l, edit);
    fields[f.first] = edit;
    fieldLabels[f.first] = l;
  }
  connectPage->addLayout(credentials);
  found = new QComboBox;
  found->setObjectName("setupStations");
  found->setAccessibleName("Discovered stations");
  found->setPlaceholderText("Choose your station");
  found->setMinimumContentsLength(6);
  found->setSizeAdjustPolicy(QComboBox::AdjustToMinimumContentsLengthWithIcon);
  connectPage->addWidget(found);
  discover = new QPushButton("Find station");
  discover->setObjectName("setupDiscover");
  connectPage->addWidget(discover);
  stationSummary = copy({});
  stationSummary->setObjectName("setupStationSummary");
  connectPage->addWidget(stationSummary);
  fields["token"]->setPlaceholderText("Paste your WeatherFlow personal token");
  connect(fields["token"], &QLineEdit::textChanged, this, [this] {
    importedTempest = {};
    found->clear();
    found->setProperty("tempestToken", QString());
    stationSummary->clear();
    fields["stationId"]->clear();
    fields["deviceId"]->clear();
  });
  connect(fields["token"], &QLineEdit::returnPressed, discover,
          &QPushButton::click);
  connect(discover, &QPushButton::clicked, this, [this] {
    if (source->currentData() == "wll") {
      emit services.discoveryRequested();
      message->setText(
          "Looking on your home network. You can also enter the hub address.");
      return;
    }
    if (source->currentData() != "tempest" || method->currentIndex() != 1) {
      message->setText(
          "For local Tempest, enter its serial from the station label. Upload "
          "gateways are configured in their manufacturer’s app.");
      return;
    }
    const auto token = fields["token"]->text().trimmed();
    if (token.isEmpty()) {
      message->setText("Paste your WeatherFlow personal token first.");
      return;
    }
    importedTempest = {};
    found->clear();
    found->setProperty("tempestToken", QString());
    stationSummary->clear();
    discover->setEnabled(false);
    message->setText("Importing your WeatherFlow stations…");
    QUrl url("https://swd.weatherflow.com/swd/rest/stations");
    QUrlQuery q;
    q.addQueryItem("token", token);
    url.setQuery(q);
    QPointer<SetupDialog> guard(this);
    services.request(url, [guard, token](QJsonDocument doc, QString error) {
      if (!guard)
        return;
      guard->discover->setEnabled(true);
      if (guard->source->currentData() != "tempest" ||
          guard->method->currentIndex() != 1 ||
          guard->fields["token"]->text().trimmed() != token)
        return;
      if (!error.isEmpty()) {
        guard->message->setText("Could not import WeatherFlow stations. Check "
                                "the token and connection. " +
                                error);
        return;
      }
      if (doc.object()
              .value("status")
              .toObject()
              .value("status_code")
              .toInt() != 0) {
        guard->message->setText("WeatherFlow rejected the token. Check its "
                                "account access and try again.");
        return;
      }
      guard->found->setProperty("tempestToken", token);
      for (const auto &v : doc.object().value("stations").toArray()) {
        const auto station = v.toObject();
        const auto settings = tempestStationSettings(station, nullptr);
        if (!settings.isEmpty())
          guard->found->addItem(settings.value("stationName").toString() +
                                    " · " +
                                    settings.value("stationId").toString(),
                                station);
      }
      if (guard->found->count() == 1)
        guard->selectStation(0);
      else {
        guard->found->setCurrentIndex(-1);
        guard->message->setText(
            guard->found->count()
                ? "Choose your station. Its location will set warnings and "
                  "NEXRAD radar automatically."
                : "No Tempest station with a valid location was found. Check "
                  "this token’s account access.");
      }
    });
  });
  connect(found, &QComboBox::activated, this, &SetupDialog::selectStation);
  uploadHint =
      copy("Custom uploads: use this computer’s LAN address, port " +
           QString::number(port) +
           ", and /ingest/ followed by your upload key. Allow local network "
           "access; guest Wi-Fi may isolate devices.");
  connectPage->addWidget(uploadHint);
  connectPage->addStretch();
  auto verification = page();
  checkStatus = copy({});
  checkStatus->setObjectName("setupConnectionStatus");
  verification->addWidget(checkStatus);
  auto retry = new QPushButton("Check again");
  verification->addWidget(retry);
  connect(retry, &QPushButton::clicked, &services, &Services::refresh);
  verification->addWidget(
      copy("Connection details were saved when you selected Save and test. You "
           "can close this setup while readings arrive."));
  verification->addStretch();
  auto personalize = page();
  auto preferences = new QFormLayout;
  preferences->setRowWrapPolicy(QFormLayout::WrapAllRows);
  units = new QComboBox;
  units->addItem("Fahrenheit / US", "imperial");
  units->addItem("Celsius / metric", "metric");
  units->setCurrentIndex(services.config.text("units") == "metric" ? 1 : 0);
  preferences->addRow("Units", units);
  sizeChoice = new QComboBox;
  sizeChoice->setAccessibleName("Setup interface size");
  for (int percent : {70, 85, 100, 115, 125, 150, 175, 200})
    sizeChoice->addItem(QString::number(percent) + "%", percent / 100.0);
  sizeChoice->setCurrentIndex(std::max(0, sizeChoice->findData(scale)));
  preferences->addRow("Interface size", sizeChoice);
  motion = new QCheckBox("Animate weather icons");
  motion->setChecked(settings.value("nativeMotion").toBool(true));
  preferences->addRow(motion);
  notifications = new QCheckBox("Weather warnings");
  notifications->setChecked(settings.value("nativeNotifications").toBool(true));
  preferences->addRow(notifications);
  personalize->addLayout(preferences);
  personalize->addWidget(
      copy("Your choices remain available in Settings. Switch off Icon "
           "animation in Appearance to stop decorative weather motion."));
  personalize->addStretch();
  connect(source, &QComboBox::currentIndexChanged, this,
          [this] { connectionForm(); });
  connect(method, &QComboBox::currentIndexChanged, this,
          [this] { connectionForm(); });
  connect(&services, &Services::changed, this, [this] {
    if (source->currentData() == "wll") {
      auto selected = found->currentData();
      found->clear();
      for (const auto &v : services.discovered) {
        auto p = v.toObject();
        found->addItem(p.value("name").toString() + " · " +
                           p.value("host").toString(),
                       p.value("host"));
      }
      found->setCurrentIndex(std::max(0, found->findData(selected)));
    }
    if (pages->currentIndex() == 3)
      checkConnection();
  });
  connectionForm();
  showStep(0);
}
void SetupDialog::selectStation(int index) {
  if (source->currentData() == "wll") {
    fields["wllHost"]->setText(found->itemData(index).toString());
    return;
  }
  importedTempest = {};
  if (source->currentData() != "tempest" || method->currentIndex() != 1 ||
      fields["token"]->text().trimmed().isEmpty() ||
      found->property("tempestToken").toString() !=
          fields["token"]->text().trimmed()) {
    message->setText("Import the station again with your current token.");
    return;
  }
  QString error;
  const auto settings =
      tempestStationSettings(found->itemData(index).toJsonObject(), &error);
  if (settings.isEmpty()) {
    stationSummary->clear();
    message->setText(error);
    return;
  }
  importedTempest = settings;
  for (const auto &key : {"stationId", "deviceId", "tempestSerial"})
    fields[key]->setText(settings.value(key).toString());
  latitude->setValue(settings.value("lat").toDouble());
  longitude->setValue(settings.value("lon").toDouble());
  locationSet = true;
  name->setText(settings.value("stationName").toString());
  stationSummary->setText(
      settings.value("stationName").toString() + "\nStation location: " +
      QString::number(settings.value("lat").toDouble(), 'f', 5) + ", " +
      QString::number(settings.value("lon").toDouble(), 'f', 5) +
      "\nNEXRAD WSR-88D radar: " + settings.value("radarSite").toString() +
      "\nOfficial warnings and forecasts will use this station location.");
  message->setText(
      "Station imported. Save and test to connect and load local warnings.");
}
void SetupDialog::resizeEvent(QResizeEvent *event) {
  QDialog::resizeEvent(event);
  if (!navigation)
    return;
  const bool compact =
      width() < 700 * std::max(1.0, QApplication::font().pixelSize() / 14.0);
  for (auto b : {back, next, closeButton, skip})
    navigation->removeWidget(b);
  navigation->addWidget(back, 0, 0);
  navigation->addWidget(next, compact ? 1 : 0, compact ? 0 : 1);
  navigation->addWidget(closeButton, compact ? 2 : 1, 0);
  navigation->addWidget(skip, compact ? 3 : 1, compact ? 0 : 1);
}
void SetupDialog::showStep(int i) {
  pages->setCurrentIndex(i);
  message->clear();
  const QStringList titles{"Welcome to StormDesk.", "A place for your weather.",
                           "Let’s make contact.", "Check your connection.",
                           "Make yourself at home."};
  heading->setText(titles[i]);
  progress->setText("STORMDESK · SETUP " + QString::number(i + 1) +
                    " OF 5");
  source->setVisible(path == "station");
  back->setEnabled(i > 0);
  next->setVisible(i > 0);
  next->setEnabled(true);
  next->setText(i == 4                         ? "Open dashboard"
                : i == 2                       ? "Save and test"
                : i == 1 && path == "forecast" ? "Load weather"
                                               : "Continue");
  skip->setVisible(i == 3);
  connectionForm();
  if (i == 3)
    checkConnection();
}
void SetupDialog::connectionForm() {
  const QString type = source->currentData().toString();
  const bool tempest = type == "tempest", cloud = method->currentIndex() == 1;
  const bool importLocation = path == "station" && tempest && cloud;
  locationFields->setVisible(!importLocation);
  locationHint->setText(
      importLocation ? "Connect with your WeatherFlow token on the next "
                       "screen. Your station’s location, local warnings and "
                       "nearest NEXRAD WSR-88D radar will be set automatically."
                     : "Choose a search result or enter coordinates for "
                       "forecasts, radar and official warnings.");
  discover->setText(importLocation ? "Import station" : "Find station");
  discover->setVisible(importLocation || type == "wll");
  found->setVisible(importLocation || type == "wll");
  stationSummary->setVisible(importLocation);
  uploadHint->setVisible(!tempest && type != "wll" && type != "awn" &&
                         type != "lacrosse");
  for (auto key : {"stationId", "deviceId"}) {
    fields[key]->setReadOnly(importLocation);
    fields[key]->setPlaceholderText(importLocation ? "Imported automatically"
                                                   : "");
  }
  method->setVisible(tempest);
  findChild<QLabel *>("setupMethodLabel")->setVisible(tempest);
  const QHash<QString, QStringList> visible{
      {"tempest", cloud ? QStringList{"deviceId", "token", "stationId"}
                        : QStringList{"tempestSerial", "stationId"}},
      {"wll", {"wllHost"}},
      {"awn", {"awnApiKey", "awnAppKey", "stationId"}},
      {"lacrosse", {"lacrosseEmail", "lacrossePass", "stationId"}}};
  const auto keys = visible.value(type, {"stationId", "ingestKey"});
  for (auto it = fields.begin(); it != fields.end(); ++it) {
    it.value()->setVisible(keys.contains(it.key()));
    fieldLabels[it.key()]->setVisible(keys.contains(it.key()));
  }
  instructions->setText(
      tempest
          ? (cloud ? "Paste your WeatherFlow personal access token, then "
                     "select Import station. StormDesk imports the station "
                     "location, picks NEXRAD WSR-88D radar, and loads local "
                     "warnings when you save. Your token stays in private "
                     "settings."
                   : "Power the Tempest hub and join the same network. "
                     "Enter your Tempest serial to accept only your "
                     "station’s broadcasts. No cloud token is needed.")
      : type == "wll" ? "Power your WeatherLink Live hub and join the same "
                        "network. Find the hub or enter its IP address."
      : type == "awn" || type == "lacrosse"
          ? "Enter your provider account details and station identity. "
            "StormDesk checks the actual provider feed."
          : "Set a station ID and upload key. In your gateway’s app, enable a "
            "compatible custom weather upload to StormDesk.");
}
QJsonObject SetupDialog::changes() const {
  QJsonObject out{{"nativeSetupPending", true},
                  {"stationName", name->text().trimmed()},
                  {"lat", latitude->value()},
                  {"lon", longitude->value()},
                  {"activePlace", ""},
                  {"stationSource", path == "forecast"
                                        ? QString()
                                        : source->currentData().toString()}};
  if (path == "station") {
    if (source->currentData() == "tempest")
      out["nativeTempestConnection"] =
          method->currentIndex() == 1 ? "cloud" : "local";
    for (auto it = fields.begin(); it != fields.end(); ++it)
      if (!it.value()->isHidden())
        out[it.key()] = it.value()->echoMode() == QLineEdit::Password
                            ? it.value()->text()
                            : it.value()->text().trimmed();
    if (source->currentData() == "tempest" && method->currentIndex() == 1) {
      for (auto it = importedTempest.begin(); it != importedTempest.end(); ++it)
        out[it.key()] = it.value();
      out["token"] = fields["token"]->text().trimmed();
    }
    if (source->currentData() == "tempest" && method->currentIndex() == 0) {
      out["token"] = "";
      out["deviceId"] = "";
      if (out.value("stationId").toString().isEmpty())
        out["stationId"] = out.value("tempestSerial");
    }
  }
  return out;
}
void SetupDialog::advance() {
  const int step = pages->currentIndex();
  const bool cloudImport = path == "station" &&
                           source->currentData() == "tempest" &&
                           method->currentIndex() == 1;
  if (step == 2 && cloudImport && importedTempest.isEmpty()) {
    message->setText(
        "Paste your WeatherFlow token and select Import station first.");
    return;
  }
  if (((step == 1 && !cloudImport) || step == 2) &&
      (!locationSet || name->text().trimmed().isEmpty())) {
    message->setText("Choose a location and give it a name first.");
    return;
  }
  if (step == 1 && path == "station") {
    showStep(2);
    return;
  }
  if (step == 2 || (step == 1 && path == "forecast")) {
    if (step == 2) {
      const QString type = source->currentData().toString();
      QStringList required;
      if (type == "tempest")
        required = method->currentIndex() == 1
                       ? QStringList{"deviceId", "token"}
                       : QStringList{"tempestSerial"};
      else if (type == "wll")
        required = {"wllHost"};
      else if (type == "awn")
        required = {"awnApiKey", "awnAppKey", "stationId"};
      else if (type == "lacrosse")
        required = {"lacrosseEmail", "lacrossePass"};
      else
        required = {"stationId", "ingestKey"};
      for (const auto &key : required)
        if (fields[key]->text().trimmed().isEmpty()) {
          message->setText("Enter " + fieldLabels[key]->text() +
                           " before connecting.");
          return;
        }
    }
    QString error;
    if (!apply(changes(), &error)) {
      message->setText(error);
      return;
    }
    testedAt = QDateTime::currentSecsSinceEpoch();
    showStep(3);
    return;
  }
  if (step == 3) {
    showStep(4);
    return;
  }
  if (step == 4) {
    QString error;
    if (!apply({{"units", units->currentData().toString()},
                {"fontScale", sizeChoice->currentData().toDouble()},
                {"nativeMotion", motion->isChecked()},
                {"nativeNotifications", notifications->isChecked()},
                {"nativeSetupDone", true},
                {"nativeSetupPending", false}},
               &error)) {
      message->setText(error);
      return;
    }
    accept();
  }
}
void SetupDialog::checkConnection() {
  const auto now = QDateTime::currentSecsSinceEpoch();
  const auto obs = services.observation;
  bool ready = false;
  if (path == "forecast") {
    const auto current = services.forecast.value("current").toObject();
    ready = services.forecast.value("_at").toDouble() >= testedAt - 1 &&
            services.forecast.value("_at").toDouble() <= now + 60 &&
            current.value("temperature_2m").isDouble();
    checkStatus->setText(
        ready
            ? "Forecast received from Open-Meteo.\n" + services.forecastStatus +
                  "\nOfficial warnings: " + services.warningStatus
            : "Waiting for live forecast data…\n" + services.forecastStatus);
  } else {
    ready = obs[0] && *obs[0] >= now - 900 && *obs[0] <= now + 60;
    checkStatus->setText(
        ready ? "Station reading received.\nLast report: " +
                    QDateTime::fromSecsSinceEpoch(qint64(*obs[0]))
                        .toString("ddd d MMM HH:mm:ss") +
                    "\n" + services.stationStatus
              : "No recent station reading yet.\n" + services.stationStatus +
                    "\nCheck power, credentials and local network access. You "
                    "can finish setup and keep waiting.");
  }
  if (path != "forecast")
    checkStatus->setText(
        checkStatus->text() +
        "\nOfficial warnings at this location: " + services.warningStatus +
        "\nRadar: " + nexradSite(services.config.location()) +
        " · NEXRAD WSR-88D");
  next->setEnabled(ready);
}
} // namespace storm
