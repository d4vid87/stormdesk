#pragma once
#include "services.h"
#include <QGridLayout>
#include <QLabel>
#include <QPushButton>
#include <QWidget>
#ifdef STORMDESK_WEBENGINE
class QWebEngineView;
#endif

namespace storm {
class Radar : public QWidget {
  Q_OBJECT
public:
  explicit Radar(Services &services, QWidget *parent = nullptr,
                 bool compact = false);
  void refresh();
  void setScale(double scale);
signals:
  void warningsRequested();
protected:
  void showEvent(QShowEvent *event) override;
  void resizeEvent(QResizeEvent *event) override;
private:
  Services &services;
  bool compact;
  QLabel *status;
  QUrl loadedUrl;
  QGridLayout *controls;
  QList<QPushButton *> buttons;
  double scaleFactor = 1;
#ifdef STORMDESK_WEBENGINE
  QWebEngineView *view = nullptr;
#endif
};
} // namespace storm
