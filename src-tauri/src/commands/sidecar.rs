use std::io::Write;
use std::process::{Command as StdCommand, Stdio};
use std::sync::Mutex;

use tauri::{Manager, State};
use tauri_plugin_shell::process::{CommandEvent, CommandChild};
use tauri_plugin_shell::ShellExt;

use crate::logger::AppLogger;
use crate::storage;

/// sidecar 进程运行时状态
pub struct SidecarState {
    pub child: Mutex<Option<CommandChild>>,
    /// 记录 PID 用于日志和端口清理时的排除
    pub pid: Mutex<Option<u32>>,
}

/// 从 AppHandle 获取日志记录器并写入日志
fn log_to_app(app: &tauri::AppHandle, level: &str, tag: &str, message: &str) {
    let Some(state) = app.try_state::<Mutex<AppLogger>>() else {
        return;
    };
    let Ok(guard) = state.lock() else {
        return;
    };
    guard.log(level, tag, message);
}

#[tauri::command]
pub async fn sidecar_start(
    app: tauri::AppHandle,
    state: State<'_, SidecarState>,
) -> Result<String, String> {
    log_to_app(&app, "INFO", "sidecar", "正在启动 sidecar 进程...");

    let child_guard = state.child.lock().map_err(|e| e.to_string())?;
    if child_guard.is_some() {
        log_to_app(&app, "WARN", "sidecar", "sidecar 进程已在运行中");
        return Ok("already running".into());
    }
    drop(child_guard);

    // 开发模式：使用 Python 直接运行 src-python/run.py
    #[cfg(debug_assertions)]
    {
        let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let manifest_parent = manifest_dir
            .parent()
            .map(std::path::Path::to_path_buf)
            .unwrap_or_else(|| manifest_dir.clone());
        let src_python_dir = manifest_parent.join("src-python");

        if src_python_dir.join("run.py").exists() {
            return spawn_dev_python(&app, &state, src_python_dir);
        }
    }

    // 生产模式：使用 tauri-plugin-shell 的 sidecar API
    spawn_sidecar_binary(&app, &state)
}

/// 使用 tauri-plugin-shell sidecar API 启动打包的二进制
fn spawn_sidecar_binary(
    app: &tauri::AppHandle,
    state: &State<'_, SidecarState>,
) -> Result<String, String> {
    let sidecar_command = app
        .shell()
        .sidecar("mi-quantify-sidecar")
        .map_err(|e| format!("无法创建 sidecar 命令: {}", e))?;

    log_to_app(app, "INFO", "sidecar", "使用 tauri sidecar API 启动...");

    let (mut receiver, child) = sidecar_command
        .spawn()
        .map_err(|e| {
            let msg = format!("sidecar 启动失败: {}", e);
            log_to_app(app, "ERROR", "sidecar", &msg);
            msg
        })?;

    let pid = child.pid();
    log_to_app(app, "INFO", "sidecar", &format!("sidecar 进程已启动 (pid {})", pid));

    // 后台线程读取 sidecar 输出事件并写入日志
    let log_dir = storage::runtime_log_dir().ok().cloned();
    std::thread::spawn(move || {
        while let Some(event) = tauri::async_runtime::block_on(receiver.recv()) {
            match event {
                CommandEvent::Stdout(data) => {
                    let line = String::from_utf8_lossy(&data);
                    for l in line.lines() {
                        write_sidecar_log(&log_dir, "stdout", l);
                    }
                }
                CommandEvent::Stderr(data) => {
                    let line = String::from_utf8_lossy(&data);
                    for l in line.lines() {
                        write_sidecar_log(&log_dir, "stderr", l);
                    }
                }
                CommandEvent::Error(err) => {
                    write_sidecar_log(&log_dir, "error", &err);
                }
                CommandEvent::Terminated(payload) => {
                    write_sidecar_log(
                        &log_dir,
                        "terminated",
                        &format!("exit code: {:?}", payload.code),
                    );
                    break;
                }
                _ => {}
            }
        }
    });

    // 等待一小段时间检查进程是否立即退出
    std::thread::sleep(std::time::Duration::from_millis(300));

    // 检查进程是否还在运行（通过 PID 检查）
    if !is_pid_alive(pid) {
        let msg = format!("sidecar 进程启动后立即退出 (pid {})", pid);
        log_to_app(app, "ERROR", "sidecar", &msg);
        // child 会在 drop 时自动清理，无需手动处理
        let _ = child;
        return Err(msg);
    }

    log_to_app(app, "INFO", "sidecar", &format!("sidecar 进程运行正常 (pid {})", pid));

    let mut child_guard = state.child.lock().map_err(|e| e.to_string())?;
    let mut pid_guard = state.pid.lock().map_err(|e| e.to_string())?;
    *child_guard = Some(child);
    *pid_guard = Some(pid);

    Ok(format!("sidecar started (pid {})", pid))
}

/// 开发模式下使用 Python 直接启动 sidecar
#[cfg(debug_assertions)]
fn spawn_dev_python(
    app: &tauri::AppHandle,
    state: &State<'_, SidecarState>,
    src_python_dir: std::path::PathBuf,
) -> Result<String, String> {
    let python_candidates = if cfg!(windows) {
        vec![
            src_python_dir
                .join(".venv")
                .join("Scripts")
                .join("python.exe"),
            std::path::PathBuf::from("python"),
        ]
    } else {
        vec![
            src_python_dir.join(".venv").join("bin").join("python"),
            std::path::PathBuf::from("python3"),
            std::path::PathBuf::from("python"),
        ]
    };

    let program = python_candidates
        .into_iter()
        .find(|c| c.components().count() <= 1 || c.exists())
        .ok_or_else(|| "未找到可用的 Python 解释器".to_string())?;

    log_to_app(
        app,
        "INFO",
        "sidecar",
        &format!("开发模式: 使用 Python 启动 ({:?})", program),
    );

    let mut child_cmd = StdCommand::new(&program);
    child_cmd
        .arg("run.py")
        .current_dir(&src_python_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // Windows: 禁止为新进程创建控制台窗口
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        child_cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = child_cmd.spawn().map_err(|e| {
        let msg = format!("Python sidecar 启动失败: {}", e);
        log_to_app(app, "ERROR", "sidecar", &msg);
        msg
    })?;

    let pid = child.id();
    log_to_app(app, "INFO", "sidecar", &format!("sidecar 进程已启动 (pid {})", pid));

    // 读取 stdout
    if let Some(stdout) = child.stdout.take() {
        let log_dir = storage::runtime_log_dir().ok().cloned();
        std::thread::spawn(move || {
            use std::io::BufRead;
            let reader = std::io::BufReader::new(stdout);
            for line in reader.lines().map_while(Result::ok) {
                write_sidecar_log(&log_dir, "stdout", &line);
            }
        });
    }

    // 读取 stderr
    if let Some(stderr) = child.stderr.take() {
        let log_dir = storage::runtime_log_dir().ok().cloned();
        std::thread::spawn(move || {
            use std::io::BufRead;
            let reader = std::io::BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                write_sidecar_log(&log_dir, "stderr", &line);
            }
        });
    }

    std::thread::sleep(std::time::Duration::from_millis(300));

    match child.try_wait() {
        Ok(Some(status)) => {
            let msg = format!(
                "sidecar 进程启动后立即退出 (pid {}, status: {})",
                pid, status
            );
            log_to_app(app, "ERROR", "sidecar", &msg);
            return Err(msg);
        }
        Ok(None) => {
            log_to_app(
                app,
                "INFO",
                "sidecar",
                &format!("sidecar 进程运行正常 (pid {})", pid),
            );
        }
        Err(e) => {
            let msg = format!("无法检查 sidecar 进程状态: {}", e);
            log_to_app(app, "ERROR", "sidecar", &msg);
            return Err(msg);
        }
    }

    // 开发模式：std::process::Child 需要 detach，但用 SidecarState::child 存不下
    // 改为存 PID，通过 kill_by_pid 终止
    *state.pid.lock().map_err(|e| e.to_string())? = Some(pid);
    std::mem::forget(child);

    Ok(format!("sidecar started (pid {})", pid))
}

/// 将 sidecar 输出写入独立的日志文件 sidecar-YYYY-MM-DD.log
fn write_sidecar_log(log_dir: &Option<std::path::PathBuf>, stream: &str, line: &str) {
    let Some(dir) = log_dir else { return };

    let now = chrono::Local::now();
    let date_str = now.format("%Y-%m-%d").to_string();
    let time_str = now.format("%Y-%m-%d %H:%M:%S%.3f").to_string();

    let file_name = format!("sidecar-{}.log", date_str);
    let log_path = dir.join(&file_name);

    let log_line = format!("[{}] [{}] {}\n", time_str, stream, line);
    print!("{}", log_line);

    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
    {
        let _ = file.write_all(log_line.as_bytes());
        let _ = file.flush();
    }
}

#[tauri::command]
pub async fn sidecar_stop(
    app: tauri::AppHandle,
    state: State<'_, SidecarState>,
) -> Result<String, String> {
    let pid = *state.pid.lock().map_err(|e| e.to_string())?;

    // 取出 CommandChild（如果有的话）并 kill
    let mut child_guard = state.child.lock().map_err(|e| e.to_string())?;
    if let Some(child) = child_guard.take() {
        let child_pid = child.pid();
        log_to_app(&app, "INFO", "sidecar", &format!("正在停止 sidecar 进程 (pid {})...", child_pid));
        let _ = child.kill();
    } else if let Some(pid) = pid {
        // 开发模式下没有 CommandChild，通过 PID 终止
        log_to_app(&app, "INFO", "sidecar", &format!("正在停止 sidecar 进程 (pid {})...", pid));
        kill_by_pid(pid);
    }

    *state.pid.lock().map_err(|e| e.to_string())? = None;
    log_to_app(&app, "INFO", "sidecar", "sidecar 进程已停止");
    Ok("stopped".into())
}

#[tauri::command]
pub async fn sidecar_status(state: State<'_, SidecarState>) -> Result<bool, String> {
    let pid_guard = state.pid.lock().map_err(|e| e.to_string())?;
    match *pid_guard {
        Some(pid) => Ok(is_pid_alive(pid)),
        None => Ok(false),
    }
}

const SIDECAR_PORT: u16 = 18911;

#[tauri::command]
pub async fn sidecar_kill_port(
    app: tauri::AppHandle,
    state: State<'_, SidecarState>,
) -> Result<Vec<u32>, String> {
    let managed_pid = state
        .pid
        .lock()
        .map_err(|e| e.to_string())?
        .unwrap_or(0);

    log_to_app(
        &app,
        "INFO",
        "sidecar",
        &format!("正在清理端口 {} 上的残留进程...", SIDECAR_PORT),
    );

    #[cfg(unix)]
    {
        let output = StdCommand::new("lsof")
            .args(["-ti", &format!(":{}", SIDECAR_PORT)])
            .output()
            .map_err(|e| format!("lsof failed: {}", e))?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut killed = Vec::new();

        for line in stdout.lines() {
            if let Ok(pid) = line.trim().parse::<u32>() {
                if pid == managed_pid {
                    continue;
                }
                kill_by_pid(pid);
                killed.push(pid);
            }
        }

        if !killed.is_empty() {
            log_to_app(
                &app,
                "INFO",
                "sidecar",
                &format!("已清理端口 {} 上的进程: {:?}", SIDECAR_PORT, killed),
            );
            std::thread::sleep(std::time::Duration::from_millis(500));
        }

        Ok(killed)
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let output = StdCommand::new("netstat")
            .args(["-ano", "-p", "TCP"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| format!("netstat failed: {}", e))?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        let needle = format!(":{}", SIDECAR_PORT);
        let mut killed = Vec::new();

        for line in stdout.lines() {
            if !line.contains(&needle) {
                continue;
            }
            let parts: Vec<&str> = line.split_whitespace().collect();
            if let Some(pid_str) = parts.last() {
                if let Ok(pid) = pid_str.parse::<u32>() {
                    if pid == managed_pid || pid == 0 {
                        continue;
                    }
                    kill_by_pid(pid);
                    killed.push(pid);
                }
            }
        }

        if !killed.is_empty() {
            log_to_app(
                &app,
                "INFO",
                "sidecar",
                &format!("已清理端口 {} 上的进程: {:?}", SIDECAR_PORT, killed),
            );
            std::thread::sleep(std::time::Duration::from_millis(500));
        }

        Ok(killed)
    }
}

#[derive(serde::Deserialize)]
pub struct ProxyInfo {
    host: String,
    port: u16,
    protocol: String,
    username: String,
    password: String,
    enabled: bool,
}

#[tauri::command]
pub fn set_proxy_env(
    app: tauri::AppHandle,
    proxies: Vec<ProxyInfo>,
) -> Result<String, String> {
    let proxy = proxies.iter().find(|p| p.enabled);
    match proxy {
        Some(p) if p.protocol == "http" || p.protocol == "socks5" => {
            let auth = if !p.username.is_empty() {
                format!("{}:{}@", p.username, p.password)
            } else {
                String::new()
            };
            let url = format!("{}://{}{}:{}", p.protocol, auth, p.host, p.port);
            std::env::set_var("HTTP_PROXY", &url);
            std::env::set_var("HTTPS_PROXY", &url);
            std::env::set_var("http_proxy", &url);
            std::env::set_var("https_proxy", &url);
            log_to_app(&app, "INFO", "proxy", &format!("代理环境变量已设置: {}", url));
            Ok(format!("proxy env set: {}", url))
        }
        _ => {
            std::env::remove_var("HTTP_PROXY");
            std::env::remove_var("HTTPS_PROXY");
            std::env::remove_var("http_proxy");
            std::env::remove_var("https_proxy");
            log_to_app(&app, "INFO", "proxy", "代理环境变量已清除");
            Ok("proxy env cleared".into())
        }
    }
}

pub fn init_state() -> SidecarState {
    SidecarState {
        child: Mutex::new(None),
        pid: Mutex::new(None),
    }
}

/// 同步关闭 sidecar 进程，用于应用退出时调用
///
/// 直接从 managed state 获取 CommandChild 并终止进程，不需要 async runtime
pub fn sidecar_shutdown(app: &tauri::AppHandle) -> Result<(), String> {
    let Some(state) = app.try_state::<SidecarState>() else {
        return Ok(());
    };

    // 取出 CommandChild 并 kill（生产模式）
    if let Ok(mut child_guard) = state.child.lock() {
        if let Some(child) = child_guard.take() {
            let pid = child.pid();
            log_to_app(app, "INFO", "sidecar", &format!("正在停止 sidecar 进程 (pid {})...", pid));
            let _ = child.kill();
        }
    }

    // 开发模式下可能只有 PID 没有 CommandChild
    if let Ok(mut pid_guard) = state.pid.lock() {
        if let Some(pid) = pid_guard.take() {
            log_to_app(app, "INFO", "sidecar", &format!("通过 PID 终止 sidecar 进程 (pid {})...", pid));
            kill_by_pid(pid);
        }
    }

    // 等待进程真正退出
    std::thread::sleep(std::time::Duration::from_millis(500));

    log_to_app(app, "INFO", "sidecar", "sidecar 进程已停止");
    Ok(())
}

// ===== 跨平台辅助函数 =====

/// 检查指定 PID 的进程是否还活着
fn is_pid_alive(pid: u32) -> bool {
    #[cfg(unix)]
    {
        unsafe { libc::kill(pid as i32, 0) == 0 }
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let output = StdCommand::new("tasklist")
            .args(["/FI", &format!("PID eq {}", pid)])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        match output {
            Ok(out) => {
                let stdout = String::from_utf8_lossy(&out.stdout);
                stdout.contains(&pid.to_string())
            }
            Err(_) => false,
        }
    }
}

/// 跨平台终止指定 PID 的进程
fn kill_by_pid(pid: u32) {
    #[cfg(unix)]
    {
        unsafe {
            libc::kill(pid as i32, libc::SIGTERM);
        }
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let _ = StdCommand::new("taskkill")
            .args(["/PID", &pid.to_string(), "/F", "/T"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
    }
}
