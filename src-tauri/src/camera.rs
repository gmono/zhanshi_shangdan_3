//! GB/T 28181 platform (UAS), H.264 decode and camera control.
//!
//! The Windows exhibit machine is the SIP platform; the camera registers to
//! it and streams RTP/PS after INVITE. NAL units are decoded with FFmpeg to
//! YUV420p. The decoded frames are kept in `latest` for the WebView2 shared
//! buffer writer (Windows) and exposed through a status endpoint for the
//! tablet controls.

#![cfg(not(target_os = "ios"))]

use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use axum::{extract::State, http::StatusCode, response::IntoResponse, routing::{get, post}, Json, Router};
use gb28181_rs::ps;
use gb28181_rs::sip::{parse_digest_auth, SipMessage, SipMethod, SipStatusCode};
use md5::{Digest, Md5};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, UdpSocket};
use tokio::process::Command as ProcessCommand;
use tokio::sync::{broadcast, mpsc};
use tower_http::cors::CorsLayer;

const NONCE: &str = "exhibition-nonce-0001";
static SERVICE: OnceLock<Arc<CameraService>> = OnceLock::new();
const SSRC: u32 = 0x4d3d;

#[derive(Clone, Debug, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct CameraConfig {
    pub enabled: bool,
    pub sip_bind: String,
    pub local_ip: String,
    pub platform_id: String,
    pub platform_domain: String,
    pub password: String,
    pub device_id: String,
    pub channel_id: String,
    pub width: u32,
    pub height: u32,
    pub ffmpeg: String,
    pub control_bind: String,
}

impl Default for CameraConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            sip_bind: "0.0.0.0:5060".into(),
            local_ip: "127.0.0.1".into(),
            platform_id: "34020000002000000001".into(),
            platform_domain: "3402000000".into(),
            password: "12345678".into(),
            device_id: "34020000001320000001".into(),
            channel_id: "34020000001320000001".into(),
            width: 1280,
            height: 720,
            ffmpeg: String::new(),
            control_bind: "0.0.0.0:1422".into(),
        }
    }
}

impl CameraConfig {
    fn load(root: &Path) -> Result<Option<Self>, String> {
        let path = root.join("camera.json");
        if !path.is_file() {
            return Ok(None);
        }
        let text = std::fs::read_to_string(&path).map_err(|error| format!("读取相机配置失败 {}：{error}", path.display()))?;
        let config: Self = serde_json::from_str(&text).map_err(|error| format!("相机配置不合法 {}：{error}", path.display()))?;
        if !config.enabled {
            return Ok(None);
        }
        if config.width == 0 || config.height == 0 || config.width % 2 != 0 || config.height % 2 != 0 {
            return Err("相机配置宽高必须是正偶数".into());
        }
        Ok(Some(config))
    }

    fn ffmpeg_path(&self) -> PathBuf {
        if self.ffmpeg.is_empty() { PathBuf::from("ffmpeg") } else { PathBuf::from(&self.ffmpeg) }
    }
}

#[derive(Default)]
struct CameraStatus {
    registered: bool,
    streaming: bool,
    frames: u64,
    decoded: u64,
}

pub struct CameraService {
    config: CameraConfig,
    command: mpsc::Sender<Command>,
    status: Arc<Mutex<CameraStatus>>,
    latest: Arc<Mutex<Option<Vec<u8>>>>,
}

impl CameraService {
    pub fn latest_frame(&self) -> Option<Vec<u8>> {
        self.latest.lock().ok()?.clone()
    }
    pub fn dimensions(&self) -> (u32, u32) { (self.config.width, self.config.height) }
    pub fn status(&self) -> Value {
        let status = self.status.lock().unwrap_or_else(|p| p.into_inner());
        json!({
            "registered": status.registered,
            "streaming": status.streaming,
            "frames": status.frames,
            "decoded": status.decoded,
            "width": self.config.width,
            "height": self.config.height
        })
    }
}

#[derive(Clone, Copy, Debug)]
enum Command {
    Focus { near: bool },
    Zoom { inside: bool },
}

pub fn service() -> Option<Arc<CameraService>> { SERVICE.get().cloned() }

pub async fn start(root: PathBuf) -> Result<Option<Arc<CameraService>>, String> {
    let Some(config) = CameraConfig::load(&root)? else { return Ok(None); };

    let sip = Arc::new(UdpSocket::bind(&config.sip_bind).await.map_err(|error| format!("相机 SIP 监听失败 {}：{error}", config.sip_bind))?);
    let rtp = Arc::new(UdpSocket::bind((config.local_ip.as_str(), 0)).await.map_err(|error| format!("相机 RTP 监听失败：{error}"))?);
    let listener = TcpListener::bind(&config.control_bind).await.map_err(|error| format!("相机控制端口失败 {}：{error}", config.control_bind))?;

    let status = Arc::new(Mutex::new(CameraStatus::default()));
    let latest = Arc::new(Mutex::new(None));
    let (command, command_rx) = mpsc::channel(16);
    let (nals, _) = broadcast::channel(128);
    let service = Arc::new(CameraService { config: config.clone(), command, status: status.clone(), latest: latest.clone() });

    let _ = SERVICE.set(service.clone());
    tokio::spawn(run_platform(config.clone(), sip, rtp, status.clone(), nals.clone(), command_rx));
    tokio::spawn(run_http(listener, service.clone()));
    tokio::spawn(run_decoder(config, latest, status, nals));

    println!("[camera] GB28181 平台已启动，控制端口 {}，等待摄像机注册", service.config.control_bind);
    Ok(Some(service))
}

fn md5_hex(value: &str) -> String {
    let mut hasher = Md5::new();
    hasher.update(value.as_bytes());
    hex::encode(hasher.finalize())
}

fn sip_response(req: &SipMessage, code: u32, reason: &str, extra: &[(&str, &str)], body: &str) -> String {
    let mut text = format!(
        "SIP/2.0 {code} {reason}\r\nVia: {}\r\nFrom: {}\r\nTo: {}\r\nCall-ID: {}\r\nCSeq: {}\r\n",
        req.get_header("Via").unwrap_or_default(),
        req.get_header("From").unwrap_or_default(),
        req.get_header("To").unwrap_or_default(),
        req.get_header("Call-ID").unwrap_or("camera"),
        req.get_header("CSeq").unwrap_or("1 REGISTER"),
    );
    for (name, value) in extra { text.push_str(&format!("{name}: {value}\r\n")); }
    if body.is_empty() {
        text.push_str("Content-Length: 0\r\n\r\n");
    } else {
        text.push_str(&format!("Content-Type: Application/MANSCDP+xml\r\nContent-Length: {}\r\n\r\n{body}", body.len()));
    }
    text
}

fn sip_request(config: &CameraConfig, method: &str, target: &str, call_id: &str, cseq: &str, body: &str) -> String {
    let port = config.sip_bind.rsplit(':').next().unwrap_or("5060");
    let via = format!("SIP/2.0/UDP {}:{};branch=z9hG4bK{}{}", config.local_ip, port, method, call_id);
    let mut text = format!(
        "{method} sip:{target}@{} SIP/2.0\r\nVia: {via}\r\nFrom: <sip:{}@{}>;tag=exhibition\r\nTo: <sip:{target}@{}>\r\nCall-ID: {call_id}\r\nCSeq: {cseq}\r\nContact: <sip:{}@{}:{}>\r\nMax-Forwards: 70\r\n",
        config.platform_domain, config.platform_id, config.platform_domain, config.platform_domain,
        config.platform_id, config.local_ip, port
    );
    if body.is_empty() {
        text.push_str("Content-Length: 0\r\n\r\n");
    } else {
        let content_type = if method == "INVITE" { "application/sdp" } else { "Application/MANSCDP+xml" };
        text.push_str(&format!("Content-Type: {content_type}\r\nContent-Length: {}\r\n\r\n{body}", body.len()));
    }
    text
}

fn invite_sdp(config: &CameraConfig, rtp_port: u16) -> String {
    format!(
        "v=0\r\no={} 0 0 IN IP4 {}\r\ns=Play\r\nc=IN IP4 {}\r\nt=0 0\r\nm=video {rtp_port} RTP/AVP 96\r\na=recvonly\r\ny={SSRC:010}\r\n",
        config.platform_id, config.local_ip, config.local_ip
    )
}

fn xml_field(xml: &str, tag: &str) -> String {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let start = xml.find(&open).map_or(0, |position| position + open.len());
    let end = xml[start..].find(&close).map_or(start, |offset| start + offset);
    xml[start..end].to_string()
}

fn catalog_channels(body: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut rest = body;
    while let Some(position) = rest.find("<Item>") {
        rest = &rest[position + "<Item>".len()..];
        let end = rest.find("</Item>").unwrap_or(rest.len());
        let item = &rest[..end];
        out.push((xml_field(item, "DeviceID"), xml_field(item, "Status")));
    }
    out
}

fn ptz_hex(code: u8, pan: u8, tilt: u8, zoom: u8) -> String {
    let mut bytes = [0xA5, 0x0F, 0x01, code, pan, tilt, zoom, 0];
    bytes[7] = bytes[..7].iter().fold(0u8, |sum, byte| sum.wrapping_add(*byte));
    hex::encode(bytes)
}

fn ptz_command(command: Command) -> String {
    match command {
        Command::Focus { near: true } => ptz_hex(0x40 | 0x02, 0x40, 0, 0),
        Command::Focus { near: false } => ptz_hex(0x40 | 0x01, 0x40, 0, 0),
        Command::Zoom { inside: true } => ptz_hex(0x10, 0, 0, 0x20),
        Command::Zoom { inside: false } => ptz_hex(0x20, 0, 0, 0x20),
    }
}

fn control_xml(channel: &str, sn: u64, ptz: &str) -> String {
    format!("<?xml version=\"1.0\" encoding=\"GB2312\"?>\r\n<Control><CmdType>DeviceControl</CmdType><SN>{sn}</SN><DeviceID>{channel}</DeviceID><PTZCmd>{ptz}</PTZCmd></Control>")
}

async fn send_ptz(config: &CameraConfig, sip: &UdpSocket, device: SocketAddr, channel: &str, command: Command, sn: u64) {
    let call_id = format!("ptz{sn:08}");
    let body = control_xml(channel, sn, &ptz_command(command));
    let request = sip_request(config, "MESSAGE", channel, &call_id, "1 MESSAGE", &body);
    let _ = sip.send_to(request.as_bytes(), device).await;
}

async fn run_platform(config: CameraConfig, sip: Arc<UdpSocket>, rtp: Arc<UdpSocket>, status: Arc<Mutex<CameraStatus>>, nals: broadcast::Sender<Vec<u8>>, mut commands: mpsc::Receiver<Command>) {
    let mut sip_buf = vec![0u8; 65535];
    let mut rtp_buf = vec![0u8; 65535];
    let mut ps_reassembly = Vec::new();
    let mut device: Option<SocketAddr> = None;
    let mut invite_sent = false;
    let mut streaming = false;
    let mut invite_call = String::new();
    let mut sn = 0u64;

    loop {
        let rtp_enabled = streaming;
        tokio::select! {
            received = sip.recv_from(&mut sip_buf) => {
                let Ok((length, peer)) = received else { continue; };
                let Ok(text) = std::str::from_utf8(&sip_buf[..length]) else { continue; };
                let Ok(message) = SipMessage::parse(text) else { continue; };

                if message.method == Some(SipMethod::Register) {
                    if let Some(auth) = message.get_header("Authorization") {
                        let Ok(params) = parse_digest_auth(auth) else { continue; };
                        let ha1 = md5_hex(&format!("{}:{}:{}", config.device_id, config.platform_domain, config.password));
                        let ha2 = md5_hex(&format!("REGISTER:{}", params.uri));
                        let expected = md5_hex(&format!("{ha1}:{}:{ha2}", params.nonce));
                        if params.response != expected {
                            let response = sip_response(&message, 403, "Forbidden", &[], "");
                            let _ = sip.send_to(response.as_bytes(), peer).await;
                            continue;
                        }
                        device = Some(peer);
                        { let mut current = status.lock().unwrap_or_else(|p| p.into_inner()); current.registered = true; }
                        let response = sip_response(&message, 200, "OK", &[], "");
                        let _ = sip.send_to(response.as_bytes(), peer).await;
                        if !invite_sent {
                            let query = format!("<?xml version=\"1.0\" encoding=\"GB2312\"?>\r\n<Query><CmdType>Catalog</CmdType><SN>1</SN><DeviceID>{}</DeviceID></Query>", config.device_id);
                            let request = sip_request(&config, "MESSAGE", &config.device_id, "catalog0001", "1 MESSAGE", &query);
                            let _ = sip.send_to(request.as_bytes(), peer).await;
                            println!("[camera] 摄像机已注册 {}，查询目录", peer);
                        }
                    } else {
                        let challenge = format!("Digest realm=\"{}\", nonce=\"{NONCE}\", algorithm=MD5", config.platform_domain);
                        let response = sip_response(&message, 401, "Unauthorized", &[("WWW-Authenticate", &challenge)], "");
                        let _ = sip.send_to(response.as_bytes(), peer).await;
                    }
                } else if message.method == Some(SipMethod::Message) {
                    let response = sip_response(&message, 200, "OK", &[], "");
                    let _ = sip.send_to(response.as_bytes(), peer).await;
                    if message.body.contains("<Response CmdType=\"Catalog\"") || message.body.contains("<Response CmdType='Catalog'") {
                        let channels = catalog_channels(&message.body);
                        let target = channels.iter().find(|(_, state)| state == "ON").map(|(id, _)| id.clone())
                            .unwrap_or_else(|| config.channel_id.clone());
                        if !invite_sent {
                            invite_sent = true;
                            invite_call = format!("camera{}", std::process::id());
                            let sdp = invite_sdp(&config, rtp.local_addr().map(|addr| addr.port()).unwrap_or(0));
                            let request = sip_request(&config, "INVITE", &target, &invite_call, "1 INVITE", &sdp);
                            if let Some(peer) = device { let _ = sip.send_to(request.as_bytes(), peer).await; }
                            println!("[camera] 目录返回 {} 个通道，邀请 {}", channels.len(), target);
                        }
                    }
                } else if message.method.is_none() && message.status_code == Some(SipStatusCode::Ok) {
                    let cseq = message.get_header("CSeq").unwrap_or_default();
                    if cseq.contains("INVITE") && !streaming {
                        streaming = true;
                        { let mut current = status.lock().unwrap_or_else(|p| p.into_inner()); current.streaming = true; }
                        let ack = sip_request(&config, "ACK", &config.channel_id, &invite_call, "1 ACK", "");
                        if let Some(peer) = device { let _ = sip.send_to(ack.as_bytes(), peer).await; }
                        println!("[camera] INVITE 成功，开始接收 GB28181 视频");
                    }
                } else if message.method == Some(SipMethod::Bye) {
                    let response = sip_response(&message, 200, "OK", &[], "");
                    let _ = sip.send_to(response.as_bytes(), peer).await;
                    streaming = false;
                    invite_sent = false;
                    { let mut current = status.lock().unwrap_or_else(|p| p.into_inner()); current.streaming = false; }
                }
            }
            received = rtp.recv_from(&mut rtp_buf), if rtp_enabled => {
                let Ok((length, _)) = received else { continue; };
                let packet = &rtp_buf[..length];
                if packet.len() < 12 || packet[0] >> 6 != 2 || packet[1] & 0x7F != 96 {
                    continue;
                }
                let ssrc = u32::from_be_bytes([packet[8], packet[9], packet[10], packet[11]]);
                if ssrc != SSRC { continue; }
                let marker = packet[1] & 0x80 != 0;
                ps_reassembly.extend_from_slice(&packet[12..]);
                if marker {
                    if let Ok(nalus) = ps::parse_ps_to_nal_units(&ps_reassembly) {
                        for nalu in nalus { let _ = nals.send(nalu); }
                        let mut current = status.lock().unwrap_or_else(|p| p.into_inner());
                        current.frames = current.frames.saturating_add(1);
                    }
                    ps_reassembly.clear();
                }
            }
            command = commands.recv() => {
                let Some(command) = command else { break; };
                if let Some(peer) = device {
                    sn = sn.wrapping_add(1);
                    send_ptz(&config, &sip, peer, &config.channel_id, command, sn).await;
                }
            }
        }
    }
}

async fn run_http(listener: TcpListener, service: Arc<CameraService>) {
    let app = Router::new()
        .route("/camera/status", get(status))
        .route("/camera/frame", get(frame))
        .route("/camera/focus", post(focus))
        .route("/camera/zoom", post(zoom))
        .with_state(service)
        .layer(CorsLayer::permissive());
    if let Err(error) = axum::serve(listener, app).await {
        eprintln!("[camera] 控制服务退出：{error}");
    }
}

async fn status(State(service): State<Arc<CameraService>>) -> impl IntoResponse {
    Json(service.status())
}

async fn frame(State(service): State<Arc<CameraService>>) -> impl IntoResponse {
    match service.latest_frame() {
        Some(frame) => (StatusCode::OK, [("Content-Type", "application/octet-stream"), ("Cache-Control", "no-store")], frame).into_response(),
        None => (StatusCode::NOT_FOUND, "没有解码帧").into_response(),
    }
}

async fn focus(State(service): State<Arc<CameraService>>, Json(body): Json<Value>) -> impl IntoResponse {
    let action = body.get("action").and_then(Value::as_str).unwrap_or("");
    if action != "near" && action != "far" {
        return (StatusCode::BAD_REQUEST, Json(json!({"message":"action 必须是 near 或 far"})));
    }
    if !service.status.lock().unwrap_or_else(|p| p.into_inner()).registered {
        return (StatusCode::SERVICE_UNAVAILABLE, Json(json!({"message":"摄像机尚未注册"})));
    }
    let command = Command::Focus { near: action == "near" };
    if service.command.send(command).await.is_err() {
        return (StatusCode::SERVICE_UNAVAILABLE, Json(json!({"message":"相机控制通道已关闭"})));
    }
    (StatusCode::OK, Json(json!({"ok":true})))
}

async fn zoom(State(service): State<Arc<CameraService>>, Json(body): Json<Value>) -> impl IntoResponse {
    let action = body.get("action").and_then(Value::as_str).unwrap_or("");
    if action != "in" && action != "out" {
        return (StatusCode::BAD_REQUEST, Json(json!({"message":"action 必须是 in 或 out"})));
    }
    if !service.status.lock().unwrap_or_else(|p| p.into_inner()).registered {
        return (StatusCode::SERVICE_UNAVAILABLE, Json(json!({"message":"摄像机尚未注册"})));
    }
    if service.command.send(Command::Zoom { inside: action == "in" }).await.is_err() {
        return (StatusCode::SERVICE_UNAVAILABLE, Json(json!({"message":"相机控制通道已关闭"})));
    }
    (StatusCode::OK, Json(json!({"ok":true})))
}

async fn run_decoder(config: CameraConfig, latest: Arc<Mutex<Option<Vec<u8>>>>, status: Arc<Mutex<CameraStatus>>, nals: broadcast::Sender<Vec<u8>>) {
    let frame_len = (config.width * config.height * 3 / 2) as usize;
    loop {
        let mut child = match ProcessCommand::new(config.ffmpeg_path())
            .args(["-hide_banner", "-loglevel", "error", "-f", "h264", "-i", "pipe:0", "-pix_fmt", "yuv420p", "-f", "rawvideo", "pipe:1"])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .spawn()
        {
            Ok(child) => child,
            Err(error) => {
                eprintln!("[camera] 无法启动 FFmpeg 解码：{error}");
                tokio::time::sleep(Duration::from_secs(3)).await;
                continue;
            }
        };
        let mut stdin = child.stdin.take();
        let mut stdout = child.stdout.take();
        let mut reader = nals.subscribe();
        let writer = tokio::spawn(async move {
            loop {
                match reader.recv().await {
                    Ok(nalu) => {
                        if let Some(input) = stdin.as_mut() {
                            if input.write_all(&[0, 0, 0, 1]).await.is_err() || input.write_all(&nalu).await.is_err() { break; }
                            let _ = input.flush().await;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(_) => break,
                }
            }
        });
        let frame_sink = latest.clone();
        let frame_status = status.clone();
        let reading = tokio::spawn(async move {
            if let Some(output) = stdout.as_mut() {
                let mut frame = vec![0u8; frame_len];
                loop {
                    if output.read_exact(&mut frame).await.is_err() { break; }
                    if let Ok(mut slot) = frame_sink.lock() { *slot = Some(frame.clone()); }
                    if let Ok(mut current) = frame_status.lock() { current.decoded = current.decoded.saturating_add(1); }
                }
            }
        });
        let _ = child.wait().await;
        writer.abort();
        reading.abort();
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
}
