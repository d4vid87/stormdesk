use rusqlite::{params_from_iter, Connection};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    io::Read,
    net::Ipv4Addr,
    path::Path,
    time::Duration,
};

fn setting(cfg: &Path, key: &str) -> String {
    crate::setting(cfg, key).unwrap_or_default()
}

fn agent(seconds: u64) -> ureq::Agent {
    ureq::AgentBuilder::new()
        .redirects(0)
        .timeout(Duration::from_secs(seconds))
        .build()
}

fn bounded_json(request: ureq::Request, limit: u64) -> Result<Value, String> {
    let response = request.call().map_err(|e| match e {
        ureq::Error::Status(code, _) => format!("Weather source returned HTTP {code}"),
        _ => "Weather source unavailable or timed out".into(),
    })?;
    let mut bytes = Vec::new();
    response
        .into_reader()
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Could not read weather source")?;
    if bytes.len() as u64 > limit {
        return Err("Weather source response too large".into());
    }
    serde_json::from_slice(&bytes).map_err(|_| "Weather source returned invalid JSON".into())
}

fn private_host(host: &str) -> Result<String, String> {
    let host = host.trim().strip_suffix(":80").unwrap_or(host.trim());
    if host == "localhost" {
        return Ok("127.0.0.1".into());
    }
    let ip: Ipv4Addr = host
        .parse()
        .map_err(|_| "Use a private IPv4 address or localhost, without a URL or path")?;
    if !ip.is_private() && !ip.is_loopback() {
        return Err("PurpleAir must be on your private local network".into());
    }
    Ok(ip.to_string())
}

/// Only the configured sensor can be polled; the request route never accepts a destination URL.
pub fn local_air(cfg: &Path) -> Result<Value, String> {
    local_air_host(&setting(cfg, "purpleAirHost"))
}

pub fn local_air_host(host: &str) -> Result<Value,String> {
    let host = private_host(host)?;
    let j = bounded_json(agent(5).get(&format!("http://{host}/json")), 256 * 1024)?;
    if !j["DateTime"].is_string()
        || number(&j["pm2_5_atm"]).is_none() && number(&j["pm2_5_atm_b"]).is_none()
    {
        return Err("PurpleAir did not report timestamped particulate readings".into());
    }
    // Sensor JSON also includes its Wi-Fi SSID and MAC. Those never leave this boundary.
    Ok(
        json!({"DateTime": j["DateTime"], "pm2_5_atm": j["pm2_5_atm"], "pm2_5_atm_b": j["pm2_5_atm_b"],
        "pm2_5_cf_1": j["pm2_5_cf_1"], "pm2_5_cf_1_b": j["pm2_5_cf_1_b"], "current_humidity": j["current_humidity"]}),
    )
}

fn number(v: &Value) -> Option<f64> {
    v.as_f64()
        .or_else(|| v.as_str()?.parse().ok())
        .filter(|n| n.is_finite())
}

fn valid_reading(index: usize, n: f64) -> bool {
    if !n.is_finite() {
        return false;
    }
    match index {
        1..=3 => (0.0..=150.0).contains(&n),
        4 => (0.0..=360.0).contains(&n),
        5 => (0.0..=3600.0).contains(&n),
        6 => (100.0..=1200.0).contains(&n),
        7 => (-100.0..=100.0).contains(&n),
        8 => (0.0..=100.0).contains(&n),
        9 => (0.0..=300000.0).contains(&n),
        10 => (0.0..=50.0).contains(&n),
        11 => (0.0..=3000.0).contains(&n),
        12 | 18 => (0.0..=3000.0).contains(&n),
        13 => (0.0..=3.0).contains(&n),
        14 => (0.0..=1000.0).contains(&n),
        15 => (0.0..=100000.0).contains(&n),
        16 => (0.0..=20.0).contains(&n),
        17 => (0.0..=60.0).contains(&n) && n > 0.0,
        _ => false,
    }
}

fn ecowitt_rows(j: &Value, from: i64, to: i64) -> Result<Vec<Vec<Option<f64>>>, String> {
    match j["code"].as_i64() {
        Some(0) => {}
        Some(40010 | 40011 | 40017 | 40018) => {
            return Err("Ecowitt credentials missing or rejected".into())
        }
        Some(45001) => return Err("Ecowitt rate limit reached; retry later".into()),
        _ => return Err("Ecowitt rejected the history request".into()),
    }
    if !j["data"].is_object() {
        return Err("Ecowitt returned invalid history".into());
    }
    let mut rows: BTreeMap<i64, Vec<Option<f64>>> = BTreeMap::new();
    for (group, field, slot, unit) in [
        ("outdoor", "temperature", 7, "°C"),
        ("outdoor", "humidity", 8, "%"),
        ("wind", "wind_speed", 2, "m/s"),
        ("wind", "wind_gust", 3, "m/s"),
        ("wind", "wind_direction", 4, "º"),
        ("pressure", "absolute", 6, "hPa"),
        ("solar_and_uvi", "solar", 11, "W/m²"),
        ("solar_and_uvi", "uvi", 10, ""),
        ("rainfall", "daily", 18, "mm"),
    ] {
        let data = &j["data"][group][field];
        let Some(list) = data["list"].as_object() else {
            continue;
        };
        let reported = data["unit"].as_str().unwrap_or("");
        if reported != unit
            && !(slot == 4 && ["°", "deg"].contains(&reported))
            && !(slot == 11 && reported == "W/m2")
        {
            return Err(format!(
                "Ecowitt returned unexpected units for {group}.{field}"
            ));
        }
        for (ts, value) in list {
            let Ok(ts) = ts.parse::<i64>() else { continue };
            let Some(n) = number(value).filter(|n| valid_reading(slot, *n)) else {
                continue;
            };
            if ts < from || ts > to {
                continue;
            }
            let row = rows.entry(ts).or_insert_with(|| {
                let mut row = vec![None; 19];
                row[0] = Some(ts as f64);
                row[17] = Some(5.0);
                row
            });
            row[slot] = Some(n);
        }
    }
    let mut previous: Option<(i64, f64)> = None;
    for (ts, row) in &mut rows {
        if let Some(total) = row[18] {
            if let Some((prev_ts, prev)) = previous {
                // A missing interval or counter reset cannot be assigned to this five-minute sample.
                if *ts - prev_ts == 300 && total >= prev {
                    row[12] = Some(total - prev);
                }
            }
            previous = Some((*ts, total));
        }
    }
    Ok(rows.into_values().collect())
}

fn tempest_rows(j: &Value, from: i64, to: i64) -> Result<Vec<Vec<Option<f64>>>, String> {
    if j["status"]["status_code"]
        .as_i64()
        .is_some_and(|code| code != 0)
    {
        return Err("Tempest rejected the history request".into());
    }
    let observations = j["obs"]
        .as_array()
        .ok_or("Tempest returned invalid history")?;
    Ok(observations
        .iter()
        .filter_map(|obs| {
            let raw = obs.as_array()?;
            let ts = number(raw.first()?)?;
            if ts.fract() != 0.0 || ts < from as f64 || ts > to as f64 {
                return None;
            }
            let mut row = vec![None; 19];
            row[0] = Some(ts);
            for (i, cell) in row.iter_mut().enumerate().skip(1) {
                *cell = raw.get(i).and_then(number).filter(|n| valid_reading(i, *n));
            }
            if row[1..17].iter().all(Option::is_none) {
                return None;
            }
            Some(row)
        })
        .collect())
}

fn insert_recovered(
    conn: &mut Connection,
    rows: &[Vec<Option<f64>>],
    src: i64,
) -> Result<usize, String> {
    let tx = conn
        .transaction()
        .map_err(|_| "Cannot start archive recovery")?;
    let sql = format!(
        "INSERT OR IGNORE INTO obs(ts,{},src) VALUES ({})",
        crate::store::FIELDS.join(","),
        (1..=20)
            .map(|i| format!("?{i}"))
            .collect::<Vec<_>>()
            .join(",")
    );
    let mut inserted = 0;
    for row in rows {
        let mut values = row.clone();
        values.push(Some(src as f64));
        inserted += tx
            .execute(&sql, params_from_iter(values))
            .map_err(|_| "Cannot save recovered history; no rows were changed")?;
    }
    tx.commit().map_err(|_| "Cannot commit recovered history")?;
    Ok(inserted)
}

pub struct Recovery {
    pub(crate) rows: Vec<Vec<Option<f64>>>,
    pub(crate) src: i64,
    pub(crate) from: i64,
    pub(crate) to: i64,
}

/// Capture only the fields that determine the request, so unrelated appearance edits do not cancel it.
pub fn recovery_config(cfg: &Value) -> Value {
    let keys = ["stationSource", "token", "deviceId", "ecowittAppKey", "ecowittApiKey", "ecowittMac"];
    Value::Object(keys.into_iter().map(|key| (key.into(), cfg["settings"][key].clone())).collect())
}

/// Fetch without holding the station lock or archive writer.
pub fn fetch_recovery(config: &Value, from: i64, to: i64) -> Result<Recovery, String> {
    let get = |key: &str| config[key].as_str().unwrap_or("").to_owned();
    let now = crate::server::epoch() as i64;
    if from < 946684800 || to <= from || to - from > 86400 || to > now {
        return Err("Choose a past range of at most one day".into());
    }
    let source = get("stationSource");
    let (rows, src) = if source == "ecowitt" || source == "push" {
        if from < now - 90 * 86400 {
            return Err("Ecowitt five-minute history is limited to the last 90 days".into());
        }
        let (app, key, mac) = (
            get("ecowittAppKey"),
            get("ecowittApiKey"),
            get("ecowittMac"),
        );
        if app.is_empty() || key.is_empty() || mac.is_empty() {
            return Err("Configure the Ecowitt application key, API key and device MAC before repairing history".into());
        }
        let date = |ts| {
            let (y, m, d, h, min, s) = crate::server::utc_ymdhms(ts);
            format!("{y:04}-{m:02}-{d:02} {h:02}:{min:02}:{s:02}")
        };
        let request = agent(15)
            .get("https://api.ecowitt.net/api/v3/device/history")
            .query("application_key", &app)
            .query("api_key", &key)
            .query("mac", &mac)
            .query("start_date", &date(from))
            .query("end_date", &date(to))
            .query("cycle_type", "5min")
            .query("call_back", "outdoor,wind,pressure,rainfall,solar_and_uvi")
            .query("temp_unitid", "1")
            .query("pressure_unitid", "3")
            .query("wind_speed_unitid", "6")
            .query("rainfall_unitid", "12");
        (
            ecowitt_rows(&bounded_json(request, 4 * 1024 * 1024)?, from, to)?,
            6,
        )
    } else if source.is_empty() || source == "tempest" {
        let (token, device) = (get("token"), get("deviceId"));
        if token.is_empty() || device.is_empty() || !device.bytes().all(|c| c.is_ascii_digit()) {
            return Err("Configure a Tempest token and device ID before repairing history".into());
        }
        let request = agent(15)
            .get(&format!(
                "https://swd.weatherflow.com/swd/rest/observations/device/{device}"
            ))
            .query("token", &token)
            .query("time_start", &from.to_string())
            .query("time_end", &to.to_string());
        (
            tempest_rows(&bounded_json(request, 4 * 1024 * 1024)?, from, to)?,
            1,
        )
    } else {
        return Err("Cloud gap repair currently supports Tempest and Ecowitt; other sources can import CSV history".into());
    };
    Ok(Recovery { rows, src, from, to })
}

/// Caller rechecks the pinned source and archive generation while holding its config lock.
pub fn commit_recovery(conn: &mut Connection, recovery: Recovery) -> Result<Value, String> {
    let Recovery { rows, src, from, to } = recovery;
    let inserted = insert_recovered(conn, &rows, src)?;
    Ok(json!({"inserted":inserted,"received":rows.len(),"from":from,"to":to,"source":if src==6 {"Ecowitt cloud"} else {"Tempest cloud"},"message":if rows.is_empty(){"No observations returned for this range"}else{"Recovery complete; existing observations were preserved"}}))
}

fn in_ring(lon: f64, lat: f64, ring: &Value) -> bool {
    let Some(ring) = ring.as_array().filter(|r| r.len() >= 4) else {
        return false;
    };
    let points: Option<Vec<(f64, f64)>> = ring
        .iter()
        .map(|p| Some((p[0].as_f64()?, p[1].as_f64()?)))
        .collect();
    let Some(points) = points else { return false };
    let mut inside = false;
    let mut previous = *points.last().unwrap();
    for (x, y) in points {
        let (xx, yy) = previous;
        if ((lon - x) * (yy - y) - (lat - y) * (xx - x)).abs() < 1e-10
            && lon >= x.min(xx)
            && lon <= x.max(xx)
            && lat >= y.min(yy)
            && lat <= y.max(yy)
        {
            return true;
        }
        if (y > lat) != (yy > lat) && lon < (xx - x) * (lat - y) / (yy - y) + x {
            inside = !inside;
        }
        previous = (x, y);
    }
    inside
}

fn contains(geometry: &Value, lat: f64, lon: f64) -> bool {
    let polygon = |p: &Value| {
        p.as_array().is_some_and(|rings| {
            !rings.is_empty()
                && in_ring(lon, lat, &rings[0])
                && !rings[1..].iter().any(|r| in_ring(lon, lat, r))
        })
    };
    match geometry["type"].as_str() {
        Some("Polygon") => polygon(&geometry["coordinates"]),
        Some("MultiPolygon") => geometry["coordinates"]
            .as_array()
            .is_some_and(|p| p.iter().any(polygon)),
        _ => false,
    }
}

fn normalize_canada(j: &Value, lat: f64, lon: f64, now: i64) -> Result<Value, String> {
    let raw = j["features"]
        .as_array()
        .ok_or("Canadian warning service returned invalid data")?;
    if j["links"]
        .as_array()
        .is_some_and(|links| links.iter().any(|l| l["rel"] == "next"))
    {
        return Err("Canadian warning response incomplete; retry later".into());
    }
    let clock = Connection::open_in_memory().map_err(|_| "Cannot validate warning times")?;
    let mut features = Vec::new();
    let mut seen = BTreeSet::new();
    for f in raw {
        let p = &f["properties"];
        let Some(expires) = p["expiration_datetime"].as_str() else {
            continue;
        };
        let epoch: Option<i64> = clock
            .query_row(
                "SELECT CAST(strftime('%s',?1) AS INTEGER)",
                [expires],
                |r| r.get(0),
            )
            .ok()
            .flatten();
        let status = p["status_en"].as_str().unwrap_or("").to_lowercase();
        if epoch.is_none_or(|t| t <= now)
            || ["ended", "cancelled", "canceled"].contains(&status.as_str())
            || !contains(&f["geometry"], lat, lon)
        {
            continue;
        }
        let (Some(event), Some(description)) =
            (p["alert_name_en"].as_str(), p["alert_text_en"].as_str())
        else {
            continue;
        };
        let key = format!("{event}|{}|{description}", p["publication_datetime"]);
        if !seen.insert(key.clone()) {
            continue;
        }
        let area = p["feature_name_en"].as_str().unwrap_or("");
        features.push(json!({"type":"Feature","id":format!("eccc:{}",p["id"].as_str().unwrap_or(&key)),"geometry":f["geometry"],"properties":{
            "event":event,"headline":format!("{event} — {area}"),"description":description,"instruction":"",
            "severity":"Unknown","urgency":"Unknown","certainty":"Unknown","alertType":p["alert_type"],"riskColour":p["risk_colour_en"],
            "effective":p["validity_datetime"],"sent":p["publication_datetime"],"expires":expires,"ends":p["event_end_datetime"],
            "areaDesc":area,"senderName":"Environment and Climate Change Canada","status":"Actual","messageType":"Alert"}}));
    }
    Ok(
        json!({"type":"FeatureCollection","features":features,"source":"Environment and Climate Change Canada"}),
    )
}

pub fn canada_alerts(lat: f64, lon: f64) -> Result<Value, String> {
    if !lat.is_finite()
        || !lon.is_finite()
        || !(-90.0..=90.0).contains(&lat)
        || !(-180.0..=180.0).contains(&lon)
    {
        return Err("Invalid warning location".into());
    }
    let bbox = format!(
        "{},{},{},{}",
        (lon - 0.001).max(-180.0),
        (lat - 0.001).max(-90.0),
        (lon + 0.001).min(180.0),
        (lat + 0.001).min(90.0)
    );
    let request = agent(15)
        .get("https://api.weather.gc.ca/collections/weather-alerts/items")
        .query("f", "json")
        .query("bbox", &bbox)
        .query("limit", "100");
    normalize_canada(
        &bounded_json(request, 16 * 1024 * 1024)?,
        lat,
        lon,
        crate::server::epoch() as i64,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn local_sensor_destination_cannot_be_an_open_proxy() {
        for host in ["192.168.1.5", "10.0.0.2:80", "localhost", "127.0.0.1"] {
            assert!(private_host(host).is_ok());
        }
        for host in [
            "8.8.8.8",
            "169.254.169.254",
            "https://192.168.1.1",
            "192.168.1.1:8080",
            "localhost/private",
            "[::1]",
            "0x7f000001",
        ] {
            assert!(private_host(host).is_err(), "{host}");
        }
    }
    #[test]
    fn ecowitt_only_differences_adjacent_valid_counters() {
        let body = json!({"code":0,"data":{"outdoor":{"temperature":{"unit":"°C","list":{"1000":"20","1300":"21","1900":"22","2200":"23","2500":"NaN","2800":"24"}}},"rainfall":{"daily":{"unit":"mm","list":{"1000":"1","1300":"2","1900":"4","2200":"0","2500":null,"2800":"1"}}}}});
        let rows = ecowitt_rows(&body, 1000, 2800).unwrap();
        assert_eq!(rows.len(), 5);
        assert_eq!(rows[0][12], None);
        assert_eq!(rows[1][12], Some(1.0));
        assert_eq!(rows[2][12], None);
        assert_eq!(rows[3][12], None);
        assert_eq!(rows[4][12], None);
        assert!(ecowitt_rows(&json!({"code":45001}), 0, 1).is_err());
        assert!(ecowitt_rows(&json!({"code":0,"data":{"outdoor":{"temperature":{"unit":"°F","list":{"1000":"70"}}}}}),0,2000).is_err());
    }
    #[test]
    fn tempest_rejects_invalid_timestamps_and_values() {
        let rows=tempest_rows(&json!({"obs":[[1000,null,4,null,null,null,1000,20],["NaN",null,5],[999,null,4],[1100,null,-10]]}),1000,1200).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0][7], Some(20.0));
    }
    #[test]
    fn recovery_preserves_existing_rows_and_rolls_back_errors() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(&format!(
            "CREATE TABLE obs(ts INTEGER PRIMARY KEY,{},src INTEGER)",
            crate::store::FIELDS
                .iter()
                .map(|f| format!("{f} REAL"))
                .collect::<Vec<_>>()
                .join(",")
        ))
        .unwrap();
        let mut row = vec![None; 19];
        row[0] = Some(1000.0);
        row[7] = Some(20.0);
        assert_eq!(insert_recovered(&mut conn, &[row.clone()], 6).unwrap(), 1);
        row[7] = Some(30.0);
        assert_eq!(insert_recovered(&mut conn, &[row.clone()], 6).unwrap(), 0);
        assert_eq!(
            conn.query_row("SELECT temp FROM obs", [], |r| r.get::<_, f64>(0))
                .unwrap(),
            20.0
        );
        row[0] = Some(1300.0);
        assert!(insert_recovered(&mut conn, &[row, vec![None; 2]], 6).is_err());
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM obs", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            1
        );
    }
    #[test]
    fn canada_preserves_official_text_and_ignores_expired_or_outside() {
        let feature = json!({"geometry":{"type":"Polygon","coordinates":[[[-80,40],[-70,40],[-70,50],[-80,50],[-80,40]]]},"properties":{"id":"test","alert_name_en":"Rainfall warning","alert_text_en":"Official text","expiration_datetime":"2030-01-01T00:00:00Z","risk_colour_en":"yellow","alert_type":"warning"}});
        let body = json!({"features":[feature.clone(),feature]});
        let v = normalize_canada(&body, 45.0, -75.0, 1700000000).unwrap();
        assert_eq!(v["features"].as_array().unwrap().len(), 1);
        assert_eq!(v["features"][0]["properties"]["severity"], "Unknown");
        assert_eq!(
            v["features"][0]["properties"]["description"],
            "Official text"
        );
        assert!(
            normalize_canada(&body, 45.0, -65.0, 1700000000).unwrap()["features"]
                .as_array()
                .unwrap()
                .is_empty()
        );
        assert!(
            normalize_canada(&body, 45.0, -75.0, 2000000000).unwrap()["features"]
                .as_array()
                .unwrap()
                .is_empty()
        );
    }
}
