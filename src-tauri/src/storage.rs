use std::{
    env, fs, io,
    path::{Path, PathBuf},
    sync::OnceLock,
};

use tauri::{AppHandle, Manager};

pub const APP_DATA_DIR_NAME: &str = ".mi_quantify";
pub const LEGACY_APP_DATA_DIR_NAME: &str = "mi_quantify";

/// 运行时应用数据目录（安装路径下的 data/），全局只初始化一次
static RUNTIME_DATA_DIR: OnceLock<PathBuf> = OnceLock::new();
/// 运行时日志目录（安装路径下的 log/），全局只初始化一次
static RUNTIME_LOG_DIR: OnceLock<PathBuf> = OnceLock::new();

/// 初始化运行时数据目录和日志目录
///
/// 在生产模式下使用应用安装目录下的 `data/` 和 `log/`，
/// 在开发模式下仍使用用户主目录下的 `.mi_quantify/`（避免污染开发目录）。
/// 会自动从旧目录迁移数据。
pub fn init_runtime_dirs(app: &AppHandle) -> io::Result<()> {
    let data_dir = resolve_data_dir(app)?;
    let log_dir = resolve_log_dir(app)?;

    fs::create_dir_all(&data_dir)?;
    fs::create_dir_all(&log_dir)?;

    let _ = RUNTIME_DATA_DIR.set(data_dir.clone());
    let _ = RUNTIME_LOG_DIR.set(log_dir);

    // 从旧目录自动迁移
    if let Some(home) = resolve_home_dir() {
        let legacy_dir = home.join(LEGACY_APP_DATA_DIR_NAME);
        let old_dir = home.join(APP_DATA_DIR_NAME);
        let target = &data_dir;
        if target != &old_dir {
            migrate_dir_if_needed(&old_dir, target)?;
        }
        if target != &legacy_dir {
            migrate_dir_if_needed(&legacy_dir, target)?;
        }
    }

    Ok(())
}

/// 获取运行时数据目录
pub fn runtime_data_dir() -> io::Result<&'static PathBuf> {
    RUNTIME_DATA_DIR
        .get()
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "运行时数据目录未初始化"))
}

/// 获取运行时日志目录
pub fn runtime_log_dir() -> io::Result<&'static PathBuf> {
    RUNTIME_LOG_DIR
        .get()
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "运行时日志目录未初始化"))
}

/// 获取数据目录下的文件路径
pub fn app_data_file(file_name: &str) -> io::Result<PathBuf> {
    Ok(runtime_data_dir()?.join(file_name))
}

/// 获取日志目录下的文件路径
#[allow(dead_code)]
pub fn app_log_file(file_name: &str) -> io::Result<PathBuf> {
    Ok(runtime_log_dir()?.join(file_name))
}

/// 解析用户主目录
pub fn resolve_home_dir() -> Option<PathBuf> {
    dirs::home_dir()
        .or_else(|| env::var_os("USERPROFILE").map(PathBuf::from))
        .or_else(|| {
            let drive = env::var_os("HOMEDRIVE")?;
            let path = env::var_os("HOMEPATH")?;
            let mut home = PathBuf::from(drive);
            home.push(path);
            Some(home)
        })
}

/// 向后兼容：旧版 storage::ensure_app_data_dir() 的调用方仍可用
pub fn ensure_app_data_dir() -> io::Result<PathBuf> {
    let dir = runtime_data_dir()?.clone();
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// 旧版遗留文件路径（用于迁移）
pub fn legacy_file(file_name: &str) -> Option<PathBuf> {
    resolve_home_dir().map(|home| home.join(LEGACY_APP_DATA_DIR_NAME).join(file_name))
}

/// 查找所有可能的候选文件路径（用于迁移）
pub fn app_support_candidates(app: &AppHandle, file_name: &str) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(dir) = app.path().app_data_dir() {
        candidates.push(dir.join(file_name));
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(home) = resolve_home_dir() {
            let identifier = app.config().identifier.clone();
            candidates.push(
                home.join("AppData")
                    .join("Roaming")
                    .join(&identifier)
                    .join(file_name),
            );
            candidates.push(
                home.join("AppData")
                    .join("Local")
                    .join(&identifier)
                    .join(file_name),
            );
        }
    }

    dedupe_paths(candidates)
}

/// 从候选路径迁移文件（仅在目标不存在时执行）
pub fn migrate_file_if_missing(target: &Path, candidates: &[PathBuf]) -> io::Result<()> {
    if target.exists() {
        return Ok(());
    }

    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }

    for candidate in candidates {
        if candidate == target || !candidate.exists() || candidate.is_dir() {
            continue;
        }
        fs::copy(candidate, target)?;
        break;
    }

    Ok(())
}

/// 解析数据目录路径
///
/// 生产环境：应用可执行文件所在目录的 `data/` 子目录
/// 开发环境：用户主目录 `~/.mi_quantify/`
fn resolve_data_dir(_app: &AppHandle) -> io::Result<PathBuf> {
    // 开发模式仍使用用户主目录
    if cfg!(debug_assertions) {
        let home = resolve_home_dir().ok_or_else(|| {
            io::Error::new(io::ErrorKind::NotFound, "无法定位用户主目录")
        })?;
        return Ok(home.join(APP_DATA_DIR_NAME));
    }

    // 生产模式：使用安装目录下的 data/
    let exe_dir = app_exe_dir()?;
    Ok(exe_dir.join("data"))
}

/// 解析日志目录路径
///
/// 生产环境：应用可执行文件所在目录的 `log/` 子目录
/// 开发环境：用户主目录 `~/.mi_quantify/log/`
fn resolve_log_dir(_app: &AppHandle) -> io::Result<PathBuf> {
    if cfg!(debug_assertions) {
        let home = resolve_home_dir().ok_or_else(|| {
            io::Error::new(io::ErrorKind::NotFound, "无法定位用户主目录")
        })?;
        return Ok(home.join(APP_DATA_DIR_NAME).join("log"));
    }

    let exe_dir = app_exe_dir()?;
    Ok(exe_dir.join("log"))
}

/// 获取应用可执行文件所在目录
fn app_exe_dir() -> io::Result<PathBuf> {
    let exe_path = env::current_exe()?;
    exe_path
        .parent()
        .map(|p| p.to_path_buf())
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "无法定位应用安装目录"))
}

fn dedupe_paths(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut unique = Vec::new();
    for path in paths {
        if unique.iter().any(|existing| existing == &path) {
            continue;
        }
        unique.push(path);
    }
    unique
}

fn migrate_dir_if_needed(source: &Path, target: &Path) -> io::Result<()> {
    if target.exists() || !source.exists() {
        return Ok(());
    }

    match fs::rename(source, target) {
        Ok(_) => Ok(()),
        Err(_) => {
            copy_dir_all(source, target)?;
            let _ = fs::remove_dir_all(source);
            Ok(())
        }
    }
}

fn copy_dir_all(source: &Path, target: &Path) -> io::Result<()> {
    fs::create_dir_all(target)?;

    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());

        if entry.file_type()?.is_dir() {
            copy_dir_all(&source_path, &target_path)?;
        } else {
            fs::copy(&source_path, &target_path)?;
        }
    }

    Ok(())
}
