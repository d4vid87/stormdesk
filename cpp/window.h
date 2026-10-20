#pragma once
#include "http.h"
#include <QComboBox>
#include <QGridLayout>
#include <QLabel>
#include <QMainWindow>
#include <QPushButton>
#include <QSettings>
#include <QStackedWidget>
#include <QSystemTrayIcon>
#include <QTableWidget>

namespace storm {
class Tools;
class InstrumentFace;
class WeatherGlyph;
class SunCycle;
class Plot : public QWidget {
public:
  explicit Plot(QWidget *parent = nullptr);
  QVector<QPointF> points;
  QString unit;
  void paintEvent(QPaintEvent *event) override;
};
class Window : public QMainWindow {
  Q_OBJECT
public:
  Window(Services &services, HttpServer &server);
  void render();
  void applyScale(double scale);
  void setup();
  double scale() const { return scaleFactor; }

protected:
  void resizeEvent(QResizeEvent *event) override;

private:
  Services &services;
  HttpServer &server;
  QSettings local;
  double scaleFactor = 1, settingsRevision = 0;
  QStackedWidget *pages;
  QComboBox *scaleBox, *pageSelect;
  QGridLayout *navigation;
  QList<QPushButton *> navButtons;
  QPushButton *refreshButton;
  QLabel *clock, *location, *heroTemperature, *heroCondition, *heroSource,
      *status, *alerts;
  std::array<QLabel *, 8> metricValues, metricSources;
  std::array<InstrumentFace *, 8> faces;
  WeatherGlyph *weatherGlyph;
  QPushButton *setupButton, *motionButton;
  QGridLayout *heroLayout;
  QLabel *heroHeading;
  SunCycle *sunCycle;
  QWidget *dashboardRadarCard = nullptr;
  QJsonObject setupChanges;
  void showInstrument(int index);
  QList<QWidget *> metricCards;
  QGridLayout *metrics = nullptr, *body = nullptr;
  QWidget *currentCard = nullptr, *contextCard = nullptr;
  QWidget *radarPage;
  Tools *tools;
  Plot *plot;
  QComboBox *historyMetric, *historyRange;
  QTableWidget *historyTable = nullptr, *ruleTable = nullptr;
  void addRule(const QJsonObject &rule);
  QLabel *historySummary;
#ifndef QT_NO_SYSTEMTRAYICON
  QSystemTrayIcon *tray = nullptr;
#endif
  QHash<QString, QWidget *> editors;
  QLabel *settingsMessage;
  QWidget *makeWeather();
  QWidget *makeRadar();
  QWidget *makeHistory();
  QWidget *makeSettings();
  void renderHistory();
  void arrange();
  void applyTheme();
  void saveSettings();
  void loadSettings();
  void openRadar();
  void backup();
  void restore();
  void exportCsv();
  void notify(const QString &title, const QString &message);
};
} // namespace storm
