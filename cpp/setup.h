#pragma once
#include "services.h"
#include <QDialog>
#include <QHash>
#include <functional>

class QComboBox;
class QDoubleSpinBox;
class QLineEdit;
class QLabel;
class QPushButton;
class QStackedWidget;
class QCheckBox;
class QGridLayout;
namespace storm {
class SetupDialog : public QDialog {
  Q_OBJECT
public:
  using Apply = std::function<bool(const QJsonObject &, QString *)>;
  SetupDialog(Services &services, quint16 port, double scale, Apply apply,
              std::function<void()> restore, QWidget *parent = nullptr);

private:
  Services &services;
  Apply apply;
  QStackedWidget *pages;
  QLabel *heading, *message, *progress, *checkStatus, *instructions;
  QPushButton *back, *next, *skip;
  QComboBox *source, *method, *places, *found, *units, *sizeChoice;
  QGridLayout *navigation = nullptr;
  QPushButton *closeButton;
  void resizeEvent(QResizeEvent *event) override;
  QLineEdit *name;
  QDoubleSpinBox *latitude, *longitude;
  QCheckBox *motion, *notifications;
  QHash<QString, QLineEdit *> fields;
  QHash<QString, QLabel *> fieldLabels;
  QString path = "station";
  bool locationSet = false;
  qint64 testedAt = 0;
  void showStep(int index);
  void connectionForm();
  void advance();
  void checkConnection();
  QJsonObject changes() const;
};
} // namespace storm
