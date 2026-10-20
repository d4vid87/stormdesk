#pragma once
#include "services.h"
#include <QCache>
#include <QGridLayout>
#include <QImage>
#include <QLabel>
#include <QSet>
#include <QSlider>
#include <QWidget>

namespace storm {
QPointF mercator(double lat, double lon, int zoom);
class Radar : public QWidget {
  Q_OBJECT
public:
  explicit Radar(Services &services, QWidget *parent = nullptr);
  void refresh();

protected:
  void showEvent(QShowEvent *event) override;
  void resizeEvent(QResizeEvent *event) override;

private:
  class Canvas;
  Services &services;
  QNetworkAccessManager tiles;
  Canvas *canvas;
  QSlider *frames;
  QLabel *status;
  QTimer animation, cadence;
  QJsonArray past;
  QString host, location;
  qint64 fetched = 0;
  bool busy = false;
  QGridLayout *controls;
  QList<QWidget *> buttons;
};
} // namespace storm
