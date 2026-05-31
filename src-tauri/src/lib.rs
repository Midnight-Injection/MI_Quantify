mod commands;
mod logger;
mod storage;

use logger::AppLogger;
use std::sync::Mutex;
use tauri::Manager;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(commands::sidecar::init_state())
        .manage(commands::scheduler::init_scheduler_state())
        .manage(commands::notifications::init_alert_state())
        .manage(commands::wechat::init_wechat_runtime_state())
        .setup(|app| {
            // 初始化运行时目录（data/ 和 log/）
            storage::init_runtime_dirs(&app.handle())?;

            // 初始化日志系统
            let log_dir = storage::runtime_log_dir()?.clone();
            let app_logger = AppLogger::new(log_dir);
            app_logger.log("INFO", "app", "MI Quantify 启动");
            app_logger.cleanup_old_logs(30);
            app.handle().manage(Mutex::new(app_logger));

            // 监听主窗口关闭事件，在关闭前清理 sidecar 进程
            let window = app.get_webview_window("main").expect("main window not found");
            let app_handle = app.handle().clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api: _, .. } = event {
                    log_to_app(&app_handle, "INFO", "app", "应用正在关闭，清理 sidecar 进程...");
                    let _ = commands::sidecar::sidecar_shutdown(&app_handle);
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            commands::app_store::app_store_get,
            commands::app_store::app_store_set,
            commands::ai::ai_chat,
            commands::ai::ai_chat_stream,
            commands::ai::test_ai_connection,
            commands::monitor::monitor_db_path,
            commands::monitor::monitor_watchlist_list,
            commands::monitor::monitor_watchlist_upsert,
            commands::monitor::monitor_watchlist_remove,
            commands::monitor::monitor_alert_list,
            commands::monitor::monitor_alert_upsert,
            commands::monitor::monitor_alert_remove,
            commands::monitor::monitor_alert_toggle,
            commands::monitor::monitor_alert_touch,
            commands::monitor::monitor_notification_list,
            commands::monitor::monitor_notification_add,
            commands::monitor::monitor_notification_clear,
            commands::monitor::monitor_notification_mark_read,
            commands::sidecar::sidecar_start,
            commands::sidecar::sidecar_stop,
            commands::sidecar::sidecar_status,
            commands::sidecar::sidecar_kill_port,
            commands::sidecar::set_proxy_env,
            commands::scheduler::scheduler_list,
            commands::scheduler::scheduler_toggle,
            commands::scheduler::scheduler_run_now,
            commands::notifications::alert_list,
            commands::notifications::alert_add,
            commands::notifications::alert_remove,
            commands::notifications::alert_toggle,
            commands::notifications::send_notification,
            commands::wechat::wechat_start_login,
            commands::wechat::wechat_get_login_status,
            commands::wechat::wechat_get_channel_status,
            commands::wechat::wechat_start_listener,
            commands::wechat::wechat_stop_listener,
            commands::wechat::wechat_logout_channel,
            commands::wechat::wechat_send_message,
            commands::chat::chat_conversation_list,
            commands::chat::chat_conversation_create,
            commands::chat::chat_conversation_update_title,
            commands::chat::chat_conversation_delete,
            commands::chat::chat_message_list,
            commands::chat::chat_message_add,
            commands::chat::chat_message_clear,
        ]);

    #[cfg(debug_assertions)]
    {
        builder = builder.plugin(tauri_plugin_mcp_bridge::init());
    }

    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    // 应用退出后，兜底清理残留的 sidecar 进程
    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            let _ = commands::sidecar::sidecar_shutdown(app_handle);
        }
    });
}

/// 写入日志的辅助函数，可在模块内使用
fn log_to_app(app: &tauri::AppHandle, level: &str, tag: &str, message: &str) {
    let Some(state) = app.try_state::<Mutex<AppLogger>>() else {
        return;
    };
    let Ok(guard) = state.lock() else {
        return;
    };
    guard.log(level, tag, message);
}
