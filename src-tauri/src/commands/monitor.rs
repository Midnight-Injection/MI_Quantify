use std::{fs, path::PathBuf};

use dirs::home_dir;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

const DB_DIR_NAME: &str = ".mi_quantify";
const DB_FILE_NAME: &str = "mi_quantify.db";
const LEGACY_DIR_NAME: &str = "mi_quantify";

#[derive(Debug, Error)]
enum MonitorDbError {
    #[error("无法定位用户目录")]
    HomeDirMissing,
    #[error("数据库目录初始化失败: {0}")]
    Io(#[from] std::io::Error),
    #[error("数据库操作失败: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("JSON 序列化失败: {0}")]
    Json(#[from] serde_json::Error),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchlistRecord {
    pub code: String,
    pub name: String,
    pub added_at: i64,
    pub group: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorAlert {
    pub id: String,
    pub stock_code: String,
    pub stock_name: String,
    #[serde(rename = "type")]
    pub alert_type: String,
    pub direction: Option<String>,
    pub target_price: Option<f64>,
    pub enabled: bool,
    pub triggered: bool,
    pub cooldown_ms: Option<i64>,
    pub last_triggered_at: Option<i64>,
    pub note: Option<String>,
    pub metadata: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorNotification {
    pub id: Option<i64>,
    pub title: String,
    pub body: String,
    pub time: i64,
    pub stock_code: Option<String>,
    #[serde(rename = "type")]
    pub entry_type: Option<String>,
    pub read: Option<bool>,
}

fn with_connection<T, F>(action: F) -> Result<T, String>
where
    F: FnOnce(&Connection) -> Result<T, MonitorDbError>,
{
    let path = monitor_db_path_inner().map_err(|error| error.to_string())?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let conn = Connection::open(path).map_err(|error| error.to_string())?;
    init_schema(&conn).map_err(|error| error.to_string())?;
    action(&conn).map_err(|error| error.to_string())
}

fn monitor_db_path_inner() -> Result<PathBuf, MonitorDbError> {
    let home = home_dir().ok_or(MonitorDbError::HomeDirMissing)?;
    let new_dir = home.join(DB_DIR_NAME);
    let legacy_dir = home.join(LEGACY_DIR_NAME);

    if !new_dir.exists() && legacy_dir.exists() {
        let _ = std::fs::rename(&legacy_dir, &new_dir);
    }

    Ok(new_dir.join(DB_FILE_NAME))
}

fn init_schema(conn: &Connection) -> Result<(), MonitorDbError> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS watchlist (
            stock_code TEXT PRIMARY KEY,
            stock_name TEXT NOT NULL,
            added_at INTEGER NOT NULL,
            group_name TEXT,
            note TEXT
        );

        CREATE TABLE IF NOT EXISTS alerts (
            id TEXT PRIMARY KEY,
            stock_code TEXT NOT NULL,
            stock_name TEXT NOT NULL,
            type TEXT NOT NULL,
            direction TEXT,
            target_price REAL,
            enabled INTEGER NOT NULL DEFAULT 1,
            triggered INTEGER NOT NULL DEFAULT 0,
            cooldown_ms INTEGER,
            last_triggered_at INTEGER,
            note TEXT,
            metadata_json TEXT,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            body TEXT NOT NULL,
            time INTEGER NOT NULL,
            stock_code TEXT,
            type TEXT,
            read INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_alerts_stock_code ON alerts(stock_code);
        CREATE INDEX IF NOT EXISTS idx_alerts_enabled ON alerts(enabled);
        CREATE INDEX IF NOT EXISTS idx_notifications_time ON notifications(time DESC);
        "#,
    )?;

    conn.execute_batch(
        "ALTER TABLE notifications ADD COLUMN read INTEGER NOT NULL DEFAULT 0",
    ).ok();

    Ok(())
}

fn bool_to_int(value: bool) -> i64 {
    if value {
        1
    } else {
        0
    }
}

fn int_to_bool(value: i64) -> bool {
    value != 0
}

#[tauri::command]
pub async fn monitor_db_path() -> Result<String, String> {
    monitor_db_path_inner()
        .map(|path| path.to_string_lossy().to_string())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn monitor_watchlist_list() -> Result<Vec<WatchlistRecord>, String> {
    with_connection(|conn| {
        let mut stmt = conn.prepare(
            "SELECT stock_code, stock_name, added_at, group_name, note
             FROM watchlist
             ORDER BY added_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(WatchlistRecord {
                code: row.get(0)?,
                name: row.get(1)?,
                added_at: row.get(2)?,
                group: row.get(3)?,
                note: row.get(4)?,
            })
        })?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(MonitorDbError::from)
    })
}

#[tauri::command]
pub async fn monitor_watchlist_upsert(entry: WatchlistRecord) -> Result<(), String> {
    with_connection(|conn| {
        conn.execute(
            "INSERT INTO watchlist (stock_code, stock_name, added_at, group_name, note)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(stock_code) DO UPDATE SET
               stock_name = excluded.stock_name,
               added_at = excluded.added_at,
               group_name = excluded.group_name,
               note = excluded.note",
            params![
                entry.code,
                entry.name,
                entry.added_at,
                entry.group,
                entry.note
            ],
        )?;
        Ok(())
    })
}

#[tauri::command]
pub async fn monitor_watchlist_remove(code: String) -> Result<(), String> {
    with_connection(|conn| {
        conn.execute("DELETE FROM watchlist WHERE stock_code = ?1", params![code])?;
        Ok(())
    })
}

#[tauri::command]
pub async fn monitor_alert_list() -> Result<Vec<MonitorAlert>, String> {
    with_connection(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, stock_code, stock_name, type, direction, target_price, enabled, triggered,
                    cooldown_ms, last_triggered_at, note, metadata_json
             FROM alerts
             ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<f64>>(5)?,
                row.get::<_, i64>(6)?,
                row.get::<_, i64>(7)?,
                row.get::<_, Option<i64>>(8)?,
                row.get::<_, Option<i64>>(9)?,
                row.get::<_, Option<String>>(10)?,
                row.get::<_, Option<String>>(11)?,
            ))
        })?;

        let raw_rows = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(MonitorDbError::from)?;
        raw_rows
            .into_iter()
            .map(|row| {
                let metadata = match row.11 {
                    Some(value) => Some(serde_json::from_str::<Value>(&value)?),
                    None => None,
                };
                Ok(MonitorAlert {
                    id: row.0,
                    stock_code: row.1,
                    stock_name: row.2,
                    alert_type: row.3,
                    direction: row.4,
                    target_price: row.5,
                    enabled: int_to_bool(row.6),
                    triggered: int_to_bool(row.7),
                    cooldown_ms: row.8,
                    last_triggered_at: row.9,
                    note: row.10,
                    metadata,
                })
            })
            .collect::<Result<Vec<_>, MonitorDbError>>()
    })
}

#[tauri::command]
pub async fn monitor_alert_upsert(entry: MonitorAlert) -> Result<(), String> {
    with_connection(|conn| {
        let metadata_json = match entry.metadata {
            Some(value) => Some(serde_json::to_string(&value)?),
            None => None,
        };
        let updated_at = chrono::Utc::now().timestamp_millis();

        conn.execute(
            "INSERT INTO alerts (
                id, stock_code, stock_name, type, direction, target_price, enabled, triggered,
                cooldown_ms, last_triggered_at, note, metadata_json, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
             ON CONFLICT(id) DO UPDATE SET
                stock_code = excluded.stock_code,
                stock_name = excluded.stock_name,
                type = excluded.type,
                direction = excluded.direction,
                target_price = excluded.target_price,
                enabled = excluded.enabled,
                triggered = excluded.triggered,
                cooldown_ms = excluded.cooldown_ms,
                last_triggered_at = excluded.last_triggered_at,
                note = excluded.note,
                metadata_json = excluded.metadata_json,
                updated_at = excluded.updated_at",
            params![
                entry.id,
                entry.stock_code,
                entry.stock_name,
                entry.alert_type,
                entry.direction,
                entry.target_price,
                bool_to_int(entry.enabled),
                bool_to_int(entry.triggered),
                entry.cooldown_ms,
                entry.last_triggered_at,
                entry.note,
                metadata_json,
                updated_at
            ],
        )?;
        Ok(())
    })
}

#[tauri::command]
pub async fn monitor_alert_remove(id: String) -> Result<(), String> {
    with_connection(|conn| {
        conn.execute("DELETE FROM alerts WHERE id = ?1", params![id])?;
        Ok(())
    })
}

#[tauri::command]
pub async fn monitor_alert_toggle(id: String, enabled: bool) -> Result<(), String> {
    with_connection(|conn| {
        conn.execute(
            "UPDATE alerts SET enabled = ?2, updated_at = ?3 WHERE id = ?1",
            params![
                id,
                bool_to_int(enabled),
                chrono::Utc::now().timestamp_millis()
            ],
        )?;
        Ok(())
    })
}

#[tauri::command]
pub async fn monitor_alert_touch(
    id: String,
    triggered: bool,
    last_triggered_at: Option<i64>,
) -> Result<(), String> {
    with_connection(|conn| {
        conn.execute(
            "UPDATE alerts
             SET triggered = ?2, last_triggered_at = ?3, updated_at = ?4
             WHERE id = ?1",
            params![
                id,
                bool_to_int(triggered),
                last_triggered_at,
                chrono::Utc::now().timestamp_millis()
            ],
        )?;
        Ok(())
    })
}

#[tauri::command]
pub async fn monitor_notification_list(
    limit: Option<u32>,
) -> Result<Vec<MonitorNotification>, String> {
    with_connection(|conn| {
        let count = limit.unwrap_or(100).clamp(1, 500);
        let mut stmt = conn.prepare(
            "SELECT id, title, body, time, stock_code, type, read
             FROM notifications
             ORDER BY time DESC
             LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![count], |row| {
            Ok(MonitorNotification {
                id: row.get(0)?,
                title: row.get(1)?,
                body: row.get(2)?,
                time: row.get(3)?,
                stock_code: row.get(4)?,
                entry_type: row.get(5)?,
                read: Some(int_to_bool(row.get::<_, i64>(6)?)),
            })
        })?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(MonitorDbError::from)
    })
}

#[tauri::command]
pub async fn monitor_notification_add(entry: MonitorNotification) -> Result<(), String> {
    with_connection(|conn| {
        conn.execute(
            "INSERT INTO notifications (title, body, time, stock_code, type)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                entry.title,
                entry.body,
                entry.time,
                entry.stock_code,
                entry.entry_type
            ],
        )?;

        conn.execute(
            "DELETE FROM notifications
             WHERE id NOT IN (
                SELECT id FROM notifications ORDER BY time DESC LIMIT 200
             )",
            [],
        )?;
        Ok(())
    })
}

#[tauri::command]
pub async fn monitor_notification_clear() -> Result<(), String> {
    with_connection(|conn| {
        conn.execute("DELETE FROM notifications", [])?;
        Ok(())
    })
}

#[tauri::command]
pub async fn monitor_notification_mark_read() -> Result<(), String> {
    with_connection(|conn| {
        conn.execute("UPDATE notifications SET read = 1", [])?;
        Ok(())
    })
}
