//! Alert rules and NWS watches, evaluated by the server rather than by whatever browser happens
//! to be open.
//!
//! `site/js/rules.js` has always done this well — but only while a tab is alive, which is the
//! one thing an alert must not depend on. A tablet that sleeps at midnight is a house with no
//! frost warning. Everything here mirrors that file deliberately, latch for latch, so the two
//! never disagree about whether a rule has fired; the page stands down (see `/diag`) when this
//! is running, because two engines on one ntfy topic means every alert arrives twice.
//!
//! The archive is SI. Rules are written in whatever the dashboard shows, so the readings are
//! converted here exactly as `app.js` converts them — a "below 32" rule typed against °F must
//! not fire at 32 °C.

use crate::store;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

/// One pass a minute. The archive gains a row a minute at best, and a rule with a duration is
/// measured in minutes by construction.
const TICK: Duration = Duration::from_secs(60);

/// A rule as the page writes it into the config blob. Every field past `metric`/`op`/`value` is
/// optional because rules saved before v3 have none of them — which is also why this is read
/// field by field rather than derived: a missing key must be a default, never a dropped rule.
#[derive(Debug, Clone)]
pub struct Rule {
    pub id: String,
    pub metric: String,
    pub op: String,
    pub value: f64,
    pub dur_min: f64,
    pub metric2: Option<String>,
    pub op2: Option<String>,
    pub value2: Option<f64>,
}

impl Rule {
    fn from_json(v: &serde_json::Value) -> Option<Rule> {
        let s = |k: &str| v.get(k).and_then(|x| x.as_str()).map(String::from);
        let f = |k: &str| v.get(k).and_then(|x| x.as_f64());
        Some(Rule {
            id: s("id").unwrap_or_default(),
            metric: s("metric")?,
            op: s("op").unwrap_or_else(|| ">".into()),
            value: f("value")?,
            dur_min: f("durMin").unwrap_or(0.0),
            metric2: s("metric2"),
            op2: s("op2"),
            value2: f("value2"),
        })
    }
}

/// Per-rule latch state, keyed by the rule's index in the saved list — the same key `rules.js`
/// uses, and cleared for the same reason when the list changes.
#[derive(Default, Clone, Copy)]
pub struct Latch {
    pub since: Option<i64>,
    pub latched: bool,
    pub last: Option<i64>,
}

/// The metric keys `rules.js` offers, and nothing else: a saved rule naming a metric that no
/// longer exists is skipped rather than treated as zero.
pub const METRICS: [&str; 16] = [
    "temp",
    "dew",
    "gust",
    "wind",
    "rh",
    "rain",
    "uv",
    "strikes3h",
    "press3h",
    "temp1h",
    "press1h",
    "rh1h",
    "low18h",
    "rain6h",
    "gust24h",
    "hiTomorrow",
];

fn holds(v: f64, op: &str, target: f64) -> bool {
    if op == "<" {
        v < target
    } else {
        v > target
    }
}

/// Re-arm at 90% of the threshold (110% for a "below" rule). Without it a gust hovering on
/// 30 mph notifies on every single report.
fn rearmed(v: f64, op: &str, target: f64) -> bool {
    if op == "<" {
        v > target * 1.1
    } else {
        v < target * 0.9
    }
}

fn second(m: &HashMap<&str, f64>, r: &Rule) -> bool {
    let Some(k) = r.metric2.as_deref() else {
        return true;
    };
    if !allowed_metric(k) {
        return false;
    }
    let (Some(v), Some(t)) = (m.get(k), r.value2) else {
        return false;
    };
    v.is_finite() && t.is_finite() && holds(*v, r.op2.as_deref().unwrap_or(">"), t)
}

fn channel_name(metric: &str) -> Option<&str> {
    metric.strip_prefix("channel:").filter(|name| !name.is_empty() && name.len() <= 80
        && name.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'_'))
}

fn forecast_metric(metric: &str) -> bool {
    ["low18h", "rain6h", "gust24h", "hiTomorrow"].contains(&metric)
}

fn allowed_metric(metric: &str) -> bool {
    METRICS.contains(&metric) || channel_name(metric).is_some()
}

/// Which rules fire on this reading. Pure, so the parity tests can drive it directly with the
/// same numbers `rules.js` asserts on.
pub fn evaluate(
    m: &HashMap<&str, f64>,
    rules: &[Rule],
    state: &mut HashMap<String, Latch>,
    now: i64,
) -> Vec<(usize, f64)> {
    evaluate_samples(m, rules, state, now, None)
}

fn evaluate_samples(
    m: &HashMap<&str, f64>, rules: &[Rule], state: &mut HashMap<String, Latch>,
    wall_time: i64, samples: Option<&HashMap<&str, i64>>,
) -> Vec<(usize, f64)> {
    let mut fired = Vec::new();
    for (i, r) in rules.iter().enumerate() {
        let key = if r.id.is_empty() {
            format!("legacy-{i}")
        } else {
            r.id.clone()
        };
        let st = state.entry(key).or_default();
        if !allowed_metric(&r.metric) {
            st.since = None;
            continue;
        }
        let Some(&v) = m.get(r.metric.as_str()) else {
            st.since = None;
            st.last = None;
            continue;
        };
        // The older input bounds the evidence for a compound rule. Wall-clock ticks
        // cannot prove that an unchanged sensor reading continued to hold.
        let stamp = |metric: &str| -> Option<i64> {
            let at = samples.map_or(Some(wall_time), |s| s.get(metric).copied())?;
            let age = if forecast_metric(metric) { 1800 } else { 600 };
            (at <= wall_time && wall_time - at <= age).then_some(at)
        };
        let at = stamp(&r.metric).and_then(|a| match r.metric2.as_deref() {
            Some(k) => stamp(k).map(|b| (a.min(b), a.max(b))), None => Some((a, a)),
        });
        let Some((now, first_evidence)) = at else { st.since = None; st.last = None; continue; };
        let gap = if samples.is_none() { 180 } else if forecast_metric(&r.metric)
            && r.metric2.as_deref().is_none_or(forecast_metric) { 1800 } else { 600 };
        if !v.is_finite() || st.last.is_some_and(|last| now < last || now - last > gap) {
            st.since = None;
            st.last = Some(now);
            continue;
        }
        st.last = Some(now);
        if !holds(v, &r.op, r.value) || !second(m, r) {
            st.since = None;
            if st.latched && rearmed(v, &r.op, r.value) {
                st.latched = false;
            }
            continue;
        }
        st.since.get_or_insert(first_evidence);
        if !st.latched && now - st.since.unwrap() >= (r.dur_min * 60.0) as i64 {
            st.latched = true;
            fired.push((i, v));
        }
    }
    fired
}

/// Extra sensor thresholds are stored in these raw units, independent of dashboard display units.
fn channel_metrics(conn: &rusqlite::Connection, now: i64) -> HashMap<String, (f64, String, i64)> {
    let mut out = HashMap::new();
    let Ok(mut stmt) = conn.prepare(
        "SELECT c.name,c.value,c.unit,c.ts FROM channels c
         JOIN (SELECT name,MAX(ts) AS ts FROM channels WHERE ts >= ?1 AND ts <= ?2 GROUP BY name) latest
         ON c.name=latest.name AND c.ts=latest.ts
         WHERE NOT EXISTS (SELECT 1 FROM notes WHERE kind='exclude' AND c.ts BETWEEN notes.ts AND notes.until)") else { return out; };
    let Ok(rows) = stmt.query_map([now - 600, now], |r| Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?, r.get::<_, String>(2)?, r.get::<_, i64>(3)?))) else { return out; };
    for (name, value, unit, ts) in rows.flatten() {
        let metric = format!("channel:{name}");
        if channel_name(&metric).is_some() && value.is_finite()
            && ["°C", "%", "V", "low", "µg/m³", "ppm"].contains(&unit.as_str())
            && (unit != "low" || value == 0.0 || value == 1.0)
        {
            out.insert(metric, (value, unit, ts));
        }
    }
    out
}

fn channel_description(metric: &str, unit: &str) -> (String, String, usize) {
    let name = channel_name(metric).unwrap_or("sensor");
    let mut label = name.replace('_', " ").replace("pm25", "PM2.5").replace("co2", "CO₂");
    if let Some(rest) = name.strip_prefix("battery_") { label = format!("{} battery", rest.replace('_', " ")); }
    if let Some(first) = label.chars().next() { label.replace_range(..first.len_utf8(), &first.to_uppercase().to_string()); }
    (label, if unit == "low" { " (0 normal / 1 low)".into() } else { format!(" {unit}") }, if unit == "low" { 0 } else { 1 })
}

// --- reading the archive in the units the rule was written in ---

fn imperial(cfg: &std::path::Path) -> bool {
    crate::setting(cfg, "units")
        .unwrap_or_default()
        .trim_matches('"')
        != "metric"
}

/// m/s to whatever the wind is displayed in — the dashboard's wind unit is separately
/// overridable, so this is not simply "metric or not".
fn wind_factor(cfg: &std::path::Path) -> f64 {
    let unit = crate::setting(cfg, "windUnit")
        .unwrap_or_default()
        .trim_matches('"')
        .to_string();
    match unit.as_str() {
        "km/h" => 3.6,
        "m/s" => 1.0,
        "kt" => 1.94384,
        "mph" => 2.23694,
        _ if imperial(cfg) => 2.23694,
        _ => 3.6,
    }
}

/// The newest row as the metric map `evaluate` wants, in display units.
///
/// `dew` is absent: the archive holds no dew point column, and `rules.js` leaves it null on the
/// live-tuple path for the same reason. A dew rule simply never fires here, which is what it
/// already does for every non-Tempest station.
fn metrics(
    conn: &rusqlite::Connection,
    cfg: &std::path::Path,
) -> Option<(i64, HashMap<&'static str, f64>)> {
    let imp = imperial(cfg);
    let w = wind_factor(cfg);
    /// ts, then the eight readings a rule can name, each of which any station is free to be
    /// missing.
    type Row = (i64, Opt, Opt, Opt, Opt, Opt, Opt, Opt, Opt);
    type Opt = Option<f64>;
    let (ts, gust, wind, rh, temp, uv, rain, interval, press): Row = conn
        .query_row(
            "SELECT ts, wind_gust, wind_avg, humidity, temp, uv, rain, report_interval, pressure
             FROM usable_obs ORDER BY ts DESC LIMIT 1",
            [],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                    r.get(7)?,
                    r.get(8)?,
                ))
            },
        )
        .ok()?;

    let mut m: HashMap<&'static str, f64> = HashMap::new();
    let mut put = |k: &'static str, v: Option<f64>| {
        if let Some(v) = v {
            m.insert(k, v);
        }
    };
    put(
        "temp",
        temp.map(|c| if imp { c * 9.0 / 5.0 + 32.0 } else { c }),
    );
    put("gust", gust.map(|v| v * w));
    put("wind", wind.map(|v| v * w));
    put("rh", rh);
    if let (Some(t), Some(rh)) = (temp, rh.filter(|v| *v > 0.0)) {
        let a = 17.625;
        let b = 243.04;
        let g = (rh / 100.0).ln() + a * t / (b + t);
        let dew = b * g / (a - g);
        put("dew", Some(if imp { dew * 9.0 / 5.0 + 32.0 } else { dew }));
    }
    put("uv", uv);
    // The archive holds the accumulation for one report interval; the rule is written per hour.
    let mins = interval.filter(|v| *v > 0.0).unwrap_or(1.0);
    put(
        "rain",
        rain.map(|v| v * (60.0 / mins) * if imp { 1.0 / 25.4 } else { 1.0 }),
    );

    // Three hours back, for the two metrics that are a change rather than a reading.
    let then: Option<f64> = conn
        .query_row(
            "SELECT pressure FROM usable_obs WHERE ts <= ?1 AND pressure IS NOT NULL ORDER BY ts DESC LIMIT 1",
            [ts - 3 * 3600],
            |r| r.get(0),
        )
        .ok();
    if let (Some(now), Some(then)) = (press, then) {
        put(
            "press3h",
            Some((now - then) * if imp { 0.02953 } else { 1.0 }),
        );
    }
    // Strikes are reported per interval, so three hours' worth is a sum, not a difference.
    let strikes: Option<f64> = conn
        .query_row(
            "SELECT SUM(strikes) FROM usable_obs WHERE ts > ?1",
            [ts - 3 * 3600],
            |r| r.get(0),
        )
        .ok()
        .flatten();
    put("strikes3h", strikes);

    type HourRow = (Option<f64>, Option<f64>, Option<f64>);
    let hour: Option<HourRow> = conn
        .query_row(
            "SELECT temp, pressure, humidity FROM usable_obs WHERE ts <= ?1 ORDER BY ts DESC LIMIT 1",
            [ts - 3600],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .ok();
    if let Some((old_t, old_p, old_rh)) = hour {
        if let (Some(a), Some(b)) = (temp, old_t) {
            put("temp1h", Some((a - b) * if imp { 1.8 } else { 1.0 }));
        }
        if let (Some(a), Some(b)) = (press, old_p) {
            put("press1h", Some((a - b) * if imp { 0.02953 } else { 1.0 }));
        }
        if let (Some(a), Some(b)) = (rh, old_rh) {
            put("rh1h", Some(a - b));
        }
    }
    Some((ts, m))
}

// Relevant settings only: a theme change must not reannounce warnings. This key stays
// in memory and is never logged because notification destinations can contain secrets.
pub(crate) fn alert_context(cfg: &std::path::Path) -> Option<String> {
    let v: serde_json::Value = serde_json::from_slice(&std::fs::read(cfg).ok()?).ok()?;
    let settings = v.get("settings")?.as_object()?;
    let mut selected = serde_json::Map::new();
    for key in [
        "stationSource", "deviceId", "stationId", "ingestKey", "wllHost",
        "lacrosseEmail", "awnApiKey", "ecowittMac", "lat", "lon", "units",
        "windUnit", "rules", "alertRegion", "forecastProvider", "notif",
        "quietStart", "quietEnd", "ntfyUrl", "ntfyTopic", "webhookUrl",
        "mqttUrl", "mqttUser", "mqttPass", "haDiscoveryPrefix", "purpleAirHost",
    ] {
        selected.insert(key.into(), settings.get(key).cloned().unwrap_or_default());
    }
    Some(format!("{}:{}", cfg.display(), serde_json::Value::Object(selected)))
}

pub(crate) fn context_current(cfg: &std::path::Path, expected: &str) -> bool {
    alert_context(cfg).as_deref() == Some(expected)
}

fn check_context(
    cfg: &std::path::Path, expected: &str, state: &mut HashMap<String, Latch>,
    seen: &mut std::collections::HashSet<String>,
) -> bool {
    if context_current(cfg, expected) { return true; }
    state.clear();
    seen.clear();
    false
}

#[derive(Clone)]
struct ForecastCache {
    context: String,
    at: i64,
    values: HashMap<&'static str, f64>,
}

impl ForecastCache {
    fn matches(&self, context: &str, now: i64) -> bool {
        self.context == context && now >= self.at && now - self.at < 900
    }
}

fn forecast_metrics(cfg: &std::path::Path, context: &str) -> (i64, HashMap<&'static str, f64>) {
    forecast_metrics_with(cfg, context, |url| {
        let r = ureq::get(url).timeout(Duration::from_secs(20)).call().ok()?;
        serde_json::from_str(&r.into_string().ok()?).ok()
    })
}

fn forecast_metrics_with(
    cfg: &std::path::Path, context: &str,
    fetch: impl FnOnce(&str) -> Option<serde_json::Value>,
) -> (i64, HashMap<&'static str, f64>) {
    static CACHE: OnceLock<Mutex<Option<ForecastCache>>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(None));
    let now = crate::server::epoch();
    if !context_current(cfg, context) { return (0, HashMap::new()); }
    if let Ok(c) = cache.lock() {
        if let Some(c) = c.as_ref().filter(|c| c.matches(context, now as i64)) {
            return (c.at, c.values.clone());
        }
    }
    let num = |k: &str| {
        crate::setting(cfg, k)?
            .trim_matches('"')
            .parse::<f64>()
            .ok()
    };
    let Some((lat, lon)) = num("lat").zip(num("lon")) else {
        return (0, HashMap::new());
    };
    let url = format!(
        "https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}\
        &hourly=temperature_2m,precipitation_probability,wind_gusts_10m\
        &daily=temperature_2m_max&forecast_days=2&timezone=auto&timeformat=unixtime&wind_speed_unit=ms"
    );
    let Some(v) = fetch(&url) else { return (0, HashMap::new()); };
    if !context_current(cfg, context) { return (0, HashMap::new()); }
    let hourly = &v["hourly"];
    let times = hourly["time"].as_array().cloned().unwrap_or_default();
    let values = |key: &str, hours: u64| -> Vec<f64> {
        let Some(arr) = hourly[key].as_array() else {
            return Vec::new();
        };
        times
            .iter()
            .zip(arr)
            .filter_map(|(t, x)| {
                let t = t.as_i64()? as u64;
                (t >= now && t <= now + hours * 3600)
                    .then(|| x.as_f64())
                    .flatten()
            })
            .collect()
    };
    let imp = imperial(cfg);
    let mut out = HashMap::new();
    let temps = values("temperature_2m", 18);
    if let Some(x) = temps.into_iter().reduce(f64::min) {
        out.insert("low18h", if imp { x * 1.8 + 32.0 } else { x });
    }
    if let Some(x) = values("precipitation_probability", 6)
        .into_iter()
        .reduce(f64::max)
    {
        out.insert("rain6h", x);
    }
    if let Some(x) = values("wind_gusts_10m", 24).into_iter().reduce(f64::max) {
        out.insert("gust24h", x * wind_factor(cfg));
    }
    if let Some(x) = v["daily"]["temperature_2m_max"]
        .get(1)
        .and_then(|x| x.as_f64())
    {
        out.insert("hiTomorrow", if imp { x * 1.8 + 32.0 } else { x });
    }
    if !context_current(cfg, context) { return (0, HashMap::new()); }
    let at = crate::server::epoch() as i64;
    if let Ok(mut c) = cache.lock() {
        *c = Some(ForecastCache { context: context.into(), at, values: out.clone() });
    }
    (at, out)
}

// --- the channels ---

/// Discord and Telegram reject the generic payload; both are recognised from the URL the user
/// pasted, exactly as `app.js webhookBody` does. Public so the parity test can assert the shape.
pub fn webhook_body(url: &str, title: &str, body: &str, category: &str) -> serde_json::Value {
    let text = if body.is_empty() {
        title.to_string()
    } else {
        format!("{title}\n{body}")
    };
    if url.contains("discord.com/api/webhooks/") || url.contains("discordapp.com/api/webhooks/") {
        return serde_json::json!({ "content": text });
    }
    if url.contains("api.telegram.org/bot") {
        return serde_json::json!({ "text": text });
    }
    serde_json::json!({ "title": title, "body": body, "category": category })
}

/// Off the machine. The payloads carry the title, the body and the category and nothing else:
/// ntfy.sh is a public relay by default and a webhook goes wherever it was pointed.
fn setting_enabled(cfg: &std::path::Path, category: &str) -> bool {
    crate::setting(cfg, "notif")
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| v.get(category).and_then(|x| x.as_bool()))
        != Some(false)
}

fn quiet_now(cfg: &std::path::Path) -> bool {
    let get = |k: &str| {
        crate::setting(cfg, k)
            .unwrap_or_default()
            .trim_matches('"')
            .to_string()
    };
    let (a, b) = (get("quietStart"), get("quietEnd"));
    if a.len() != 5 || b.len() != 5 {
        return false;
    }
    let parse = |s: &str| {
        s[..2]
            .parse::<i64>()
            .ok()
            .zip(s[3..].parse::<i64>().ok())
            .map(|(h, m)| h * 60 + m)
    };
    let Some((from, to)) = parse(&a).zip(parse(&b)) else {
        return false;
    };
    let at = rusqlite::Connection::open_in_memory().ok().and_then(|c| c.query_row(
        "SELECT CAST(strftime('%H','now','localtime') AS INTEGER)*60 + CAST(strftime('%M','now','localtime') AS INTEGER)", [], |r| r.get::<_, i64>(0)).ok());
    at.is_some_and(|at| {
        if from <= to {
            at >= from && at < to
        } else {
            at >= from || at < to
        }
    })
}

fn push(cfg: &std::path::Path, category: &str, title: &str, body: &str) -> serde_json::Value {
    let Some(context) = alert_context(cfg) else {
        return serde_json::json!({ "suppressed": true, "channels": [] });
    };
    push_checked(cfg, &context, category, title, body)
}

fn push_checked(cfg: &std::path::Path, context: &str, category: &str, title: &str, body: &str) -> serde_json::Value {
    // Capture destinations before any request. Never read another station's webhook
    // after waiting for the previous station's ntfy response.
    let snapshot: serde_json::Value = std::fs::read(cfg).ok()
        .and_then(|s| serde_json::from_slice(&s).ok()).unwrap_or_default();
    let get = |k: &str| snapshot["settings"][k].as_str().unwrap_or("").to_string();
    if !context_current(cfg, context) {
        return serde_json::json!({ "suppressed": true, "channels": [] });
    }
    if !setting_enabled(cfg, category) || (quiet_now(cfg) && category != "severe") {
        return serde_json::json!({ "suppressed": true, "channels": [] });
    }
    let mut results = serde_json::Map::new();
    let topic = get("ntfyTopic");
    if !topic.is_empty() && context_current(cfg, context) {
        let base = {
            let u = get("ntfyUrl");
            if u.is_empty() {
                "https://ntfy.sh".to_string()
            } else {
                u
            }
        };
        // A header value cannot contain a line break, and NWS headlines do.
        let head: String = title.replace(['\r', '\n'], " ").chars().take(200).collect();
        let r = ureq::post(&format!(
            "{}/{}",
            base.trim_end_matches('/'),
            urlencode(&topic)
        ))
        .timeout(Duration::from_secs(15))
        .set("Title", &head)
        .set("Tags", category)
        .send_string(if body.is_empty() { title } else { body });
        if let Err(e) = &r {
            // Never the error's Display: an ntfy URL is a credential in its own right.
            eprintln!("stormdesk: ntfy push failed ({})", err_kind(&e));
        }
        results.insert(
            "ntfy".into(),
            serde_json::json!({ "ok": r.is_ok(), "error": r.err().as_ref().map(err_kind) }),
        );
    }
    let hook = get("webhookUrl");
    if !hook.is_empty() && context_current(cfg, context) {
        let r = ureq::post(&hook)
            .timeout(Duration::from_secs(15))
            .set("Content-Type", "application/json")
            .send_string(&webhook_body(&hook, title, body, category).to_string());
        if let Err(e) = &r {
            eprintln!("stormdesk: webhook push failed ({})", err_kind(&e));
        }
        results.insert(
            "webhook".into(),
            serde_json::json!({ "ok": r.is_ok(), "error": r.err().as_ref().map(err_kind) }),
        );
    }
    if context_current(cfg, context) && !get("mqttUrl").is_empty() {
        crate::mqtt::send_for_station(context, if category == "rule" { "rule" } else { "alert" }, title);
        results.insert("broker".into(), serde_json::json!({ "ok": true }));
    }
    serde_json::json!({ "sent": results.values().any(|v| v["ok"] == true), "channels": results })
}

fn err_kind(e: &ureq::Error) -> String {
    match e {
        ureq::Error::Status(code, _) => format!("HTTP {code}"),
        ureq::Error::Transport(_) => "no answer".into(),
    }
}

fn urlencode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// Fire one real notification through every configured channel. The point is that it is real —
/// a test that takes a different path to the phone tests nothing.
pub fn test_push(cfg: &std::path::Path) -> String {
    let get = |k: &str| {
        crate::setting(cfg, k)
            .unwrap_or_default()
            .trim_matches('"')
            .to_string()
    };
    let _ = get;
    push(
        cfg,
        "info",
        "StormDesk test alert",
        "If this reached you, alerts work.",
    )
    .to_string()
}

// --- NWS ---

/// The dedupe key `desk.js` settled on: NWS mints a fresh id for every continuation of the same
/// warning, so keying on the id re-chimed the same tornado warning every five minutes. Key on
/// what the warning IS — a severity change still gets through, which is the one update worth a
/// second chime.
fn alert_key(p: &serde_json::Value) -> String {
    let s = |k: &str| p.get(k).and_then(|v| v.as_str()).unwrap_or("");
    format!("{}|{}|{}", s("event"), s("areaDesc"), s("severity"))
}

fn nws(cfg: &std::path::Path) -> Option<Vec<serde_json::Value>> {
    let num = |k: &str| {
        crate::setting(cfg, k)?
            .trim_matches('"')
            .parse::<f64>()
            .ok()
    };
    let (lat, lon) = (num("lat")?, num("lon")?);
    if crate::setting(cfg,"alertRegion").as_deref()==Some("CA") {
        return crate::environment::canada_alerts(lat,lon).ok()?.get("features")?.as_array().cloned();
    }
    let url = format!("https://api.weather.gov/alerts/active?point={lat:.4},{lon:.4}");
    let body = ureq::get(&url)
        .timeout(Duration::from_secs(20))
        .set(
            "User-Agent",
            concat!("StormDesk/", env!("CARGO_PKG_VERSION")),
        )
        .call();
    let body = match body {
        Ok(r) => r.into_string().ok()?,
        Err(e) => {
            eprintln!("stormdesk: NWS alert poll failed ({})", err_kind(&e));
            return None;
        }
    };
    let v: serde_json::Value = serde_json::from_str(&body).ok()?;
    Some(v.get("features")?.as_array()?.clone())
}

// --- the loop ---

fn rules(cfg: &std::path::Path) -> Vec<Rule> {
    crate::setting(cfg, "rules")
        .and_then(|s| serde_json::from_str::<Vec<serde_json::Value>>(&s).ok())
        .unwrap_or_default()
        .iter()
        .filter_map(Rule::from_json)
        .collect()
}

/// Label, unit and decimals for the notification text, so a server-sent alert reads exactly like
/// the banner the page would have shown.
fn describe(metric: &str, cfg: &std::path::Path) -> (&'static str, String, usize) {
    let imp = imperial(cfg);
    let wind = crate::setting(cfg, "windUnit")
        .unwrap_or_default()
        .trim_matches('"')
        .to_string();
    let wind = if wind.is_empty() {
        if imp {
            "mph".to_string()
        } else {
            "km/h".to_string()
        }
    } else {
        wind
    };
    let temp = if imp { "°F" } else { "°C" };
    let press = if imp { "inHg" } else { "mb" };
    let precip = if imp { "in/h" } else { "mm/h" };
    match metric {
        "temp" => ("Temperature", temp.into(), 1),
        "dew" => ("Dew point", temp.into(), 1),
        "gust" => ("Wind gust", wind, 1),
        "wind" => ("Wind average", wind, 1),
        "rh" => ("Humidity", "%".into(), 0),
        "rain" => ("Rain rate", precip.into(), 2),
        "uv" => ("UV index", String::new(), 1),
        "strikes3h" => ("Lightning strikes · 3h", String::new(), 0),
        "press3h" => ("Pressure change · 3h", press.into(), 2),
        "temp1h" => ("Temp change · 1h", temp.into(), 1),
        "press1h" => ("Pressure change · 1h", press.into(), 2),
        "rh1h" => ("Humidity change · 1h", "%".into(), 0),
        "low18h" => ("Forecast low · 18h", temp.into(), 0),
        "rain6h" => ("Forecast rain chance · 6h", "%".into(), 0),
        "gust24h" => ("Forecast gust · 24h", wind, 0),
        "hiTomorrow" => ("Forecast high · tomorrow", temp.into(), 0),
        _ => ("Reading", String::new(), 1),
    }
}

fn tick(
    data_dir: &std::path::Path,
    cfg: &std::path::Path,
    state: &mut HashMap<String, Latch>,
    seen: &mut std::collections::HashSet<String>,
    last_rules: &mut String,
) {
    let Some(context) = alert_context(cfg) else { state.clear(); seen.clear(); return; };
    if context != *last_rules {
        state.clear();
        seen.clear();
        *last_rules = context.clone();
    }
    let rs = rules(cfg);
    if !rs.is_empty() {
        if let Ok(conn) = store::open(&store::station_db_path(data_dir, cfg)) {
            let now = crate::server::epoch() as i64;
            let channels = channel_metrics(&conn, now);
            let (ts, mut m) = metrics(&conn, cfg).unwrap_or((0, HashMap::new()));
            if ts < now - 600 || ts > now { m.clear(); }
            {
                let mut stamps: HashMap<String, i64> = m.keys().map(|key| ((*key).into(), ts)).collect();
                if rs.iter().any(|r| forecast_metric(&r.metric) || r.metric2.as_deref().is_some_and(forecast_metric)) {
                    let (at, forecast) = forecast_metrics(cfg, &context);
                    stamps.extend(forecast.keys().map(|key| ((*key).into(), at)));
                    m.extend(forecast);
                }
                if !check_context(cfg, &context, state, seen) { return; }
                stamps.extend(channels.iter().map(|(key, (_, _, ts))| (key.clone(), *ts)));
                let sample_times = stamps.iter().map(|(key, at)| (key.as_str(), *at)).collect();
                let mut owned: HashMap<String, f64> = m.into_iter().map(|(key, value)| (key.into(), value)).collect();
                owned.extend(channels.iter().map(|(key, (value, _, _))| (key.clone(), *value)));
                let values = owned.iter().map(|(key, value)| (key.as_str(), *value)).collect();
                for (i, v) in evaluate_samples(&values, &rs, state, crate::server::epoch() as i64, Some(&sample_times)) {
                    if !check_context(cfg, &context, state, seen) { return; }
                    let r = &rs[i];
                    let (label, unit, digits) = channels.get(&r.metric)
                        .map(|(_, unit, _)| channel_description(&r.metric, unit))
                        .unwrap_or_else(|| { let (label, unit, digits) = describe(&r.metric, cfg); (label.into(), unit, digits) });
                    let op = if r.op == "<" { "below" } else { "above" };
                    let title = format!("{label} {op} {:.*}{unit}", digits, r.value);
                    let mut body = format!("Now {:.*}{unit}", digits, v);
                    if r.dur_min > 0.0 {
                        body.push_str(&format!(" for {} min", r.dur_min as i64));
                    }
                    let result = push_checked(cfg, &context, "rule", &title, &body);
                    crate::ingest::note(
                        "alert-delivery",
                        result["sent"] == true,
                        if result["sent"] == true {
                            "delivered"
                        } else {
                            "failed or suppressed"
                        },
                        false,
                    );
                }
            }
        }
    }

    if !check_context(cfg, &context, state, seen) { return; }
    let feats = nws(cfg);
    if !check_context(cfg, &context, state, seen) { return; }
    let Some(feats) = feats else { return };
    for f in &feats {
        if !check_context(cfg, &context, state, seen) { return; }
        let Some(p) = f.get("properties") else {
            continue;
        };
        if !is_new(seen, p) {
            continue;
        }
        let s = |k: &str| p.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
        let severity = s("severity");
        if quiet_now(cfg) && !matches!(severity.as_str(), "Severe" | "Extreme") {
            continue;
        }
        let result = push_checked(cfg, &context, "severe", &s("event"), &s("headline"));
        crate::ingest::note(
            "alert-delivery",
            result["sent"] == true,
            if result["sent"] == true {
                "delivered"
            } else {
                "failed or suppressed"
            },
            false,
        );
    }
    if !check_context(cfg, &context, state, seen) { return; }
    if expire(seen, &feats) {
        crate::mqtt::send_for_station(&context, "alert", "");
    }
}

/// Has this warning been announced already? Announcing sets the memory, so a caller that skips is
/// a caller that has nothing to say.
fn is_new(seen: &mut std::collections::HashSet<String>, props: &serde_json::Value) -> bool {
    seen.insert(alert_key(props))
}

/// Drop warnings that are no longer in the feed, so the next one of the same kind chimes again.
/// Returns true on the all-clear: the moment the last warning went away.
///
/// Without the all-clear the `alert` sensor keeps its last headline forever, and an automation
/// asking "is anything out right now" gets answered by a thunderstorm that ended on Tuesday.
/// Only on the transition, so a quiet month is not a message a minute.
fn expire(seen: &mut std::collections::HashSet<String>, feats: &[serde_json::Value]) -> bool {
    let live: std::collections::HashSet<String> = feats
        .iter()
        .filter_map(|f| f.get("properties").map(alert_key))
        .collect();
    let had = !seen.is_empty();
    seen.retain(|k| live.contains(k));
    had && seen.is_empty()
}

/// Run the engine for as long as the process lives. Silent until a rule is saved or a warning is
/// issued, which is most days.
pub fn start(data_dir: std::path::PathBuf, cfg_path: std::path::PathBuf) {
    std::thread::spawn(move || {
        let mut state: HashMap<String, Latch> = HashMap::new();
        let mut seen = std::collections::HashSet::new();
        let mut last_rules = String::new();
        // The page checks `/diag` to decide whether to run its own engine; say so before the
        // first tick, not after it.
        crate::ingest::note("alerts", true, "watching", false);
        loop {
            tick(&data_dir, &cfg_path, &mut state, &mut seen, &mut last_rules);
            std::thread::sleep(TICK);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule(metric: &str, op: &str, value: f64, dur_min: f64) -> Rule {
        Rule {
            id: String::new(),
            metric: metric.into(),
            op: op.into(),
            value,
            dur_min,
            metric2: None,
            op2: None,
            value2: None,
        }
    }

    fn m(pairs: &[(&'static str, f64)]) -> HashMap<&'static str, f64> {
        pairs.iter().copied().collect()
    }

    // The same numbers `site/js/rules.js` asserts on. If these two ever disagree, one of the two
    // engines is telling somebody their greenhouse is fine when it isn't.
    #[test]
    fn the_latch_matches_the_page_latch() {
        let rs = [rule("gust", ">", 30.0, 0.0)];
        let mut st = HashMap::new();
        assert_eq!(evaluate(&m(&[("gust", 40.0)]), &rs, &mut st, 0).len(), 1);
        assert_eq!(
            evaluate(&m(&[("gust", 40.0)]), &rs, &mut st, 60).len(),
            0,
            "latched"
        );
        assert_eq!(
            evaluate(&m(&[("gust", 29.0)]), &rs, &mut st, 120).len(),
            0,
            "inside the re-arm band"
        );
        assert_eq!(
            evaluate(&m(&[("gust", 20.0)]), &rs, &mut st, 180).len(),
            0,
            "re-arm is not a fire"
        );
        assert_eq!(
            evaluate(&m(&[("gust", 40.0)]), &rs, &mut st, 240).len(),
            1,
            "fires again"
        );
    }

    #[test]
    fn a_duration_holds_the_rule_back() {
        let rs = [rule("temp", "<", 32.0, 10.0)];
        let mut st = HashMap::new();
        for now in (0..600).step_by(60) {
            assert_eq!(evaluate(&m(&[("temp", 30.0)]), &rs, &mut st, now).len(), 0);
        }
        assert_eq!(evaluate(&m(&[("temp", 30.0)]), &rs, &mut st, 600).len(), 1);
    }

    #[test]
    fn a_missing_reading_never_fires() {
        let rs = [rule("temp", "<", 32.0, 10.0)];
        let mut st = HashMap::new();
        assert_eq!(evaluate(&m(&[("temp", 30.0)]), &rs, &mut st, 0).len(), 0);
        assert_eq!(evaluate(&m(&[]), &rs, &mut st, 60).len(), 0);
        assert_eq!(evaluate(&m(&[("temp", 30.0)]), &rs, &mut st, 600).len(), 0);
    }

    #[test]
    fn an_and_rule_needs_both_halves() {
        let mut r = rule("gust", ">", 25.0, 0.0);
        r.metric2 = Some("rh".into());
        r.op2 = Some("<".into());
        r.value2 = Some(40.0);
        let rs = [r];
        let mut st = HashMap::new();
        assert_eq!(
            evaluate(&m(&[("gust", 30.0), ("rh", 50.0)]), &rs, &mut st, 0).len(),
            0
        );
        assert_eq!(
            evaluate(&m(&[("gust", 30.0), ("rh", 30.0)]), &rs, &mut st, 60).len(),
            1
        );
        let mut st = HashMap::new();
        assert_eq!(
            evaluate(&m(&[("gust", 30.0)]), &rs, &mut st, 0).len(),
            0,
            "missing second reading"
        );
    }

    #[test]
    fn a_rule_saved_before_v3_still_fires() {
        let rs = [rule("gust", ">", 30.0, 0.0)];
        let mut st = HashMap::new();
        assert_eq!(evaluate(&m(&[("gust", 40.0)]), &rs, &mut st, 0).len(), 1);
    }

    #[test]
    fn extra_sensor_rules_hold_reset_on_missing_and_keep_saved_ids() {
        let parsed = Rule::from_json(&serde_json::json!({
            "id":"greenhouse-alert", "metric":"channel:temperature_1",
            "op":">", "value":30, "durMin":2, "channelUnit":"°C"
        })).unwrap();
        let rs = [parsed];
        let mut state = HashMap::new();
        assert!(evaluate(&m(&[("channel:temperature_1", 35.0)]), &rs, &mut state, 0).is_empty());
        assert!(evaluate(&m(&[]), &rs, &mut state, 60).is_empty());
        assert!(evaluate(&m(&[("channel:temperature_1", 35.0)]), &rs, &mut state, 120).is_empty());
        assert_eq!(evaluate(&m(&[("channel:temperature_1", 35.0)]), &rs, &mut state, 240).len(), 1);
        assert!(state["greenhouse-alert"].latched);
        assert!(evaluate(&m(&[("channel:temperature_1", 35.0)]), &rs, &mut state, 300).is_empty());
        assert!(!allowed_metric("channel:bad name"));
        assert!(!allowed_metric("channel:"));
        let (label, unit, _) = channel_description("channel:soil_moisture_1", "%");
        assert_eq!(label, "Soil moisture 1");
        assert_eq!(unit, " %");
    }

    #[test]
    fn channel_metrics_ignore_stale_future_invalid_and_excluded_readings() {
        let conn = store::open(std::path::Path::new(":memory:")).unwrap();
        let now = 1_700_000_000i64;
        for ts in [now - 700, now - 100, now - 50, now + 1] {
            let mut row = vec![None; 19]; row[0] = Some(ts as f64);
            assert!(store::insert(&conn, &row, 0));
        }
        for (ts, name, value, unit) in [
            (now - 100, "temperature_1", 35.0, "°C"),
            (now - 100, "soil_moisture_1", 20.0, "%"),
            (now - 700, "stale", 1.0, "%"),
            (now + 1, "future", 1.0, "%"),
            (now - 100, "invalid", 1.0, "madeup"),
            (now - 100, "battery_bad", 2.0, "low"),
            (now - 100, "bad name", 1.0, "%"),
        ] {
            conn.execute("INSERT INTO channels VALUES (?1,?2,?3,?4)", rusqlite::params![ts,name,value,unit]).unwrap();
        }
        let readings = channel_metrics(&conn, now);
        assert_eq!(readings.len(), 2);
        assert_eq!(readings["channel:temperature_1"], (35.0, "°C".into(), now - 100));
        assert!(channel_metrics(&conn, now + 701).is_empty());
        conn.execute("INSERT INTO notes(ts,until,kind,text) VALUES (?1,?1,'exclude','Sensor maintenance')", [now - 100]).unwrap();
        assert!(channel_metrics(&conn, now).is_empty(), "excluded observations cannot trigger a sensor rule");
    }

    #[test]
    fn standalone_sensor_channels_fire_without_weather_observations() {
        let conn = store::open(std::path::Path::new(":memory:")).unwrap();
        let now = 1_700_000_000i64;
        conn.execute("INSERT INTO channels VALUES (?1,'pm25',42.0,'µg/m³')", [now - 30]).unwrap();
        let readings = channel_metrics(&conn, now);
        let values = readings.iter().map(|(key, (value, _, _))| (key.as_str(), *value)).collect();
        let rs = [rule("channel:pm25", ">", 35.0, 0.0)];
        assert_eq!(evaluate(&values, &rs, &mut HashMap::new(), now).len(), 1);
        conn.execute("INSERT INTO notes(ts,until,kind,text) VALUES (?1,?2,'exclude','Air sensor fault')", [now - 60, now]).unwrap();
        let excluded = channel_metrics(&conn, now);
        let values = excluded.iter().map(|(key, (value, _, _))| (key.as_str(), *value)).collect();
        assert!(evaluate(&values, &rs, &mut HashMap::new(), now).is_empty());
    }

    fn warning(event: &str, area: &str, sev: &str) -> serde_json::Value {
        serde_json::json!({ "properties": { "event": event, "areaDesc": area, "severity": sev } })
    }

    /// NWS mints a fresh id for every continuation of the same warning, so keying the memory on
    /// the id re-chimed the same tornado warning every five minutes.
    #[test]
    fn a_continued_warning_does_not_chime_twice_but_a_worse_one_does() {
        let mut seen = std::collections::HashSet::new();
        let w = warning("Tornado Warning", "Hartford", "Severe");
        assert!(is_new(&mut seen, w.get("properties").unwrap()));
        assert!(
            !is_new(&mut seen, w.get("properties").unwrap()),
            "same warning, continued"
        );
        let worse = warning("Tornado Warning", "Hartford", "Extreme");
        assert!(
            is_new(&mut seen, worse.get("properties").unwrap()),
            "a severity change is worth a second chime"
        );
    }

    #[test]
    fn the_all_clear_fires_once_when_the_last_warning_goes_away() {
        let mut seen = std::collections::HashSet::new();
        let w = warning("Flood Warning", "Hartford", "Severe");
        let x = warning("Wind Advisory", "Hartford", "Moderate");
        is_new(&mut seen, w.get("properties").unwrap());
        is_new(&mut seen, x.get("properties").unwrap());
        assert!(
            !expire(&mut seen, &[w.clone(), x.clone()]),
            "both still out"
        );
        assert!(
            !expire(&mut seen, std::slice::from_ref(&w)),
            "one left is not an all-clear"
        );
        assert!(expire(&mut seen, &[]), "the last one going away is");
        assert!(
            !expire(&mut seen, &[]),
            "and a quiet month says nothing further"
        );
    }

    #[test]
    fn the_two_webhooks_that_reject_the_generic_shape() {
        let d = webhook_body(
            "https://discord.com/api/webhooks/1/abc",
            "Tornado",
            "take cover",
            "severe",
        );
        assert!(d["content"].as_str().unwrap().contains("Tornado"));
        let t = webhook_body(
            "https://api.telegram.org/bot1:abc/sendMessage?chat_id=2",
            "Tornado",
            "take cover",
            "severe",
        );
        assert!(t["text"].as_str().unwrap().contains("cover"));
        let g = webhook_body(
            "https://example.com/hook",
            "Tornado",
            "take cover",
            "severe",
        );
        assert_eq!(g["category"], "severe");
    }

    #[test]
    fn hold_duration_needs_new_samples_and_the_older_compound_input() {
        let mut r = rule("temp", ">", 30.0, 2.0);
        r.metric2 = Some("channel:temperature_1".into());
        r.value2 = Some(30.0);
        let rs = [r];
        let values = m(&[("temp", 35.0), ("channel:temperature_1", 35.0)]);
        let mut stamps = HashMap::from([("temp", 1000), ("channel:temperature_1", 1000)]);
        let mut state = HashMap::new();
        assert!(evaluate_samples(&values, &rs, &mut state, 1000, Some(&stamps)).is_empty());
        stamps.insert("temp", 1120);
        assert!(evaluate_samples(&values, &rs, &mut state, 1120, Some(&stamps)).is_empty());
        assert!(evaluate_samples(&values, &rs, &mut state, 1240, Some(&stamps)).is_empty());
        stamps.insert("channel:temperature_1", 1120);
        assert_eq!(evaluate_samples(&values, &rs, &mut state, 1240, Some(&stamps)).len(), 1);
        let mut state = HashMap::new();
        evaluate_samples(&values, &rs, &mut state, 1120, Some(&stamps));
        assert!(evaluate_samples(&values, &rs, &mut state, 1721, Some(&stamps)).is_empty());
        assert!(state["legacy-0"].since.is_none(), "stale data resets duration");
        stamps.insert("temp", 1721);
        stamps.insert("channel:temperature_1", 1721);
        assert!(evaluate_samples(&values, &rs, &mut state, 1721, Some(&stamps)).is_empty());
        stamps.remove("channel:temperature_1");
        evaluate_samples(&values, &rs, &mut state, 1781, Some(&stamps));
        assert!(state["legacy-0"].since.is_none(), "missing companion timestamp resets duration");
        // On first evaluation the newer input marks when both conditions are known.
        let mut state = HashMap::new();
        let mut stamps = HashMap::from([("temp", 1000), ("channel:temperature_1", 1060)]);
        evaluate_samples(&values, &rs, &mut state, 1060, Some(&stamps));
        stamps.insert("temp", 1120);
        stamps.insert("channel:temperature_1", 1120);
        assert!(evaluate_samples(&values, &rs, &mut state, 1120, Some(&stamps)).is_empty());
        stamps.insert("temp", 1180);
        stamps.insert("channel:temperature_1", 1180);
        assert_eq!(evaluate_samples(&values, &rs, &mut state, 1180, Some(&stamps)).len(), 1);
    }

    #[test]
    fn forecast_holds_use_acquisitions_instead_of_repeated_cached_ticks() {
        let rs = [rule("low18h", "<", 0.0, 10.0)];
        let mut state = HashMap::new();
        let values = m(&[("low18h", -2.0)]);
        let mut stamps = HashMap::from([("low18h", 1000)]);
        assert!(evaluate_samples(&values, &rs, &mut state, 1000, Some(&stamps)).is_empty());
        assert!(evaluate_samples(&values, &rs, &mut state, 1600, Some(&stamps)).is_empty());
        stamps.insert("low18h", 1900);
        assert_eq!(evaluate_samples(&values, &rs, &mut state, 1900, Some(&stamps)).len(), 1);
    }

    fn test_config(label: &str) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("stormdesk-alerts-{label}-{}-{}.json",
            std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        std::fs::write(&path, serde_json::json!({"settings":{
            "stationSource":"ecowitt", "ecowittMac":"AABBCCDDEE01", "lat":40, "lon":-90, "units":"metric"
        }}).to_string()).unwrap();
        path
    }

    #[test]
    fn context_changes_clear_latches_and_warnings_and_reject_inflight_forecasts() {
        let cfg = test_config("context");
        let context = alert_context(&cfg).unwrap();
        let mut config: serde_json::Value = serde_json::from_slice(&std::fs::read(&cfg).unwrap()).unwrap();
        config["settings"]["theme"] = "dark".into();
        std::fs::write(&cfg, config.to_string()).unwrap();
        assert!(context_current(&cfg, &context), "theme does not reset warnings");
        for (key, value) in [
            ("ecowittMac", serde_json::json!("AABBCCDDEE02")),
            ("lat", serde_json::json!(45)), ("lon", serde_json::json!(-95)),
            ("units", serde_json::json!("imperial")), ("windUnit", serde_json::json!("kt")),
            ("rules", serde_json::json!([])), ("alertRegion", serde_json::json!("CA")),
            ("webhookUrl", serde_json::json!("https://example.invalid/new")),
        ] {
            let mut changed = config.clone();
            changed["settings"][key] = value;
            std::fs::write(&cfg, changed.to_string()).unwrap();
            let mut state = HashMap::from([("x".into(), Latch::default())]);
            let mut seen = std::collections::HashSet::from(["warning".into()]);
            assert!(!check_context(&cfg, &context, &mut state, &mut seen), "{key}");
            assert!(state.is_empty() && seen.is_empty());
        }
        std::fs::write(&cfg, config.to_string()).unwrap();
        let (_, result) = forecast_metrics_with(&cfg, &context, |_| {
            config["settings"]["units"] = "imperial".into();
            std::fs::write(&cfg, config.to_string()).unwrap();
            Some(serde_json::json!({"daily":{"temperature_2m_max":[1,40]}}))
        });
        assert!(result.is_empty(), "response belongs to the old unit/location context");
        let changed_context = alert_context(&cfg).unwrap();
        let (at, values) = forecast_metrics_with(&cfg, &changed_context, |_| {
            Some(serde_json::json!({"daily":{"temperature_2m_max":[1,40]}}))
        });
        assert_eq!(values["hiTomorrow"], 104.0);
        let cached = ForecastCache { context: changed_context.clone(), at, values };
        assert!(cached.matches(&changed_context, at + 60));
        assert!(!cached.matches(&context, at + 60));
        assert!(!cached.matches(&changed_context, at + 900));
        std::fs::remove_file(cfg).unwrap();
    }

    #[test]
    fn station_change_during_ntfy_cancels_later_delivery_destinations() {
        use std::io::{Read, Write};
        let cfg = test_config("push");
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let mut config: serde_json::Value = serde_json::from_slice(&std::fs::read(&cfg).unwrap()).unwrap();
        config["settings"]["ntfyUrl"] = base.clone().into();
        config["settings"]["ntfyTopic"] = "test".into();
        config["settings"]["webhookUrl"] = format!("{base}/hook").into();
        std::fs::write(&cfg, config.to_string()).unwrap();
        let context = alert_context(&cfg).unwrap();
        let thread_cfg = cfg.clone();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
            let mut request = [0; 4096];
            stream.read(&mut request).unwrap();
            config["settings"]["ecowittMac"] = "AABBCCDDEE02".into();
            std::fs::write(thread_cfg, config.to_string()).unwrap();
            stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
            listener
        });
        let result = push_checked(&cfg, &context, "rule", "Test", "Reading");
        let listener = server.join().unwrap();
        listener.set_nonblocking(true).unwrap();
        assert_eq!(result["channels"]["ntfy"]["ok"], true);
        assert!(result["channels"].get("webhook").is_none());
        assert_eq!(listener.accept().unwrap_err().kind(), std::io::ErrorKind::WouldBlock);
        std::fs::remove_file(cfg).unwrap();
    }

    #[test]
    fn a_ntfy_topic_with_a_slash_cannot_escape_its_url() {
        assert_eq!(urlencode("my topic/../admin"), "my%20topic%2F..%2Fadmin");
    }
}
