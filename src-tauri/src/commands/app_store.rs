use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde_json::{Map, Value};
use tauri::AppHandle;
use thiserror::Error;

use crate::storage;

const STORE_FILE_NAME: &str = "settings.json";

#[derive(Debug, Error)]
enum AppStoreError {
    #[error("无法定位用户目录或 Windows 用户目录变量")]
    HomeDirMissing,
    #[error("配置目录初始化失败: {0}")]
    Io(#[from] std::io::Error),
    #[error("配置 JSON 解析失败: {0}")]
    Json(#[from] serde_json::Error),
}

fn store_dir() -> Result<PathBuf, AppStoreError> {
    storage::ensure_app_data_dir().map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            AppStoreError::HomeDirMissing
        } else {
            AppStoreError::Io(error)
        }
    })
}

fn target_store_path() -> Result<PathBuf, AppStoreError> {
    Ok(store_dir()?.join(STORE_FILE_NAME))
}

fn ensure_store_path(app: &AppHandle) -> Result<PathBuf, AppStoreError> {
    let target = target_store_path()?;
    let mut candidates = Vec::new();
    if let Some(legacy_file) = storage::legacy_file(STORE_FILE_NAME) {
        candidates.push(legacy_file);
    }
    candidates.extend(storage::app_support_candidates(app, STORE_FILE_NAME));
    storage::migrate_file_if_missing(&target, &candidates)?;
    Ok(target)
}

fn read_store_map(path: &Path) -> Result<Map<String, Value>, AppStoreError> {
    if !path.exists() {
        return Ok(Map::new());
    }

    let raw = fs::read_to_string(path)?;
    if raw.trim().is_empty() {
        return Ok(Map::new());
    }

    match serde_json::from_str::<Value>(&raw)? {
        Value::Object(map) => Ok(map),
        _ => Ok(Map::new()),
    }
}

fn write_store_map(path: &Path, map: &Map<String, Value>) -> Result<(), AppStoreError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let payload = serde_json::to_string_pretty(map)?;
    let unique_suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let tmp = path.with_extension(format!("json.tmp.{unique_suffix}"));
    fs::write(&tmp, payload)?;
    fs::rename(tmp, path)?;
    Ok(())
}

#[tauri::command]
pub async fn app_store_get(app: AppHandle, key: String) -> Result<Option<Value>, String> {
    let path = ensure_store_path(&app).map_err(|error| error.to_string())?;
    let map = read_store_map(&path).map_err(|error| error.to_string())?;
    Ok(map.get(&key).cloned())
}

#[tauri::command]
pub async fn app_store_set(app: AppHandle, key: String, value: Value) -> Result<(), String> {
    let path = ensure_store_path(&app).map_err(|error| error.to_string())?;
    let mut map = read_store_map(&path).map_err(|error| error.to_string())?;
    map.insert(key, value);
    write_store_map(&path, &map).map_err(|error| error.to_string())
}
