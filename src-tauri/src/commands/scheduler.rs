use std::sync::Mutex;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduledTask {
    pub id: String,
    pub name: String,
    pub task_type: String,
    pub cron: String,
    pub enabled: bool,
    pub last_run: Option<String>,
    pub next_run: Option<String>,
}

pub struct SchedulerState {
    pub tasks: Mutex<Vec<ScheduledTask>>,
}

#[tauri::command]
pub async fn scheduler_list(state: State<'_, SchedulerState>) -> Result<Vec<ScheduledTask>, String> {
    let tasks = state.tasks.lock().map_err(|e| e.to_string())?;
    Ok(tasks.clone())
}

#[tauri::command]
pub async fn scheduler_toggle(state: State<'_, SchedulerState>, id: String, enabled: bool) -> Result<(), String> {
    let mut tasks = state.tasks.lock().map_err(|e| e.to_string())?;
    if let Some(task) = tasks.iter_mut().find(|t| t.id == id) {
        task.enabled = enabled;
    }
    Ok(())
}

#[tauri::command]
pub async fn scheduler_run_now(id: String) -> Result<String, String> {
    Ok(format!("task {} triggered manually", id))
}

pub fn init_scheduler_state() -> SchedulerState {
    let tasks = vec![
        ScheduledTask {
            id: "market_open".into(),
            name: "开盘行情推送".into(),
            task_type: "market".into(),
            cron: "0 9,30 * * 1-5".into(),
            enabled: true,
            last_run: None,
            next_run: None,
        },
        ScheduledTask {
            id: "market_close".into(),
            name: "收盘数据汇总".into(),
            task_type: "market".into(),
            cron: "0 15 * * 1-5".into(),
            enabled: true,
            last_run: None,
            next_run: None,
        },
        ScheduledTask {
            id: "daily_eval".into(),
            name: "每日AI评估".into(),
            task_type: "ai_eval".into(),
            cron: "30 15 * * 1-5".into(),
            enabled: false,
            last_run: None,
            next_run: None,
        },
        ScheduledTask {
            id: "news_scan".into(),
            name: "新闻情绪扫描".into(),
            task_type: "news".into(),
            cron: "0 */30 * * *".into(),
            enabled: false,
            last_run: None,
            next_run: None,
        },
        ScheduledTask {
            id: "signal_scan".into(),
            name: "策略信号扫描".into(),
            task_type: "signal".into(),
            cron: "0 10,14 * * 1-5".into(),
            enabled: false,
            last_run: None,
            next_run: None,
        },
    ];
    SchedulerState {
        tasks: Mutex::new(tasks),
    }
}
