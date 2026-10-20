#include "radar.h"
#include <QDesktopServices>
#include <QPushButton>
#include <QResizeEvent>
#include <QShowEvent>
#include <QVBoxLayout>
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
    view->setMinimumHeight(qRound((compact ? 920 : 640) * scale));
  }
#else
  Q_UNUSED(scale);
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
} // namespace storm
