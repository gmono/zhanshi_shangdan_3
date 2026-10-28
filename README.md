# 观境 · 展厅双端地图

基于 [Tauronic](https://github.com/rgilsimoes/Tauronic) 初始化，同一个 Tauri 2 + Ionic React 软件用于 iOS 和 Windows。

当前资源命名、地图自动发现、同步顺序、错误展示和交付规则见 [项目约定](docs/项目约定.md)。下文历史说明与其不一致时，以项目约定为准。

- **主屏：三个地点的嵌套卷帘对比**。外层调整地点宽度，内层比较同一地点不同月份的图片。
- **子界面：普通地图**。iOS 点击按钮进入，可返回三图主屏，也支持浏览器后退。
- **iOS：操作端**。单图支持单指平移、双指缩放；对比页支持触摸拖动两级分割线；连接配置放在独立设置页。
- **Windows：展示端**。启动后全屏并保持 topmost，跟随 iOS 的界面、视角、图层和分割比例。
- **Windows 退出快捷键：`Ctrl + Win + Q`**。使用原生按键处理退出整个应用，在应用运行期间接管此组合键；退出后恢复系统原有行为。Linux 和 iOS 不注册此快捷键。
- **Windows 管理员权限**。应用清单要求启动时通过 UAC 授权；此清单仅用于 Windows，不改变 iOS 或 Linux 权限。

## 启动

需要 Node.js 24 和 pnpm 10。

```bash
pnpm install
# 首次检出需要先按后面的“复现资源”步骤生成本地瓦片。
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

## 成品交付

每次完成当前提交的双端构建及本地 iOS 签名校验后，执行：

```bash
pnpm artifacts:collect
```

脚本从 `tmp/signed-提交号/` 和 `tmp/windows-提交号/` 收集同一提交的成品，验证 IPA 签名报告及 SHA-256，然后归档到 `out/展厅App.ipa`、`out/展厅App-Windows-x64-setup.exe`，并生成 `out/交付清单.json`。缺包、校验失败或提交号不符时拒绝交付；证书不会复制到 `out/`。

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

工程文件格式固定为 `objectVersion = 56`、`compatibilityVersion = "Xcode 14.0"`。应用和 UI 测试的 XcodeGen 配置都必须使用 `projectFormat: xcode14_0`，不能随生成工具升级工程格式。CI 通过 `node scripts/check-xcode-format.mjs` 检查已有工程和临时生成的测试工程。

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

## 超大图真实影像资产

当前三个地点使用不同的 NASA Blue Marble: Next Generation 影像：**北美东部、欧洲与西亚、东亚**。每个地点分别使用 **2004年1月、7月、10月** 的真实月度合成图，共9张独立源图。资料来源为 NASA Earth Observatory，具体来源、下载地址、裁剪范围和文件校验值保存在 `assets/image-sources.json` 与 `public/zoomify/manifest.json`。这些影像用于演示，不代表客户展厅数据。

官方原始分幅为21600×21600；按相同地点固定范围原生像素裁剪为 **16000×9000**，不插值放大。每张未压缩RGB TIFF为432,000,790字节（约412MiB），每套输出3045个256px JPEG瓦片、7级Zoomify金字塔。客户端只按视口加载瓦片，不解码完整TIFF。

- 导入程序：`scripts/import-large-images.py`，使用libvips流式处理并限制并行度。
- 来源配置：`assets/image-sources.json`；逐图来源与尺寸记录：`public/zoomify/manifest.json`。
- 原始下载放在 `tmp/image-research/`，未压缩原图及预览放在 `assets/source-images/`；图片、预览、瓦片和生成清单全部忽略，不提交Git。
- 正式瓦片：`public/zoomify/north-america-年月/`、`europe-年月/`、`east-asia-年月/`，由脚本生成并随安装包离线提供；仓库只保存来源配置和脚本。

复现资源：

```bash
UV_CACHE_DIR=./tmp/uv-cache uv venv .venv --python 3.11
UV_CACHE_DIR=./tmp/uv-cache uv pip install --python .venv/bin/python -r scripts/image-tools-requirements.txt
.venv/bin/python scripts/import-large-images.py --download --tiles-only
```

`--tiles-only`只生成运行瓦片，不写大TIFF或预览；需要保存未压缩原图时去掉这个参数。已完成且来源校验一致的图片会复用；已有但未完成的目录需要检查后清理再重试。GitHub CI先按来源配置生成或恢复缓存，再把生成资源交给各端构建，不从Git检出图片。历史示意图生成脚本不再用于当前素材。

### 使用独立本地瓦片服务

默认资源为安装包内相对地址，也可启动只读静态瓦片服务：

```bash
pnpm tiles:serve
```

服务监听 `0.0.0.0:1421`，暴露 `public/`。如果使用该服务，在 `src/map/catalog.json` 把相应图片URL改成 `http://展厅电脑局域网IP:1421/zoomify/图片目录/`，保持两端使用同一份清单，并允许防火墙TCP1421。应用自身的相对地址模式不需要这个额外服务。

### 地点嵌套对比与大图路由

主界面保留对比图，顶部四个图按钮通过 `/map/:pageId` 进入同一个 Ionic 二级页面组件，用 Ionic 返回栈回到主界面。设置页不影响大屏当前画面；主对比页由 Ionic RouterOutlet 缓存。

`src/map/catalog.json` 集中配置地点、每个地点的图片列表和独立大图入口。地点数与各地点图片数可不同；分割线数量按各列表长度自动生成。外层改变地点容器宽度，内层按该地点自身宽度裁切图片。比较页固定全图，二级大图支持手势平移、缩放，各图分别保存相机状态。

三个地点的图片集合完全独立，每个地点内部三张图保持同一裁剪范围。图1、图2、图3分别进入三个地区的1月影像，图4进入东亚7月影像，四个入口使用不同图片。

同步状态包括当前地图页面、外层边界、每地点内层边界及各大图视角。控制端连上房间立即发布自己的状态，大屏只读跟随；控制端断开时不清空大屏画面。当前同步协议前后端均使用完整状态快照，拖动仍为最多每16ms推送一次。
