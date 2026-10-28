use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::{collections::HashMap, sync::{Arc, atomic::{AtomicU64, Ordering}}};
use tokio::{net::{TcpListener, TcpStream, UdpSocket}, sync::{mpsc, oneshot, Mutex}, task::JoinHandle, time::{interval, timeout_at, Duration, Instant, MissedTickBehavior}};
use tokio_tungstenite::{accept_async, tungstenite::Message};

type Tx = mpsc::UnboundedSender<Message>;
#[cfg(not(test))]
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(5);
#[cfg(test)]
const HEARTBEAT_INTERVAL: Duration = Duration::from_millis(25);
#[cfg(not(test))]
const HEARTBEAT_TIMEOUT: Duration = Duration::from_secs(15);
#[cfg(test)]
const HEARTBEAT_TIMEOUT: Duration = Duration::from_millis(75);
#[derive(Default)] struct Room { state: Option<Value>, revision: u64, controller: Option<u64>, peers: HashMap<u64, (String, Tx)> }
#[derive(Default)] struct Relay { rooms: HashMap<String, Room>, next_id: u64 }
#[derive(Default)] pub struct RelayHandle { task: Mutex<Option<JoinHandle<()>>> }

// 所有调用都在 relay 锁内完成，编号与入发送队列顺序一致。
fn sync_message(mut value: Value) -> Message {
    static NEXT_MESSAGE_ID: AtomicU64 = AtomicU64::new(1);
    value["id"] = json!(NEXT_MESSAGE_ID.fetch_add(1, Ordering::Relaxed));
    Message::Text(value.to_string().into())
}

pub async fn start(handle: Arc<RelayHandle>, port: u16) -> Result<String, String> {
    start_on(handle,([0,0,0,0],port).into()).await
}

pub async fn start_on(handle:Arc<RelayHandle>, address:std::net::SocketAddr) -> Result<String,String> {
    let port=address.port();
    let mut current = handle.task.lock().await;
    if current.is_some() { return Ok(format!("ws://0.0.0.0:{port}")); }
    let listener = TcpListener::bind(address).await.map_err(|e| format!("同步服务启动失败: {e}"))?;
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
        let _ = tx.send(sync_message(json!({"type":"snapshot","state":room.state,"revision":room.revision})));
        let presence = sync_message(json!({
            "type": "presence",
            "controller": room.controller.is_some(),
            "displays": room.peers.values().filter(|(peer_role, _)| peer_role == "display").count(),
        }));
        for (_, peer) in room.peers.values() { let _ = peer.send(presence.clone()); }
        id
    };
    let (pong_tx, mut pong_rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let (writer_stopped, mut writer_stopped_rx) = oneshot::channel();
    let writer = tokio::spawn(async move {
        let mut heartbeats = interval(HEARTBEAT_INTERVAL);
        heartbeats.set_missed_tick_behavior(MissedTickBehavior::Skip);
        heartbeats.tick().await;
        let mut sequence = 0_u64;
        let mut pending_ping: Option<(Vec<u8>, Instant)> = None;
        loop {
            tokio::select! {
                message = rx.recv() => match message {
                    Some(message) => if sink.send(message).await.is_err() { break; },
                    None => break,
                },
                pong = pong_rx.recv() => if let Some(pong) = pong {
                    if pending_ping.as_ref().is_some_and(|(payload, _)| *payload == pong) {
                        pending_ping = None;
                    }
                },
                _ = heartbeats.tick() => {
                    if pending_ping.as_ref().is_some_and(|(_, sent)| sent.elapsed() >= HEARTBEAT_TIMEOUT) {
                        break;
                    }
                    if pending_ping.is_none() {
                        sequence = sequence.wrapping_add(1);
                        let payload = sequence.to_be_bytes().to_vec();
                        if sink.send(Message::Ping(payload.clone().into())).await.is_err() { break; }
                        pending_ping = Some((payload, Instant::now()));
                    }
                }
            }
        }
        let _ = writer_stopped.send(());
    });
    loop {
        let incoming = tokio::select! {
            _ = &mut writer_stopped_rx => break,
            incoming = stream.next() => incoming,
        };
        let Some(incoming) = incoming else {break};
        let Ok(message) = incoming else {break};
        if message.is_close() {break;}
        if let Message::Pong(payload) = message {
            let _ = pong_tx.send(payload.to_vec());
            continue;
        }
        if !message.is_text() { continue; }
        let value: Value = serde_json::from_str(message.to_text().unwrap_or("{}")).unwrap_or_default();
        if value.get("type").and_then(Value::as_str) == Some("heartbeat") {
            if let Some(source_id) = value.get("id").and_then(Value::as_u64).filter(|id| *id > 0 && *id <= 9_007_199_254_740_991) {
                let _ = tx.send(sync_message(json!({"type":"heartbeat_ack","sourceId":source_id})));
            }
            continue;
        }
        let mut all = relay.lock().await;
        let is_active_controller = all.rooms.get(&room_id).is_some_and(|room| room.controller == Some(id));
        if role != "controller" || !is_active_controller { let _ = tx.send(sync_message(json!({"type":"error","message":"展示端只读"}))); continue; }
        if value.get("type").and_then(Value::as_str) != Some("state") { continue; }
        let state = value.get("state").cloned().unwrap_or_default(); if !state.is_object() { continue; }
        if let Some(room) = all.rooms.get_mut(&room_id) {
            // 状态入库、编号、广播在同一个临界区内完成，换页与视角不会拆开。
            room.state = Some(state);
            room.revision += 1;
            let mut snapshot = json!({"type":"snapshot","state":room.state,"revision":room.revision});
            if let Some(source_id) = value.get("id").and_then(Value::as_u64).filter(|n| *n > 0 && *n <= 9_007_199_254_740_991) {
                snapshot["sourceId"] = json!(source_id);
            }
            let payload = sync_message(snapshot);
            for (_, peer) in room.peers.values() { let _ = peer.send(payload.clone()); }
        }
    }
    writer.abort();
    let mut all = relay.lock().await;
    if let Some(room) = all.rooms.get_mut(&room_id) {
        room.peers.remove(&id);
        if room.controller == Some(id) { room.controller = None; }
        if room.peers.is_empty() { all.rooms.remove(&room_id); }
        else if let Some(room) = all.rooms.get(&room_id) {
            let presence = sync_message(json!({
                "type": "presence",
                "controller": room.controller.is_some(),
                "displays": room.peers.values().filter(|(peer_role, _)| peer_role == "display").count(),
            }));
            for (_, peer) in room.peers.values() { let _ = peer.send(presence.clone()); }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::{SinkExt, StreamExt};
    use tokio::{time::{sleep, timeout}, net::TcpListener};
    use tokio_tungstenite::connect_async;

    async fn connect_controller(address: std::net::SocketAddr) -> tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<TcpStream>> {
        let (mut socket, _) = connect_async(format!("ws://{address}")).await.unwrap();
        socket.send(Message::Text(json!({"role":"controller","room":"heartbeat-test"}).to_string().into())).await.unwrap();
        socket
    }

    async fn next_message(socket: &mut tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<TcpStream>>) -> Message {
        timeout(Duration::from_secs(2), socket.next()).await.unwrap().unwrap().unwrap()
    }

    async fn start_test_relay() -> (Arc<RelayHandle>, std::net::SocketAddr) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        drop(listener);
        let handle = Arc::new(RelayHandle::default());
        start_on(handle.clone(), address).await.unwrap();
        (handle, address)
    }

    #[tokio::test]
    async fn a_controller_that_stops_answering_pings_releases_its_room_slot() {
        let (handle, address) = start_test_relay().await;
        let mut disconnected = connect_controller(address).await;
        assert!(matches!(next_message(&mut disconnected).await, Message::Text(_)));
        // Stop polling the socket to simulate a suspended iOS WebView after network loss.
        sleep(Duration::from_millis(250)).await;

        let mut reconnected = connect_controller(address).await;
        let message = next_message(&mut reconnected).await;
        assert!(matches!(message, Message::Text(_)), "stale connection blocked reconnect: {message:?}");
        stop(handle).await;
    }

    #[tokio::test]
    async fn a_controller_that_answers_pings_keeps_exclusive_room_ownership() {
        let (handle, address) = start_test_relay().await;
        let mut connected = connect_controller(address).await;
        assert!(matches!(next_message(&mut connected).await, Message::Text(_)));
        let reader = tokio::spawn(async move { while connected.next().await.is_some() {} });
        sleep(Duration::from_millis(250)).await;

        let mut duplicate = connect_controller(address).await;
        assert!(matches!(next_message(&mut duplicate).await, Message::Close(_)));
        reader.abort();
        stop(handle).await;
    }

    #[tokio::test]
    async fn application_heartbeat_is_acknowledged_with_its_source_id() {
        let (handle, address) = start_test_relay().await;
        let mut socket = connect_controller(address).await;
        assert!(matches!(next_message(&mut socket).await, Message::Text(_)));
        socket.send(Message::Text(json!({"type":"heartbeat","id":47}).to_string().into())).await.unwrap();
        loop {
            let Message::Text(text) = next_message(&mut socket).await else { continue };
            let message: Value = serde_json::from_str(&text).unwrap();
            if message["type"] == "heartbeat_ack" {
                assert_eq!(message["sourceId"], 47);
                assert!(message["id"].as_u64().is_some_and(|id| id > 0));
                break;
            }
        }
        stop(handle).await;
    }
}
