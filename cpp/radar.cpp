#include "radar.h"
#include <QDesktopServices>
#include <QPushButton>
#include <QResizeEvent>
#include <QShowEvent>
#include <QVBoxLayout>
#include <algorithm>
#ifdef STORMDESK_WEBENGINE
#include <QWebEngineSettings>
#include <QWebEngineView>
#endif

namespace storm {
Radar::Radar(Services &s, QWidget *parent, bool compactMode)
    : QWidget(parent), services(s), compact(compactMode) {
  setAccessibleName("HookEcho live radar");
  setMinimumWidth(0);
  auto layout = new QVBoxLayout(this);
  layout->setContentsMargins(0, 0, 0, 0);
  status = new QLabel("HookEcho · Loading radar…");
  status->setWordWrap(true);
  status->setObjectName("hookEchoStatus");
  layout->addWidget(status);
  controls = new QGridLayout;
  auto reload = new QPushButton("Reload radar");
  auto open = new QPushButton("Open HookEcho");
  auto warnings = new QPushButton("Warnings");
  buttons = {reload, open, warnings};
  for (int i = 0; i < buttons.size(); ++i)
    controls->addWidget(buttons[i], 0, i);
  layout->addLayout(controls);
  connect(warnings, &QPushButton::clicked, this, &Radar::warningsRequested);
  connect(open, &QPushButton::clicked, this,
          [this] { QDesktopServices::openUrl(services.radarUrl()); });
  connect(reload, &QPushButton::clicked, this, [this] {
    loadedUrl = QUrl();
    refresh();
  });
  connect(&services, &Services::changed, this, &Radar::refresh);
#ifdef STORMDESK_WEBENGINE
  if (services.config.text("stationSource") != "demo") {
    view = new QWebEngineView(this);
    view->setObjectName("hookEchoWebView");
    view->setMinimumWidth(0);
    view->page()->setBackgroundColor(QColor("#101319"));
    view->settings()->setAttribute(QWebEngineSettings::FullScreenSupportEnabled,
                                   false);
    layout->insertWidget(1, view, 1);
    connect(view, &QWebEngineView::loadFinished, this, [this](bool ok) {
      status->setText(
          ok ? "HookEcho · Live feeds · Check the scan time on the map"
             : "HookEcho could not load. Check the connection, then reload or "
               "open HookEcho.");
      setProperty("hookEchoLoaded", ok);
      status->setVisible(!immersive || !ok);
      for (auto button : buttons)
        button->setVisible(!immersive || !ok);
    });
  } else
    status->setText("Synthetic demo mode · Live HookEcho radar is disabled.");
#else
  status->setText("Embedded HookEcho needs Qt WebEngine in this build. Open "
                  "HookEcho to use the live radar in your browser.");
  reload->hide();
#endif
  setScale(1);
}
void Radar::setScale(double scale) {
  scaleFactor = scale;
#ifdef STORMDESK_WEBENGINE
  if (view) {
    view->setZoomFactor(scale);
    view->setMinimumHeight(immersive ? 0
                                     : qRound((compact ? 920 : 640) * scale));
  }
#else
  Q_UNUSED(scale);
#endif
}
void Radar::setImmersive(bool enabled) {
  immersive = enabled;
  setScale(scaleFactor);
#ifdef STORMDESK_WEBENGINE
  if (view) {
    status->setVisible(!immersive);
    for (auto button : buttons)
      button->setVisible(!immersive);
  }
#endif
}
void Radar::showEvent(QShowEvent *event) {
  QWidget::showEvent(event);
  refresh();
}
void Radar::resizeEvent(QResizeEvent *event) {
  QWidget::resizeEvent(event);
  const int columns = width() / scaleFactor < 420 ? 1 : 3;
  for (auto button : buttons)
    controls->removeWidget(button);
  for (int i = 0; i < buttons.size(); ++i)
    controls->addWidget(buttons[i], i / columns, i % columns);
}
void Radar::refresh() {
#ifdef STORMDESK_WEBENGINE
  if (!view || !isVisible())
    return;
  const auto url = services.radarUrl();
  if (loadedUrl == url)
    return;
  loadedUrl = url;
  setProperty("hookEchoLoaded", false);
  status->setText("HookEcho · Loading radar…");
  view->setUrl(url);
#endif
}
RadarStage::RadarStage(Radar *background, QWidget *panel, QWidget *parent)
    : QWidget(parent), radar(background), instruments(panel) {
  setObjectName("radarStage");
  setMinimumSize(0, 0);
  radar->setParent(this);
  radar->setImmersive(true);
  instruments->setParent(this);
  instruments->setObjectName("instrumentShelf");
  toggle = new QPushButton("Hide instruments", this);
  toggle->setObjectName("toggleInstruments");
  toggle->setCheckable(true);
  toggle->setChecked(true);
  toggle->setAccessibleName("Show or hide native instruments");
  connect(toggle, &QPushButton::clicked, this, [this] {
    userToggled = true;
    arrange();
  });
}
void RadarStage::setScale(double value) {
  scaleFactor = value;
  arrange();
}
void RadarStage::resizeEvent(QResizeEvent *event) {
  QWidget::resizeEvent(event);
  arrange();
}
void RadarStage::arrange() {
  const int margin = qRound(12 * scaleFactor);
  const int panelWidth = std::max(1, width() - 2 * margin);
  if (!userToggled)
    toggle->setChecked(width() / scaleFactor >= 900);
  const int buttonHeight = toggle->sizeHint().height();
  const int panelHeight =
      std::max(0, std::min(qRound(330 * scaleFactor), qRound(height() * .46)));
  instruments->setGeometry(margin, 0, panelWidth, panelHeight);
  const bool expanded = toggle->isChecked() && panelHeight > 0;
  instruments->setVisible(expanded);
  toggle->setText(toggle->isChecked() ? "Hide instruments"
                                      : "Show instruments");
  const int radarTop =
      expanded ? std::min(height(), panelHeight + qRound(6 * scaleFactor)) : 0;
  radar->setGeometry(0, radarTop, width(), std::max(0, height() - radarTop));
  const int buttonTop =
      radarTop +
      (radar->height() > 300 * scaleFactor ? qRound(96 * scaleFactor) : margin);
  toggle->setGeometry(margin, buttonTop,
                      std::min(panelWidth, toggle->sizeHint().width()),
                      buttonHeight);
  radar->lower();
  instruments->raise();
  toggle->raise();
}
} // namespace storm
