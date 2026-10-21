#pragma once
#include <QJsonArray>
#include <QJsonObject>

namespace storm {
// Returns only a newer, published native release; never a legacy 4.x update.
QJsonObject nativeUpdate(const QJsonArray &releases, const QString &current,
                         bool previews);
}
