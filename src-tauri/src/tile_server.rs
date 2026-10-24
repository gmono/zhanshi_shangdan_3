use axum::{extract::{State, WebSocketUpgrade, ws::{Message, WebSocket}}, http::StatusCode, response::IntoResponse, routing::get, Json, Router};
use serde_json::{json,Value};
use std::{path::PathBuf,sync::{Arc,RwLock}};
use tokio::sync::broadcast;
use tower_http::{cors::CorsLayer,services::ServeDir};

pub const PORT:u16=1421;
#[derive(Clone)]
pub struct Assets { snapshot:Arc<RwLock<Value>>, events:broadcast::Sender<Value> }
impl Assets {
    fn publish(&self, progress:Value, catalog:Option<Value>) {
        let mut snapshot=self.snapshot.write().unwrap();
        *snapshot=json!({"progress":progress,"catalog":catalog});
        let _=self.events.send(snapshot.clone());
    }
}

pub async fn run(root:PathBuf,cache:PathBuf,vips:PathBuf,bind:&str) -> Result<(),String> {
    let listener=tokio::net::TcpListener::bind(bind).await.map_err(|e|format!("地图服务启动失败：{e}"))?;
    let (sender,_)=broadcast::channel(256);
    let state=Assets{snapshot:Arc::new(RwLock::new(json!({"catalog":null,"progress":{"phase":"starting","completed":0,"total":11,"elapsedMs":0,"sourcePath":root,"processorPath":vips,"message":"正在启动地图处理服务"}}))),events:sender};
    let worker=state.clone();let worker_cache=cache.clone();
    tokio::spawn(async move {
      loop {
        let source=root.clone();let cache=worker_cache.clone();let processor=vips.clone();let updates=worker.clone();
        let result=tokio::task::spawn_blocking(move||{
            std::fs::create_dir_all(&source).map_err(|e|format!("无法创建地图资源目录：{}\n系统错误：{e}",source.display()))?;
            std::fs::create_dir_all(&cache).map_err(|e|format!("无法创建地图缓存目录：{}\n系统错误：{e}",cache.display()))?;
            let ready=std::cell::RefCell::new(None);
            let catalog=crate::map_assets::prepare_with_progress(&source,&cache,&processor,&|value|{
                // 完成状态与目录必须在同一条通知中发布。
                if value["phase"]=="ready" {*ready.borrow_mut()=Some(value);}else{updates.publish(value,None);}
            })?;
            Ok::<_,String>((ready.into_inner().ok_or("地图处理未报告完成状态")?,catalog))
        }).await.unwrap_or_else(|error|Err(format!("地图处理任务异常：{error}")));
        match result {
            Ok((progress,catalog))=>{worker.publish(progress,Some(catalog));break;}
            Err(error)=>{
                let mut progress=worker.snapshot.read().unwrap()["progress"].clone();
                progress["phase"]=json!("error");progress["message"]=json!("地图准备失败，修复文件后自动重试");progress["error"]=json!(error);
                progress["logPath"]=json!(worker_cache.join("资源处理记录.txt"));
                worker.publish(progress,None);
                let log_path=worker_cache.join("资源处理记录.txt");
                let _=tokio::task::spawn_blocking(move||std::fs::write(log_path,error)).await;
            }
        }
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
      }
    });
    let app=Router::new().route("/events",get(events)).route("/catalog",get(catalog)).route("/progress",get(progress)).route("/health",get(||async {Json(json!({"service":"exhibition","version":1}))}))
        .nest_service("/zoomify",ServeDir::new(cache)).with_state(state).layer(CorsLayer::permissive());
    axum::serve(listener,app).await.map_err(|e|e.to_string())
}
async fn events(State(state):State<Assets>,ws:WebSocketUpgrade)->impl IntoResponse {
    ws.on_upgrade(move|socket|notifications(socket,state))
}
async fn notifications(mut socket:WebSocket,state:Assets) {
    // 订阅与快照读取共用读锁，保证新连接不丢更新、不先收到新状态再收到旧快照。
    let (mut updates,snapshot)={let snapshot=state.snapshot.read().unwrap();(state.events.subscribe(),snapshot.clone())};
    if socket.send(Message::Text(snapshot.to_string().into())).await.is_err(){return;}
    loop {
        tokio::select! {
            update=updates.recv()=>match update {
                Ok(value)=>if socket.send(Message::Text(value.to_string().into())).await.is_err(){break;},
                // 慢客户端不能拖住处理线程；重连后立即得到最新快照。
                Err(_)=>{let _=socket.send(Message::Close(None)).await;break;}
            },
            incoming=socket.recv()=>match incoming {
                None|Some(Err(_))|Some(Ok(Message::Close(_)))=>break,
                _=>{}
            }
        }
    }
}
async fn catalog(State(state):State<Assets>) -> impl IntoResponse {
    let snapshot=state.snapshot.read().unwrap();
    if snapshot["catalog"].is_object(){(StatusCode::OK,Json(snapshot["catalog"].clone()))}
    else {(StatusCode::SERVICE_UNAVAILABLE,Json(json!({"message":snapshot["progress"]["message"],"progress":snapshot["progress"]})))}
}
async fn progress(State(state):State<Assets>)->Json<Value>{Json(state.snapshot.read().unwrap()["progress"].clone())}
