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
#[derive(Default)] struct Room { state: Option<Value>, revision: u64, peers: HashMap<u64, (String, Tx)> }
#[derive(Default)] struct Relay { rooms: HashMap<String, Room>, next_id: u64 }
#[derive(Default)] pub struct RelayHandle { task: Mutex<Option<JoinHandle<()>>> }

fn valid_page(value: &str) -> bool {
    value == "comparison" || value.strip_prefix("map-").is_some_and(|number| {
        !number.is_empty() && !number.starts_with('0') && number.len() <= 2 && number.chars().all(|ch| ch.is_ascii_digit())
    })
}

fn valid_splits(value: &Value) -> bool {
    value.as_array().is_some_and(|values| {
        values.iter().enumerate().all(|(index, value)| {
            let Some(number) = value.as_f64() else { return false };
            number.is_finite() && (0.0..=1.0).contains(&number)
                && (index == 0 || number >= values[index - 1].as_f64().unwrap_or(f64::NAN))
        })
    })
}

fn valid_camera(value: &Value) -> bool {
    let Some(center) = value.get("center").and_then(Value::as_array) else { return false };
    if center.len() != 2 || !center.iter().all(|n| n.as_f64().is_some_and(|v| v.is_finite() && v.abs() <= 1e12))
        || !value.get("zoom").and_then(Value::as_f64).is_some_and(|zoom| zoom.is_finite() && (0.0..=24.0).contains(&zoom)) { return false; }
    match value.get("space").and_then(Value::as_str) {
        None => true,
        Some("image-relative") => center.iter().all(|n| n.as_f64().is_some_and(|v| (0.0..=1.0).contains(&v))),
        Some(_) => false,
    }
}

fn valid_state(value: &Value) -> bool {
    let Some(object) = value.as_object() else { return false };
    if !value.get("center").and_then(Value::as_array).is_some_and(|center| center.len() == 2 && center.iter().all(|n| n.as_f64().is_some_and(|v| v.is_finite() && v.abs() <= 1e12)))
        || !value.get("zoom").and_then(Value::as_f64).is_some_and(|zoom| zoom.is_finite() && (0.0..=24.0).contains(&zoom))
        || !value.get("showPoints").is_some_and(Value::is_boolean)
        || !value.get("comparison").is_some_and(Value::is_boolean)
        || !value.get("splits").is_some_and(valid_splits)
        || value["splits"].as_array().is_none_or(|splits| splits.len() != 2) { return false; }
    let legacy = !object.contains_key("page") && !object.contains_key("outerSplits") && !object.contains_key("innerSplits");
    if legacy { return true; }
    let Some(page) = value.get("page").and_then(Value::as_str) else { return false };
    if !valid_page(page) || value["comparison"].as_bool() != Some(page == "comparison")
        || !value.get("outerSplits").is_some_and(valid_splits) { return false; }
    let Some(inner) = value.get("innerSplits").and_then(Value::as_array) else { return false };
    if inner.len() != value["outerSplits"].as_array().unwrap().len() + 1 || !inner.iter().all(valid_splits) { return false; }
    if let Some(cameras) = value.get("mapViews") {
        let Some(cameras) = cameras.as_object() else { return false };
        if cameras.len() > 32 || cameras.iter().any(|(page, camera)| !page.strip_prefix("map-").is_some_and(|n| !n.is_empty() && !n.starts_with('0') && n.len() <= 2 && n.chars().all(|ch| ch.is_ascii_digit())) || !valid_camera(camera)) { return false; }
    }
    true
}

fn merge_state_patch(base: Option<&Value>, page_id: &str, patch: &Value, replace: bool) -> Option<Value> {
    if !valid_page(page_id) || !patch.is_object() { return None; }
    let fields = ["center", "zoom", "showPoints", "comparison", "page", "outerSplits", "innerSplits", "mapViews", "splits"];
    let patch_object = patch.as_object()?;
    if patch_object.keys().any(|key| !fields.contains(&key.as_str()))
        || patch.get("page").and_then(Value::as_str).is_some_and(|page| page != page_id) { return None; }
    if replace { return valid_state(patch).then(|| patch.clone()); }
    let mut next = base.filter(|state| valid_state(state))?.clone();
    let next_object = next.as_object_mut()?;
    for (key, value) in patch_object {
        if key != "innerSplits" && key != "mapViews" { next_object.insert(key.clone(), value.clone()); }
    }
    if let Some(patch_views) = patch.get("mapViews") {
        if page_id == "comparison" { return None; }
        let patch_views = patch_views.as_object()?;
        if patch_views.keys().any(|key| key != page_id || !valid_camera(&patch_views[key])) { return None; }
        let views = next_object.entry("mapViews").or_insert_with(|| json!({})).as_object_mut()?;
        for (key, camera) in patch_views { views.insert(key.clone(), camera.clone()); }
    }
    if let Some(patch_splits) = patch.get("innerSplits") {
        if page_id != "comparison" { return None; }
        let patch_splits = patch_splits.as_object()?;
        let inner = next_object.get_mut("innerSplits")?.as_array_mut()?;
        for (index, splits) in patch_splits {
            if index != "0" && index.starts_with('0') { return None; }
            let index: usize = index.parse().ok()?;
            if index >= inner.len() || !valid_splits(splits) { return None; }
            inner[index] = splits.clone();
        }
    }
    valid_state(&next).then_some(next)
}

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
        room.peers.insert(id, (role.clone(), tx.clone()));
        let page_id = room.state.as_ref().and_then(|state| state.get("page")).and_then(Value::as_str).unwrap_or("comparison");
        let _ = tx.send(sync_message(json!({"type":"snapshot","pageId":page_id,"state":room.state,"revision":room.revision})));
        let controllers = room.peers.values().filter(|(peer_role, _)| peer_role == "controller").count();
        let presence = sync_message(json!({
            "type": "presence",
            "pageId": page_id,
            "controller": controllers > 0,
            "controllers": controllers,
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
                let page_id = value.get("pageId").and_then(Value::as_str).filter(|page| valid_page(page)).unwrap_or("comparison");
                let _ = tx.send(sync_message(json!({"type":"heartbeat_ack","pageId":page_id,"sourceId":source_id})));
            }
            continue;
        }
        let mut all = relay.lock().await;
        if role != "controller" {
            let page_id = value.get("pageId").and_then(Value::as_str).filter(|page| valid_page(page)).unwrap_or("comparison");
            let _ = tx.send(sync_message(json!({"type":"error","pageId":page_id,"message":"展示端只读"}))); continue;
        }
        if value.get("type").and_then(Value::as_str) != Some("state") { continue; }
        if let Some(room) = all.rooms.get_mut(&room_id) {
            let is_replace = value.get("replace").and_then(Value::as_bool) == Some(true) || value.get("state").is_some();
            let patch = value.get("patch").or_else(|| value.get("state")).cloned().unwrap_or_default();
            let page_id = value.get("pageId").and_then(Value::as_str)
                .or_else(|| patch.get("page").and_then(Value::as_str)).unwrap_or("comparison");
            let Some(state) = merge_state_patch(room.state.as_ref(), page_id, &patch, is_replace) else {
                let _ = tx.send(sync_message(json!({"type":"error","pageId":page_id,"message":"无效地图状态补丁或页面编号"})));
                continue;
            };
            // 状态合并、revision 和广播排队都在同一个锁内，保持房间到达顺序。
            room.state = Some(state);
            room.revision += 1;
            let mut snapshot = json!({"type":"snapshot","pageId":room.state.as_ref().and_then(|state| state.get("page")).and_then(Value::as_str).unwrap_or(page_id),"state":room.state,"revision":room.revision});
            if let Some(source_id) = value.get("id").and_then(Value::as_u64).filter(|n| *n > 0 && *n <= 9_007_199_254_740_991) {
                snapshot["sourceId"] = json!(source_id);
            }
            let payload = sync_message(snapshot);
            for (peer_id, (_, peer)) in &room.peers { if *peer_id != id { let _ = peer.send(payload.clone()); } }
            let mut acknowledgement = json!({"type":"state_ack","pageId":room.state.as_ref().and_then(|state| state.get("page")).and_then(Value::as_str).unwrap_or(page_id),"state":room.state,"revision":room.revision});
            if let Some(source_id) = value.get("id").and_then(Value::as_u64).filter(|n| *n > 0 && *n <= 9_007_199_254_740_991) {
                acknowledgement["sourceId"] = json!(source_id);
            }
            let _ = tx.send(sync_message(acknowledgement));
        }
    }
    writer.abort();
    let mut all = relay.lock().await;
    if let Some(room) = all.rooms.get_mut(&room_id) {
        room.peers.remove(&id);
        if room.peers.is_empty() { all.rooms.remove(&room_id); }
        else if let Some(room) = all.rooms.get(&room_id) {
            let controllers = room.peers.values().filter(|(peer_role, _)| peer_role == "controller").count();
            let page_id = room.state.as_ref().and_then(|state| state.get("page")).and_then(Value::as_str).unwrap_or("comparison");
            let presence = sync_message(json!({
                "type": "presence",
                "pageId": page_id,
                "controller": controllers > 0,
                "controllers": controllers,
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
    async fn multiple_controllers_share_the_room_and_merge_page_patches() {
        let (handle, address) = start_test_relay().await;
        let mut first = connect_controller(address).await;
        assert!(matches!(next_message(&mut first).await, Message::Text(_)));
        let mut second = connect_controller(address).await;
        assert!(matches!(next_message(&mut second).await, Message::Text(_)));
        let seed = json!({"center":[0,0],"zoom":3,"showPoints":false,"comparison":true,"page":"comparison","outerSplits":[0.5],"innerSplits":[[0.2],[0.3]],"mapViews":{},"splits":[0.3,0.7]});
        first.send(Message::Text(json!({"id":1,"type":"state","pageId":"comparison","replace":true,"patch":seed}).to_string().into())).await.unwrap();
        let received = loop {
            let Message::Text(text) = next_message(&mut second).await else { continue };
            let message: Value = serde_json::from_str(&text).unwrap();
            if message["type"] == "snapshot" && message["state"].is_object() { break message; }
        };
        assert_eq!(received["state"], seed);
        let camera = json!({"center":[0.75,0.4],"zoom":2,"space":"image-relative"});
        second.send(Message::Text(json!({"id":1,"type":"state","pageId":"map-2","patch":{"page":"map-2","comparison":false,"mapViews":{"map-2":camera}}}).to_string().into())).await.unwrap();
        let received = loop {
            let Message::Text(text) = next_message(&mut first).await else { continue };
            let message: Value = serde_json::from_str(&text).unwrap();
            if message["type"] == "snapshot" && message["state"]["page"] == "map-2" { break message; }
        };
        assert_eq!(received["state"]["mapViews"]["map-2"], camera);
        first.send(Message::Text(json!({"id":2,"type":"state","pageId":"comparison","patch":{"page":"comparison","comparison":true,"innerSplits":{"0":[0.4]}}}).to_string().into())).await.unwrap();
        let received = loop {
            let Message::Text(text) = next_message(&mut second).await else { continue };
            let message: Value = serde_json::from_str(&text).unwrap();
            if message["type"] == "snapshot" && message["state"]["page"] == "comparison" { break message; }
        };
        assert_eq!(received["state"]["innerSplits"], json!([[0.4],[0.3]]));
        assert_eq!(received["state"]["mapViews"]["map-2"], camera);
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
