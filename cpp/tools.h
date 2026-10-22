#pragma once
#include "advanced.h"
#include <QComboBox>
#include <QDateEdit>
#include <QLabel>
#include <QPixmap>
#include <QTimer>
#include <QVBoxLayout>
#include <QWidget>

namespace storm {
class Tools : public QWidget {
  Q_OBJECT
public:
  explicit Tools(Services &services, QWidget *parent = nullptr);
  Advanced advanced;
  void refresh(bool force = false);
  void render();
signals:
  void dashboardChanged();

protected:
  void showEvent(QShowEvent *event) override;

private:
  QComboBox *topic, *metric, *filter;
  QDateEdit *from, *to;
  QLabel *note;
  QWidget *content;
  QVBoxLayout *body;
  QTimer debounce, cadence;
  QPixmap droughtImage;
  qint64 droughtImageAt = 0;
  bool droughtImageBusy = false;
  QStringList currentProviders;
  void customization();
};
} // namespace storm
