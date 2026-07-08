// 防止 Windows 上出现额外的控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    novamsg_lib::run()
}
