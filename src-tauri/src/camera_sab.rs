//! Windows-only WebView2 shared-buffer bridge.
//!
//! The Rust decoder writes YUV420p frames into a WebView2 shared buffer;
//! the page receives it through `sharedbufferreceived` and renders it with
//! WebGL. No JSON/base64 frame copies cross the IPC boundary.

#![cfg(target_os = "windows")]

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tauri::WebviewWindow;
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2Environment12, ICoreWebView2_17, COREWEBVIEW2_SHARED_BUFFER_ACCESS_READ_ONLY,
};
use windows_core::{Interface, PCWSTR};

use crate::camera::CameraService;

const HEADER_BYTES: usize = 64;
const MAGIC: u32 = 0x5341_4231; // "SAB1"
static GENERATION: AtomicU64 = AtomicU64::new(0);

pub async fn attach(window: &WebviewWindow) -> Result<Value, String> {
    let service = crate::camera::service().ok_or_else(|| "相机服务未启动".to_string())?;
    let (width, height) = service.dimensions();
    let width = width as usize;
    let height = height as usize;
    let slot_bytes = width * height * 3 / 2;
    let total = HEADER_BYTES + slot_bytes * 2;
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;

    let (sent, received) = tokio::sync::oneshot::channel::<Result<usize, String>>();
    window
        .with_webview(move |webview| {
            let result = (|| -> Result<usize, String> {
                let environment = webview.environment();
                let environment: ICoreWebView2Environment12 = environment.cast().map_err(|error| format!("WebView2 版本不支持共享缓冲区：{error}"))?;
                let buffer = unsafe { environment.CreateSharedBuffer(total as u64) }.map_err(|error| error.to_string())?;
                let mut pointer: *mut u8 = std::ptr::null_mut();
                unsafe { buffer.Buffer(&mut pointer) }.map_err(|error| error.to_string())?;
                if pointer.is_null() {
                    return Err("WebView2 共享缓冲区指针为空".into());
                }
                let controller = webview.controller();
                let core = unsafe { controller.CoreWebView2() }.map_err(|error| error.to_string())?;
                let core: ICoreWebView2_17 = core.cast().map_err(|error| format!("WebView2 版本不支持共享缓冲区：{error}"))?;
                let meta = json!({
                    "width": width,
                    "height": height,
                    "headerBytes": HEADER_BYTES,
                    "slotBytes": slot_bytes,
                }).to_string();
                let wide: Vec<u16> = meta.encode_utf16().chain(std::iter::once(0)).collect();
                unsafe {
                    core.PostSharedBufferToScript(&buffer, COREWEBVIEW2_SHARED_BUFFER_ACCESS_READ_ONLY, PCWSTR(wide.as_ptr()))
                }.map_err(|error| error.to_string())?;
                // The page holds the buffer; keep the COM object alive for the
                // lifetime of this attachment instead of closing it.
                std::mem::forget(buffer);
                Ok(pointer as usize)
            })();
            let _ = sent.send(result);
        })
        .map_err(|error| error.to_string())?;

    let pointer = tokio::time::timeout(Duration::from_secs(5), received)
        .await
        .map_err(|_| "等待 WebView2 共享缓冲区超时".to_string())?
        .map_err(|_| "WebView2 共享缓冲区通道关闭".to_string())??;

    tokio::spawn(writer(service, pointer, width, height, slot_bytes, generation));
    Ok(json!({
        "width": width,
        "height": height,
        "headerBytes": HEADER_BYTES,
        "slotBytes": slot_bytes,
    }))
}

async fn writer(service: Arc<CameraService>, pointer: usize, width: usize, height: usize, slot_bytes: usize, generation: u64) {
    let mut sequence = 0u32;
    let started = Instant::now();
    loop {
        if GENERATION.load(Ordering::Relaxed) != generation {
            break;
        }
        let frame = service.latest_frame();
        let (source, data) = match frame {
            Some(frame) if frame.len() == slot_bytes => (1u32, frame),
            _ => (0u32, test_pattern(width, height, slot_bytes, started.elapsed())),
        };
        let active = (sequence & 1) as usize;
        // Keep the raw pointer inside a synchronous helper so the writer
        // future only carries Send data across the 40ms await.
        unsafe { write_frame(pointer, width, height, slot_bytes, active, source, sequence, &data); }
        sequence = sequence.wrapping_add(1);
        tokio::time::sleep(Duration::from_millis(40)).await;
    }
}

#[allow(clippy::too_many_arguments)]
unsafe fn write_frame(pointer: usize, width: usize, height: usize, slot_bytes: usize, active: usize, source: u32, sequence: u32, data: &[u8]) {
    let pointer = pointer as *mut u8;
    let target = pointer.add(HEADER_BYTES + active * slot_bytes);
    std::ptr::copy_nonoverlapping(data.as_ptr(), target, slot_bytes);
    write_u32(pointer, 0, MAGIC);
    write_u32(pointer, 4, 1);
    write_u32(pointer, 8, width as u32);
    write_u32(pointer, 12, height as u32);
    write_u32(pointer, 20, active as u32);
    write_u32(pointer, 24, slot_bytes as u32);
    write_u32(pointer, 28, source);
    write_u32(pointer, 32, HEADER_BYTES as u32);
    // Publish the sequence last; the page reads it before the slot.
    std::ptr::write_volatile(pointer.add(16) as *mut u32, sequence);
}

fn write_u32(pointer: *mut u8, offset: usize, value: u32) {
    unsafe { std::ptr::write_unaligned(pointer.add(offset) as *mut u32, value) }
}

/// A moving color-bar pattern used until the GB28181 camera sends frames.
fn test_pattern(width: usize, height: usize, slot_bytes: usize, elapsed: Duration) -> Vec<u8> {
    let mut frame = vec![0u8; slot_bytes];
    let luma_len = width * height;
    let chroma_len = luma_len / 4;
    let (luma, rest) = frame.split_at_mut(luma_len);
    let (u, v) = rest.split_at_mut(chroma_len);
    for row in 0..height {
        for col in 0..width {
            let bar = (col * 8 / width.max(1)) as u8;
            luma[row * width + col] = bar.saturating_mul(28).saturating_add(16);
        }
    }
    u.fill(128);
    v.fill(128);
    let line = (elapsed.as_millis() / 16) as usize % width.max(1);
    for row in 0..height {
        for col in line..(line + 4).min(width) {
            luma[row * width + col] = 235;
        }
    }
    frame
}
