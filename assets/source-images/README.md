# 超大图测试资产

运行 `uv run --python .venv/bin/python scripts/generate-large-images.py` 可重新生成三套同尺寸、同坐标系的展厅方案图与 Zoomify 多级瓦片。

- 每套原图：16000 × 9000，RGB TIFF 未压缩，432,000,140 字节（约 412 MiB）。原始 TIFF 由 Git 忽略。
- 每套瓦片：256 × 256 JPEG，7 个缩放级别，3045 张；前端只请求视口范围中的瓦片。
- `public/zoomify/manifest.json` 记录生成清单。`*-preview.jpg` 可预览原图。
- 三图使用相同视角且禁止平移/缩放，确保三套平面图严格配准；单图模式可平移/缩放。

生成的是用于压力和交互验证的程序化示意平面图，不代表真实建筑测绘资料。
