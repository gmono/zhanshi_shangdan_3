#[cfg(target_os = "windows")]
mod native {
    use std::{
        io, ptr,
        sync::{
            atomic::{AtomicBool, Ordering},
            mpsc,
        },
    };
    use windows_sys::Win32::{
        Foundation::{LPARAM, LRESULT, WPARAM},
        System::LibraryLoader::GetModuleHandleW,
        UI::{
            Input::KeyboardAndMouse::{
                GetAsyncKeyState, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT,
            },
            WindowsAndMessaging::{
                CallNextHookEx, DispatchMessageW, GetMessageW, PostQuitMessage, SetWindowsHookExW,
                TranslateMessage, UnhookWindowsHookEx, HC_ACTION, KBDLLHOOKSTRUCT, MSG,
                WH_KEYBOARD_LL, WM_KEYDOWN, WM_SYSKEYDOWN,
            },
        },
    };

    static EXIT_REQUESTED: AtomicBool = AtomicBool::new(false);

    unsafe extern "system" fn keyboard_hook(code: i32, event: WPARAM, data: LPARAM) -> LRESULT {
        if code == HC_ACTION as i32 && matches!(event as u32, WM_KEYDOWN | WM_SYSKEYDOWN) {
            let key = &*(data as *const KBDLLHOOKSTRUCT);
            let down = |key| GetAsyncKeyState(key) < 0;
            if key.vkCode == 0x51
                && crate::exit_chord::is_exit_chord(
                    key.vkCode,
                    true,
                    down(VK_CONTROL as i32),
                    down(VK_LWIN as i32) || down(VK_RWIN as i32),
                    down(VK_MENU as i32),
                    down(VK_SHIFT as i32),
                )
            {
                EXIT_REQUESTED.store(true, Ordering::Relaxed);
                PostQuitMessage(0);
                return 1;
            }
        }
        CallNextHookEx(ptr::null_mut(), code, event, data)
    }

    pub fn install(app: tauri::AppHandle) -> io::Result<()> {
        let (ready_tx, ready_rx) = mpsc::channel();
        std::thread::Builder::new()
            .name("windows-exit-shortcut".into())
            .spawn(move || unsafe {
                // 原生键盘钩子只处理指定组合键，不依赖 WebView 焦点，也不记录键盘内容。
                let hook = SetWindowsHookExW(
                    WH_KEYBOARD_LL,
                    Some(keyboard_hook),
                    GetModuleHandleW(ptr::null()),
                    0,
                );
                if hook.is_null() {
                    let _ = ready_tx.send(Err(io::Error::last_os_error()));
                    return;
                }
                if ready_tx.send(Ok(())).is_err() {
                    UnhookWindowsHookEx(hook);
                    return;
                }
                let mut message: MSG = std::mem::zeroed();
                while GetMessageW(&mut message, ptr::null_mut(), 0, 0) > 0 {
                    TranslateMessage(&message);
                    DispatchMessageW(&message);
                }
                UnhookWindowsHookEx(hook);
                if EXIT_REQUESTED.swap(false, Ordering::Relaxed) {
                    app.exit(0);
                }
            })?;
        ready_rx.recv().map_err(io::Error::other)?
    }
}

#[cfg(target_os = "windows")]
pub use native::install;
