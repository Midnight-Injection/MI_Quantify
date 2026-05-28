use std::io::Read;
use std::process::{Command as StdCommand, Stdio};
use std::sync::Mutex;
use tauri::{Manager, State};

pub struct SidecarState {
    pub process: Mutex<Option<u32>>,
}

#[tauri::command]
pub async fn sidecar_start(
    app: tauri::AppHandle,
    state: State<'_, SidecarState>,
) -> Result<String, String> {
    let mut guard = state.process.lock().map_err(|e| e.to_string())?;
    if guard.is_some() {
        return Ok("already running".into());
    }

    let launch = resolve_sidecar_launch(&app)?;

    #[cfg(target_os = "macos")]
    {
        let _ = StdCommand::new("xattr")
            .args(["-c"])
            .arg(&launch.program)
            .output();
    }

    let mut command = StdCommand::new(&launch.program);
    if !launch.args.is_empty() {
        command.args(&launch.args);
    }

    let mut child = command
        .current_dir(&launch.current_dir)
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            format!(
                "failed to start sidecar with {:?} {:?}: {}",
                launch.program, launch.args, e
            )
        })?;

    let pid = child.id();

    std::thread::sleep(std::time::Duration::from_millis(1500));

    match child.try_wait() {
        Ok(Some(status)) => {
            let mut stderr_output = String::new();
            if let Some(mut stderr) = child.stderr.take() {
                let _ = stderr.read_to_string(&mut stderr_output);
            }
            return Err(format!(
                "sidecar 进程启动后立即退出 (pid {}, status: {}){}",
                pid,
                status,
                if stderr_output.trim().is_empty() {
                    String::new()
                } else {
                    format!(
                        "\n错误输出:\n{}",
                        stderr_output.chars().take(3000).collect::<String>()
                    )
                }
            ));
        }
        Ok(None) => {
            if let Some(stderr) = child.stderr.take() {
                std::thread::spawn(move || {
                    use std::io::{BufRead, BufReader};
                    let _ = BufReader::new(stderr).lines().count();
                });
            }
        }
        Err(e) => {
            return Err(format!("无法检查 sidecar 进程状态: {}", e));
        }
    }

    *guard = Some(pid);
    std::mem::forget(child);

    Ok(format!("sidecar started (pid {})", pid))
}

#[tauri::command]
pub async fn sidecar_stop(state: State<'_, SidecarState>) -> Result<String, String> {
    let mut guard = state.process.lock().map_err(|e| e.to_string())?;
    match *guard {
        Some(pid) => {
            #[cfg(unix)]
            {
                unsafe {
                    libc::kill(pid as i32, libc::SIGTERM);
                }
            }
            #[cfg(windows)]
            {
                StdCommand::new("taskkill")
                    .args(["/PID", &pid.to_string(), "/F"])
                    .output()
                    .ok();
            }
            *guard = None;
            Ok("stopped".into())
        }
        None => Ok("not running".into()),
    }
}

#[tauri::command]
pub async fn sidecar_status(state: State<'_, SidecarState>) -> Result<bool, String> {
    let guard = state.process.lock().map_err(|e| e.to_string())?;
    match *guard {
        Some(pid) => {
            #[cfg(unix)]
            {
                unsafe { Ok(libc::kill(pid as i32, 0) == 0) }
            }
            #[cfg(windows)]
            {
                let output = StdCommand::new("tasklist")
                    .args(["/FI", &format!("PID eq {}", pid)])
                    .output()
                    .map_err(|e| e.to_string())?;
                let stdout = String::from_utf8_lossy(&output.stdout);
                Ok(stdout.contains(&pid.to_string()))
            }
        }
        None => Ok(false),
    }
}

struct SidecarLaunch {
    program: std::path::PathBuf,
    args: Vec<String>,
    current_dir: std::path::PathBuf,
}

const SIDECAR_PORT: u16 = 18911;

#[tauri::command]
pub async fn sidecar_kill_port(state: State<'_, SidecarState>) -> Result<Vec<u32>, String> {
    let managed_pid = state
        .process
        .lock()
        .map_err(|e| e.to_string())?
        .unwrap_or(0);

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
                unsafe {
                    libc::kill(pid as i32, libc::SIGTERM);
                }
                killed.push(pid);
            }
        }

        if !killed.is_empty() {
            std::thread::sleep(std::time::Duration::from_millis(500));
        }

        Ok(killed)
    }

    #[cfg(windows)]
    {
        let output = StdCommand::new("netstat")
            .args(["-ano", "-p", "TCP"])
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
                    let _ = StdCommand::new("taskkill")
                        .args(["/PID", &pid.to_string(), "/F"])
                        .output();
                    killed.push(pid);
                }
            }
        }

        if !killed.is_empty() {
            std::thread::sleep(std::time::Duration::from_millis(500));
        }

        Ok(killed)
    }
}

fn resolve_sidecar_launch(app: &tauri::AppHandle) -> Result<SidecarLaunch, String> {
    let binary_name = format!(
        "mi-quantify-sidecar{}",
        if cfg!(windows) { ".exe" } else { "" }
    );

    let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
    let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let manifest_parent = manifest_dir
        .parent()
        .map(std::path::Path::to_path_buf)
        .unwrap_or_else(|| manifest_dir.clone());
    let src_python_dir = manifest_parent.join("src-python");

    // Dev mode: prefer Python over bundled binary
    #[cfg(debug_assertions)]
    {
        if src_python_dir.join("run.py").exists() {
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

            for candidate in python_candidates {
                if candidate.components().count() > 1 && !candidate.exists() {
                    continue;
                }
                return Ok(SidecarLaunch {
                    program: candidate,
                    args: vec!["run.py".into()],
                    current_dir: src_python_dir.clone(),
                });
            }
        }
    }

    // 1. bundled app: check multiple possible locations where Tauri places externalBin
    let bundled_candidates: Vec<std::path::PathBuf> = if let Ok(resource_dir) =
        app.path().resource_dir()
    {
        let mut dirs = vec![
            resource_dir.join("binaries").join(&binary_name),
            resource_dir.join(&binary_name),
        ];
        // macOS: externalBin is placed in MacOS/ sibling of Resources/
        if let Some(contents_dir) = resource_dir.parent() {
            dirs.push(contents_dir.join("MacOS").join(&binary_name));
        }
        dirs
    } else {
        vec![]
    };

    for bundled in &bundled_candidates {
        if bundled.exists() {
            return Ok(SidecarLaunch {
                current_dir: bundled
                    .parent()
                    .unwrap_or(std::path::Path::new("."))
                    .to_path_buf(),
                program: bundled.clone(),
                args: Vec::new(),
            });
        }
    }

    // 2. dev mode fallback (non-debug build): prefer running the Python app from src-python
    #[cfg(not(debug_assertions))]
    {
        if src_python_dir.join("run.py").exists() {
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

            for candidate in python_candidates {
                if candidate.components().count() > 1 && !candidate.exists() {
                    continue;
                }
                return Ok(SidecarLaunch {
                    program: candidate,
                    args: vec!["run.py".into()],
                    current_dir: src_python_dir.clone(),
                });
            }
        }
    }

    // 3. fallback: src-tauri/binaries/mi-quantify-sidecar-<rust-target-triple>
    let target_triple = std::env::var("TAURI_ENV_TARGET").unwrap_or_else(|_| {
        let arch = std::env::consts::ARCH;
        let os = std::env::consts::OS;
        match os {
            "macos" => format!("{}-apple-darwin", arch),
            "linux" => format!("{}-unknown-linux-gnu", arch),
            "windows" => format!("{}-pc-windows-msvc", arch),
            _ => format!("{}-{}-unknown", arch, os),
        }
    });
    let triple_name = format!(
        "mi-quantify-sidecar-{}{}",
        target_triple,
        if cfg!(windows) { "" } else { "" }
    );

    let candidates = [
        manifest_dir.join("binaries").join(&triple_name),
        cwd.join("src-tauri/binaries").join(&triple_name),
        cwd.join("../src-tauri/binaries").join(&triple_name),
        manifest_parent
            .join("src-tauri/binaries")
            .join(&triple_name),
    ];

    for path in &candidates {
        if path.exists() {
            return Ok(SidecarLaunch {
                current_dir: path
                    .parent()
                    .unwrap_or(std::path::Path::new("."))
                    .to_path_buf(),
                program: path.clone(),
                args: Vec::new(),
            });
        }
    }

    Err(format!(
        "sidecar launcher not found; checked bundled binary, dev python entry, and [{}]",
        candidates
            .iter()
            .map(|p| p.to_string_lossy().to_string())
            .collect::<Vec<_>>()
            .join(", ")
    ))
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
pub fn set_proxy_env(proxies: Vec<ProxyInfo>) -> Result<String, String> {
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
            Ok(format!("proxy env set: {}", url))
        }
        _ => {
            std::env::remove_var("HTTP_PROXY");
            std::env::remove_var("HTTPS_PROXY");
            std::env::remove_var("http_proxy");
            std::env::remove_var("https_proxy");
            Ok("proxy env cleared".into())
        }
    }
}

pub fn init_state() -> SidecarState {
    SidecarState {
        process: Mutex::new(None),
    }
}
