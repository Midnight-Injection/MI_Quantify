use std::process::Command as StdCommand;
use std::sync::Mutex;
use tauri::{Manager, State};

pub struct SidecarState {
    pub process: Mutex<Option<u32>>,
}

#[tauri::command]
pub async fn sidecar_start(app: tauri::AppHandle, state: State<'_, SidecarState>) -> Result<String, String> {
    let mut guard = state.process.lock().map_err(|e| e.to_string())?;
    if guard.is_some() {
        return Ok("already running".into());
    }

    let sidecar_path = resolve_sidecar_path(&app)?;

    let child = StdCommand::new(&sidecar_path)
        .current_dir(sidecar_path.parent().unwrap_or(std::path::Path::new(".")))
        .spawn()
        .map_err(|e| format!("failed to start sidecar at {:?}: {}", sidecar_path, e))?;

    let pid = child.id();
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

fn resolve_sidecar_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let binary_name = format!(
        "mi-quantify-sidecar{}",
        if cfg!(windows) { ".exe" } else { "" }
    );

    // 1. bundled app: resource_dir/binaries/mi-quantify-sidecar
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled: std::path::PathBuf = resource_dir.join("binaries").join(&binary_name);
        if bundled.exists() {
            return Ok(bundled);
        }
    }

    // 2. dev mode: src-tauri/binaries/mi-quantify-sidecar-<rust-target-triple>
    let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
    let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let manifest_parent = manifest_dir
        .parent()
        .map(std::path::Path::to_path_buf)
        .unwrap_or_else(|| manifest_dir.clone());

    let target_triple = std::env::var("TAURI_ENV_TARGET")
        .unwrap_or_else(|_| {
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
        manifest_parent.join("src-tauri/binaries").join(&triple_name),
    ];

    for path in &candidates {
        if path.exists() {
            return Ok(path.clone());
        }
    }

    Err(format!(
        "sidecar binary not found; checked resource_dir + [{}]",
        candidates
            .iter()
            .map(|p| p.to_string_lossy().to_string())
            .collect::<Vec<_>>()
            .join(", ")
    ))
}

pub fn init_state() -> SidecarState {
    SidecarState {
        process: Mutex::new(None),
    }
}
