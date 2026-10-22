#pragma once
#include <QRect>

namespace storm {
inline QRect popupBounds(QRect popup, const QRect &safe) {
  if (safe.isEmpty())
    return popup;
  popup.setSize(popup.size().boundedTo(safe.size()));
  popup.moveLeft(qBound(safe.left(), popup.left(),
                        safe.right() - popup.width() + 1));
  popup.moveTop(qBound(safe.top(), popup.top(),
                       safe.bottom() - popup.height() + 1));
  return popup;
}
} // namespace storm
