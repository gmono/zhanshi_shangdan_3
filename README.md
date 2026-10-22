# 观境 · 展厅双端地图

基于 [Tauronic](https://github.com/rgilsimoes/Tauronic) 初始化，同一个 Tauri 2 + Ionic React 软件用于 iOS 和 Windows。

- **主屏：三图卷帘联动对比**。三图共享同一视角，用两条分割线控制可见范围。
- **子界面：普通地图**。iOS 点击按钮进入，可返回三图主屏，也支持浏览器后退。
- **iOS：操作端**。单指平移、双指缩放、触摸拖动分割线、图层开关、复位。
- **Windows：展示端**。启动后全屏并保持 topmost，跟随 iOS 的界面、视角、图层和分割比例。

## 启动

需要 Node.js 24 和 pnpm 10。

```bash
pnpm install
pnpm dev
```

浏览器预览：

- iOS 操作端：http://localhost:1420/?role=controller
- Windows 展示端：http://localhost:1420/?role=display

原生软件按平台自动选择端类型，浏览器查询参数仅用于开发预览。两端不是两个独立项目。

## 验证双端联动

在另一个终端启动中继：

```bash
pnpm relay
```

两端右上角点击连接设置，填写相同内容：

- 服务地址：`ws://展厅电脑局域网IP:8787`
- 房间密钥：相同的 8–96 位字母、数字、下划线或短横线。正式使用应设置随机长密钥。

在同一电脑浏览器测试可填 `ws://localhost:8787`。手机需要填写电脑 IP，且处于可互访的网络；电脑需允许 8787 端口。连接成功后显示在线大屏数量，未连接时明确显示“本地预览”。每个房间允许一台控制端，最多 15 台展示端。断线自动重连；所有端离开后，内存快照保留 60 秒。中继重启后不会保留快照。

控制端相机与卷帘在操作过程中持续同步，每 16ms 最多推送一次并保留最终位置。展示端无法写入状态。当前是受控局域网基础实现；互联网部署需 WSS、接入认证与反向代理。房间密钥相当于连接凭据，不要放到公开链接。

## 地图与超大图接入

地图使用 [OpenLayers](https://openlayers.org/)，Ionic 负责界面，不自行实现地图手势。地图区设置 `touch-action: none`，Ionic 页面关闭自身滚动；操作面板可独立滚动。

复制 `.env.example` 为 `.env`，修改后重启开发服务或重新打包。iOS、Windows 必须使用相同的地图配置和配准。

### 地理地图：标准 XYZ

```dotenv
VITE_MAP_KIND=xyz
VITE_MAP_URL=https://tiles.example.com/a/{z}/{x}/{y}.png
VITE_COMPARE_B_URL=https://tiles.example.com/b/{z}/{x}/{y}.png
VITE_COMPARE_C_URL=https://tiles.example.com/c/{z}/{x}/{y}.png
VITE_MAP_A_NAME=规划前
VITE_MAP_B_NAME=建设中
VITE_MAP_C_NAME=建成后
VITE_MAP_ATTRIBUTION=地图数据来源
```

采用 EPSG:3857、标准 XYZ、多级缩放、按视口加载和每层 256 个瓦片的缓存目标。底层采用成熟瓦片层 Canvas 渲染；不会全量下载整个地图。当前假设三组瓦片同一坐标体系和原点；如果原始数据使用其他坐标系，需要先转换并配准。演示默认是 OSM、Esri 地形、Esri 卫星影像，属于在线示例，并非离线展厅资产。

### 超大展厅平面图：Zoomify 图像金字塔

原始大图先在数据制作阶段预切成 **Zoomify** 多级瓦片，目录含 `TileGroup0/0-0-0.jpg` 等路径。例如可通过 libvips 的 `dzsave --layout zoomify` 制作。不要直接把几万或几十万像素的大图交给浏览器整张载入。

```dotenv
VITE_MAP_KIND=zoomify
VITE_MAP_URL=http://192.168.1.100:8080/a/
VITE_COMPARE_B_URL=http://192.168.1.100:8080/b/
VITE_COMPARE_C_URL=http://192.168.1.100:8080/c/
VITE_IMAGE_WIDTH=100000
VITE_IMAGE_HEIGHT=60000
VITE_MAP_A_NAME=方案一
VITE_MAP_B_NAME=方案二
VITE_MAP_C_NAME=方案三
VITE_MAP_ATTRIBUTION=展厅设计图
```

采用像素投影，范围为 `[0, -高度, 宽度, 0]`。三组图必须具有相同尺寸、比例和配准。地图源需允许跨域（CORS）。封闭网络可把全部瓦片部署于展厅本地服务；当前不包含离线瓦片下载器或打包工具。Zoomify 接口已接入，正式超大图性能验收需要你的实际瓦片数据。

## Windows 原生构建

在 Windows 安装 Rust、Visual Studio C++ 构建工具和 WebView2 后：

```bash
pnpm install
pnpm tauri:dev
pnpm build:windows
```

安装包输出到 `src-tauri/target/release/bundle/`。仓库附带 GitHub Actions Windows 构建工作流，尚未在远端触发。

## iOS 原生构建

需要 **macOS + Xcode + Apple 开发者签名**。保留模板原生工程名 `tauronic` 与包标识 `com.tauronic.kit` 以避免破坏生成工程引用；正式发布前应统一替换成自己的标识并重新初始化工程。

```bash
pnpm install
pnpm tauri ios init
pnpm tauri:ios
pnpm build:ios
```

在 Xcode 中设置开发团队，也可以配置 `APPLE_DEVELOPMENT_TEAM`。`src-tauri/Info.plist` 声明局域网访问用途与本地网络例外；真机首次使用需要允许本地网络访问。正式远程服务采用 WSS。iOS 原生系统返回手势不作为此版本依赖：界面中有明确的“返回三图主屏”按钮。

## 检查

```bash
pnpm test
pnpm lint
pnpm build
```

`pnpm test` 覆盖状态校验、卷帘边界、展示端只读、房间隔离、单控制端及重连快照。浏览器验证记录见 `docs/验证记录.md`。

原生 iOS、Windows 安装包尚未在目标系统构建。浏览器触摸模拟不能替代 iOS 真机验收。

## 主要文件

- `src/map/MapStage.tsx`：共享视角、三图裁剪、触摸分割线。
- `src/map/config.ts`：XYZ / Zoomify 地图源。
- `src/sync/useSync.ts`：客户端同步及重连。
- `server/relay.mjs`：房间中继与权限校验。
- `src/App.tsx`：主屏、子界面及返回。
- `src/platform/role.ts`：原生平台分流。

## 选型来源

- [OpenLayers 默认交互](https://openlayers.org/en/latest/apidoc/module-ol_interaction_defaults.html)：DragPan、PinchZoom、PinchRotate 等。
- [OpenLayers Zoomify](https://openlayers.org/en/latest/apidoc/module-ol_source_Zoomify-Zoomify.html)：大幅图像金字塔。
- [Ionic Content](https://ionicframework.com/docs/api/content)：内容滚动与容器。
- [Ionic Gestures](https://ionicframework.com/docs/utilities/gestures)：通用手势工具；地图使用 OpenLayers 专业交互。
- [MapLibre 地图 API](https://maplibre.org/maplibre-gl-js/docs/API/classes/Map/)：矢量地理地图的备选方案。

保留 Tauronic 的原始 MIT 许可证及版权声明，见 `LICENSE.MD`。

## GitHub Actions 云端编译 iOS

仓库已配置 `.github/workflows/check.yml`：

- `ios-simulator` 在 GitHub 的 `macos-14` runner 上编译 iOS Simulator，不需要 Mac、iPhone 或 Apple Developer 账号；每次 Pull Request、push 都会执行。
- `ios-testflight` 在手动运行或推送 `v*` tag 时构建签名 IPA 并上传 TestFlight。它需要 GitHub Environment `testflight` 中的 Apple secrets。

在 GitHub 仓库的 **Settings → Environments → testflight → Environment secrets** 添加：

| Secret | 内容 |
|---|---|
| `APPLE_CERTIFICATE_P12_BASE64` | Apple Distribution `.p12` 文件的 base64 内容 |
| `APPLE_CERTIFICATE_PASSWORD` | `.p12` 导出密码 |
| `APPLE_TEAM_ID` | Apple Developer Team ID |
| `APPSTORE_CONNECT_ISSUER_ID` | App Store Connect API Key 的 Issuer ID |
| `APPSTORE_CONNECT_KEY_ID` | App Store Connect API Key ID |
| `APPSTORE_CONNECT_API_PRIVATE_KEY` | `AuthKey_XXXXXXXXXX.p8` 的完整文本，包含 BEGIN/END 行 |

证书和 App Store Connect API Key 需要由 Apple Developer 账号持有人在 Apple 后台创建；GitHub Actions 只提供 macOS 构建机，不能绕过 Apple 签名。Provisioning Profile 由工作流根据 `com.tauronic.kit` 自动下载，因此 App ID 必须先在 Apple Developer 后台注册。若使用自己的 Bundle ID，请同步修改 `src-tauri/tauri.conf.json`、工作流 `bundle-id` 和 Provisioning Profile。

首次建议执行 `workflow_dispatch`，确认 IPA artifact 已上传后，再通过 tag 发布：

```bash
git tag v0.1.1
git push origin v0.1.1
```

TestFlight 外部测试仍需 App Store Connect 的 Beta App Review；内部测试成员不需要这一步。Apple Developer Program 官方费用为每年 99 美元（地区价格可能不同）。

## Windows 底座直连同步

Windows Tauri 展示端启动时会自动在 `0.0.0.0:8787` 启动 Rust WebSocket 中继，不再必须单独运行 `pnpm relay`。iOS 或浏览器控制端在连接设置里填写 Windows 电脑的局域网 IP：

```text
ws://192.168.1.100:8787
```

房间密钥仍需两端一致。Windows 防火墙需要允许入站 TCP 8787；如果连接失败，先在 Windows 执行 `ipconfig` 查看局域网 IPv4 地址，并确认两台设备在同一可互访网络。Windows 自身使用 `127.0.0.1:8787` 连接底座。Node 中继 `pnpm relay` 仍用于浏览器开发和没有 Tauri Windows 的场景。

Rust 底座与 Node 中继使用相同的首条 `hello` 消息和地图状态快照协议；Windows 只读角色不能写入，iOS 控制端可以同步视角、界面和卷帘分割线。当前底座同步服务是局域网明文 WebSocket，不应直接暴露到公网；公网部署需 WSS、认证和反向代理。

## Linux Tauri 调试

Tauri Linux 使用 WebKitGTK，不能直接接 Chrome DevTools Protocol（CDP）。项目支持两种调试方式：

### 代理调试（推荐）

Tauri 和 Chromium 加载同一个 Vite 页面，因此前端 DOM、CSS、地图手势和同步页面逻辑可以用浏览器 CDP 检查：

```bash
pnpm dev
# 另一个终端
pnpm tauri dev
```

然后用浏览器 CDP 打开 `http://localhost:1420/?role=display` 或 `?role=controller`。涉及 Tauri `invoke` 的部分需要在真实 Tauri 窗口中验证，普通页面交互可直接由 CDP 检查。

### WebKit Inspector

启动 Tauri 时设置：

```bash
WEBKIT_INSPECTOR_SERVER=127.0.0.1:9334 RUST_LOG=info pnpm tauri dev
```

`9334` 是 WebKit 私有 Inspector 端口，不是 Chrome CDP HTTP 端点；它用于 WebKit Inspector 客户端，不要用 Chrome CDP 工具直接访问。若端口被占用，换一个本机端口。Linux 调试所需依赖可通过 `pnpm tauri info` 检查，至少需要 WebKitGTK 4.1、GTK、librsvg 和 Rust。

项目已删除模板中强制 `aarch64-apple-darwin` 的 Cargo 配置，Linux、Windows 桌面构建会使用当前主机目标；iOS 构建由 GitHub macOS runner 显式选择 Apple target。

Windows 展示端启动时自动全屏并置顶：先通过 Tauri 窗口 API 设置 always-on-top，再通过 Win32 `SetWindowPos(HWND_TOPMOST)` 设置原生 Z 序。手动切换全屏也走相同原生路径；退出全屏时恢复普通层级。Linux 保持窗口化，便于开发调试。Windows topmost 位于普通桌面窗口之上；系统安全桌面（例如 UAC 安全提示）仍由操作系统控制。

## 超大图演示资产

项目当前三图卷帘已换为本地同配准 Zoomify 展厅图，普通地图复用方案一。每张源图为 16000×9000、RGB TIFF 未压缩，432,000,140 字节（约 412 MiB）；每套切成 3045 张 256px JPEG 瓦片，包含 7 级金字塔。运行时仅按当前视口请求瓦片，不传输或解码完整 TIFF。

- 原图生成器：`scripts/generate-large-images.py`
- 原图及预览：`assets/source-images/`（大 TIFF 自动忽略，预览 JPG 保留）
- 瓦片：`public/zoomify/scheme-1/`、`scheme-2/`、`scheme-3/`
- 重新生成：`uv run --python .venv/bin/python scripts/generate-large-images.py`

**三图卷帘模式固定视角**，只操作分割线。**普通单图模式支持平移和缩放**。Linux Tauri 调试不自动全屏；Windows 展示端启动时自动全屏置顶。当前示意图为程序化测试素材，后续可替换为同尺寸、同配准的真实展厅方案图，并使用同一 Zoomify 目录结构。

### 将超大图交给 Tauri 本地瓦片服务器

前端采用按需请求的 Zoomify 瓦片。Tauri 的生产资源目录固定为构建前可知的静态文件，因此动态生成的数 GB 瓦片不建议全部打进安装包。项目可启动一个只读静态瓦片服务，供 iOS 和 Tauri 桌面访问：

```bash
pnpm tiles:serve
```

服务监听 `0.0.0.0:1421`，只暴露 `public/` 下已生成的瓦片。控制端 `.env` 中设置：

```dotenv
VITE_MAP_URL=http://192.168.1.50:1421/zoomify/scheme-1/
VITE_COMPARE_B_URL=http://192.168.1.50:1421/zoomify/scheme-2/
VITE_COMPARE_C_URL=http://192.168.1.50:1421/zoomify/scheme-3/
```

将 `192.168.1.50` 替换为运行服务器设备的局域网 IPv4；iOS 和服务器需处于可互访网络，防火墙开放 TCP 1421。大图应放在服务器的 `public/zoomify/` 下。静态示例瓦片现已保存到 Git，可直接网页预览；超大 TIFF 原图由生成脚本按需复现，默认不放进 Git。

### 地点嵌套对比与大图路由

主界面保留对比图，顶部四个图按钮通过 `/map/:pageId` 进入同一个 Ionic 二级页面组件，用 Ionic 返回栈回到主界面。设置页不影响大屏当前画面；主对比页由 Ionic RouterOutlet 缓存。

`src/map/catalog.json` 集中配置地点、每个地点的图片列表和独立大图入口。地点数与各地点图片数可不同；分割线数量按各列表长度自动生成。外层改变地点容器宽度，内层按该地点自身宽度裁切图片。比较页固定全图，二级大图支持手势平移、缩放，各图分别保存相机状态。

仓库目前只有三套现有 Zoomify 图片，因此默认三个地点使用同一组已有图片，图4暂复用第一套图片。这里是可替换的数据配置，尚未收到客户各地点及第四张大图的独立素材，不代表已导入新素材。

同步状态包括当前地图页面、外层边界、每地点内层边界及各大图视角。控制端连上房间立即发布自己的状态，大屏只读跟随；控制端断开时不清空大屏画面。当前同步协议前后端均使用完整状态快照，拖动仍为最多每16ms推送一次。
