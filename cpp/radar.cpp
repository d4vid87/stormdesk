#include "radar.h"
#include <QDesktopServices>
#include <QPushButton>
#include <QResizeEvent>
#include <QShowEvent>
#include <QHideEvent>
#include <QScrollArea>
#ifdef STORMDESK_ANDROID_WEBVIEW
#include <QQuickView>
#include <QQuickItem>
#include <QCoreApplication>
#include <QFuture>
#include <QJniEnvironment>
#include <QJniObject>
#endif
#include <QVBoxLayout>
#include <algorithm>
#ifdef STORMDESK_WEBENGINE
#include <QWebEngineSettings>
#include <QWebEngineView>
#endif

namespace storm {
#ifdef STORMDESK_ANDROID_WEBVIEW
static void fitDashboardWebView(int width) {
  QNativeInterface::QAndroidApplication::runOnAndroidMainThread([width]() -> QVariant {
    if (!QNativeInterface::QAndroidApplication::isActivityContext()) return {};
    const auto activity = QNativeInterface::QAndroidApplication::context();
    const auto decor = activity.callObjectMethod("getWindow", "()Landroid/view/Window;")
                                  .callObjectMethod("getDecorView", "()Landroid/view/View;");
    QJniEnvironment env;
    const auto webView = env.findClass("android/webkit/WebView");
    const auto group = env.findClass("android/view/ViewGroup");
    QList<QJniObject> pending{decor};
    while (!pending.isEmpty()) {
      const auto view = pending.takeLast();
      if (!view.isValid()) continue;
      if (env->IsInstanceOf(view.object(), webView)) {
        if (!view.callMethod<jboolean>("isShown", "()Z")) continue;
        // Android ignores the viewport meta width until its native wide-viewport setting is enabled.
        const auto settings = view.callObjectMethod("getSettings", "()Landroid/webkit/WebSettings;");
        settings.callMethod<void>("setUseWideViewPort", "(Z)V", jboolean(true));
        const int viewport = std::max(720, width);
        const auto script = QJniObject::fromString(
            QString("document.querySelector('meta[name=viewport]').setAttribute('content',"
                    "'width=%1,initial-scale=%2,user-scalable=no')")
                .arg(viewport).arg(double(width) / viewport));
        view.callMethod<void>("evaluateJavascript",
            "(Ljava/lang/String;Landroid/webkit/ValueCallback;)V",
            script.object<jstring>(), jobject(nullptr));
      } else if (env->IsInstanceOf(view.object(), group)) {
        const int count = view.callMethod<jint>("getChildCount", "()I");
        for (int i = 0; i < count; ++i)
          pending << view.callObjectMethod("getChildAt", "(I)Landroid/view/View;", i);
      }
    }
    return {};
  });
}
#endif
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
#elif defined(STORMDESK_ANDROID_WEBVIEW)
  if (services.config.text("stationSource") != "demo") {
    mobileView = new QQuickView;
    mobileView->setResizeMode(QQuickView::SizeRootObjectToView);
    mobileView->setColor(QColor("#101214"));
    mobileView->setSource(QUrl("qrc:/native/AndroidRadar.qml"));
    auto container = QWidget::createWindowContainer(mobileView, this);
    container->setObjectName("hookEchoMobileView");
    container->setMinimumSize(0, 0);
    layout->insertWidget(1, container, 1);
    if (mobileView->rootObject()) {
      mobileView->rootObject()->setVisible(false);
      connect(mobileView->rootObject(), SIGNAL(pageLoaded(bool)), this, SLOT(pageLoaded(bool)));
    } else {
      status->setText("Radar view could not start. Open HookEcho or retry.");
      setProperty("hookEchoLoaded", false);
    }
  } else {
    status->setText("Synthetic demo mode · Live HookEcho radar is disabled.");
  }
#else
  status->setText("Open live HookEcho radar in your browser. Your selected "
                  "station and radar site carry over.");
  reload->hide();
#endif
  setScale(1);
}
void Radar::pageLoaded(bool ok) {
#ifdef STORMDESK_ANDROID_WEBVIEW
  if (ok && compact && isVisible()) fitDashboardWebView(width());
#endif
  setProperty("hookEchoLoaded", ok);
  status->setText(ok ? "HookEcho · Check the scan time on the map"
                     : "Radar could not load. Check your connection and retry.");
  status->setVisible(!immersive || !ok);
  for (auto button : buttons) button->setVisible(!immersive || !ok);
}
void Radar::hideEvent(QHideEvent *event) {
#ifdef STORMDESK_ANDROID_WEBVIEW
  if (mobileView && mobileView->rootObject())
    mobileView->rootObject()->setVisible(false);
#endif
  QWidget::hideEvent(event);
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
#ifdef STORMDESK_ANDROID_WEBVIEW
  if (mobileView && mobileView->rootObject())
    mobileView->rootObject()->setVisible(true);
#endif
  refresh();
}
void Radar::resizeEvent(QResizeEvent *event) {
  QWidget::resizeEvent(event);
#ifdef STORMDESK_ANDROID_WEBVIEW
  if (compact && isVisible() && property("hookEchoLoaded").toBool())
    fitDashboardWebView(width());
#endif
  const int columns = width() / scaleFactor < 420 ? 1 : 3;
  for (auto button : buttons)
    controls->removeWidget(button);
  for (int i = 0; i < buttons.size(); ++i)
    controls->addWidget(buttons[i], i / columns, i % columns);
}
void Radar::refresh() {
#ifdef STORMDESK_ANDROID_WEBVIEW
  if (!mobileView || !mobileView->rootObject() || !isVisible()) return;
  const auto url = services.radarUrl();
  if (loadedUrl == url) return;
  loadedUrl = url;
  status->setText("HookEcho · Loading live radar…");
  setProperty("hookEchoLoaded", false);
  status->show();
  if (mobileView->rootObject()->property("url").toUrl() == url)
    QMetaObject::invokeMethod(mobileView->rootObject(), "reload");
  else
    mobileView->rootObject()->setProperty("url", url);
#endif
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
RadarStage::RadarStage(Radar *background, QWidget *panel, QWidget *parent, bool mobileUi)
    : QWidget(parent), radar(background), instruments(panel), mobile(mobileUi) {
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
  if (mobile) {
    toggle->hide();
    const auto scroll = qobject_cast<QScrollArea *>(instruments);
    const int wanted = scroll && scroll->widget()
        ? scroll->widget()->sizeHint().height() : qRound(220 * scaleFactor);
    const int panelHeight = std::min(wanted, qRound(height() * .52));
    instruments->setGeometry(0, 0, width(), panelHeight);
    instruments->show();
    const int top = std::min(height(), panelHeight + 6);
    radar->setGeometry(0, top, width(), std::max(0, height() - top));
    radar->layout()->setContentsMargins(0, 0, 0, 0);
    return;
  }
  const int margin = qRound(12 * scaleFactor);
  const int panelWidth = std::max(1, width() - 2 * margin);
  if (!userToggled) {
#ifdef STORMDESK_WEBENGINE
    toggle->setChecked(width() / scaleFactor >= 900);
#else
    toggle->setChecked(true);
#endif
  }
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
#ifdef STORMDESK_WEBENGINE
  const int buttonTop =
      radarTop +
      (radar->height() > 300 * scaleFactor ? qRound(96 * scaleFactor) : margin);
#else
  const int buttonTop = radarTop + margin;
  radar->layout()->setContentsMargins(0, buttonHeight + 2 * margin, 0, 0);
#endif
  toggle->setGeometry(margin, buttonTop,
                      std::min(panelWidth, toggle->sizeHint().width()),
                      buttonHeight);
  radar->lower();
  instruments->raise();
  toggle->raise();
}
} // namespace storm
