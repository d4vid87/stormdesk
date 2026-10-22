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
class RadarStage;
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
  Window(Services &services, HttpServer &server, bool mobile = false);
  void render();
  void applyScale(double scale);
  void setup();
  double scale() const { return scaleFactor; }

protected:
  void resizeEvent(QResizeEvent *event) override;

private:
  Services &services;
  HttpServer &server;
  bool mobile;
  QLabel *mobileStationSummary = nullptr;
  void arrangeInstruments();
  QSettings local;
  double scaleFactor = 1, settingsRevision = 0;
  QStackedWidget *pages;
  QComboBox *scaleBox, *pageSelect;
  QGridLayout *navigation;
  QList<QPushButton *> navButtons;
  QPushButton *refreshButton, *alertButton;
  QLabel *clock, *clockDate, *location, *heroTemperature, *heroCondition,
      *heroSource, *status, *alerts = nullptr;
  std::array<QLabel *, 8> metricValues, metricSources;
  std::array<InstrumentFace *, 8> faces;
  WeatherGlyph *weatherGlyph;
  QPushButton *setupButton;
  QList<int> gaugeOrder;
  int movingGauge = -1;
  QPoint gaugeDragStart;
  bool gaugeDragged = false;
  void moveGauge(int source, int target);
  bool eventFilter(QObject *watched, QEvent *event) override;
  QGridLayout *heroLayout;
  QLabel *heroHeading;
  SunCycle *sunCycle;
  QWidget *dashboardRadarCard = nullptr;
  RadarStage *radarStage = nullptr;
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
  QLabel *updateStatus;
  QPushButton *updateCheck, *updateDownload;
  QUrl updateUrl;
  bool updateBusy = false;
  void checkUpdates(bool manual = false);
  QWidget *makeWeather();
  QWidget *makeRadar();
  QWidget *makeHistory();
  QWidget *makeSettings();
  void renderHistory();
  void arrange();
  void applyTheme();
  void styleAlerts();
  void saveSettings();
  void loadSettings();
  void openRadar();
  void openWarnings();
  void backup();
  void restore();
  void exportCsv();
  void notify(const QString &title, const QString &message);
};
} // namespace storm
