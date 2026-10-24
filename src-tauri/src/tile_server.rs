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
        let result=crate::map_assets::prepare(&root,&worker_cache,&vips);
        if let Err(error)=&result {let _=std::fs::write(worker_cache.join("资源处理记录.txt"),error);}
        *worker.catalog.write().unwrap()=result;
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

pub fn spawn(app:tauri::AppHandle) -> Result<(),String> {
    use tauri::Manager;
    let exe=std::env::current_exe().map_err(|e|e.to_string())?;
    let beside=exe.parent().ok_or("无法定位程序目录")?.join("地图资源");
    let root=if let Some(root)=std::env::var_os("EXHIBITION_RESOURCE_DIR") {PathBuf::from(root)}
        else if beside.is_dir() {beside}
        else {app.path().document_dir().map_err(|e|e.to_string())?.join("展厅App/地图资源")};
    std::fs::create_dir_all(root.join("大图")).map_err(|e|e.to_string())?;
    std::fs::create_dir_all(root.join("对比")).map_err(|e|e.to_string())?;
    let vips=if let Some(path)=std::env::var_os("EXHIBITION_VIPS") {PathBuf::from(path)}
        else {app.path().resource_dir().map_err(|e|e.to_string())?.join("tools/vips/bin/vips.exe")};
    let cache=root.join(".cache");
    tauri::async_runtime::spawn(async move {if let Err(error)=run(root,cache,vips,&format!("0.0.0.0:{PORT}")).await {eprintln!("{error}");}});
    Ok(())
}
