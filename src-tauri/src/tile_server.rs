use std::{path::{Path, PathBuf}, sync::Arc};
use tokio::{io::{AsyncReadExt, AsyncWriteExt}, net::TcpListener};
use tauri::Manager;

const PORT: u16 = 1421;

pub fn spawn(app: tauri::AppHandle) {
    tokio::spawn(async move {
        let root = app.path().resource_dir().ok().map(|p| p.join("zoomify"));
        let root = root.filter(|p| p.is_dir()).or_else(|| Some(PathBuf::from("public/zoomify")));
        let Some(root) = root else { return };
        let Ok(listener) = TcpListener::bind(("0.0.0.0", PORT)).await else { return };
        loop { let Ok((mut stream, _)) = listener.accept().await else { break; }; let root = root.clone(); tokio::spawn(async move { let _ = serve(&mut stream, &root).await; }); }
    });
}

async fn serve(stream: &mut tokio::net::TcpStream, root: &Path) -> Result<(), String> {
    let mut data = [0u8; 4096]; let size = stream.read(&mut data).await.map_err(|e|e.to_string())?;
    let request = String::from_utf8_lossy(&data[..size]); let path = request.lines().next().and_then(|line| line.strip_prefix("GET ")).and_then(|line| line.split_whitespace().next()).unwrap_or("/");
    let decoded = path.trim_start_matches('/').split('/').filter(|part| !part.is_empty() && *part != "." && *part != "..").collect::<Vec<_>>().join("/");
    let file = root.join(decoded); let body = tokio::fs::read(&file).await.map_err(|e|e.to_string());
    let (status, content_type, bytes) = match body { Ok(bytes) => ("200 OK", mime(&file), bytes), Err(_) => ("404 Not Found", "text/plain; charset=utf-8", b"not found".to_vec()) };
    let header = format!("HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n", bytes.len());
    stream.write_all(header.as_bytes()).await.map_err(|e|e.to_string())?; stream.write_all(&bytes).await.map_err(|e|e.to_string())?; Ok(())
}
fn mime(path: &Path) -> &'static str { match path.extension().and_then(|v|v.to_str()) { Some("jpg")|Some("jpeg") => "image/jpeg", Some("png") => "image/png", Some("xml") => "application/xml", Some("json") => "application/json", _ => "application/octet-stream" } }
