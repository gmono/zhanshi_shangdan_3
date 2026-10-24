mod relay;
#[cfg(not(target_os="ios"))]
mod tile_server;
#[cfg(not(target_os="ios"))]
mod map_assets;
#[cfg(any(target_os = "windows", test))]
mod exit_chord;
#[cfg(target_os = "windows")]
mod windows_shortcut;
use std::sync::Arc;
use tauri::Manager;
use tauri::State;

#[cfg(not(target_os="ios"))]
fn start_tile_server(app:tauri::AppHandle) -> Result<(),String> {
    let exe=std::env::current_exe().map_err(|e|e.to_string())?;
    let root=map_assets::resource_root(&exe,std::env::var_os("EXHIBITION_RESOURCE_DIR").as_deref())?;
    let vips=if let Some(path)=std::env::var_os("EXHIBITION_VIPS") {std::path::PathBuf::from(path)}
        else {app.path().resource_dir().map_err(|e|e.to_string())?.join("tools/vips/bin/vips.exe")};
    let cache=root.join(".cache");
    tauri::async_runtime::spawn(async move {
        if let Err(error)=tile_server::run(root,cache,vips,&format!("0.0.0.0:{}",tile_server::PORT)).await {eprintln!("{error}");}
    });
    Ok(())
}

#[cfg(target_os = "windows")]
fn set_windows_topmost(window: &tauri::WebviewWindow, enabled: bool) -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, HWND_NOTOPMOST, HWND_TOPMOST, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW,
    };

    let hwnd = window.hwnd().map_err(|error| error.to_string())?;
    window.set_always_on_top(enabled).map_err(|error| error.to_string())?;
    let insert_after = if enabled { HWND_TOPMOST } else { HWND_NOTOPMOST };
    let result = unsafe {
        SetWindowPos(
            hwnd.0 as _,
            insert_after,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW,
        )
    };
    if result == 0 {
        return Err("Windows 未能调整展示窗口的置顶层级".into());
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn set_windows_topmost(_window: &tauri::WebviewWindow, _enabled: bool) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
async fn start_sync_relay(port: Option<u16>, relay: State<'_, Arc<relay::RelayHandle>>) -> Result<String, String> {
    relay::start(relay.inner().clone(), port.unwrap_or(8787)).await
}
#[tauri::command]
async fn stop_sync_relay(relay: State<'_, Arc<relay::RelayHandle>>) -> Result<(), String> { relay::stop(relay.inner().clone()).await; Ok(()) }

#[tauri::command]
async fn discover_displays() -> Result<Vec<serde_json::Value>, String> { relay::discover_displays().await }

#[tauri::command]
fn set_display_fullscreen(enabled: bool, window: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(not(target_os = "ios"))]
    {
        if enabled {
            window.set_fullscreen(true).map_err(|error| error.to_string())?;
            set_windows_topmost(&window, true)?;
        } else {
            window.set_fullscreen(false).map_err(|error| error.to_string())?;
            set_windows_topmost(&window, false)?;
        }
    }

    #[cfg(target_os = "ios")]
    let _ = (enabled, window);

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Arc::new(relay::RelayHandle::default()))
        .plugin(tauri_plugin_os::init())
        .setup(|_app| {
            #[cfg(not(target_os="ios"))]
            {
                start_tile_server(_app.handle().clone()).map_err(std::io::Error::other)?;
                let relay=_app.state::<Arc<relay::RelayHandle>>().inner().clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(error)=relay::start(relay,8787).await {eprintln!("{error}");return;}
                    relay::spawn_discovery_listener();
                });
            }
            #[cfg(target_os = "windows")]
            {
                windows_shortcut::install(_app.handle().clone())?;
                let window = _app.get_webview_window("main").expect("main window is configured");
                window.set_fullscreen(true)?;
                set_windows_topmost(&window, true).map_err(std::io::Error::other)?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![start_sync_relay, stop_sync_relay, discover_displays, set_display_fullscreen])
        .run(tauri::generate_context!())
        .expect("展厅地图启动失败");
}
