use serde::{Deserialize, Serialize};
use std::{fs, path::Path, process::Command};
use tauri::{Manager, RunEvent, WindowEvent};

#[derive(Debug, Deserialize)]
struct GeneratedFile {
    path: String,
    contents: String,
    #[serde(default)]
    skip_if_exists: bool,
}

#[derive(Debug, Serialize)]
struct WriteGeneratedFilesResult {
    written_files: Vec<String>,
    skipped_files: Vec<String>,
}

#[derive(Debug, Serialize)]
struct SvnCommandResult {
    stdout: String,
    stderr: String,
}

fn run_svn_command(cwd: &str, args: &[&str]) -> Result<SvnCommandResult, String> {
    let args = args.iter().map(|arg| arg.to_string()).collect::<Vec<_>>();
    run_svn_command_owned(cwd, &args)
}

fn run_svn_command_owned(cwd: &str, args: &[String]) -> Result<SvnCommandResult, String> {
    let path = Path::new(cwd);
    if !path.exists() {
        return Err(format!("SVN 目录不存在: {}", cwd));
    }
    if !path.is_dir() {
        return Err(format!("SVN 路径不是目录: {}", cwd));
    }

    let output = Command::new("svn")
        .args(args)
        .current_dir(path)
        .output()
        .map_err(|err| format!("执行 svn 失败: {}", err))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        let detail = if stderr.trim().is_empty() {
            stdout.trim().to_string()
        } else {
            stderr.trim().to_string()
        };
        return Err(format!("svn {} 失败: {}", args.join(" "), detail));
    }

    Ok(SvnCommandResult { stdout, stderr })
}

fn svn_status_entries(cwd: &str) -> Result<Vec<(char, String)>, String> {
    let status = run_svn_command(cwd, &["status"])?;
    let mut entries = Vec::new();

    for line in status.stdout.lines() {
        let marker = line.chars().next().unwrap_or(' ');
        let path = line.get(8..).unwrap_or("").trim().to_string();
        if !path.is_empty() {
            entries.push((marker, path));
        }
    }

    Ok(entries)
}

#[tauri::command]
fn write_generated_files(files: Vec<GeneratedFile>) -> Result<WriteGeneratedFilesResult, String> {
    let mut written_files = Vec::new();
    let mut skipped_files = Vec::new();

    for file in files {
        let path = Path::new(&file.path);
        if file.skip_if_exists && path.exists() {
            skipped_files.push(file.path);
            continue;
        }

        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|err| format!("创建目录失败 {}: {}", parent.display(), err))?;
        }

        fs::write(path, file.contents.as_bytes())
            .map_err(|err| format!("写入文件失败 {}: {}", path.display(), err))?;

        let read_back = fs::read_to_string(path)
            .map_err(|err| format!("写入后读取校验失败 {}: {}", path.display(), err))?;
        if read_back != file.contents {
            return Err(format!("写入内容校验失败 {}", path.display()));
        }

        written_files.push(file.path);
    }

    Ok(WriteGeneratedFilesResult {
        written_files,
        skipped_files,
    })
}

#[tauri::command]
fn svn_update(cwd: String) -> Result<SvnCommandResult, String> {
    run_svn_command(&cwd, &["update"])
}

#[tauri::command]
fn svn_commit(cwd: String, message: String) -> Result<SvnCommandResult, String> {
    run_svn_command(&cwd, &["commit", "-m", &message])
}

#[tauri::command]
fn svn_commit_all(cwd: String, message: String) -> Result<SvnCommandResult, String> {
    let commit_message = message.trim();
    if commit_message.is_empty() {
        return Err("提交说明不能为空".to_string());
    }

    let entries = svn_status_entries(&cwd)?;
    for (marker, path) in &entries {
        match marker {
            '?' => {
                run_svn_command_owned(
                    &cwd,
                    &["add".to_string(), "--force".to_string(), path.to_string()],
                )?;
            }
            '!' => {
                run_svn_command_owned(
                    &cwd,
                    &["delete".to_string(), "--force".to_string(), path.to_string()],
                )?;
            }
            _ => {}
        }
    }

    let pending_entries = svn_status_entries(&cwd)?;
    if pending_entries.is_empty() {
        return Ok(SvnCommandResult {
            stdout: "没有可提交的 SVN 变化".to_string(),
            stderr: String::new(),
        });
    }

    run_svn_command_owned(
        &cwd,
        &[
            "commit".to_string(),
            "-m".to_string(),
            commit_message.to_string(),
        ],
    )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            write_generated_files,
            svn_update,
            svn_commit,
            svn_commit_all
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| match event {
        RunEvent::WindowEvent {
            label,
            event: WindowEvent::CloseRequested { api, .. },
            ..
        } if label == "main" => {
            api.prevent_close();
            if let Some(window) = app_handle.get_webview_window("main") {
                let _ = window.hide();
            }
        }
        #[cfg(target_os = "macos")]
        RunEvent::Reopen {
            has_visible_windows: false,
            ..
        } => {
            if let Some(window) = app_handle.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }
        _ => {}
    });
}
