//! GB/T 28181 virtual camera (device / UAC).
//!
//! Registers to a GB28181 platform, answers Catalog queries and streams a
//! looping H.264 test pattern as RTP/PS after INVITE. PTZ commands received
//! from the platform are logged, so the app's focus/zoom path can be tested
//! without real hardware.
//!
//! The synthetic source is generated with FFmpeg into tmp/; no binary media
//! is committed. The H.264 is parsed into access units and fed at 25 fps.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use gb28181_rs::config::{Gb28181Config, Transport};
use gb28181_rs::frame::{AccessUnit, Nalu};
use gb28181_rs::manscdp::PtzCommand;
use gb28181_rs::mock::MockFrameHub;
use gb28181_rs::segment;
use gb28181_rs::server::{DeviceControlHandler, Gb28181Server};

const DEFAULT_PLATFORM_IP: &str = "127.0.0.1";
const DEFAULT_PLATFORM_PORT: u16 = 5060;
const DEFAULT_DEVICE_ID: &str = "34020000001320000001";
const DEFAULT_CHANNEL_ID: &str = "34020000001320000001";
const DEFAULT_DOMAIN: &str = "3402000000";
const DEFAULT_PASSWORD: &str = "12345678";
const DEFAULT_LOCAL_PORT: u16 = 15060;
const FPS: u64 = 25;

struct Args {
    platform_ip: String,
    platform_port: u16,
    device_id: String,
    channel_id: String,
    domain: String,
    password: String,
    local_port: u16,
    video: PathBuf,
    fps: u64,
}

impl Default for Args {
    fn default() -> Self {
        Self {
            platform_ip: DEFAULT_PLATFORM_IP.into(),
            platform_port: DEFAULT_PLATFORM_PORT,
            device_id: DEFAULT_DEVICE_ID.into(),
            channel_id: DEFAULT_CHANNEL_ID.into(),
            domain: DEFAULT_DOMAIN.into(),
            password: DEFAULT_PASSWORD.into(),
            local_port: DEFAULT_LOCAL_PORT,
            video: PathBuf::from("tmp/gb28181-camera/test.h264"),
            fps: FPS,
        }
    }
}

fn parse_args() -> Result<Args> {
    let mut args = Args::default();
    let mut it = std::env::args().skip(1);
    while let Some(flag) = it.next() {
        let mut value = || it.next().with_context(|| format!("{flag} 缺少参数"));
        match flag.as_str() {
            "--platform-ip" => args.platform_ip = value()?,
            "--platform-port" => args.platform_port = value()?.parse().context("platform-port")?,
            "--device-id" => args.device_id = value()?,
            "--channel-id" => args.channel_id = value()?,
            "--domain" => args.domain = value()?,
            "--password" => args.password = value()?,
            "--local-port" => args.local_port = value()?.parse().context("local-port")?,
            "--video" => args.video = PathBuf::from(value()?),
            "--fps" => args.fps = value()?.parse().context("fps")?,
            "--help" | "-h" => {
                println!("用法: gb28181-virtual-camera [--platform-ip IP] [--platform-port 5060] [--device-id 20位] [--channel-id 20位] [--domain 域] [--password 密码] [--local-port 15060] [--video path.h264] [--fps 25]");
                std::process::exit(0);
            }
            other => anyhow::bail!("未知参数: {other}"),
        }
    }
    if args.fps == 0 {
        anyhow::bail!("fps 必须大于 0");
    }
    Ok(args)
}

struct LogPtz;

impl DeviceControlHandler for LogPtz {
    fn on_ptz(&self, cmd: &PtzCommand) {
        // The app's focus/zoom buttons arrive here as GB28181 MANSCMD.
        println!("[virtual-camera] PTZ: {cmd:?}");
    }
}

fn generate_test_video(path: &Path) -> Result<()> {
    if path.is_file() {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let ffmpeg = std::env::var_os("FFMPEG_BIN").unwrap_or_else(|| "ffmpeg".into());
    let status = Command::new(ffmpeg)
        .args([
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=1280x720:rate=25",
            "-t",
            "6",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-profile:v",
            "baseline",
            "-g",
            "25",
            "-pix_fmt",
            "yuv420p",
            "-f",
            "h264",
        ])
        .arg(path)
        .status()
        .context("无法启动 ffmpeg 生成测试画面（可设置 FFMPEG_BIN 或预先放入 --video）")?;
    if !status.success() {
        anyhow::bail!("ffmpeg 生成测试画面失败: {status}");
    }
    Ok(())
}

fn load_frames(path: &Path) -> Result<Vec<AccessUnit>> {
    let recorded = segment::read_segment(path).with_context(|| format!("读取 H.264 失败: {}", path.display()))?;
    let frames: Vec<AccessUnit> = recorded
        .into_iter()
        .map(|au| {
            let nalus = au
                .nalus
                .into_iter()
                .map(|data| {
                    let nalu_type = data.first().copied().unwrap_or(0) & 0x1F;
                    Nalu {
                        nalu_type,
                        data,
                        is_idr: nalu_type == 5,
                        is_sps: nalu_type == 7,
                        is_pps: nalu_type == 8,
                        is_aud: nalu_type == 9,
                    }
                })
                .collect();
            AccessUnit { nalus, timestamp: Instant::now(), is_key_frame: au.is_key_frame }
        })
        .collect();
    if frames.is_empty() {
        anyhow::bail!("H.264 文件里没有可发送的访问单元: {}", path.display());
    }
    Ok(frames)
}

fn synth_frames() -> Vec<AccessUnit> {
    // Protocol-only fallback when FFmpeg is unavailable; not a decodable picture.
    (0..50)
        .map(|frame_no| {
            let key = frame_no % 12 == 0;
            let mut nalus = vec![nalu(9, 4)];
            if key {
                nalus.push(nalu(7, 27));
                nalus.push(nalu(8, 9));
                nalus.push(nalu(5, 24_000));
            } else {
                nalus.push(nalu(1, 2_400));
            }
            AccessUnit { nalus, timestamp: Instant::now(), is_key_frame: key }
        })
        .collect()
}

fn nalu(nalu_type: u8, size: usize) -> Nalu {
    Nalu {
        nalu_type,
        data: (0..size)
            .map(|i| if i == 0 { nalu_type } else { (i % 200 + 7) as u8 })
            .collect(),
        is_idr: nalu_type == 5,
        is_sps: nalu_type == 7,
        is_pps: nalu_type == 8,
        is_aud: nalu_type == 9,
    }
}

async fn feed(hub: Arc<MockFrameHub>, frames: Arc<Vec<AccessUnit>>, fps: u64) {
    let delay = Duration::from_millis(1000 / fps.max(1));
    let mut index = 0usize;
    let mut subscribers = 0usize;
    loop {
        // A platform subscribes on INVITE. Restart at the first access unit
        // (SPS/PPS + IDR) so the receiver can decode immediately.
        let current = hub.subscriber_count();
        if current > subscribers {
            index = 0;
        }
        subscribers = current;
        let mut frame = frames[index % frames.len()].clone();
        frame.timestamp = Instant::now();
        hub.write(frame);
        index = index.wrapping_add(1);
        tokio::time::sleep(delay).await;
    }
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<()> {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();
    let args = parse_args()?;

    if let Err(error) = generate_test_video(&args.video) {
        log::warn!("{error:#}; 使用合成 NAL 单元（只能验证协议，不能解码画面）");
    }
    let frames = match load_frames(&args.video) {
        Ok(frames) => {
            println!(
                "[virtual-camera] 视频 {}：{} 帧，{} fps",
                args.video.display(),
                frames.len(),
                args.fps
            );
            frames
        }
        Err(error) => {
            log::warn!("{error:#}; 使用合成 NAL 单元");
            synth_frames()
        }
    };
    let frames = Arc::new(frames);
    let hub = Arc::new(MockFrameHub::new());

    let config = Gb28181Config {
        enabled: true,
        platform_sip_address: args.platform_ip.clone(),
        platform_sip_port: args.platform_port,
        device_id: args.device_id.clone(),
        channel_id: args.channel_id.clone(),
        sip_domain: args.domain.clone(),
        password: args.password.clone(),
        local_sip_port: args.local_port,
        register_interval_secs: 3600,
        heartbeat_interval_secs: 5,
        heartbeat_timeout_count: 3,
        transport: Transport::Udp,
        ..Gb28181Config::default()
    };

    let mut server = Gb28181Server::new(config, hub.clone())
        .with_control_handler(Some(Arc::new(LogPtz)))
        .spawn()
        .await
        .context("虚拟摄像头启动失败")?;

    println!(
        "[virtual-camera] 设备 {} 注册到 {}:{}，本地 SIP :{}，等待平台 INVITE",
        args.device_id, args.platform_ip, args.platform_port, args.local_port
    );

    tokio::spawn(feed(hub, frames, args.fps));
    tokio::signal::ctrl_c().await?;
    println!("[virtual-camera] 正在停止");
    server.shutdown().await?;
    Ok(())
}
