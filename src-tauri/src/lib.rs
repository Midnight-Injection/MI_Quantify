mod commands;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .manage(commands::sidecar::init_state())
        .manage(commands::scheduler::init_scheduler_state())
        .manage(commands::notifications::init_alert_state())
        .manage(commands::wechat::init_wechat_runtime_state())
        .invoke_handler(tauri::generate_handler![
            greet,
            commands::ai::ai_chat,
            commands::ai::test_ai_connection,
            commands::ai::load_local_ai_config,
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
            commands::sidecar::sidecar_start,
            commands::sidecar::sidecar_stop,
            commands::sidecar::sidecar_status,
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
        ]);

    #[cfg(debug_assertions)]
    {
        builder = builder.plugin(tauri_plugin_mcp_bridge::init());
    }

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
