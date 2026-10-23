# Windows 虚拟机与文件导出

## 已有环境

Windows 10 Pro 22H2 已安装在 Docker 管理的 QEMU/KVM 虚拟机中。独立环境根目录为 `/media/phnics/WorkData/windows-test`，系统盘、镜像、缓存、日志和共享文件均在 WorkData；不使用系统默认 Docker 存储，不删除现有数据。

- 管理脚本：`/media/phnics/WorkData/windows-test/manage.sh`。
- 配置文件：`/media/phnics/WorkData/windows-test/compose.yml`。
- Docker socket：`/media/phnics/WorkData/windows-test/runtime/docker.sock`。
- Docker 数据：`/media/phnics/WorkData/windows-test/daemon/data`。
- Windows 系统盘：`/media/phnics/WorkData/windows-test/storage/vm`，QCOW2 按需增长，逻辑容量40GB。
- 资源：2个虚拟CPU、3GB内存；容器内存上限5GB，不使用容器交换。
- 浏览器桌面：<http://127.0.0.1:8006/>。
- 本机RDP：`127.0.0.1:3390`。
- 展厅同步服务：Windows内8787，宿主机映射8788。

## 启停

```bash
/media/phnics/WorkData/windows-test/manage.sh start
/media/phnics/WorkData/windows-test/manage.sh status
/media/phnics/WorkData/windows-test/manage.sh logs
/media/phnics/WorkData/windows-test/manage.sh stop
```

脚本会验证 WorkData 挂载和独立 Docker 数据目录。不要用系统默认 `docker` 命令替代这个脚本。

本次会话通过用户级临时服务 `exhibition-windows-docker-persistent.service` 托管独立 Docker，避免终端退出导致后台进程丢失。服务没有设为开机自动启动，服务日志位于 `/media/phnics/WorkData/windows-test/logs/docker-service.log`。查询：

```bash
systemctl --user status exhibition-windows-docker-persistent.service
```

## 百度网盘下载与宿主机取出

Windows 的 `\\host.lan\Data` 对应宿主机 `/media/phnics/WorkData/windows-test/share`。此共享目录可写，不需要通过浏览器逐张导出。

百度网盘下载图片时，将下载位置指定为共享目录下的 `BaiduDownloads`。如果客户端不支持网络路径，可把共享目录映射为盘符后选择，或先下载到虚拟机再复制到共享目录。

- Windows 路径：`\\host.lan\Data\BaiduDownloads`。
- 宿主机路径：`/media/phnics/WorkData/windows-test/share/BaiduDownloads`。

文件写到共享目录后已位于 WorkData 实体硬盘。需要导入项目时，再复制到被 Git 忽略的 `assets/source-images/`；原始图片、下载缓存和安装包均不提交。

`\\host.lan\Data\release` 是本项目 `out/` 的只读成品目录，不能作为网盘下载位置。登录、验证码由用户本人完成，账号信息不写入仓库。

## Windows 版内置服务

Windows Tauri 程序自身提供展厅服务，不需要另开 Node 服务：WebSocket 状态同步固定为 `8787`，Zoomify 瓦片 HTTP 固定为 `1421`，局域网发现请求固定为 UDP `8789`。iOS 设置页只输入 Windows IPv4 地址，协议、端口、域名和房间密钥均由程序固定。

iOS 点击“搜索”时发送一次局域网发现请求；Windows 收到后返回自己的 IPv4 地址和“展厅App”名称，不做周期广播。路由器禁止广播、启用访客隔离或跨网段时，搜索可能为空，此时可手动输入 IPv4 地址。未连接 Windows 时，iOS 显示连接提示层，不加载完整地图瓦片。

Windows 地图资源约定：安装包旁建立 `地图资源/zoomify/`，目录内使用现有 Zoomify 标准结构；每个目录名使用 `地点-年份`，例如 `地点1-2023/TileGroup0/0-0-0.jpg` 和同目录的 `ImageProperties.xml`。程序启动时优先读取这个目录，用户替换资源后重启 Windows 展厅即可生效。资源目录不进入 iOS 包，也不提交 Git。

## 当前百度网盘任务

- 分享：`序厅-遥感图`，包含三个地点的多年份遥感图片；账号登录和会员状态由用户本人完成。
- 下载目录：`/media/phnics/WorkData/windows-test/share/BaiduDownloads/序厅-遥感图`，Windows中对应 `B:\BaiduDownloads\序厅-遥感图`。
- 下载任务已启动为整个文件夹，客户端当前并发5个任务；`.baiduyun.p.downloading` 文件表示仍在下载，不能提前改名或导入。
- 已完成文件和像素尺寸记录在项目临时文件 `tmp/baidu-image-inventory.json`，下载过程不写入 Git。
- 用户另提供的 `456.jpg` 原图为 49969×27750、约421MB，已复制为 `assets/source-images/single-maps/map-1.jpg` 至 `map-5.jpg`；五份 SHA-256 一致。图片目录被 Git 忽略，不提交。
