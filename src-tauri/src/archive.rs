//! Bounded, authenticated archive editing; raw observations are never rewritten by quality review.
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use crate::store;

pub fn archive_air(conn: &mut Connection, value: &Value, now: i64) {
    let Some(stamp)=value["DateTime"].as_str() else{return};
    // PurpleAir uses slash-separated UTC dates. SQLite already supplies the date parser.
    let normalized=stamp.replace('/', "-").to_ascii_uppercase();
    if !normalized.ends_with('Z') {return;}
    let timestamp=conn.query_row("SELECT unixepoch(?1)", [&normalized], |r|r.get::<_,Option<i64>>(0)).ok().flatten();
    let Some(ts)=timestamp.filter(|ts|*ts>=now-600&&*ts<=now+60) else{return};
    let Ok(tx)=conn.transaction() else{return};
    for (key,name) in [("pm2_5_atm","purpleair_pm25_a"),("pm2_5_atm_b","purpleair_pm25_b")] {
        if let Some(v)=value[key].as_f64().filter(|v|v.is_finite()&&(0.0..=10000.0).contains(v)) {
            if tx.execute("INSERT OR IGNORE INTO channels(ts,name,value,unit) VALUES (?1,?2,?3,'µg/m³')",params![ts,name,v]).is_err(){return;}
        }
    }
    let _=tx.commit();
}

pub fn read(conn: &Connection, from: i64, to: i64) -> Result<Value, String> {
    let mut stmt = conn.prepare(&format!("SELECT ts,{},src FROM obs WHERE ts BETWEEN ?1 AND ?2 ORDER BY ts LIMIT 50001", store::FIELDS.join(","))).map_err(|_| "Archive unavailable")?;
    let rows = stmt.query_map([from,to], |r| {
        let mut row = vec![json!(r.get::<_,i64>(0)?)];
        for i in 1..=store::FIELDS.len() { row.push(json!(r.get::<_,Option<f64>>(i)?)); }
        row.push(json!(r.get::<_,i64>(19)?));
        Ok(Value::Array(row))
    }).map_err(|_| "Archive unavailable")?.collect::<Result<Vec<_>,_>>().map_err(|_| "Archive unavailable")?;
    if rows.len() > 50000 { return Err("Choose a shorter period (maximum 50,000 readings)".into()); }
    let mut stmt = conn.prepare("SELECT id,ts,until,kind,text,value FROM notes WHERE until>=?1 AND ts<=?2 ORDER BY ts,id").map_err(|_| "Notes unavailable")?;
    let notes = stmt.query_map([from,to], |r| Ok(json!({"id":r.get::<_,i64>(0)?,"ts":r.get::<_,i64>(1)?,"until":r.get::<_,i64>(2)?,"kind":r.get::<_,String>(3)?,"text":r.get::<_,String>(4)?,"value":r.get::<_,Option<f64>>(5)?}))).map_err(|_| "Notes unavailable")?.collect::<Result<Vec<_>,_>>().map_err(|_| "Notes unavailable")?;
    Ok(json!({"obs":rows,"notes":notes,"from":from,"to":to}))
}

pub fn channels(conn: &Connection, from: i64, to: i64) -> Result<Value, String> {
    let mut stmt = conn.prepare("SELECT ts,name,value,unit FROM channels c WHERE ts BETWEEN ?1 AND ?2 AND NOT EXISTS (SELECT 1 FROM notes n WHERE n.kind='exclude' AND c.ts BETWEEN n.ts AND n.until) ORDER BY ts LIMIT 50000").map_err(|_| "Sensors unavailable")?;
    let rows = stmt.query_map([from,to], |r| Ok(json!({"ts":r.get::<_,i64>(0)?,"name":r.get::<_,String>(1)?,"value":r.get::<_,f64>(2)?,"unit":r.get::<_,String>(3)?}))).map_err(|_| "Sensors unavailable")?.collect::<Result<Vec<_>,_>>().map_err(|_| "Sensors unavailable")?;
    Ok(json!(rows))
}

pub fn latest_channels(conn: &Connection, now: i64) -> Result<Value, String> {
    let mut stmt=conn.prepare("SELECT c.ts,c.name,c.value,c.unit FROM channels c JOIN (SELECT name,MAX(ts) AS ts FROM channels c0 WHERE ts>=?1 AND NOT EXISTS (SELECT 1 FROM notes n WHERE n.kind='exclude' AND c0.ts BETWEEN n.ts AND n.until) GROUP BY name) last ON c.name=last.name AND c.ts=last.ts ORDER BY c.name").map_err(|_| "Sensors unavailable")?;
    let rows=stmt.query_map([now-86400],|r|Ok(json!({"ts":r.get::<_,i64>(0)?,"name":r.get::<_,String>(1)?,"value":r.get::<_,f64>(2)?,"unit":r.get::<_,String>(3)?}))).map_err(|_| "Sensors unavailable")?.collect::<Result<Vec<_>,_>>().map_err(|_| "Sensors unavailable")?;
    Ok(json!(rows))
}

pub fn edit(conn: &mut Connection, body: &Value, now: i64) -> Result<Value, String> {
    let action = body["action"].as_str().ok_or("Missing action")?;
    if action == "delete-note" {
        let id = body["id"].as_i64().filter(|id| *id>0).ok_or("Invalid note")?;
        conn.execute("DELETE FROM notes WHERE id=?1", [id]).map_err(|_| "Could not delete note")?;
        return Ok(json!({"ok":true}));
    }
    if action == "note" {
        let ts = body["ts"].as_i64().filter(|t| *t>=0 && *t<=now+86400).ok_or("Invalid observation time")?;
        let until = body["until"].as_i64().unwrap_or(ts);
        if until<ts || until>now+86400 { return Err("Invalid end time".into()); }
        let kind = body["kind"].as_str().filter(|k| matches!(*k,"note"|"exclude"|"snowfall"|"snowdepth")).ok_or("Invalid note type")?;
        let text = body["text"].as_str().unwrap_or("").trim();
        if text.len()>2000 || (matches!(kind,"note"|"exclude") && text.is_empty()) { return Err("Enter a note of 1–2000 characters".into()); }
        let value = body["value"].as_f64();
        if matches!(kind,"snowfall"|"snowdepth") && !value.is_some_and(|v| v.is_finite() && (0.0..=20000.0).contains(&v)) { return Err("Snow must be 0–20,000 mm".into()); }
        conn.execute("INSERT INTO notes(ts,until,kind,text,value) VALUES (?1,?2,?3,?4,?5)", params![ts,until,kind,text,value]).map_err(|_| "Could not save note")?;
        return Ok(json!({"ok":true,"id":conn.last_insert_rowid()}));
    }
    if action == "import" {
        let rows = body["rows"].as_array().filter(|r| !r.is_empty() && r.len()<=10000).ok_or("Import requires 1–10,000 observations")?;
        let mut validated = Vec::new();
        for row in rows {
            let row = row.as_array().filter(|r| r.len()==19).ok_or("Invalid row width")?;
            let ts = row[0].as_f64().filter(|v| v.is_finite() && *v>=0.0 && *v<=now as f64+600.0 && v.fract()==0.0).ok_or("Invalid timestamp")?;
            let mut tuple = vec![Some(ts)];
            for cell in &row[1..] {
                if cell.is_null() { tuple.push(None); }
                else { tuple.push(Some(cell.as_f64().filter(|v| v.is_finite() && v.abs()<1e9).ok_or("Invalid numeric cell")?)); }
            }
            if tuple[7].is_some_and(|v| !(-100.0..=80.0).contains(&v)) || tuple[8].is_some_and(|v| !(0.0..=100.0).contains(&v)) || tuple[12].is_some_and(|v| v<0.0) { return Err("Invalid temperature, humidity or rainfall; check CSV units".into()); }
            validated.push(tuple);
        }
        let tx = conn.transaction().map_err(|_| "Archive busy")?;
        let mut inserted = 0;
        let sql = format!("INSERT OR IGNORE INTO obs(ts,{},src) VALUES ({},5)",store::FIELDS.join(","),(1..=19).map(|i|format!("?{i}")).collect::<Vec<_>>().join(","));
        for row in &validated { inserted += tx.execute(&sql,rusqlite::params_from_iter(row.iter())).map_err(|_|"Import write failed; no changes saved")?; }
        tx.commit().map_err(|_| "Import failed")?;
        return Ok(json!({"ok":true,"inserted":inserted,"duplicates":validated.len()-inserted}));
    }
    Err("Unknown archive action".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn db() -> Connection { store::open(std::path::Path::new(":memory:")).unwrap() }
    #[test]
    fn air_history_requires_fresh_utc_and_preserves_originals() {
        let mut c=db();let now=1_700_000_000;
        let sample=json!({"DateTime":"2023/11/14T22:13:20z","pm2_5_atm":12.5,"pm2_5_atm_b":-1});
        archive_air(&mut c,&sample,now);
        let rows=channels(&c,now-1,now+1).unwrap();
        assert_eq!(rows.as_array().unwrap().len(),1);assert_eq!(rows[0]["value"],12.5);
        archive_air(&mut c,&json!({"DateTime":"2023-11-14T22:13:20Z","pm2_5_atm":99}),now);
        assert_eq!(channels(&c,now-1,now+1).unwrap()[0]["value"],12.5);
        for stamp in ["2023-11-14T22:00:00Z","2023-11-14T23:00:00Z","2023-11-14T22:13:21","invalid"] {
            archive_air(&mut c,&json!({"DateTime":stamp,"pm2_5_atm":99}),now);
        }
        assert_eq!(channels(&c,0,now+86400).unwrap().as_array().unwrap().len(),1);
    }
    #[test]
    fn exclusions_preserve_raw_and_restore_records() {
        let mut c=db(); let row=vec![Some(100.0);19]; store::insert(&c,&row,0);
        c.execute("INSERT INTO channels(ts,name,value,unit) VALUES (100,'soil_moisture_1',80,'%')",[]).unwrap();
        edit(&mut c,&json!({"action":"note","ts":100,"kind":"exclude","text":"sensor moved"}),200).unwrap();
        assert_eq!(read(&c,0,200).unwrap()["obs"].as_array().unwrap().len(),1);
        assert_eq!(store::tuples_json(&c,0,200),"{\"obs\":[]}");
        assert_eq!(channels(&c,0,200).unwrap(),json!([]));
        assert_eq!(latest_channels(&c,200).unwrap(),json!([]));
        assert_eq!(c.query_row("SELECT COUNT(*) FROM channels",[],|r|r.get::<_,i64>(0)).unwrap(),1);
        edit(&mut c,&json!({"action":"delete-note","id":1}),200).unwrap();
        assert_ne!(store::tuples_json(&c,0,200),"{\"obs\":[]}");
        assert_eq!(channels(&c,0,200).unwrap().as_array().unwrap().len(),1);
        assert_eq!(latest_channels(&c,200).unwrap().as_array().unwrap().len(),1);
    }
    #[test]
    fn invalid_import_is_atomic_and_duplicates_are_preserved() {
        let mut c=db(); let mut row=vec![Value::Null;19]; row[0]=100.into();row[7]=20.into();
        let mut bad=row.clone();bad[7]=900.into();
        assert!(edit(&mut c,&json!({"action":"import","rows":[row,bad]}),200).is_err());
        assert_eq!(store::stamp(&c),(0,0));
        assert_eq!(edit(&mut c,&json!({"action":"import","rows":[row.clone(),row]}),200).unwrap()["inserted"],1);
        assert!(edit(&mut c,&json!({"action":"note","ts":100,"kind":"snowfall","value":-1}),200).is_err());
    }
}
