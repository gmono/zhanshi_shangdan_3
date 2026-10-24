//! 测试入口直接编译生产资源与同步服务，不用伪造目录或 WebSocket 响应。
#[path = "../../../src-tauri/src/map_assets.rs"]
mod map_assets;
#[path = "../../../src-tauri/src/tile_server.rs"]
mod tile_server;
#[path = "../../../src-tauri/src/relay.rs"]
mod relay;

#[tokio::main]
async fn main() {
    let args:Vec<String>=std::env::args().collect();
    assert!(args.len()>=3,"用法：exhibition-resource-test-server 原图目录 vips路径 [HTTP监听地址] [WebSocket端口]");
    let root=std::path::PathBuf::from(&args[1]);
    let handle=std::sync::Arc::new(relay::RelayHandle::default());
    relay::start(handle,args.get(4).map(|v|v.parse().unwrap()).unwrap_or(8787)).await.unwrap();
    tile_server::run(root.clone(),root.join(".cache"),std::path::PathBuf::from(&args[2]),args.get(3).map(String::as_str).unwrap_or("127.0.0.1:1431")).await.unwrap();
}
