use std::path::PathBuf;

#[tokio::main]
async fn main() -> Result<(), String> {
    let root = std::env::args().nth(1).map(PathBuf::from).unwrap_or_else(|| PathBuf::from("tmp/camera-platform-root"));
    let service = tauronic_lib::camera::start(root).await?;
    if service.is_none() {
        eprintln!("没有启用 camera.json");
        return Ok(());
    }
    println!("相机平台运行中，Ctrl+C 退出");
    tokio::signal::ctrl_c().await.map_err(|error| error.to_string())?;
    Ok(())
}
