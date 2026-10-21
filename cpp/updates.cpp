#include "updates.h"
#include <QRegularExpression>
#include <QVersionNumber>
#include <limits>
#include <optional>

namespace storm {
struct ReleaseVersion {
  QVersionNumber number;
  int preview;
};
static std::optional<ReleaseVersion> version(QString text) {
  static const QRegularExpression pattern(
      "^v?([0-9]{1,9}\\.[0-9]{1,9}\\.[0-9]{1,9})(?:-preview\\.([1-9][0-9]{0,8}))?$");
  const auto match = pattern.match(text);
  if (!match.hasMatch())
    return {};
  return ReleaseVersion{QVersionNumber::fromString(match.captured(1)),
                        match.captured(2).isEmpty()
                            ? std::numeric_limits<int>::max()
                            : match.captured(2).toInt()};
}
static bool newer(const ReleaseVersion &a, const ReleaseVersion &b) {
  const int difference = QVersionNumber::compare(a.number, b.number);
  return difference > 0 || (difference == 0 && a.preview > b.preview);
}
QJsonObject nativeUpdate(const QJsonArray &releases, const QString &current,
                         bool previews) {
  auto best = version(current);
  if (!best)
    return {};
  QJsonObject result;
  for (const auto &item : releases) {
    const auto release = item.toObject();
    const auto tag = release.value("tag_name").toString();
    const auto candidate = version(tag);
    if (!candidate || release.value("draft").toBool(true) ||
        release.value("published_at").toString().isEmpty() ||
        release.value("assets").toArray().isEmpty() ||
        candidate->number < QVersionNumber(5, 0, 0))
      continue;
    const bool preview = candidate->preview != std::numeric_limits<int>::max();
    if ((preview || release.value("prerelease").toBool()) && !previews)
      continue;
    if (newer(*candidate, *best)) {
      best = candidate;
      result = {{"version", tag},
                {"url", "https://github.com/d4vid87/stormdesk/releases/tag/" + tag}};
    }
  }
  return result;
}
}
