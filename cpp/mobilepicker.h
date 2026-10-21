#pragma once
#include <QComboBox>
#include <QDialog>
#include <QInputMethod>
#include <QLabel>
#include <QListWidget>
#include <QPointer>
#include <QPushButton>
#include <QVBoxLayout>
#include <QGuiApplication>
#include <algorithm>

namespace storm {
inline QDialog *mobilePicker(QComboBox *box) {
  if (box->property("mobilePicking").toBool()) return nullptr;
  box->setProperty("mobilePicking", true);
  QGuiApplication::inputMethod()->hide();
  auto dialog = new QDialog(box->window());
  dialog->setObjectName("mobilePicker");
  dialog->setAttribute(Qt::WA_DeleteOnClose);
  dialog->setWindowTitle(box->accessibleName().isEmpty() ? "Choose an option" : box->accessibleName());
  auto layout = new QVBoxLayout(dialog);
  auto heading = new QLabel(dialog->windowTitle());
  heading->setTextFormat(Qt::PlainText);
  layout->addWidget(heading);
  auto list = new QListWidget;
  list->setObjectName("mobilePickerOptions");
  for (int i = 0; i < box->count(); ++i) {
    auto item = new QListWidgetItem(box->itemIcon(i), box->itemText(i), list);
    item->setData(Qt::UserRole, box->itemData(i));
    item->setFlags(box->model()->flags(box->model()->index(i, box->modelColumn(), box->rootModelIndex())));
    item->setSizeHint(QSize(0, std::max(48, box->fontMetrics().height() + 24)));
  }
  list->setCurrentRow(box->currentIndex());
  layout->addWidget(list, 1);
  const QPointer<QComboBox> target(box);
  QObject::connect(list, &QListWidget::itemClicked, dialog, [target, list, dialog](QListWidgetItem *item) {
    if (!item->flags().testFlag(Qt::ItemIsEnabled)) return;
    const int row = list->row(item);
    const auto text = item->text();
    const QPointer<QDialog> picker(dialog);
    if (!target || row >= target->count() || target->itemText(row) != text ||
        target->itemData(row) != item->data(Qt::UserRole) ||
        !target->model()->flags(target->model()->index(row, target->modelColumn(), target->rootModelIndex()))
             .testFlag(Qt::ItemIsEnabled)) {
      dialog->reject();
      return;
    }
    target->setCurrentIndex(row);
    if (target) emit target->activated(row);
    if (target) emit target->textActivated(text);
    if (picker) picker->accept();
  });
  auto close = new QPushButton("Cancel");
  close->setMinimumHeight(48);
  layout->addWidget(close);
  QObject::connect(close, &QPushButton::clicked, dialog, &QDialog::reject);
  QObject::connect(dialog, &QDialog::finished, dialog, [target] {
    if (target) target->setProperty("mobilePicking", false);
  });
  dialog->resize(std::min(460, box->window()->width()),
                 std::min(640, box->window()->height()));
  dialog->open();
  return dialog;
}
}
