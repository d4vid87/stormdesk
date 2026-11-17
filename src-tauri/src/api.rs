// The versioned read-only API. One endpoint, named fields, SI, no credentials.
//
// Everything else this server answers is shaped for the dashboard and free to change with it —
// `/history/tuples` hands out bare arrays in a column order the page happens to know. That is a
// fine contract with a page shipped in the same binary and a terrible one with a Home Assistant
// integration somebody installed six months ago. `/api/v1` is the one that has to stay still.

use crate::{ingest, server::State, store};
use std::sync::{Arc, Mutex};
use std::time::Duration;

struct Cached<T> {
    key: String,
    expires: u64,
    value: Option<T>,
}

// Only the cache owner waits on upstream I/O. Other HTTP workers stay available while it loads.
fn cached_fetch<T: Clone>(slot: &Mutex<Option<Cached<T>>>, key: &str, fetch: impl FnOnce() -> (Option<T>, u64)) -> Option<T> {
    let mut cached = slot.try_lock().ok()?;
    let now = crate::server::epoch();
    if let Some(entry) = cached.as_ref().filter(|c| c.key == key && now < c.expires) {
        return entry.value.clone();
    }
    let (value, ttl) = fetch();
    *cached = Some(Cached { key: key.into(), expires: crate::server::epoch().saturating_add(ttl), value: value.clone() });
    value
}

fn location(cfg: &std::path::Path) -> Option<(f64, f64)> {
    let settings = settings_snapshot(cfg);
    let num = |k: &str| settings[k].as_f64().or_else(|| settings[k].as_str()?.parse::<f64>().ok());
    let (lat, lon) = (num("lat")?, num("lon")?);
    (lat.is_finite() && lon.is_finite() && (-90.0..=90.0).contains(&lat) && (-180.0..=180.0).contains(&lon)).then_some((lat, lon))
}

fn settings_snapshot(cfg: &std::path::Path) -> serde_json::Value {
    std::fs::read_to_string(cfg).ok()
        .and_then(|body| serde_json::from_str::<serde_json::Value>(&body).ok())
        .and_then(|root| root.get("settings").cloned()).unwrap_or_default()
}

const FORECAST_TTL: u64 = 900;

/// Today's high, low, precipitation chance and condition code, for the weather entity.
fn forecast(cfg: &std::path::Path) -> Option<serde_json::Value> {
    static CACHE: Mutex<Option<Cached<serde_json::Value>>> = Mutex::new(None);
    let place = location(cfg)?;
    let key = format!("{},{}", place.0, place.1);
    let result = cached_fetch(&CACHE, &key, || {
        let result = fetch_forecast(place.0, place.1);
        let ttl = if result.is_some() { FORECAST_TTL } else { 30 };
        (result, ttl)
    });
    // Settings can change while the request is in flight; never label that answer as this place.
    (location(cfg) == Some(place)).then_some(result).flatten()
}

fn fetch_forecast(lat: f64, lon: f64) -> Option<serde_json::Value> {
    let url = format!(
        "https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}\
         &daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max\
         &forecast_days=5&timezone=auto&timeformat=unixtime"
    );
    let body = match ureq::get(&url).timeout(Duration::from_secs(20)).call() {
        Ok(r) => serde_json::from_str::<serde_json::Value>(&r.into_string().ok()?).ok()?,
        // Status codes only: an upstream URL carries the coordinates of somebody's house.
        Err(ureq::Error::Status(code, _)) => {
            eprintln!("stormdesk: forecast fetch failed ({code})");
            return None;
        }
        Err(_) => return None,
    };
    let d = body.get("daily")?;
    let day = |k: &str, i: usize| d.get(k).and_then(|a| a.get(i)).cloned().unwrap_or(serde_json::Value::Null);
    let days: Vec<serde_json::Value> = (0..5)
        .map(|i| {
            serde_json::json!({
                "at": day("time", i),
                "high_c": day("temperature_2m_max", i),
                "low_c": day("temperature_2m_min", i),
                "precip_chance": day("precipitation_probability_max", i),
                "wmo_code": day("weather_code", i),
            })
        })
        .collect();
    Some(serde_json::json!({ "days": days }))
}

/// The newest archive row as named fields, plus the two derived values the MQTT publisher also
/// sends. Named, because a Home Assistant integration must not have to know a column order.
fn current(conn: &rusqlite::Connection) -> Option<serde_json::Value> {
    let cols = store::FIELDS.join(", ");
    let (ts, vals) = conn
        .query_row(&format!("SELECT ts, {cols} FROM usable_obs ORDER BY ts DESC LIMIT 1"), [], |r| {
            let ts: i64 = r.get(0)?;
            let mut v = Vec::with_capacity(store::FIELDS.len());
            for i in 1..=store::FIELDS.len() {
                v.push(r.get::<_, Option<f64>>(i)?);
            }
            Ok((ts, v))
        })
        .ok()?;
    let at = |name: &str| store::FIELDS.iter().position(|f| *f == name).and_then(|i| vals[i]);
    let mut obj = serde_json::Map::new();
    obj.insert("at".into(), ts.into());
    for (f, v) in store::FIELDS.iter().zip(&vals) {
        obj.insert((*f).into(), match v {
            Some(x) => serde_json::Value::from(*x),
            None => serde_json::Value::Null,
        });
    }
    if let Some(t) = at("temp") {
        let f = (crate::mqtt::feels_like(t, at("humidity"), at("wind_avg")) * 10.0).round() / 10.0;
        obj.insert("feels_like".into(), f.into());
    }
    if let Some(p) = at("pressure") {
        let was = conn
            .query_row(
                "SELECT pressure FROM usable_obs WHERE ts <= ?1 AND pressure IS NOT NULL ORDER BY ts DESC LIMIT 1",
                [ts - 3 * 3600],
                |r| r.get::<_, Option<f64>>(0),
            )
            .ok()
            .flatten();
        if let Some(was) = was {
            obj.insert("pressure_trend".into(), crate::mqtt::press_trend(p, was).into());
        }
    }
    Some(serde_json::Value::Object(obj))
}

/// The whole payload. Units are SI and stated as such, so a consumer never has to guess which
/// way the dashboard was set when it read this.
pub fn snapshot(state: &Arc<State>) -> String {
    let cfg = &state.cfg_path;
    let (settings, obs) = {
        let _guard = state.config_write.lock().unwrap_or_else(|e| e.into_inner());
        (settings_snapshot(cfg), state.db().and_then(|c| current(&c)))
    };
    let get = |k: &str| settings[k].as_str().map(String::from)
        .or_else(|| settings[k].as_f64().map(|v| v.to_string())).unwrap_or_default();
    let daily = forecast(cfg);
    let daily = if settings_snapshot(cfg) == settings { daily } else { None };
    let body = serde_json::json!({
        "api": 1,
        "version": env!("CARGO_PKG_VERSION"),
        "units": "si",
        "station": {
            "id": get("stationId"),
            "name": get("stationName"),
            "source": get("stationSource"),
            "lat": get("lat").parse::<f64>().ok(),
            "lon": get("lon").parse::<f64>().ok(),
        },
        "current": obs,
        "forecast": daily,
        "health": serde_json::from_str::<serde_json::Value>(&ingest::diag_json()).unwrap_or_default(),
    });
    body.to_string()
}

/// Both halves of the smart-home setup, tried for real: the broker we publish to, and the Home
/// Assistant we read entities back from. The token never leaves this process — that is the whole
/// reason this lives here rather than in a fetch from the drawer.
pub fn test_smart_home(cfg: &std::path::Path) -> String {
    let (mqtt_ok, mqtt_says) = crate::mqtt::probe(cfg);
    let settings = settings_snapshot(cfg);
    let get = |k: &str| settings[k].as_str().unwrap_or_default().to_string();
    let (url, token) = (get("haUrl"), get("haToken"));
    let (ha_ok, ha_says) = if url.is_empty() {
        (false, "no Home Assistant URL set".to_string())
    } else {
        let base = url.trim_end_matches('/');
        match ureq::get(&format!("{base}/api/"))
            .set("Authorization", &format!("Bearer {token}"))
            .timeout(Duration::from_secs(10))
            .call()
        {
            Ok(_) => (true, "connected".to_string()),
            // The status code, never the error body: a Home Assistant error page can echo the
            // request, and the request carries the token.
            Err(ureq::Error::Status(401 | 403, _)) => (false, "token rejected".to_string()),
            Err(ureq::Error::Status(code, _)) => (false, format!("HTTP {code}")),
            Err(_) => (false, "no answer".to_string()),
        }
    };
    serde_json::json!({
        "mqtt": { "ok": mqtt_ok, "what": mqtt_says },
        "ha": { "ok": ha_ok, "what": ha_says },
    })
    .to_string()
}

/// Every entity Home Assistant knows about, slimmed to what a picker and a read-back panel need.
///
/// This exists so the browser never holds the long-lived token. It also retires the CORS block
/// people hit here — Home Assistant does not send CORS headers unless its YAML says to, so the
/// old direct-from-the-page fetch failed for most installs until they edited a config file. The
/// page still falls back to that path on a static host, which has no server to ask.
///
/// Cached briefly: a house with four dashboards open should be four reads of this, not four
/// reads of Home Assistant.
pub fn ha_states(cfg: &std::path::Path) -> String {
    static CACHE: Mutex<Option<Cached<String>>> = Mutex::new(None);
    let connection = || {
        // Read URL and credential from one atomic config revision, never from separate reads.
        let settings = settings_snapshot(cfg);
        let get = |k: &str| settings[k].as_str().unwrap_or_default().to_string();
        (get("haUrl"), get("haToken"))
    };
    let settings = connection();
    if settings.0.is_empty() {
        return r#"{"error":"no Home Assistant URL set"}"#.into();
    }
    // A token change must invalidate entities fetched with the previous credentials, too.
    let key = serde_json::to_string(&settings).unwrap_or_default();
    let body = cached_fetch(&CACHE, &key, || {
        let body = fetch_ha_states(&settings.0, &settings.1);
        let ttl = if body.contains("\"entities\"") { STATES_TTL } else { 5 };
        (Some(body), ttl)
    });
    if connection() != settings { return r#"{"error":"Home Assistant connection changed"}"#.into(); }
    body.unwrap_or_else(|| r#"{"error":"Home Assistant refresh in progress"}"#.into())
}

fn fetch_ha_states(url: &str, token: &str) -> String {
    let base = url.trim_end_matches('/');
    // Five seconds, not twenty: a Home Assistant that is switched off must not hold one of the
    // four worker threads while every screen in the house asks again. The 15 s cache above is
    // what keeps the poll cheap when it does answer.
    let body = match ureq::get(&format!("{base}/api/states"))
        .set("Authorization", &format!("Bearer {token}"))
        .timeout(Duration::from_secs(5))
        .call()
    {
        Ok(r) => r.into_string().unwrap_or_default(),
        // Codes and fixed words only: a Home Assistant error page can echo back the request that
        // carried the token.
        Err(ureq::Error::Status(401 | 403, _)) => return r#"{"error":"token rejected"}"#.to_string(),
        Err(ureq::Error::Status(code, _)) => {
            return serde_json::json!({ "error": format!("HTTP {code}") }).to_string()
        }
        Err(_) => return r#"{"error":"no answer"}"#.to_string(),
    };
    let Ok(list) = serde_json::from_str::<Vec<serde_json::Value>>(&body) else {
        return r#"{"error":"unexpected answer"}"#.to_string();
    };
    let out: Vec<serde_json::Value> = list
        .iter()
        .filter_map(|e| {
            let id = e.get("entity_id")?.as_str()?;
            let attrs = e.get("attributes");
            Some(serde_json::json!({
                "id": id,
                "name": attrs
                    .and_then(|a| a.get("friendly_name"))
                    .and_then(|v| v.as_str())
                    .unwrap_or(id),
                "state": e.get("state").and_then(|v| v.as_str()).unwrap_or(""),
                "unit": attrs
                    .and_then(|a| a.get("unit_of_measurement"))
                    .and_then(|v| v.as_str())
                    .unwrap_or(""),
            }))
        })
        .collect();
    let body = serde_json::json!({ "entities": out }).to_string();
    body
}

/// Long enough that a wall of dashboards is one read, short enough that a light switch shows up
/// on the panel while somebody is still standing next to it.
const STATES_TTL: u64 = 15;

// --- US Drought Monitor ---
//
// Two hops, neither of which a browser can make (no CORS on either): the FCC block API turns the
// station's coordinates into a county FIPS code, then the Drought Monitor hands back that
// county's weekly severity split. The page shows one line of it on the fire card.
//
// The whole result is cached rather than the two halves: a county's drought class changes once a
// week, on a Thursday.
pub fn drought(cfg: &std::path::Path) -> String {
    static CACHE: Mutex<Option<Cached<String>>> = Mutex::new(None);
    let Some(place) = location(cfg) else {
        return r#"{"error":"no location set"}"#.to_string();
    };
    let key = format!("{},{}", place.0, place.1);
    let body = cached_fetch(&CACHE, &key, || {
        match fetch_drought(place.0, place.1) {
            Ok(body) => (Some(body), DROUGHT_TTL),
            Err(e) => (Some(serde_json::json!({ "error": e }).to_string()), 600),
        }
    });
    if location(cfg) != Some(place) { return r#"{"error":"Location changed"}"#.into(); }
    body.unwrap_or_else(|| r#"{"error":"Drought refresh in progress"}"#.into())
}

fn fetch_drought(lat: f64, lon: f64) -> Result<String, String> {
    // Coordinates are the house. Never format the error — the URL is in it.
    let fips_body = ureq::get(&format!(
        "https://geo.fcc.gov/api/census/block/find?latitude={lat}&longitude={lon}&format=json"
    ))
    .timeout(Duration::from_secs(8))
    .call()
    .map_err(|e| match e {
        ureq::Error::Status(code, _) => format!("county lookup HTTP {code}"),
        _ => "county lookup unreachable".to_string(),
    })?
    .into_string()
    .map_err(|_| "county lookup unreadable".to_string())?;
    let v: serde_json::Value = serde_json::from_str(&fips_body).map_err(|_| "county lookup unexpected".to_string())?;
    let fips = v["County"]["FIPS"].as_str().unwrap_or_default().to_string();
    if fips.len() != 5 {
        return Err("no US county here".into());
    }
    // Six weeks back is enough to always contain a published map, whatever day it is asked on.
    let ymd = |t: i64| {
        let (y, m, d, ..) = crate::server::utc_ymdhms(t);
        format!("{m}/{d}/{y}")
    };
    let now = crate::server::epoch() as i64;
    // `Accept: application/json` is load-bearing: without it this endpoint answers CSV.
    let body = ureq::get(&format!(
        "https://usdmdataservices.unl.edu/api/CountyStatistics/GetDroughtSeverityStatisticsByAreaPercent\
?aoi={fips}&startdate={}&enddate={}&statisticsType=1",
        ymd(now - 42 * 86400),
        ymd(now)
    ))
    .set("Accept", "application/json")
    .timeout(Duration::from_secs(8))
    .call()
    .map_err(|e| match e {
        ureq::Error::Status(code, _) => format!("drought monitor HTTP {code}"),
        _ => "drought monitor unreachable".to_string(),
    })?
    .into_string()
    .map_err(|_| "drought monitor unreadable".to_string())?;
    newest_week(&body).ok_or_else(|| "no drought map published yet".to_string())
}

/// The most recent weekly row, by its map date rather than its position in the array — the order
/// the service returns is not part of anything anybody documented.
fn newest_week(body: &str) -> Option<String> {
    let rows: Vec<serde_json::Value> = serde_json::from_str(body).ok()?;
    let key = |r: &serde_json::Value| {
        // "9/2/2025" — pad it into something that sorts.
        let d = r["mapDate"].as_str().unwrap_or_default().to_string();
        let p: Vec<&str> = d.split('/').collect();
        if p.len() == 3 {
            format!("{:0>4}{:0>2}{:0>2}", p[2], p[0], p[1])
        } else {
            d
        }
    };
    let best = rows.iter().max_by_key(|r| key(r))?;
    let pct = |k: &str| {
        best[k]
            .as_f64()
            .or_else(|| best[k].as_str().and_then(|s| s.parse().ok()))
            .unwrap_or(0.0)
    };
    Some(
        serde_json::json!({
            "date": best["mapDate"].as_str().unwrap_or_default(),
            "county": best["county"].as_str().unwrap_or_default(),
            "state": best["state"].as_str().unwrap_or_default(),
            "none": pct("none"), "d0": pct("d0"), "d1": pct("d1"),
            "d2": pct("d2"), "d3": pct("d3"), "d4": pct("d4"),
        })
        .to_string(),
    )
}

/// The map is published once a week; six hours is "the same day, at most one extra fetch".
const DROUGHT_TTL: u64 = 6 * 3600;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upstream_cache_is_keyed_expires_and_cools_down_failures() {
        let cache = Mutex::new(None);
        assert_eq!(cached_fetch(&cache, "place-a", || (Some(1), 900)), Some(1));
        assert_eq!(cached_fetch(&cache, "place-a", || panic!("cache hit fetched again")), Some(1));
        assert_eq!(cached_fetch(&cache, "place-b", || (Some(2), 900)), Some(2));
        cache.lock().unwrap().as_mut().unwrap().expires = 0;
        assert_eq!(cached_fetch(&cache, "place-b", || (None, 30)), None);
        assert_eq!(cached_fetch(&cache, "place-b", || panic!("failed upstream retried inside cooldown")), None);
        assert_eq!(cached_fetch(&cache, "place-c", || (Some(3), 900)), Some(3));
    }

    #[test]
    fn one_slow_upstream_never_blocks_other_readers() {
        let cache = Arc::new(Mutex::new(None));
        let (started_tx, started_rx) = std::sync::mpsc::channel();
        let (finish_tx, finish_rx) = std::sync::mpsc::channel();
        let worker_cache = cache.clone();
        let worker = std::thread::spawn(move || cached_fetch(&worker_cache, "same-place", || {
            started_tx.send(()).unwrap();
            finish_rx.recv().unwrap();
            (Some(7), 900)
        }));
        started_rx.recv().unwrap();
        let start = std::time::Instant::now();
        for _ in 0..20 {
            assert_eq!(cached_fetch(&cache, "same-place", || panic!("duplicate upstream request")), None);
        }
        assert!(start.elapsed() < Duration::from_millis(100), "HTTP workers waited for upstream I/O");
        finish_tx.send(()).unwrap();
        assert_eq!(worker.join().unwrap(), Some(7));
        assert_eq!(cached_fetch(&cache, "same-place", || panic!("completed result was not cached")), Some(7));
    }

    #[test]
    fn ha_cache_changes_with_credentials_and_disabled_connection() {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            for expected in ["Bearer first", "Bearer second"] {
                let (mut stream, _) = listener.accept().unwrap();
                stream.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
                let mut request = [0u8; 2048];
                let n = stream.read(&mut request).unwrap();
                assert!(String::from_utf8_lossy(&request[..n]).contains(expected));
                let body = format!(r#"[{{"entity_id":"sensor.test","state":"{expected}"}}]"#);
                write!(stream, "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
            }
        });
        let path = std::env::temp_dir().join(format!("stormdesk-api-{}-{}.json", std::process::id(), crate::server::epoch()));
        let save = |url: &str, token: &str| std::fs::write(&path, serde_json::json!({"settings":{"haUrl":url,"haToken":token}}).to_string()).unwrap();
        save(&url, "first");
        let first = ha_states(&path);
        assert!(first.contains("Bearer first"));
        assert_eq!(ha_states(&path), first);
        save(&url, "second");
        assert!(ha_states(&path).contains("Bearer second"));
        save("", "second");
        assert!(ha_states(&path).contains("no Home Assistant URL set"));
        server.join().unwrap();
        std::fs::remove_file(path).unwrap();
    }

    /// The published week is picked by its date, not by where it happens to sit in the array, and
    /// the percentages survive whether the service quotes them or not.
    #[test]
    fn drought_picks_the_newest_week_by_date() {
        let body = r#"[
          {"mapDate":"8/19/2025","county":"Tarrant County","state":"TX","none":100,"d0":0,"d1":0,"d2":0,"d3":0,"d4":0},
          {"mapDate":"9/2/2025","county":"Tarrant County","state":"TX","none":"81","d0":"19","d1":"19","d2":"19","d3":0,"d4":0},
          {"mapDate":"8/26/2025","county":"Tarrant County","state":"TX","none":90,"d0":10,"d1":0,"d2":0,"d3":0,"d4":0}
        ]"#;
        let v: serde_json::Value = serde_json::from_str(&newest_week(body).unwrap()).unwrap();
        assert_eq!(v["date"], "9/2/2025");
        assert_eq!(v["d2"], 19.0);
        assert_eq!(v["none"], 81.0);
        assert!(newest_week("[]").is_none(), "no rows is no answer, not a zero week");
        assert!(newest_week("not json").is_none());
    }

    /// Named fields, and the derived pair alongside them — the whole point of the endpoint.
    #[test]
    fn current_is_named_fields_not_a_bare_tuple() {
        let conn = store::open(std::path::Path::new(":memory:")).unwrap();
        let mut row = vec![None; store::FIELDS.len()];
        let put = |row: &mut Vec<Option<f64>>, name: &str, v: f64| {
            row[store::FIELDS.iter().position(|f| *f == name).unwrap()] = Some(v);
        };
        put(&mut row, "temp", 31.5);
        put(&mut row, "humidity", 72.0);
        put(&mut row, "pressure", 1006.4);
        let now = crate::server::epoch() as i64;
        conn.execute(
            &format!(
                "INSERT INTO obs (ts, {}) VALUES ({}, {})",
                store::FIELDS.join(", "),
                now,
                row.iter().map(|v| v.map(|x| x.to_string()).unwrap_or_else(|| "NULL".into())).collect::<Vec<_>>().join(", ")
            ),
            [],
        )
        .unwrap();
        conn.execute("INSERT INTO obs (ts, pressure) VALUES (?1, 1009.9)", [now - 3 * 3600]).unwrap();

        let v = current(&conn).unwrap();
        assert_eq!(v["temp"], 31.5);
        assert_eq!(v["at"], now);
        // A field the station doesn't have is null, not missing and not zero.
        assert!(v["lux"].is_null());
        // Heat index at 31.5 °C and 72% is well above the plain reading.
        assert!(v["feels_like"].as_f64().unwrap() > 38.0);
        assert_eq!(v["pressure_trend"], "falling rapidly");
    }
}
