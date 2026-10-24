use axum::{extract::State, http::StatusCode, response::IntoResponse, routing::get, Json, Router};
use serde_json::{json,Value};
use std::{path::PathBuf,sync::{Arc,RwLock}};
use tower_http::{cors::CorsLayer,services::ServeDir};

pub const PORT:u16=1421;
#[derive(Clone)]
pub struct Assets {pub catalog:Arc<RwLock<Result<Value,String>>>,pub progress:Arc<RwLock<Value>>}

pub async fn run(root:PathBuf,cache:PathBuf,vips:PathBuf,bind:&str) -> Result<(),String> {
    let listener=tokio::net::TcpListener::bind(bind).await.map_err(|e|format!("地图服务启动失败：{e}"))?;
    std::fs::create_dir_all(&root).map_err(|e|e.to_string())?;
    std::fs::create_dir_all(&cache).map_err(|e|e.to_string())?;
    let state=Assets{catalog:Arc::new(RwLock::new(Err("正在准备地图资源".into()))),progress:Arc::new(RwLock::new(json!({"phase":"starting","completed":0,"total":11,"elapsedMs":0,"message":"正在启动地图处理服务"})))};
    let worker=state.clone();let worker_cache=cache.clone();
    tokio::spawn(async move {
      loop {
        let source=root.clone();let cache=worker_cache.clone();let processor=vips.clone();let progress=worker.progress.clone();
        let result=tokio::task::spawn_blocking(move||crate::map_assets::prepare_with_progress(&source,&cache,&processor,&|value|{*progress.write().unwrap()=value;})).await.unwrap_or_else(|error|Err(format!("地图处理任务异常：{error}")));
        if let Err(error)=&result {
            let _=std::fs::write(worker_cache.join("资源处理记录.txt"),error);
            let mut progress=worker.progress.write().unwrap();
            progress["phase"]=json!("error");progress["message"]=json!("地图准备失败，修复文件后自动重试");progress["error"]=json!(error);
            progress["logPath"]=json!(worker_cache.join("资源处理记录.txt"));
        }
        let ready=result.is_ok();
        *worker.catalog.write().unwrap()=result;
        if ready {break;}
        // 首次启动目录为空、用户仍在复制原图时，保持服务在线并重试。
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
      }
    });
    let app=Router::new().route("/catalog",get(catalog)).route("/progress",get(progress)).route("/health",get(||async {Json(json!({"service":"exhibition","version":1}))}))
        .nest_service("/zoomify",ServeDir::new(cache)).with_state(state).layer(CorsLayer::permissive());
    axum::serve(listener,app).await.map_err(|e|e.to_string())
}
async fn catalog(State(state):State<Assets>) -> impl IntoResponse {
    match &*state.catalog.read().unwrap() {
        Ok(catalog)=>(StatusCode::OK,Json(catalog.clone())),
        Err(message)=>(StatusCode::SERVICE_UNAVAILABLE,Json(json!({"message":message,"progress":state.progress.read().unwrap().clone()}))),
    }
}
async fn progress(State(state):State<Assets>)->Json<Value>{Json(state.progress.read().unwrap().clone())}
