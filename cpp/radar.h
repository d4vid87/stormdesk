#pragma once
#include "services.h"
#include <QGridLayout>
#include <QLabel>
#include <QPushButton>
#include <QWidget>
#ifdef STORMDESK_WEBENGINE
class QWebEngineView;
#endif
#ifdef STORMDESK_ANDROID_WEBVIEW
class QQuickView;
#endif

namespace storm {
class Radar : public QWidget {
  Q_OBJECT
public:
  explicit Radar(Services &services, QWidget *parent = nullptr,
                 bool compact = false);
  void refresh();
  void setScale(double scale);
  void setImmersive(bool enabled);
signals:
  void warningsRequested();
protected:
  void showEvent(QShowEvent *event) override;
  void resizeEvent(QResizeEvent *event) override;
  void hideEvent(QHideEvent *event) override;
private slots:
  void pageLoaded(bool ok);
private:
  Services &services;
  bool compact, immersive = false;
  QLabel *status;
  QUrl loadedUrl;
  QGridLayout *controls;
  QList<QPushButton *> buttons;
  double scaleFactor = 1;
#ifdef STORMDESK_ANDROID_WEBVIEW
  QQuickView *mobileView = nullptr;
  QWidget *mobileContainer = nullptr;
  bool recreateOnShow = false;
  void createMobileView();
#endif
#ifdef STORMDESK_WEBENGINE
  QWebEngineView *view = nullptr;
#endif
};
class RadarStage : public QWidget {
  Q_OBJECT
public:
  RadarStage(Radar *radar, QWidget *instruments, QWidget *parent = nullptr,
             bool mobile = false);
  void setScale(double scale);

protected:
  void resizeEvent(QResizeEvent *event) override;

private:
  Radar *radar;
  QWidget *instruments;
  QPushButton *toggle;
  double scaleFactor = 1;
  bool userToggled = false, mobile = false;
  void arrange();
};
} // namespace storm
