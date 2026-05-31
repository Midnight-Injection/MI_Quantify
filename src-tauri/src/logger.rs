use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

use chrono::Local;

/// 日志写入器，全局持有一个文件句柄
pub struct AppLogger {
    log_file: Mutex<Option<File>>,
    log_dir: PathBuf,
}

impl AppLogger {
    /// 创建日志写入器
    pub fn new(log_dir: PathBuf) -> Self {
        Self {
            log_file: Mutex::new(None),
            log_dir,
        }
    }

    /// 写入一行日志到当天日志文件
    ///
    /// 格式：`[2024-01-01 12:00:00] [LEVEL] message`
    pub fn log(&self, level: &str, tag: &str, message: &str) {
        let now = Local::now();
        let date_str = now.format("%Y-%m-%d").to_string();
        let time_str = now.format("%Y-%m-%d %H:%M:%S%.3f").to_string();

        let line = format!("[{}] [{}] [{}] {}\n", time_str, level, tag, message);

        // 同时输出到控制台（开发调试用）
        print!("{}", line);

        let file_name = format!("app-{}.log", date_str);
        let log_path = self.log_dir.join(&file_name);

        if let Ok(mut guard) = self.log_file.lock() {
            // 每次都重新打开文件（确保日期切换时使用正确的文件）
            if guard.is_none() {
                if let Some(parent) = log_path.parent() {
                    let _ = fs::create_dir_all(parent);
                }
                match OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&log_path)
                {
                    Ok(file) => {
                        *guard = Some(file);
                    }
                    Err(e) => {
                        eprintln!("无法打开日志文件 {:?}: {}", log_path, e);
                        return;
                    }
                }
            }

            if let Some(ref mut file) = *guard {
                let _ = file.write_all(line.as_bytes());
                let _ = file.flush();
            }
        }
    }

    /// 清理过期日志文件（保留最近 N 天）
    pub fn cleanup_old_logs(&self, keep_days: u64) {
        let cutoff = Local::now() - chrono::Duration::days(keep_days as i64);
        let cutoff_str = cutoff.format("%Y-%m-%d").to_string();

        if let Ok(entries) = fs::read_dir(&self.log_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    if name.starts_with("app-") && name.ends_with(".log") {
                        // 提取日期部分 app-YYYY-MM-DD.log
                        let date_part = name
                            .strip_prefix("app-")
                            .and_then(|s| s.strip_suffix(".log"));
                        if let Some(date) = date_part {
                            if date < cutoff_str.as_str() {
                                let _ = fs::remove_file(&path);
                            }
                        }
                    }
                }
            }
        }
    }
}

/// 安全写入日志的辅助宏
#[macro_export]
macro_rules! app_log {
    ($logger:expr, $level:expr, $tag:expr, $($arg:tt)*) => {
        $logger.log($level, $tag, &format!($($arg)*))
    };
}
