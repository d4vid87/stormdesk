#include "discovery.h"
#include <QDateTime>
#include <QNetworkDatagram>
#include <QNetworkInterface>
#include <QSet>
#include <QUuid>
#include <QtEndian>
#include <algorithm>

namespace storm {
static void u16(QByteArray &out, quint16 n) {
  out.append(char(n >> 8));
  out.append(char(n));
}
static void u32(QByteArray &out, quint32 n) {
  u16(out, quint16(n >> 16));
  u16(out, quint16(n));
}
static quint16 read16(const QByteArray &p, int at) {
  return qFromBigEndian<quint16>(
      reinterpret_cast<const uchar *>(p.constData() + at));
}
static quint32 read32(const QByteArray &p, int at) {
  return qFromBigEndian<quint32>(
      reinterpret_cast<const uchar *>(p.constData() + at));
}
static QByteArray name(const QString &text) {
  QByteArray out;
  for (const auto &label : text.split('.', Qt::SkipEmptyParts)) {
    auto b = label.toUtf8();
    if (b.size() > 63)
      return {};
    out.append(char(b.size()));
    out += b;
  }
  out.append(char(0));
  return out;
}
static QString readName(const QByteArray &p, int &at) {
  QStringList labels;
  int offset = at, steps = 0, total = 0;
  bool jumped = false;
  QSet<int> seen;
  while (offset < p.size() && ++steps <= 128) {
    if (seen.contains(offset))
      return {};
    seen.insert(offset);
    int n = uchar(p[offset++]);
    if ((n & 0xc0) == 0xc0) {
      if (offset >= p.size())
        return {};
      int pointer = ((n & 0x3f) << 8) | uchar(p[offset++]);
      if (pointer >= p.size())
        return {};
      if (!jumped)
        at = offset;
      jumped = true;
      offset = pointer;
      continue;
    }
    if (n & 0xc0 || n > 63 || offset + n > p.size())
      return {};
    if (!n) {
      if (!jumped)
        at = offset;
      return labels.join('.').toLower();
    }
    total += n + 1;
    if (total > 255)
      return {};
    labels << QString::fromUtf8(p.constData() + offset, n);
    offset += n;
  }
  return {};
}
QJsonArray decodeDns(const QByteArray &packet) {
  QJsonArray out;
  if (packet.size() < 12 || packet.size() > 9000)
    return out;
  int at = 12;
  int questions = read16(packet, 4),
      records = read16(packet, 6) + read16(packet, 8) + read16(packet, 10);
  if (questions + records > 128)
    return out;
  for (int i = 0; i < questions; ++i) {
    auto n = readName(packet, at);
    if (n.isEmpty() || at + 4 > packet.size())
      return {};
    out.append(QJsonObject{
        {"name", n}, {"type", read16(packet, at)}, {"question", true}});
    at += 4;
  }
  for (int i = 0; i < records; ++i) {
    auto n = readName(packet, at);
    if (n.isEmpty() || at + 10 > packet.size())
      return {};
    int type = read16(packet, at), length = read16(packet, at + 8);
    auto ttl = read32(packet, at + 4);
    at += 10;
    if (at + length > packet.size())
      return {};
    QJsonObject r{{"name", n}, {"type", type}, {"ttl", double(ttl)}};
    if (type == 1 && length == 4)
      r["address"] = QHostAddress(read32(packet, at)).toString();
    else if (type == 12) {
      int start = at;
      auto target = readName(packet, start);
      if (target.isEmpty() || start > at + length)
        return {};
      r["target"] = target;
    } else if (type == 33 && length >= 7) {
      r["port"] = read16(packet, at + 4);
      int start = at + 6;
      auto target = readName(packet, start);
      if (target.isEmpty() || start > at + length)
        return {};
      r["target"] = target;
    }
    out.append(r);
    at += length;
  }
  return out;
}
static void record(QByteArray &out, const QString &n, quint16 type, quint32 ttl,
                   const QByteArray &value, bool shared = false) {
  out += name(n);
  u16(out, type);
  u16(out, shared ? 1 : 0x8001);
  u32(out, ttl);
  u16(out, quint16(value.size()));
  out += value;
}
QByteArray serviceAnnouncement(const QString &host, const QString &address,
                               quint16 port, quint32 ttl) {
  QHostAddress ip(address);
  if (ip.protocol() != QAbstractSocket::IPv4Protocol)
    return {};
  QByteArray out(12, char(0));
  out[2] = char(0x84);
  out[7] = 5;
  const QString type = "_stormdesk._tcp.local",
                instance = "stormdesk-" + host.section('.', 0, 0) + "." + type;
  record(out, "_services._dns-sd._udp.local", 12, ttl, name(type), true);
  record(out, type, 12, ttl, name(instance), true);
  QByteArray srv(4, char(0));
  u16(srv, port);
  srv += name(host);
  record(out, instance, 33, ttl, srv);
  QByteArray txt;
  for (const auto &s :
       {QByteArray("version=" STORMDESK_VERSION), QByteArray("path=/api/v1")}) {
    txt.append(char(s.size()));
    txt += s;
  }
  record(out, instance, 16, ttl, txt);
  QByteArray a;
  u32(a, ip.toIPv4Address());
  record(out, host, 1, ttl, a);
  return out;
}
Discovery::Discovery(Services &s, quint16 p) : services(s), port(p) {
  connect(&timer, &QTimer::timeout, this, &Discovery::scan);
  connect(&s, &Services::discoveryRequested, this, &Discovery::scan);
  connect(&socket, &QUdpSocket::readyRead, this, [this] {
    while (socket.hasPendingDatagrams()) {
      auto datagram = socket.receiveDatagram(9000);
      const auto packet = datagram.data();
      auto records = decodeDns(packet);
      if (packet.size() < 12)
        continue;
      bool answer = false;
      const auto now = QDateTime::currentSecsSinceEpoch();
      for (const auto &v : records) {
        auto r = v.toObject();
        const auto n = r.value("name").toString();
        if (r.value("question").toBool()) {
          if (n == "_stormdesk._tcp.local" ||
              n == "_services._dns-sd._udp.local" || n == host)
            answer = true;
          continue;
        }
        const auto expires = now + std::min(4500, r.value("ttl").toInt());
        if (r.value("type").toInt() == 1 &&
            !r.value("address").toString().isEmpty()) {
          if (addresses.size() < 128 || addresses.contains(n))
            addresses[n] = {r.value("address").toString(), expires};
        }
        if (r.value("type").toInt() == 33 &&
            n.endsWith("._weatherlinklive._tcp.local") &&
            (consoles.size() < 32 || consoles.contains(n)))
          consoles[n] = {r.value("target").toString(),
                         r.value("port").toInt(80), expires};
      }
      if (answer) {
        auto reply = serviceAnnouncement(host, address, port);
        if (datagram.senderPort() != 5353) {
          reply[0] = packet[0];
          reply[1] = packet[1];
          socket.writeDatagram(reply, datagram.senderAddress(),
                               datagram.senderPort());
        } else
          socket.writeDatagram(reply, QHostAddress("224.0.0.251"), 5353);
      }
      publish();
    }
  });
}
bool Discovery::start() {
  for (const auto &entry : QNetworkInterface::allAddresses())
    if (entry.protocol() == QAbstractSocket::IPv4Protocol &&
        !entry.isLoopback() && !entry.isNull()) {
      address = entry.toString();
      break;
    }
  if (address.isEmpty() ||
      !socket.bind(QHostAddress::AnyIPv4, 5353,
                   QUdpSocket::ShareAddress | QUdpSocket::ReuseAddressHint))
    return false;
  host = "stormdesk-" + address;
  host.replace('.', '-');
  host += ".local";
  bool joined = false;
  for (const auto &iface : QNetworkInterface::allInterfaces())
    if (iface.flags().testFlag(QNetworkInterface::IsUp) &&
        !iface.flags().testFlag(QNetworkInterface::IsLoopBack) &&
        iface.flags().testFlag(QNetworkInterface::CanMulticast))
      joined = socket.joinMulticastGroup(QHostAddress("224.0.0.251"), iface) ||
               joined;
  socket.setSocketOption(QAbstractSocket::MulticastTtlOption, 255);
  timer.start(30000);
  scan();
  return joined;
}
void Discovery::scan() {
  if (socket.state() != QAbstractSocket::BoundState)
    return;
  socket.writeDatagram(serviceAnnouncement(host, address, port),
                       QHostAddress("224.0.0.251"), 5353);
  QByteArray query(12, char(0));
  query[5] = 1;
  query += name("_weatherlinklive._tcp.local");
  u16(query, 12);
  u16(query, 1);
  socket.writeDatagram(query, QHostAddress("224.0.0.251"), 5353);
  publish();
}
void Discovery::publish() {
  QJsonArray result;
  auto now = QDateTime::currentSecsSinceEpoch();
  for (auto i = consoles.begin(); i != consoles.end();)
    if (i.value().expires <= now)
      i = consoles.erase(i);
    else
      ++i;
  for (auto i = addresses.begin(); i != addresses.end();)
    if (i.value().second <= now)
      i = addresses.erase(i);
    else
      ++i;
  for (auto i = consoles.begin(); i != consoles.end(); ++i)
    if (addresses.contains(i.value().target))
      result.append(
          QJsonObject{{"name", i.key().section('.', 0, 0)},
                      {"host", addresses.value(i.value().target).first}});
  if (result != services.discovered) {
    services.discovered = result;
    emit services.changed();
  }
}
} // namespace storm
