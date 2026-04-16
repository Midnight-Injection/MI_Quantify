use std::process::Command as StdCommand;
use std::sync::Mutex;
use tauri::State;

pub struct SidecarState {
    pub process: Mutex<Option<u32>>,
}

#[tauri::command]
pub async fn sidecar_start(state: State<'_, SidecarState>) -> Result<String, String> {
    let mut guard = state.process.lock().map_err(|e| e.to_string())?;
    if guard.is_some() {
        return Ok("already running".into());
    }

    let (script_path, script_dir) = find_sidecar_script()?;
    let python_path = find_python(&script_dir)?;

    let child = StdCommand::new(&python_path)
        .arg(&script_path)
        .current_dir(&script_dir)
        .spawn()
        .map_err(|e| format!("failed to start sidecar: {}", e))?;

    let pid = child.id();
    *guard = Some(pid);

    // Detach so it keeps running
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

fn find_python(script_dir: &std::path::Path) -> Result<String, String> {
    let venv_python = script_dir.join(".venv/bin/python3");
    if venv_python.exists() {
        return Ok(venv_python.to_string_lossy().into());
    }

    let candidates = ["python3", "python"];
    for cmd in &candidates {
        if StdCommand::new(cmd).arg("--version").output().is_ok() {
            return Ok(cmd.to_string());
        }
    }
    Err("no python interpreter found".into())
}

fn find_sidecar_script() -> Result<(String, std::path::PathBuf), String> {
    let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
    let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let manifest_parent = manifest_dir
        .parent()
        .map(std::path::Path::to_path_buf)
        .unwrap_or_else(|| manifest_dir.clone());
    let candidates = [
        cwd.join("src-python/run.py"),
        cwd.join("../src-python/run.py"),
        manifest_parent.join("src-python/run.py"),
        manifest_dir.join("../src-python/run.py"),
    ];

    for path in &candidates {
        if path.exists() {
            let dir = path.parent().unwrap().to_path_buf();
            return Ok((path.to_string_lossy().into(), dir));
        }
    }

    Err(format!(
        "sidecar script not found; checked: {}",
        candidates
            .iter()
            .map(|path| path.to_string_lossy().to_string())
            .collect::<Vec<_>>()
            .join(", ")
    ))
}

pub fn init_state() -> SidecarState {
    SidecarState {
        process: Mutex::new(None),
    }
}
