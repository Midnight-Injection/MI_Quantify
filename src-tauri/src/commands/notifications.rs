use std::sync::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, State};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PriceAlert {
    pub id: String,
    pub stock_code: String,
    pub stock_name: String,
    pub target_price: f64,
    pub direction: String,
    pub enabled: bool,
    pub triggered: bool,
}

pub struct AlertState {
    pub alerts: Mutex<Vec<PriceAlert>>,
}

#[tauri::command]
pub async fn alert_list(state: State<'_, AlertState>) -> Result<Vec<PriceAlert>, String> {
    let alerts = state.alerts.lock().map_err(|e| e.to_string())?;
    Ok(alerts.clone())
}

#[tauri::command]
pub async fn alert_add(
    state: State<'_, AlertState>,
    stock_code: String,
    stock_name: String,
    target_price: f64,
    direction: String,
) -> Result<(), String> {
    let mut alerts = state.alerts.lock().map_err(|e| e.to_string())?;
    alerts.push(PriceAlert {
        id: format!("alert_{}", chrono::Utc::now().timestamp_millis()),
        stock_code,
        stock_name,
        target_price,
        direction,
        enabled: true,
        triggered: false,
    });
    Ok(())
}

#[tauri::command]
pub async fn alert_remove(state: State<'_, AlertState>, id: String) -> Result<(), String> {
    let mut alerts = state.alerts.lock().map_err(|e| e.to_string())?;
    alerts.retain(|a| a.id != id);
    Ok(())
}

#[tauri::command]
pub async fn alert_toggle(state: State<'_, AlertState>, id: String, enabled: bool) -> Result<(), String> {
    let mut alerts = state.alerts.lock().map_err(|e| e.to_string())?;
    if let Some(alert) = alerts.iter_mut().find(|a| a.id == id) {
        alert.enabled = enabled;
    }
    Ok(())
}

#[tauri::command]
pub async fn send_notification(app: tauri::AppHandle, title: String, body: String) -> Result<(), String> {
    app.emit("notification", serde_json::json!({ "title": &title, "body": &body }))
        .map_err(|e: tauri::Error| e.to_string())?;
    Ok(())
}

pub fn init_alert_state() -> AlertState {
    AlertState {
        alerts: Mutex::new(Vec::new()),
    }
}
