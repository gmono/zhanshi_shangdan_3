use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::{collections::HashMap, sync::Arc};
use tokio::{net::{TcpListener, TcpStream, UdpSocket}, sync::{mpsc, Mutex}, task::JoinHandle, time::{timeout_at, Duration, Instant}};
use tokio_tungstenite::{accept_async, tungstenite::Message};

type Tx = mpsc::UnboundedSender<Message>;
#[derive(Default)] struct Room { state: Option<Value>, controller: Option<u64>, peers: HashMap<u64, (String, Tx)> }
#[derive(Default)] struct Relay { rooms: HashMap<String, Room>, next_id: u64 }
#[derive(Default)] pub struct RelayHandle { task: Mutex<Option<JoinHandle<()>>> }

pub async fn start(handle: Arc<RelayHandle>, port: u16) -> Result<String, String> {
    let mut current = handle.task.lock().await;
    if current.is_some() { return Ok(format!("ws://0.0.0.0:{port}")); }
    let listener = TcpListener::bind(("0.0.0.0", port)).await.map_err(|e| format!("同步服务启动失败: {e}"))?;
    let shared = Arc::new(Mutex::new(Relay::default()));
    let task = tokio::spawn(accept_loop(listener, shared));
    *current = Some(task);
    Ok(format!("ws://0.0.0.0:{port}"))
}
pub async fn stop(handle: Arc<RelayHandle>) { if let Some(task) = handle.task.lock().await.take() { task.abort(); } }

const DISCOVERY_PORT: u16 = 8789;

pub fn spawn_discovery_listener() {
    tokio::spawn(async {
        let socket = match UdpSocket::bind(("0.0.0.0", DISCOVERY_PORT)).await { Ok(s) => s, Err(_) => return };
        let mut buffer = [0u8; 512];
        while let Ok((size, peer)) = socket.recv_from(&mut buffer).await {
            if std::str::from_utf8(&buffer[..size]).ok() != Some("exhibition-discover-v1") { continue; }
            let Some(ip)=local_ip_for(&peer).await else {continue};
            let response = serde_json::json!({"service":"exhibition-display-v1","name":"展厅App","ip":ip});
            let _ = socket.send_to(response.to_string().as_bytes(), peer).await;
        }
    });
}

async fn local_ip_for(peer: &std::net::SocketAddr) -> Option<String> {
    let probe = UdpSocket::bind("0.0.0.0:0").await.ok()?;
    probe.connect(peer).await.ok()?;
    Some(probe.local_addr().ok()?.ip().to_string())
}

pub async fn discover_displays() -> Result<Vec<serde_json::Value>, String> {
    let socket = UdpSocket::bind("0.0.0.0:0").await.map_err(|e| format!("局域网搜索失败: {e}"))?;
    socket.set_broadcast(true).map_err(|e| format!("局域网搜索失败: {e}"))?;
    socket.send_to(b"exhibition-discover-v1", ("255.255.255.255", DISCOVERY_PORT)).await.map_err(|e| format!("局域网搜索失败: {e}"))?;
    let mut results = Vec::new(); let mut buffer = [0u8; 512];
    let deadline=Instant::now()+Duration::from_secs(3);
    loop {
        match timeout_at(deadline, socket.recv_from(&mut buffer)).await {
            Ok(Ok((size, peer))) => if let Ok(mut value) = serde_json::from_slice::<serde_json::Value>(&buffer[..size]) {
                if value.get("service").and_then(Value::as_str)!=Some("exhibition-display-v1") || !peer.is_ipv4() {continue;}
                value["ip"]=json!(peer.ip().to_string());
                if !results.iter().any(|v: &Value| v["ip"]==value["ip"]) && results.len()<32 {results.push(value);}
            },
            _ => break,
        }
    }
    Ok(results)
}

async fn accept_loop(listener: TcpListener, relay: Arc<Mutex<Relay>>) {
    while let Ok((stream, _)) = listener.accept().await {
        let state = relay.clone(); tokio::spawn(async move { let _ = handle_client(stream, state).await; });
    }
}
async fn handle_client(stream: TcpStream, relay: Arc<Mutex<Relay>>) -> Result<(), String> {
    let request = stream; let mut ws = accept_async(request).await.map_err(|e| e.to_string())?;
    // tungstenite exposes the request URI only through the handshake callback; clients send role/room as first message.
    let first = ws.next().await.ok_or("缺少连接参数")?.map_err(|e| e.to_string())?;
    let text = first.into_text().map_err(|_| "连接参数格式错误")?;
    let hello: Value = serde_json::from_str(&text).map_err(|_| "连接参数格式错误")?;
    let role = hello.get("role").and_then(Value::as_str).unwrap_or("").to_string();
    let room_id = hello.get("room").and_then(Value::as_str).unwrap_or("").to_string();
    if !["controller", "display"].contains(&role.as_str()) || room_id.len() < 8 || room_id.len() > 96 { return Err("无效的房间或角色".into()); }
    let (mut sink, mut stream) = ws.split(); let (tx, mut rx) = mpsc::unbounded_channel();
    let id = {
        let mut all = relay.lock().await;
        all.next_id += 1;
        let id = all.next_id;
        let room = all.rooms.entry(room_id.clone()).or_default();
        if role == "controller" && room.controller.is_some() {
            let _ = sink.send(Message::Close(Some(tokio_tungstenite::tungstenite::protocol::CloseFrame {
                code: 1008.into(), reason: "房间已有控制端".into(),
            }))).await;
            return Err("房间已有控制端".into());
        }
        room.peers.insert(id, (role.clone(), tx.clone()));
        if role == "controller" { room.controller = Some(id); }
        let _ = tx.send(Message::Text(json!({"type":"snapshot","state":room.state,"revision":0}).to_string().into()));
        let presence = Message::Text(json!({
            "type": "presence",
            "controller": room.controller.is_some(),
            "displays": room.peers.values().filter(|(peer_role, _)| peer_role == "display").count(),
        }).to_string().into());
        for (_, peer) in room.peers.values() { let _ = peer.send(presence.clone()); }
        id
    };
    let writer = tokio::spawn(async move { while let Some(message) = rx.recv().await { if sink.send(message).await.is_err() { break; } } });
    while let Some(incoming) = stream.next().await {
        let Ok(message) = incoming else {break}; if message.is_close() {break;} if !message.is_text() { continue; }
        let value: Value = serde_json::from_str(message.to_text().unwrap_or("{}")).unwrap_or_default();
        let is_active_controller = relay.lock().await.rooms.get(&room_id).is_some_and(|room| room.controller == Some(id));
        if role != "controller" || !is_active_controller { let _ = tx.send(Message::Text(json!({"type":"error","message":"展示端只读"}).to_string().into())); continue; }
        if value.get("type").and_then(Value::as_str) != Some("state") { continue; }
        let state = value.get("state").cloned().unwrap_or_default(); if !state.is_object() { continue; }
        let all = relay.lock().await; if let Some(room) = all.rooms.get(&room_id) { let payload = Message::Text(json!({"type":"snapshot","state":state,"revision":1}).to_string().into()); for (_, peer) in room.peers.values() { let _ = peer.send(payload.clone()); } }
        drop(all); let mut all = relay.lock().await; if let Some(room) = all.rooms.get_mut(&room_id) { room.state = Some(state); }
    }
    writer.abort();
    let mut all = relay.lock().await;
    if let Some(room) = all.rooms.get_mut(&room_id) {
        room.peers.remove(&id);
        if room.controller == Some(id) { room.controller = None; }
        if room.peers.is_empty() { all.rooms.remove(&room_id); }
        else if let Some(room) = all.rooms.get(&room_id) {
            let presence = Message::Text(json!({
                "type": "presence",
                "controller": room.controller.is_some(),
                "displays": room.peers.values().filter(|(peer_role, _)| peer_role == "display").count(),
            }).to_string().into());
            for (_, peer) in room.peers.values() { let _ = peer.send(presence.clone()); }
        }
    }
    Ok(())
}
