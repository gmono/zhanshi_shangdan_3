# GB28181 虚拟摄像头（测试工具）

基于 [`gb28181-rs`](https://crates.io/crates/gb28181-rs)（MIT）的 GB/T 28181 设备端（UAC）测试工具。它不依赖 Dahua SDK，也不走 RTSP：注册、目录、INVITE、RTP/PS 全部按 GB28181 协议。

## 组成

- `gb28181-virtual-camera`：虚拟摄像头。生成/读取 H.264 测试画面，循环按 25fps 发送；平台下发 INVITE 后推 RTP/PS；收到的 PTZ 命令（聚焦/变倍）打印到日志。
- `test_platform`：最小 GB28181 平台端，用于自测。监听 SIP `5060`，完成 401 Digest 注册、Catalog、INVITE、RTP/PS 收流和 BYE，把收到的 H.264 写到 `tmp/gb28181-camera/received.h264`。

## 自测

```bash
cargo run --manifest-path tools/gb28181-camera/Cargo.toml --bin test_platform
cargo run --manifest-path tools/gb28181-camera/Cargo.toml --bin gb28181-virtual-camera
```

已实测：注册/目录/INVITE/RTP/PS/BYE 全部通过，`received.h264` 可被 `ffprobe` 解码为 H.264 Constrained Baseline 1280×720。

## 对接真实平台

```bash
cargo run --manifest-path tools/gb28181-camera/Cargo.toml --bin gb28181-virtual-camera -- \
  --platform-ip 192.168.1.10 --platform-port 5060 \
  --device-id 34020000001320000001 --channel-id 34020000001320000001 \
  --domain 3402000000 --password 你的密码 --local-port 15060
```

默认设备编码/密码是 GB28181 示例值，仅用于本地自测；真实平台请替换。

## 注意

- 测试画面由本机 `ffmpeg` 生成到 `tmp/`，不提交媒体文件；可用 `--video` 指定已有的 Annex-B H.264。
- 本工具只实现设备端；应用端（Windows）需要实现平台端 UAS、RTP/PS 收流、解码和 SAB 输出。
- `NetSdk_win_x64/` 仅本地保留参考，不参与构建、不打包。
