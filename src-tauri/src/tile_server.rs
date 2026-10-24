use axum::{extract::State, http::StatusCode, response::IntoResponse, routing::get, Json, Router};
use serde_json::{json,Value};
use std::{path::PathBuf,sync::{Arc,RwLock}};
use tower_http::{cors::CorsLayer,services::ServeDir};

pub const PORT:u16=1421;
#[derive(Clone)]
pub struct Assets {pub catalog:Arc<RwLock<Result<Value,String>>>}

pub async fn run(root:PathBuf,cache:PathBuf,vips:PathBuf,bind:&str) -> Result<(),String> {
    let listener=tokio::net::TcpListener::bind(bind).await.map_err(|e|format!("地图服务启动失败：{e}"))?;
    std::fs::create_dir_all(&root).map_err(|e|e.to_string())?;
    std::fs::create_dir_all(&cache).map_err(|e|e.to_string())?;
    let state=Assets{catalog:Arc::new(RwLock::new(Err("正在准备地图资源".into())))};
    let worker=state.clone();let worker_cache=cache.clone();
    tokio::task::spawn_blocking(move||{
      loop {
        let result=crate::map_assets::prepare(&root,&worker_cache,&vips);
        if let Err(error)=&result {let _=std::fs::write(worker_cache.join("资源处理记录.txt"),error);}
        let ready=result.is_ok();
        *worker.catalog.write().unwrap()=result;
        if ready {break;}
        // 首次启动目录为空、用户仍在复制原图时，保持服务在线并重试。
        std::thread::sleep(std::time::Duration::from_secs(2));
      }
    });
    let app=Router::new().route("/catalog",get(catalog)).route("/health",get(||async {Json(json!({"service":"exhibition","version":1}))}))
        .nest_service("/zoomify",ServeDir::new(cache)).with_state(state).layer(CorsLayer::permissive());
    axum::serve(listener,app).await.map_err(|e|e.to_string())
}
async fn catalog(State(state):State<Assets>) -> impl IntoResponse {
    match &*state.catalog.read().unwrap() {
        Ok(catalog)=>(StatusCode::OK,Json(catalog.clone())),
        Err(message)=>(StatusCode::SERVICE_UNAVAILABLE,Json(json!({"message":message}))),
    }
}
