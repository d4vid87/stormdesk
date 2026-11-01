// Every weather station that isn't a Tempest.
//
// The Tempest `obs_st` tuple is this app's internal format end to end — SQLite columns
// (`store::FIELDS`), the page's `OBS` map, CWOP, MQTT, the rules engine. So the whole of
// multi-brand support is one conversion at this boundary: a foreign report becomes an SI tuple
// and a synthesized Tempest-shaped packet, and nothing downstream branches. Same trick
// `api.js metarObs()` plays with a METAR.
//
// Two directions in:
//   * push — Ecowitt "customized upload" (POST, urlencoded), Ambient's awnet custom server
//     (GET query string), the Weather Underground protocol that half the clones speak, and
//     rtl_433 JSON piped in by curl (that is the AcuRite Iris story: no API exists).
//   * poll — Davis WeatherLink Live on the LAN, Ambient's cloud (which is also how a
//     KestrelMet 6000 is read), and La Crosse's unofficial app API.
//
// The imperial field vocabulary is shared across Ecowitt/Ambient/WU/AWN, so one mapping table
// serves all four. WLL and rtl_433 get their names translated into that vocabulary first.
//
// Only the selected station is collected. Its identity selects a separate archive and counter set.

use crate::server::{epoch, State};
use crate::store;
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

/// A reading we heard ourselves, over the LAN: push protocols and the Davis poll.
pub const SRC_INGEST: i64 = 3;
/// A reading that came back from somebody's cloud. Separate so an unofficial API going bad is
/// one `DELETE FROM obs WHERE src = 4` away from gone.
pub const SRC_CLOUD: i64 = 4;

/// Consoles report every 16 seconds; the archive is a row a minute. 55 rather than 60 so a
/// console that drifts slightly slow doesn't lose every other minute to the guard.
const MIN_GAP: u64 = 55;

const MPS_PER_MPH: f64 = 0.447_04;
const MB_PER_INHG: f64 = 33.863_9;
const MM_PER_IN: f64 = 25.4;

type Fields = HashMap<String, String>;

// --- Parsing ---

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'+' => out.push(b' '),
            // `.get` rather than `&s[..]`: a `%` in front of a multi-byte character lands the end
            // of that slice mid-character, and indexing there panics on a request anyone can send.
            b'%' if i + 2 < b.len() => {
                match s
                    .get(i + 1..i + 3)
                    .and_then(|h| u8::from_str_radix(h, 16).ok())
                {
                    Some(v) => {
                        out.push(v);
                        i += 2;
                    }
                    None => out.push(b'%'),
                }
            }
            c => out.push(c),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn parse_pairs(s: &str, into: &mut Fields) {
    for kv in s.split('&') {
        if let Some((k, v)) = kv.split_once('=') {
            into.insert(percent_decode(k).to_lowercase(), percent_decode(v));
        }
    }
}

/// Flatten a JSON object one level into the same string map. rtl_433 lines and AWN's `lastData`
/// are both flat objects of numbers, so there is nothing deeper to walk.
fn parse_json(v: &serde_json::Value, into: &mut Fields) {
    if let Some(obj) = v.as_object() {
        for (k, val) in obj {
            let s = val
                .as_str()
                .map(String::from)
                .unwrap_or_else(|| val.to_string());
            into.insert(k.to_lowercase(), s);
        }
    }
}

/// Whatever the console sent, as one lower-cased map. Query string and body are merged because
/// the WU protocol puts everything in the query and Ecowitt puts everything in the body.
fn collect(url: &str, body: &str) -> Fields {
    let mut f = Fields::new();
    if let Some(q) = url.split('?').nth(1) {
        parse_pairs(q, &mut f);
    }
    let trimmed = body.trim_start();
    if trimmed.starts_with('{') {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) {
            parse_json(&v, &mut f);
        }
    } else if !trimmed.is_empty() {
        parse_pairs(trimmed, &mut f);
    }
    f
}

// --- Mapping ---

fn num(f: &Fields, keys: &[&str]) -> Option<f64> {
    keys.iter()
        .find_map(|k| f.get(*k))
        .and_then(|v| v.trim().parse::<f64>().ok())
}

/// The whole of multi-brand support, in one table: foreign field names on the right, `obs_st`
/// slot numbers on the left. Slot 0 (time) is the caller's — a push gets `now()` because
/// console clocks lie, a poll gets the payload's own stamp so CWOP's staleness guard still
/// means something.
///
/// Slots left NULL: 1 wind lull and 5 wind interval (nobody else reports them), 9 lux (a
/// Tempest measures it, a WS-2902 does not), 16 battery (every other brand reports a flag, and
/// `env.js` compares that slot against a Tempest's 2.355 V — a flag there would read as a flat
/// battery forever).
///
/// Rain and lightning arrive as running daily totals, but slot 12 is per-interval and slot 15 is
/// a per-interval count, so both are differenced against what we last stored.
fn tuple(f: &Fields, ts: f64, mem: &mut Mem) -> Vec<Option<f64>> {
    let f_to_c = |v: f64| (v - 32.0) / 1.8;

    let temp = num(f, &["tempf", "temp_out_f"])
        .map(f_to_c)
        .or_else(|| num(f, &["temperature_c", "temp_c", "temp"]));
    let wind_avg = num(f, &["windspeedmph"])
        .map(|v| v * MPS_PER_MPH)
        .or_else(|| num(f, &["wind_avg_m_s"]));
    let gust = num(f, &["windgustmph"])
        .map(|v| v * MPS_PER_MPH)
        .or_else(|| num(f, &["wind_max_m_s"]));
    let dir = num(f, &["winddir", "wind_dir_deg"]);
    // Absolute (station) pressure is what the archive holds — every consumer that wants sea
    // level derives it from the station's own altitude. `baromin` is the WU protocol's spelling.
    let press = num(f, &["baromabsin", "baromrelin", "baromin"])
        .map(|v| v * MB_PER_INHG)
        .or_else(|| num(f, &["pressure_hpa", "pressure_mb"]));
    let rh = num(f, &["humidity", "humidity_out"]);
    let uv = num(f, &["uv", "uvi", "uv_index"]);
    let solar = num(f, &["solarradiation", "solar_rad"]);

    // Piezo gauges (the Wittboy's) report under their own names; prefer them when present.
    let day_rain_mm = num(f, &["drain_piezo", "dailyrainin"])
        .map(|v| v * MM_PER_IN)
        .or_else(|| num(f, &["rain_mm", "dailyrainmm"]));
    let rain = day_rain_mm.map(|cur| delta(&mut mem.rain, cur));

    let strike_dist = num(f, &["lightning", "storm_dist_km", "lightning_distance"]);
    let strikes = num(f, &["lightning_num", "strike_count", "lightning_day"])
        .map(|cur| delta(&mut mem.strikes, cur));

    let interval = mem
        .last_ts
        .map(|prev| (((ts - prev) / 60.0).round()).clamp(1.0, 30.0));

    vec![
        Some(ts),
        None,                                          // 1 wind lull
        wind_avg,                                      // 2
        gust,                                          // 3
        dir,                                           // 4
        None,                                          // 5 wind interval
        press,                                         // 6
        temp,                                          // 7
        rh,                                            // 8
        None,                                          // 9 lux
        uv,                                            // 10
        solar,                                         // 11
        rain,                                          // 12 this interval
        rain.map(|r| if r > 0.0 { 1.0 } else { 0.0 }), // 13 precip type
        strike_dist,                                   // 14
        strikes,                                       // 15 this interval
        None,                                          // 16 battery volts
        interval,                                      // 17
        day_rain_mm,                                   // 18
    ]
}

#[derive(Debug)]
struct Channel {
    name: String,
    value: f64,
    unit: &'static str,
}

/// Explicit protocol fields only: upload credentials and arbitrary JSON never enter the archive.
/// Ecowitt battery formats differ by device; flags must never be compared with Tempest volts.
fn channels(f: &Fields) -> Vec<Channel> {
    let mut out = Vec::new();
    let mut add = |name: String, value: Option<f64>, unit, min: f64, max: f64| {
        if let Some(value) = value.filter(|v| v.is_finite() && *v >= min && *v <= max) {
            out.push(Channel { name, value, unit });
        }
    };
    let temperature = |c: &str, fahrenheit: &str| {
        num(f, &[c]).or_else(|| num(f, &[fahrenheit]).map(|v| (v - 32.0) / 1.8))
    };
    add("indoor_temperature".into(), temperature("tempinc", "tempinf"), "°C", -100.0, 100.0);
    add("indoor_humidity".into(), num(f, &["humidityin"]), "%", 0.0, 100.0);
    add("co2".into(), num(f, &["co2", "co2in"]), "ppm", 0.0, 100_000.0);
    add("pm25".into(), num(f, &["pm25_co2", "pm25"]), "µg/m³", 0.0, 100_000.0);
    for i in 1..=16 {
        add(format!("soil_moisture_{i}"), num(f, &[&format!("soilmoisture{i}")]), "%", 0.0, 100.0);
        add(format!("battery_soil_{i}"), num(f, &[&format!("soilbatt{i}")]), "V", 0.0, 20.0);
        if i <= 8 {
            add(format!("temperature_{i}"), temperature(&format!("temp{i}c"), &format!("temp{i}f")), "°C", -100.0, 100.0);
            add(format!("humidity_{i}"), num(f, &[&format!("humidity{i}")]), "%", 0.0, 100.0);
            add(format!("soil_temperature_{i}"), temperature(&format!("tf_ch{i}c"), &format!("tf_ch{i}")), "°C", -100.0, 100.0);
            add(format!("leaf_wetness_{i}"), num(f, &[&format!("leafwetness_ch{i}")]), "%", 0.0, 100.0);
            add(format!("pm25_{i}"), num(f, &[&format!("pm25_ch{i}")]), "µg/m³", 0.0, 100_000.0);
            add(format!("battery_temperature_{i}"), num(f, &[&format!("batt{i}")]).filter(|v| *v == 0.0 || *v == 1.0), "low", 0.0, 1.0);
            add(format!("battery_soil_temperature_{i}"), num(f, &[&format!("tf_batt{i}")]), "V", 0.0, 20.0);
            add(format!("battery_pm25_{i}"), num(f, &[&format!("pm25batt{i}")]).filter(|v| v.fract() == 0.0).map(|v| v * 20.0), "%", 0.0, 100.0);
        }
    }
    for (key, name) in [("wh25batt", "wh25"), ("wh26batt", "wh26"), ("wh65batt", "wh65"), ("trans_battery_flag", "davis")] {
        add(format!("battery_{name}"), num(f, &[key]).filter(|v| *v == 0.0 || *v == 1.0), "low", 0.0, 1.0);
    }
    let flag = num(f, &["battery_low"]).filter(|v| *v == 0.0 || *v == 1.0)
        .or_else(|| num(f, &["battery_ok"]).filter(|v| *v == 0.0 || *v == 1.0).map(|v| 1.0 - v));
    add("battery_sensor".into(), flag, "low", 0.0, 1.0);
    for (key, name) in [("wh40batt", "wh40"), ("wh68batt", "wh68"), ("wh80batt", "wh80"), ("wh85batt", "wh85"), ("wh90batt", "wh90"), ("console_batt", "console"), ("battery_v", "sensor_voltage")] {
        add(format!("battery_{name}"), num(f, &[key]), "V", 0.0, 20.0);
    }
    for key in ["wh57batt", "co2_batt"] {
        add(format!("battery_{}", key.trim_end_matches("batt")), num(f, &[key]).filter(|v| v.fract() == 0.0).map(|v| v * 20.0), "%", 0.0, 100.0);
    }
    out
}

// --- Running counters ---

/// What the last stored report said, so a running total can be turned into an interval.
#[derive(Clone, Default)]
struct Mem {
    rain: Option<f64>,
    strikes: Option<f64>,
    last_ts: Option<f64>,
    /// When we heard the last kept report, by our clock.
    last_wall: Option<u64>,
    /// The payload's own stamp on that report, unclamped — a poll that returns the same
    /// reading twice is a duplicate, not a new interval.
    last_raw: Option<f64>,
}

/// Difference a running total against the last stored one. A drop means the console rolled its
/// daily counter over (midnight, or a reset), and the new value is the accumulation since — the
/// alternative, a negative rainfall, would corrupt every SUM downstream. The first report after a
/// start scores zero: we have no idea how much of that total we already recorded.
///
fn delta(prev: &mut Option<f64>, cur: f64) -> f64 {
    let was = prev.replace(cur);
    match was {
        None => 0.0,
        Some(p) if cur < p => cur,
        Some(p) => cur - p,
    }
}

impl Mem {
    /// Just the two running totals and when they were saved. `last_wall`/`last_raw` are throttle
    /// state, not accounting: a restart should write the next report it hears, not skip it.
    fn json(&self, at: u64) -> String {
        serde_json::json!({ "rain": self.rain, "strikes": self.strikes, "at": at }).to_string()
    }

    /// A seed older than a day is thrown away. The console's own total has almost certainly
    /// rolled over since, and scoring a whole day's rain against one interval is a worse lie than
    /// forfeiting the outage.
    fn from_json(s: &str, now: u64) -> Mem {
        let v: serde_json::Value = serde_json::from_str(s).unwrap_or_default();
        let stale = now.saturating_sub(v["at"].as_u64().unwrap_or(0)) > 86400;
        Mem {
            rain: if stale { None } else { v["rain"].as_f64() },
            strikes: if stale { None } else { v["strikes"].as_f64() },
            ..Default::default()
        }
    }
}

fn counter_key(origin: &str) -> String {
    format!("counters:{origin}")
}

/// Counters and throttle state, per source. One shared set used to serve every brand at once,
/// which meant a Davis poll and an Ecowitt push starved each other, and one console's wrong
/// clock stopped the lot.
fn mem() -> &'static Mutex<HashMap<String, Mem>> {
    static M: OnceLock<Mutex<HashMap<String, Mem>>> = OnceLock::new();
    M.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Is this report far enough from the last one we kept to be worth a row?
///
/// Gated on our own clock, not the payload's. A WeatherLink Live console set a day ahead used to
/// park `last_ts` in the future and every later report was dropped for good — "grabs data
/// initially then stops". The payload stamp is only used to spot a poll that returned the same
/// reading twice.
fn keep(now: u64, m: &Mem, raw_ts: f64) -> bool {
    if m.last_raw == Some(raw_ts) {
        return false;
    }
    m.last_wall
        .map(|w| now.saturating_sub(w) >= MIN_GAP)
        .unwrap_or(true)
}

// --- Diagnostics ---

/// The last thing each source did, for the drawer. Fixed phrases and status codes only — these
/// go over HTTP to any LAN client, and the payloads they describe carry keys and passwords.
struct Diag {
    at: u64,
    ok: bool,
    what: String,
    rows: u64,
}

fn diags() -> &'static Mutex<HashMap<&'static str, Diag>> {
    static D: OnceLock<Mutex<HashMap<&'static str, Diag>>> = OnceLock::new();
    D.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn note(origin: &'static str, ok: bool, what: &str, stored: bool) {
    let Ok(mut d) = diags().lock() else { return };
    let e = d.entry(origin).or_insert(Diag {
        at: 0,
        ok: true,
        what: String::new(),
        rows: 0,
    });
    e.at = epoch();
    e.ok = ok;
    e.what = what.into();
    if stored {
        e.rows += 1;
    }
}

/// `{"push":{"at":...,"ok":true,"what":"stored","rows":42}, ...}`
pub fn diag_json() -> String {
    let Ok(d) = diags().lock() else {
        return "{}".into();
    };
    let body = d
        .iter()
        .map(|(k, v)| {
            format!(
                "\"{k}\":{{\"at\":{},\"ok\":{},\"what\":\"{}\",\"rows\":{}}}",
                v.at,
                v.ok,
                v.what.replace('"', ""),
                v.rows
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    format!("{{{body}}}")
}

// --- Publishing ---

/// Make the report look like it came off a Tempest hub: the page's UDP path, the MQTT bridge and
/// the rules engine all read `state.packets` and the `udp` SSE event, and none of them should
/// learn a second shape.
///
/// Cadence matters as much as shape. `rapid_wind` goes out per report, because that is what the
/// gauge animates on. `obs_st` goes out only when a row is stored, because `rules.js` treats
/// each one as a fresh interval and would otherwise count the same rain three times a minute.
fn publish(state: &Arc<State>, kind: &str, body: String) {
    if let Ok(mut map) = state.packets.lock() {
        map.insert(kind.into(), body.clone());
    }
    state.broadcast("udp", &body);
}

fn n(v: Option<f64>) -> String {
    v.map(|x| format!("{x}")).unwrap_or_else(|| "null".into())
}

/// One foreign report, whatever spoke it, from parse to stored row. Returns true when a row was
/// written.
///
/// The counters are only advanced on a report we keep — a differenced total against a report we
/// threw away would drop that interval's rain on the floor.
fn take(state: &Arc<State>, f: &Fields, raw_ts: f64, src: i64, origin: &'static str) -> bool {
    let identity = crate::server::station_fingerprint(&state.cfg_path);
    take_for_station(state, f, raw_ts, src, origin, &identity)
}

fn take_for_station(state: &Arc<State>, f: &Fields, raw_ts: f64, src: i64, origin: &'static str, expected: &str) -> bool {
    // Config writes use this same lock: the selected archive cannot change midway through commit.
    let _configuration = state.config_write.lock().unwrap_or_else(|e| e.into_inner());
    if state.maintenance.load(std::sync::atomic::Ordering::Relaxed)
        || crate::server::station_fingerprint(&state.cfg_path) != expected
    {
        return false;
    }
    if origin == "push" {
        let source = crate::setting(&state.cfg_path, "stationSource").unwrap_or_default();
        let id = crate::setting(&state.cfg_path, "stationId").unwrap_or_default();
        let mac = if matches!(source.as_str(), "ecowitt" | "push") {
            crate::setting(&state.cfg_path, "ecowittMac").unwrap_or_default()
        } else { String::new() };
        if matches!(source.as_str(), "wll" | "awn" | "lacrosse" | "tempest")
            || !push_identity_matches(&id, f) || !push_mac_matches(&mac, f) {
            return false;
        }
    }
    let at = epoch();
    // A console clock that is out by a day would otherwise scatter rows across the archive and
    // defeat CWOP's staleness guard. Ten minutes of slack is more than any real drift.
    let ts = raw_ts.clamp(at as f64 - 600.0, at as f64 + 600.0);
    let wind = num(f, &["windspeedmph"])
        .map(|v| v * MPS_PER_MPH)
        .or_else(|| num(f, &["wind_avg_m_s"]));
    if let (Some(sp), Some(dir)) = (wind, num(f, &["winddir", "wind_dir_deg"])) {
        publish(
            state,
            "rapid_wind",
            format!(
                "{{\"type\":\"rapid_wind\",\"ob\":[{},{sp},{dir}],\"_at\":{at}}}",
                ts as i64
            ),
        );
    }

    let source = crate::setting(&state.cfg_path, "stationSource").unwrap_or_else(|| format!("\"{origin}\""));
    let stable = ["passkey", "mac", "station_id", "id"].iter()
        .find_map(|k| f.get(*k)).map(String::as_str).unwrap_or(origin);
    let fallback = format!("{}:{}", source.trim_matches('"'), stable);
    let configured = crate::server::station_fingerprint(&state.cfg_path);
    let identity = if configured == "none" { fallback.clone() } else { configured };
    let memory_key = format!("{identity}:{origin}");
    let mut all = mem().lock().unwrap();
    // First report of this run: pick the counters back up off disk, so an app that was restarted
    // (or updated) does not forfeit the rain that fell while it was down. A read connection —
    // holding the writer's mutex across a query is what starves the UDP listener.
    let m = all.get(&memory_key).cloned().unwrap_or_else(|| {
        state
            .db()
            .and_then(|c| store::meta_get(&c, &counter_key(origin)))
            .map(|s| Mem::from_json(&s, at))
            .unwrap_or_default()
    });
    if !keep(at, &m, raw_ts) {
        drop(all);
        // Healthy: the poll is faster than the archive write gate. "throttled" read as a fault.
        note(origin, true, "ok · waiting for next write slot", false);
        return false;
    }
    let mut next = m;
    let t = tuple(f, ts, &mut next);
    next.last_ts = Some(ts);
    next.last_wall = Some(at);
    next.last_raw = Some(raw_ts);
    let saved = next.json(at);
    let extras = channels(f);
    // One transaction: never announce success or advance counters unless the observation and
    // its rain/lightning state are durably committed together.
    let committed = state.with_db(|conn| {
            if crate::server::station_fingerprint(&state.cfg_path) != expected {
                return false;
            }
            if !state.archive_accepts_as(conn, &fallback) {
                return false;
            }
            store_observation_channels(conn, &t, src, &counter_key(origin), &saved, &extras)
        })
        .unwrap_or(false);
    if !committed {
        drop(all);
        note(origin, false, "archive write failed", false);
        return false;
    }
    all.insert(memory_key, next);
    drop(all);
    note(origin, true, "stored", true);
    if crate::server::station_fingerprint(&state.cfg_path) != expected {
        return true; // The old station's row is safe, but its live reading is no longer selected.
    }
    if let (Some(d), Some(c)) = (t[14], t[15]) {
        if c > 0.0 {
            publish(
                state,
                "evt_strike",
                format!(
                    "{{\"type\":\"evt_strike\",\"evt\":[{},{d},{c}],\"_at\":{at}}}",
                    ts as i64
                ),
            );
        }
    }
    publish(
        state,
        "obs_st",
        format!(
            "{{\"type\":\"obs_st\",\"obs\":[[{}]],\"_at\":{at}}}",
            t.iter().map(|v| n(*v)).collect::<Vec<_>>().join(",")
        ),
    );
    true
}

#[cfg(test)]
fn store_observation(conn: &mut rusqlite::Connection, tuple: &[Option<f64>], src: i64, key: &str, counters: &str) -> bool {
    store_observation_channels(conn, tuple, src, key, counters, &[])
}

fn store_observation_channels(conn: &mut rusqlite::Connection, tuple: &[Option<f64>], src: i64, key: &str, counters: &str, extras: &[Channel]) -> bool {
    conn.transaction().ok().map(|tx| {
        if !store::insert(&tx, tuple, src) { return false; }
        for c in extras {
            if tx.execute("INSERT INTO channels(ts,name,value,unit) VALUES (?1,?2,?3,?4)",
                rusqlite::params![tuple[0], c.name, c.value, c.unit]).is_err() { return false; }
        }
        if tx.execute("INSERT INTO meta(key,value) VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=?2",
            [key, counters]).is_err() { return false; }
        tx.commit().is_ok()
    }).unwrap_or(false)
}

// --- The push route ---

/// `/ingest`, plus the paths consoles default to. Returns the HTTP status; the caller writes the
/// body, which has to be the literal `success` because WU clients check for it.
///
/// `ingestKey`, when set, has to appear as `?key=` or as the last path segment — a Wittboy can
/// only be told a path, not a header. Empty by default: this server already trusts its LAN with
/// `/config`, and a station that needs a shared secret to report is a station nobody sets up.
pub fn accept(state: &Arc<State>, url: &str, body: &str) -> u16 {
    let want = crate::setting(&state.cfg_path, "ingestKey").unwrap_or_default();
    if !want.is_empty() {
        let path = url.split('?').next().unwrap_or("");
        let given = crate::server::query(url, "key").unwrap_or_default();
        if given != want && !path.ends_with(&format!("/{want}")) {
            note("push", false, "wrong ingest key", false);
            return 401;
        }
    }
    let f = collect(url, body);
    let source = crate::setting(&state.cfg_path, "stationSource").unwrap_or_default();
    if matches!(source.as_str(), "wll" | "awn" | "lacrosse" | "tempest") {
        return 409;
    }
    let configured = crate::setting(&state.cfg_path, "stationId").unwrap_or_default();
    let mac = if matches!(source.as_str(), "ecowitt" | "push") {
        crate::setting(&state.cfg_path, "ecowittMac").unwrap_or_default()
    } else { String::new() };
    if !push_identity_matches(&configured, &f) || !push_mac_matches(&mac, &f) {
        note("push", false, "report belongs to a different station", false);
        return 409;
    }
    // Extra-sensor-only stations are useful too; arbitrary non-weather fields are rejected.
    if num(&f, &["tempf", "temperature_c", "temp_c", "temp"]).is_none()
        && num(&f, &["windspeedmph", "wind_avg_m_s"]).is_none()
    {
        if !channels(&f).is_empty() {
            take(state, &f, epoch() as f64, SRC_INGEST, "push");
            return 200;
        }
        note("push", false, "no supported measurements in report", false);
        return 400;
    }
    // Console clocks are wrong often enough that trusting `dateutc` would scatter rows across
    // the archive. What matters is when we heard it.
    take(state, &f, epoch() as f64, SRC_INGEST, "push");
    200
}

fn push_mac_matches(configured: &str, fields: &Fields) -> bool {
    if configured.trim().is_empty() { return true; }
    // PASSKEY identifies an authenticated upload, not the hardware MAC. MAC-less protocols
    // cannot prove device identity; each station must use a distinct configured ingestKey.
    let Some(actual) = fields.get("mac") else { return true; };
    let normalize = |s: &str| s.trim().replace([':', '-'], "").to_ascii_uppercase();
    let wanted = normalize(configured);
    wanted.len() == 12 && wanted.bytes().all(|b| b.is_ascii_hexdigit()) && normalize(actual) == wanted
}

fn push_identity_matches(configured: &str, fields: &Fields) -> bool {
    if configured.is_empty() { return true; }
    if let Some(id) = fields.get("id").or_else(|| fields.get("station_id")) {
        return id.eq_ignore_ascii_case(configured);
    }
    let normalized = |s: &str| s.replace([':', '-'], "").to_ascii_lowercase();
    let wanted = normalized(configured);
    // A Tempest numeric ID left in settings is not an Ecowitt MAC address or passkey.
    if (wanted.len() == 12 || wanted.len() == 32) && wanted.bytes().all(|b| b.is_ascii_hexdigit()) {
        if let Some(id) = fields.get("mac").or_else(|| fields.get("passkey")) {
            return normalized(id) == wanted;
        }
    }
    true
}

// --- Pollers ---

fn get(url: &str, origin: &'static str) -> Option<serde_json::Value> {
    // Status code or transport kind only, never the error's Display: these URLs carry API keys in
    // their query strings and this string goes to a log.
    match ureq::get(url).timeout(Duration::from_secs(20)).call() {
        Ok(r) => r
            .into_string()
            .ok()
            .and_then(|b| serde_json::from_str(&b).ok()),
        Err(ureq::Error::Status(code, _)) => {
            eprintln!("stormdesk: station poll refused ({code})");
            note(origin, false, &format!("HTTP {code}"), false);
            None
        }
        Err(ureq::Error::Transport(t)) => {
            eprintln!("stormdesk: station poll failed ({:?})", t.kind());
            note(origin, false, &format!("{:?}", t.kind()), false);
            None
        }
    }
}

/// Davis WeatherLink Live, which is how a Vantage Pro2 or a Vantage Vue gets on the network
/// (a Console 6313 serves the same route). Local HTTP, no key, no cloud.
///
/// ponytail: WLL also broadcasts 2.5-second wind over UDP 22222 after an arming request. The
/// 10-second poll is the same data at a resolution the gauge can't show; arm the UDP stream if
/// somebody wants the fast needle.
fn poll_wll(state: &Arc<State>, host: &str) {
    let identity = crate::server::station_fingerprint(&state.cfg_path);
    if crate::setting(&state.cfg_path, "stationSource").as_deref() != Some("wll")
        || crate::setting(&state.cfg_path, "wllHost").as_deref() != Some(host) { return; }
    let Some(v) = get(&format!("http://{host}/v1/current_conditions"), "wll") else {
        return;
    };
    let ts = v
        .pointer("/data/ts")
        .and_then(|t| t.as_f64())
        .unwrap_or(epoch() as f64);
    let f = wll_fields(&v);
    if !f.is_empty() {
        take_for_station(state, &f, ts, SRC_INGEST, "wll", &identity);
    }
}

/// The payload-to-fields half of the WLL poll, split out so it can be tested without a console.
fn wll_fields(v: &serde_json::Value) -> Fields {
    let mut f = Fields::new();
    let Some(conds) = v.pointer("/data/conditions").and_then(|c| c.as_array()) else {
        return f;
    };
    for c in conds {
        let g = |k: &str| c.get(k).and_then(|x| x.as_f64());
        // Structure type 1 is the ISS — the outdoor sensor suite. The others are the barometer
        // (3), the indoor sensor (4) and any extra transmitters.
        match c
            .get("data_structure_type")
            .and_then(|x| x.as_i64())
            .unwrap_or(0)
        {
            1 => {
                let put = |f: &mut Fields, k: &str, v: Option<f64>| {
                    if let Some(v) = v {
                        f.insert(k.into(), v.to_string());
                    }
                };
                put(&mut f, "tempf", g("temp"));
                put(&mut f, "humidity", g("hum"));
                put(&mut f, "windspeedmph", g("wind_speed_avg_last_1_min"));
                put(&mut f, "windgustmph", g("wind_speed_hi_last_2_min"));
                put(&mut f, "winddir", g("wind_dir_scalar_avg_last_1_min"));
                put(&mut f, "solarradiation", g("solar_rad"));
                put(&mut f, "uv", g("uv_index"));
                put(&mut f, "trans_battery_flag", g("trans_battery_flag"));
                // Davis reports rain as tip counts and tells you separately how big a tip is.
                if let Some(counts) = g("rainfall_daily") {
                    f.insert(
                        "dailyrainmm".into(),
                        (counts * rain_bucket_mm(c)).to_string(),
                    );
                }
            }
            3 => {
                if let Some(bar) = g("bar_absolute") {
                    f.insert("baromabsin".into(), bar.to_string());
                }
            }
            4 => {
                if let Some(temp) = g("temp_in") { f.insert("tempinf".into(), temp.to_string()); }
                if let Some(hum) = g("hum_in") { f.insert("humidityin".into(), hum.to_string()); }
            }
            _ => {}
        }
    }
    f
}

/// Millimetres per tip, from the gauge Davis says is installed. Default is the 0.01 in gauge
/// sold in North America, which is what an unset field almost always means.
fn rain_bucket_mm(c: &serde_json::Value) -> f64 {
    match c.get("rain_size").and_then(|x| x.as_i64()).unwrap_or(1) {
        2 => 0.2,
        3 => 0.1,
        4 => 0.0254,
        _ => 0.254,
    }
}

/// Ambient Weather Network. The official API, and the only way to read a KestrelMet 6000 —
/// it has no local protocol at all. Also covers any Ambient console whose owner would rather
/// not point it away from Ambient's own servers.
fn poll_awn(state: &Arc<State>, api_key: &str, app_key: &str) {
    let identity = crate::server::station_fingerprint(&state.cfg_path);
    let selected = crate::setting(&state.cfg_path, "stationId").unwrap_or_default();
    if crate::setting(&state.cfg_path, "stationSource").as_deref() != Some("awn")
        || crate::setting(&state.cfg_path, "awnApiKey").as_deref() != Some(api_key)
        || crate::setting(&state.cfg_path, "awnAppKey").as_deref() != Some(app_key) { return; }
    let url = format!(
        "https://rt.ambientweather.net/v1/devices?applicationKey={app_key}&apiKey={api_key}"
    );
    let Some(v) = get(&url, "awn") else { return };
    let Some(last) = awn_device(&v, &selected).and_then(|d| d.get("lastData")) else {
        note("awn", false, "selected station not found in account", false);
        return;
    };
    let mut f = Fields::new();
    parse_json(last, &mut f);
    // `dateutc` is milliseconds here, unlike everywhere else in this file.
    let ts = last
        .get("dateutc")
        .and_then(|t| t.as_f64())
        .map(|ms| ms / 1000.0)
        .unwrap_or(epoch() as f64);
    take_for_station(state, &f, ts, SRC_CLOUD, "awn", &identity);
}

fn awn_device<'a>(value: &'a serde_json::Value, selected: &str) -> Option<&'a serde_json::Value> {
    let devices = value.as_array()?;
    if selected.is_empty() { return devices.first(); }
    let normalize = |s: &str| s.replace([':', '-'], "").to_ascii_lowercase();
    let wanted = normalize(selected);
    devices.iter().find(|device| device["macAddress"].as_str().is_some_and(|mac| normalize(mac) == wanted))
}

/// La Crosse. Unofficial: there is no published API, and this is the app's own — a Google
/// Identity Toolkit login against a key shipped inside the app, then their gateway. Expect it to
/// break without warning; that is why these rows are `SRC_CLOUD` and can be deleted on their own.
const LACROSSE_KEY: &str = "AIzaSyD-Uo0hkRIeDYJhyyIg-TvAv8HhExARIO4";

fn lacrosse_token(email: &str, pass: &str) -> Option<String> {
    let url = format!("https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyPassword?key={LACROSSE_KEY}");
    let body = serde_json::json!({"email": email, "password": pass, "returnSecureToken": true});
    match ureq::post(&url)
        .timeout(Duration::from_secs(20))
        .set("Content-Type", "application/json")
        .send_string(&body.to_string())
    {
        Ok(r) => serde_json::from_str::<serde_json::Value>(&r.into_string().ok()?)
            .ok()?
            .get("idToken")?
            .as_str()
            .map(String::from),
        Err(ureq::Error::Status(code, _)) => {
            eprintln!("stormdesk: La Crosse login refused ({code})");
            None
        }
        Err(_) => None,
    }
}

fn bearer(url: &str, token: &str) -> Option<serde_json::Value> {
    match ureq::get(url)
        .timeout(Duration::from_secs(20))
        .set("Authorization", &format!("Bearer {token}"))
        .call()
    {
        Ok(r) => r
            .into_string()
            .ok()
            .and_then(|b| serde_json::from_str(&b).ok()),
        Err(ureq::Error::Status(code, _)) => {
            eprintln!("stormdesk: La Crosse read refused ({code})");
            note("lacrosse", false, &format!("HTTP {code}"), false);
            None
        }
        Err(ureq::Error::Transport(t)) => {
            eprintln!("stormdesk: La Crosse read failed ({:?})", t.kind());
            note("lacrosse", false, &format!("{:?}", t.kind()), false);
            None
        }
    }
}

fn poll_lacrosse(state: &Arc<State>, token: &str, identity: &str) {
    if crate::setting(&state.cfg_path, "stationSource").as_deref() != Some("lacrosse")
        || crate::server::station_fingerprint(&state.cfg_path) != identity { return; }
    const GW: &str = "https://lax-gateway.appspot.com/_ah/api/lacrosseClient/v1.1/active-user";
    let Some(locs) = bearer(&format!("{GW}/locations"), token) else {
        return;
    };
    let Some(loc) = locs.pointer("/items/0/id").and_then(|v| {
        v.as_str()
            .map(String::from)
            .or_else(|| v.as_i64().map(|i| i.to_string()))
    }) else {
        return;
    };
    let Some(devs) = bearer(
        &format!("{GW}/location/{loc}/sensorAssociations?prettyPrint=false"),
        token,
    ) else {
        return;
    };
    let Some(dev) = devs.pointer("/items/0/sensor") else {
        return;
    };
    let Some(id) = dev.get("id").and_then(|v| v.as_str()) else {
        return;
    };

    let feed = format!(
        "https://ingv2.lacrossetechnology.com/api/v1.1/active-user/device-association/ref.user-device.{id}/feed\
         ?fields=temperature,humidity,barometric_pressure,wind_speed,wind_heading,rain_total&aggregates=ai.ticks.1&types=spot"
    );
    let Some(v) = bearer(&feed, token) else {
        return;
    };
    // The feed nests one object per field, each with its own trailing sample. Walk it rather
    // than index it: which fields come back depends on which sensors the account owns.
    let mut f = Fields::new();
    let mut ts = epoch() as f64;
    for (_, per_device) in v.as_object().into_iter().flatten() {
        for (name, series) in per_device.as_object().into_iter().flatten() {
            let Some(last) = series
                .pointer("/values")
                .and_then(|a| a.as_array())
                .and_then(|a| a.last())
            else {
                continue;
            };
            if let Some(u) = last.get("u").and_then(|u| u.as_f64()) {
                ts = u;
            }
            let Some(val) = last.pointer("/s").and_then(|s| s.as_f64()) else {
                continue;
            };
            let key = match name.as_str() {
                "temperature" => "temperature_c",
                "humidity" => "humidity",
                "barometric_pressure" => "pressure_hpa",
                "wind_speed" => "wind_avg_m_s",
                "wind_heading" => "wind_dir_deg",
                "rain_total" => "rain_mm",
                _ => continue,
            };
            f.insert(key.into(), val.to_string());
        }
    }
    if !f.is_empty() {
        take_for_station(state, &f, ts, SRC_CLOUD, "lacrosse", identity);
    }
}

/// One thread for every pulled source. Settings are read fresh each tick, the same way
/// `cwop::start` does it, so filling in a WeatherLink address in the drawer takes effect without
/// a restart.
///
/// ponytail: no Ecowitt `get_livedata_info` poller. Push covers every gateway they sell, and it
/// costs the user nothing that their console isn't already configured to spend.
pub fn start_pollers(state: Arc<State>) {
    std::thread::spawn(move || {
        let mut tick: u64 = 0;
        let mut lax: Option<(String, u64, String)> = None; // token, minted at, station identity
        loop {
            std::thread::sleep(Duration::from_secs(10));
            tick += 1;
            let s = |k: &str| crate::setting(&state.cfg_path, k).unwrap_or_default();

            let wll = s("wllHost");
            if s("stationSource") == "wll" && !wll.is_empty() {
                poll_wll(&state, &wll);
            }

            // Retention, hourly, from the one loop that already holds the state. Off by default:
            // an archive is the reason most people run this, and a non-Tempest install has no
            // cloud to backfill from once a year is gone.
            if tick % 360 == 1 {
                let years = s("retentionYears")
                    .trim_matches('"')
                    .parse::<i64>()
                    .unwrap_or(0);
                if years > 0 {
                    let cutoff = epoch() as i64 - years * 365 * 86400;
                    // A week per lock: the UDP listener writes on its own connection and gives up
                    // after ten seconds, so a long DELETE is a dropped reading.
                    while state.with_db(|c| store::prune(c, cutoff)).unwrap_or(0) > 0 {}
                }
            }

            // A minute apart: the API allows one request a second, and the station behind it
            // uploads far more slowly than that.
            let (api, app) = (s("awnApiKey"), s("awnAppKey"));
            if s("stationSource") == "awn" && tick % 6 == 0 && !api.is_empty() && !app.is_empty() {
                poll_awn(&state, &api, &app);
            }

            let (email, pass) = (s("lacrosseEmail"), s("lacrossePass"));
            if s("stationSource") == "lacrosse" && tick % 12 == 0 && !email.is_empty() && !pass.is_empty() {
                let identity = crate::server::station_fingerprint(&state.cfg_path);
                // Tokens last an hour; mint a new one at fifty minutes rather than discover the
                // expiry as a 401 on a station that then reads as offline.
                let fresh = lax
                    .as_ref()
                    .map(|(_, at, id)| epoch().saturating_sub(*at) < 3000 && id == &identity)
                    .unwrap_or(false);
                if !fresh {
                    lax = lacrosse_token(&email, &pass).map(|t| (t, epoch(), identity));
                }
                if let Some((t, _, id)) = lax.as_ref() {
                    poll_lacrosse(&state, t, id);
                }
            }
        }
    });
}

// ponytail: the checks that matter are the conversions and the two running counters — a wrong
// factor is a plausible-looking wrong number forever, and a counter that doesn't handle midnight
// turns one day's rain into a negative that poisons every SUM in the archive.
#[cfg(test)]
mod tests {
    use super::*;

    /// Rain that fell while the app was down still gets scored once, and a console that rolled
    /// its daily total over in the meantime never scores a negative interval.
    #[test]
    fn counters_survive_a_restart_and_a_rollover_while_down() {
        let now = 1_700_000_000u64;
        let mut m = Mem {
            rain: Some(0.4),
            ..Default::default()
        };
        let saved = m.json(now);

        // Restart: the seed is picked up and the next report scores only the difference.
        let mut back = Mem::from_json(&saved, now + 600);
        assert!((delta(&mut back.rain, 0.7) - 0.3).abs() < 1e-9);

        // Rolled over while we were down — the new total is the accumulation since, never negative.
        let mut rolled = Mem::from_json(&saved, now + 600);
        assert_eq!(delta(&mut rolled.rain, 0.1), 0.1_f64);

        // Three days later the console's total means nothing to us any more: start cold, which
        // scores the first report as zero rather than inventing a day of rain.
        let mut stale = Mem::from_json(&saved, now + 3 * 86400);
        assert!(stale.rain.is_none());
        assert_eq!(delta(&mut stale.rain, 5.0), 0.0_f64);

        // A truncated or hand-edited meta row is a cold start, not a panic.
        assert!(Mem::from_json("{oops", now).rain.is_none());
        assert!(Mem::from_json("", now).strikes.is_none());

        // Throttle state is deliberately not carried across: the first report after a restart is
        // worth a row whatever the clock says.
        m.last_wall = Some(now);
        assert!(Mem::from_json(&m.json(now), now).last_wall.is_none());
    }

    /// A real Ecowitt "customized upload" body, GW2000 firmware, Wittboy attached.
    const ECOWITT: &str = "PASSKEY=A1B2C3&stationtype=GW2000A_V3.1.5&dateutc=2026-08-19+14:30:00\
        &tempf=77.0&humidity=55&winddir=180&windspeedmph=10.0&windgustmph=20.0\
        &baromabsin=29.92&baromrelin=30.01&dailyrainin=0.10&solarradiation=812.4&uv=7\
        &lightning=12&lightning_num=3&freq=915M&model=GW2000A";

    /// The same reading as an Ambient console's awnet custom-server GET.
    const AMBIENT: &str = "/ingest?stationtype=AMBWeatherV4.3.4&PASSKEY=AA:BB:CC&dateutc=2026-08-19+14:30:00\
        &tempf=77.0&humidity=55&winddir=180&windspeedmph=10.0&windgustmph=20.0&baromabsin=29.92&dailyrainin=0.10";

    /// And as a Weather Underground protocol update, which is what the clones speak.
    const WU: &str = "/weatherstation/updateweatherstation.php?ID=KXX1&PASSWORD=x&dateutc=now\
        &tempf=77.0&humidity=55&winddir=180&windspeedmph=10.0&windgustmph=20.0&baromin=29.92&dailyrainin=0.10";

    /// And as WeeWX's Wunderground uploader sends it — same protocol, WeeWX's field set and
    /// softwaretype tag. Feeding StormDesk from WeeWX is docs/weewx.md, and this is the
    /// assertion behind it.
    const WEEWX: &str = "/weatherstation/updateweatherstation.php?ID=anything&PASSWORD=anything\
        &dateutc=2026-08-19+14%3A30%3A00&tempf=77.0&humidity=55&dewptf=60.5&winddir=180\
        &windspeedmph=10.0&windgustmph=20.0&baromin=29.92&rainin=0.02&dailyrainin=0.10\
        &solarradiation=812.4&UV=7&softwaretype=weewx-5.0.2&action=updateraw";

    fn build(url: &str, body: &str) -> Vec<Option<f64>> {
        let f = collect(url, body);
        let mut m = Mem::default();
        tuple(&f, 1_000_000.0, &mut m)
    }

    fn close(a: Option<f64>, b: f64) -> bool {
        a.map(|x| (x - b).abs() < 0.01).unwrap_or(false)
    }

    #[test]
    fn ecowitt_lands_in_the_right_slots() {
        let t = build("/ingest", ECOWITT);
        assert!(close(t[7], 25.0), "77 F is 25 C, got {:?}", t[7]);
        assert!(close(t[8], 55.0));
        assert!(close(t[2], 4.4704), "10 mph in m/s, got {:?}", t[2]);
        assert!(close(t[3], 8.9408));
        assert!(close(t[4], 180.0));
        assert!(close(t[6], 1013.21), "29.92 inHg in mb, got {:?}", t[6]);
        assert!(close(t[11], 812.4));
        assert!(close(t[10], 7.0));
        assert!(close(t[14], 12.0));
        assert!(
            close(t[18], 2.54),
            "0.10 in of rain is 2.54 mm, got {:?}",
            t[18]
        );
        // Nothing to difference against yet, so the first report claims no rain and no strikes.
        assert_eq!((t[12], t[15]), (Some(0.0), Some(0.0)));
        // Slots no other brand reports stay empty rather than zero.
        assert_eq!((t[1], t[5], t[9], t[16]), (None, None, None, None));
    }

    #[test]
    fn absolute_pressure_wins_over_relative() {
        let t = build("/ingest", ECOWITT);
        assert!(
            close(t[6], 1013.21),
            "took the sea-level figure: {:?}",
            t[6]
        );
    }

    #[test]
    fn weewx_wu_uploader_lands_in_the_right_slots() {
        let t = build("/weatherstation/updateweatherstation.php", WEEWX);
        assert!(close(t[7], 25.0), "77 F is 25 C, got {:?}", t[7]);
        assert!(close(t[8], 55.0));
        assert!(close(t[2], 4.4704));
        assert!(close(t[3], 8.9408));
        assert!(close(t[4], 180.0));
        assert!(close(t[6], 1013.21), "29.92 inHg in mb, got {:?}", t[6]);
        assert!(close(t[11], 812.4));
        assert!(
            close(t[18], 2.54),
            "0.10 in of daily rain is 2.54 mm, got {:?}",
            t[18]
        );
    }

    #[test]
    fn ambient_and_wu_read_the_same_as_ecowitt() {
        let e = build("/ingest", ECOWITT);
        let a = build(AMBIENT, "");
        let w = build(WU, "");
        for slot in [2, 3, 4, 6, 7, 8, 18] {
            assert_eq!(
                e[slot], a[slot],
                "slot {slot} differs between Ecowitt and Ambient"
            );
            assert_eq!(
                e[slot], w[slot],
                "slot {slot} differs between Ecowitt and WU"
            );
        }
    }

    #[test]
    fn rain_is_an_interval_and_survives_midnight() {
        let mut m = Mem::default();
        let f = |mm: &str| {
            let mut x = Fields::new();
            x.insert("tempf".into(), "70".into());
            x.insert("dailyrainin".into(), mm.into());
            x
        };
        assert_eq!(
            tuple(&f("0.10"), 0.0, &mut m)[12],
            Some(0.0),
            "first report must not claim the day's rain"
        );
        let t = tuple(&f("0.15"), 60.0, &mut m);
        assert!(
            close(t[12], 0.05 * MM_PER_IN),
            "0.05 in fell, got {:?}",
            t[12]
        );
        assert_eq!(t[13], Some(1.0), "rain fell but precip type says dry");
        // Midnight: the console's daily total restarts. The drop is a rollover, not negative rain.
        let t = tuple(&f("0.02"), 120.0, &mut m);
        assert!(
            close(t[12], 0.02 * MM_PER_IN),
            "rollover mishandled: {:?}",
            t[12]
        );
        assert!(
            t[12].unwrap() >= 0.0,
            "a negative rainfall would poison every SUM"
        );
        // Dry interval.
        let t = tuple(&f("0.02"), 180.0, &mut m);
        assert_eq!((t[12], t[13]), (Some(0.0), Some(0.0)));
    }

    #[test]
    fn strikes_are_counted_per_interval() {
        let mut m = Mem::default();
        let f = |n: &str| {
            let mut x = Fields::new();
            x.insert("tempf".into(), "70".into());
            x.insert("lightning_num".into(), n.into());
            x
        };
        assert_eq!(tuple(&f("3"), 0.0, &mut m)[15], Some(0.0));
        assert_eq!(tuple(&f("7"), 60.0, &mut m)[15], Some(4.0));
        assert_eq!(
            tuple(&f("1"), 120.0, &mut m)[15],
            Some(1.0),
            "counter reset should not go negative"
        );
    }

    #[test]
    fn report_interval_is_minutes_and_clamped() {
        let mut m = Mem::default();
        let mut f = Fields::new();
        f.insert("tempf".into(), "70".into());
        assert_eq!(
            tuple(&f, 0.0, &mut m)[17],
            None,
            "no previous report, no interval"
        );
        m.last_ts = Some(0.0);
        assert_eq!(tuple(&f, 60.0, &mut m)[17], Some(1.0));
        m.last_ts = Some(0.0);
        assert_eq!(
            tuple(&f, 86_400.0, &mut m)[17],
            Some(30.0),
            "a day's gap must clamp, not scale"
        );
    }

    #[test]
    fn rtl_433_json_maps_through_the_si_names() {
        // What `rtl_433 -C si -F json` prints for an AcuRite 5-in-1.
        let body = r#"{"model":"Acurite-5n1","temperature_C":25.0,"humidity":55,
            "wind_avg_m_s":4.4704,"wind_dir_deg":180,"rain_mm":10.0}"#;
        let t = build("/ingest", body);
        assert!(close(t[7], 25.0));
        assert!(close(t[2], 4.4704));
        assert!(close(t[4], 180.0));
        assert!(close(t[18], 10.0));
    }

    /// A real /v1/current_conditions body, trimmed to the fields we read. Solar and UV come off
    /// the ISS record and used to be dropped on the floor.
    #[test]
    fn a_wll_payload_becomes_the_fields_the_tuple_wants() {
        let v = serde_json::json!({"data": {"ts": 1_700_000_000i64, "conditions": [
            {"data_structure_type": 1, "temp": 71.6, "hum": 54.0,
             "wind_speed_avg_last_1_min": 4.0, "wind_speed_hi_last_2_min": 11.0,
             "wind_dir_scalar_avg_last_1_min": 190.0, "solar_rad": 812.0, "uv_index": 6.5,
             "rainfall_daily": 14.0, "rain_size": 1},
            {"data_structure_type": 3, "bar_absolute": 29.61, "bar_sea_level": 29.86},
            {"data_structure_type": 4, "temp_in": 70.0}]}});
        let f = wll_fields(&v);
        assert_eq!(f.get("tempf").map(String::as_str), Some("71.6"));
        assert_eq!(f.get("windspeedmph").map(String::as_str), Some("4"));
        assert_eq!(f.get("winddir").map(String::as_str), Some("190"));
        assert_eq!(f.get("uv").map(String::as_str), Some("6.5"));
        assert_eq!(f.get("solarradiation").map(String::as_str), Some("812"));
        // 14 tips of the 0.01 in gauge is 3.556 mm, not 14 of anything.
        let rain: f64 = f.get("dailyrainmm").unwrap().parse().unwrap();
        assert!((rain - 3.556).abs() < 1e-6, "rain was {rain}");
        // The archive holds station pressure; sea level is derived from altitude downstream.
        assert_eq!(f.get("baromabsin").map(String::as_str), Some("29.61"));
        // The indoor record is not the outdoor temperature.
        assert!(!f.contains_key("temp_in"));
    }

    #[test]
    fn davis_rain_counts_use_the_gauge_size() {
        let iss = serde_json::json!({"rain_size": 1});
        assert!((rain_bucket_mm(&iss) - 0.254).abs() < 1e-9, "0.01 in gauge");
        assert!((rain_bucket_mm(&serde_json::json!({"rain_size": 4})) - 0.0254).abs() < 1e-9);
        // An absent field is the North American gauge, not zero millimetres a tip.
        assert!((rain_bucket_mm(&serde_json::json!({})) - 0.254).abs() < 1e-9);
    }

    /// The Davis regression: a console stamping its reports a day into the future used to freeze
    /// the throttle forever, because the gate compared payload stamps.
    #[test]
    fn a_console_clock_in_the_future_cannot_stall_the_gate() {
        let now = 1_000_000u64;
        let ahead = now as f64 + 86_400.0;
        let mut m = Mem::default();
        assert!(keep(now, &m, ahead), "first report always keeps");
        m.last_wall = Some(now);
        m.last_raw = Some(ahead);
        assert!(
            !keep(now + 10, &m, ahead + 10.0),
            "ten seconds later is still the same minute"
        );
        assert!(
            keep(now + MIN_GAP, &m, ahead + 60.0),
            "a minute of our time must let a row through"
        );
    }

    #[test]
    fn a_repeated_poll_result_is_not_a_new_interval() {
        let m = Mem {
            last_wall: Some(0),
            last_raw: Some(500.0),
            ..Mem::default()
        };
        assert!(
            !keep(1_000, &m, 500.0),
            "same payload stamp is the same reading"
        );
        assert!(keep(1_000, &m, 501.0));
    }

    #[test]
    fn sources_do_not_throttle_each_other() {
        // Two entries in the map, so a push and a poll each get their own minute.
        let mut map: HashMap<&'static str, Mem> = HashMap::new();
        map.insert(
            "push",
            Mem {
                last_wall: Some(1_000),
                ..Mem::default()
            },
        );
        assert!(keep(1_010, map.entry("wll").or_default(), 1_010.0));
        assert!(!keep(1_010, &map["push"], 1_010.0));
    }

    #[test]
    fn percent_encoding_and_plus_signs_decode() {
        let f = collect("/ingest", "dateutc=2026-08-19+14%3A30%3A00&tempf=77.0");
        assert_eq!(
            f.get("dateutc").map(String::as_str),
            Some("2026-08-19 14:30:00")
        );
        assert_eq!(f.get("tempf").map(String::as_str), Some("77.0"));
    }

    /// A `%` in front of a multi-byte character used to put a str slice mid-character and panic.
    /// `/ingest` takes no credentials and a panicked worker thread is never replaced, so a handful
    /// of crafted requests was enough to leave the dashboard unanswered.
    #[test]
    fn a_stray_percent_before_a_wide_character_does_not_panic() {
        assert_eq!(
            percent_decode("%41"),
            "A",
            "a real escape must still decode"
        );
        assert_eq!(percent_decode("%€"), "%€");
        assert_eq!(percent_decode("a%€b"), "a%€b");
        // And arriving the way it would off the wire: the rest of the body still parses.
        let f = collect("/ingest", "tempf=%€&humidity=55");
        assert_eq!(f.get("humidity").map(String::as_str), Some("55"));
    }

    #[test]
    fn a_failed_observation_does_not_advance_counters() {
        let mut conn = store::open(std::path::Path::new(":memory:")).unwrap();
        conn.execute_batch("CREATE TRIGGER reject_obs BEFORE INSERT ON obs BEGIN SELECT RAISE(ABORT, 'test'); END;").unwrap();
        let mut tuple = vec![None; 19];
        tuple[0] = Some(1_700_000_000.0);
        assert!(!store_observation(&mut conn, &tuple, store::SRC_UDP, "counter:test", "advanced"));
        assert!(store::meta_get(&conn, "counter:test").is_none());
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM obs", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
    }

    #[test]
    fn channel_units_flags_and_allowlist_are_preserved() {
        let f = collect("/ingest", "tempinf=68&humidityin=45&temp1f=77&tf_ch1=50&soilmoisture1=32&pm25_ch1=8.5&co2=420&wh65batt=1&soilbatt1=1.4&wh57batt=3&batt1=0&battery_ok=1&PASSWORD=999&unknown=123&humidity2=101&temp2f=NaN&pm25_ch2=-1&batt2=0.5");
        let got = channels(&f);
        let value = |name: &str| got.iter().find(|c| c.name == name).map(|c| (c.value, c.unit));
        assert_eq!(value("indoor_temperature"), Some((20.0, "°C")));
        assert_eq!(value("temperature_1"), Some((25.0, "°C")));
        assert_eq!(value("soil_temperature_1"), Some((10.0, "°C")));
        assert_eq!(value("soil_moisture_1"), Some((32.0, "%")));
        assert_eq!(value("pm25_1"), Some((8.5, "µg/m³")));
        assert_eq!(value("co2"), Some((420.0, "ppm")));
        assert_eq!(value("battery_wh65"), Some((1.0, "low")));
        assert_eq!(value("battery_temperature_1"), Some((0.0, "low")));
        assert_eq!(value("battery_sensor"), Some((0.0, "low")));
        assert_eq!(value("battery_soil_1"), Some((1.4, "V")));
        assert_eq!(value("battery_wh57"), Some((60.0, "%")));
        for rejected in ["password", "unknown", "humidity_2", "temperature_2", "pm25_2", "battery_temperature_2"] {
            assert!(value(rejected).is_none(), "{rejected}");
        }
        assert!(tuple(&f, 1.0, &mut Mem::default())[16].is_none(), "flags never become volts");
    }

    #[test]
    fn channel_failure_rolls_back_observation_and_counters() {
        let mut conn = store::open(std::path::Path::new(":memory:")).unwrap();
        let mut row = vec![None; 19];
        row[0] = Some(1_700_000_000.0);
        let extras = channels(&collect("/ingest", "tempinf=68&wh65batt=1"));
        conn.execute_batch("CREATE TRIGGER reject_channel BEFORE INSERT ON channels BEGIN SELECT RAISE(ABORT, 'test'); END;").unwrap();
        assert!(!store_observation_channels(&mut conn, &row, SRC_INGEST, "counters:push", "new", &extras));
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM obs", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
        assert!(store::meta_get(&conn, "counters:push").is_none());
        conn.execute_batch("DROP TRIGGER reject_channel;").unwrap();
        assert!(store_observation_channels(&mut conn, &row, SRC_INGEST, "counters:push", "new", &extras));
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM channels", [], |r| r.get::<_, i64>(0)).unwrap(), 2);
        assert!(!store_observation_channels(&mut conn, &row, SRC_INGEST, "counters:push", "duplicate", &extras));
        assert_eq!(store::meta_get(&conn, "counters:push").as_deref(), Some("new"));
    }

    #[test]
    fn station_counters_do_not_share_a_source_slot() {
        let mut map: HashMap<String, Mem> = HashMap::new();
        map.insert("ecowitt:home:push".into(), Mem { rain: Some(50.0), last_wall: Some(1_000), ..Mem::default() });
        let cabin = map.entry("ecowitt:cabin:push".into()).or_default();
        assert!(keep(1_010, cabin, 1_010.0));
        assert_eq!(delta(&mut cabin.rain, 2.0), 0.0);
        assert_eq!(map["ecowitt:home:push"].rain, Some(50.0));
    }

    #[test]
    fn push_identity_rejects_other_station_ids_and_macs() {
        assert!(push_identity_matches("", &collect("/ingest", "ID=home")));
        assert!(push_identity_matches("home", &collect("/ingest", "ID=HOME")));
        assert!(!push_identity_matches("home", &collect("/ingest", "ID=cabin")));
        assert!(push_identity_matches("aa:bb:cc:dd:ee:ff", &collect("/ingest", "PASSKEY=AABBCCDDEEFF")));
        assert!(!push_identity_matches("aa:bb:cc:dd:ee:ff", &collect("/ingest", "PASSKEY=112233445566")));
        assert!(push_identity_matches("12345", &collect("/ingest", "PASSKEY=AABBCCDDEEFF")), "a leftover Tempest ID is not a MAC");
    }

    #[test]
    fn configured_ecowitt_mac_is_checked_without_confusing_passkeys() {
        let wanted="AA:BB:CC:DD:EE:01";
        assert!(push_mac_matches(wanted,&collect("/ingest","mac=aa-bb-cc-dd-ee-01")));
        assert!(!push_mac_matches(wanted,&collect("/ingest","mac=AA:BB:CC:DD:EE:02")));
        assert!(push_mac_matches(wanted,&collect("/ingest","PASSKEY=00112233445566778899aabbccddeeff")));
        let dir=std::env::temp_dir().join(format!("wd-ingest-mac-{}-{}",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        std::fs::create_dir_all(&dir).unwrap();
        let cfg=dir.join("config.json");
        std::fs::write(&cfg,serde_json::json!({"settings":{"stationSource":"ecowitt","ecowittMac":wanted,"ingestKey":"upload-secret"}}).to_string()).unwrap();
        let state=State::new(dir.clone(),cfg);
        let expected=crate::server::station_fingerprint(&state.cfg_path);
        let other=collect("/ingest","mac=AA:BB:CC:DD:EE:02&tempf=68");
        assert!(!take_for_station(&state,&other,epoch() as f64,SRC_INGEST,"push",&expected));
        assert_eq!(accept(&state,"/ingest?key=upload-secret","mac=AA:BB:CC:DD:EE:02&tempf=68"),409);
        assert!(state.packets.lock().unwrap().is_empty());
        assert_eq!(state.db().unwrap().query_row("SELECT COUNT(*) FROM obs",[],|r|r.get::<_,i64>(0)).unwrap(),0);
        let own=collect("/ingest","mac=aabbccddee01&tempf=68");
        assert!(take_for_station(&state,&own,epoch() as f64,SRC_INGEST,"push",&expected));
        assert_eq!(state.db().unwrap().query_row("SELECT COUNT(*) FROM obs",[],|r|r.get::<_,i64>(0)).unwrap(),1);
        drop(state);
        let _=std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_stale_poll_cannot_publish_or_write_to_the_selected_station() {
        let dir = std::env::temp_dir().join(format!("wd-ingest-race-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("config.json");
        std::fs::write(&path, r#"{"settings":{"stationSource":"wll","wllHost":"new-station"}}"#).unwrap();
        let state = State::new(dir.clone(), path);
        let f = collect("/ingest", "tempf=68&windspeedmph=3&winddir=180&wh65batt=1");
        assert!(!take_for_station(&state, &f, epoch() as f64, SRC_INGEST, "wll", "wll:old-station"));
        assert!(state.packets.lock().unwrap().is_empty());
        let conn = state.db().unwrap();
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM obs", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
        drop(conn);
        drop(state);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn ambient_selects_the_requested_station_not_the_first_device() {
        let devices = serde_json::json!([
            {"macAddress": "AA:BB:CC:DD:EE:FF", "lastData": {"tempf": 70}},
            {"macAddress": "11:22:33:44:55:66", "lastData": {"tempf": 30}}
        ]);
        assert_eq!(awn_device(&devices, "112233445566").unwrap()["lastData"]["tempf"], 30);
        assert_eq!(awn_device(&devices, "").unwrap()["lastData"]["tempf"], 70);
        assert!(awn_device(&devices, "unknown").is_none());
    }
}
