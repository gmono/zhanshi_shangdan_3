"""导入NASA真实超大图，按原始像素裁剪并生成标准Zoomify瓦片。"""
from pathlib import Path
import argparse
import hashlib
import json
import os
import subprocess
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor

ROOT = Path(__file__).resolve().parent.parent
(ROOT / 'tmp').mkdir(parents=True, exist_ok=True)
os.environ.setdefault('VIPS_CONCURRENCY', '2')
os.environ.setdefault('TMPDIR', str(ROOT / 'tmp'))
import pyvips


def download_source(item):
    source = ROOT / item['sourcePath']
    if source.exists():
        return
    source.parent.mkdir(parents=True, exist_ok=True)
    part = source.with_suffix('.part')
    subprocess.run(['curl', '--fail', '--location', '--retry', '2', '--retry-delay', '2',
                    '--connect-timeout', '30', '--max-time', '900', '--silent', '--show-error',
                    '--output', str(part), item['url']], check=True)
    part.rename(source)


def import_images(download=False, tiles_only=False):
    config = json.loads((ROOT / 'assets/image-sources.json').read_text())
    if download:
        with ThreadPoolExecutor(max_workers=3) as pool:
            list(pool.map(download_source, config['images']))
    pyvips.cache_set_max_mem(64 * 1024 * 1024)
    records = []
    for item in config['images']:
        source = ROOT / item['sourcePath']
        if not source.exists():
            raise FileNotFoundError(f'缺少原始图片 {source}，请添加 --download 下载官方原图')
        image = pyvips.Image.new_from_file(str(source), access='sequential')
        out = ROOT / 'public/zoomify' / item['id']
        marker = out / 'source.json'
        source_sha256 = hashlib.sha256(source.read_bytes()).hexdigest()
        if source_sha256 != item['expectedSha256']:
            raise ValueError(f'{item["id"]}原图校验失败，与来源配置不一致')
        if marker.exists():
            saved = json.loads(marker.read_text())
            if saved['sourceSha256'] != source_sha256 or saved['crop'] != item['crop']:
                raise ValueError(f'{item["id"]}已有瓦片与当前源配置不一致')
            records.append(saved)
            print(f'{item["id"]}: 复用已校验的原图和瓦片', flush=True)
            continue
        if image.width < item['width'] or image.height < item['height']:
            raise ValueError(f'{item["id"]}原图分辨率不足，禁止通过放大凑尺寸')
        left, top, width, height = item['crop']
        if [width, height] != config['outputSize'] or left + width > image.width or top + height > image.height:
            raise ValueError(f'{item["id"]}裁剪范围不合法')
        original_size = [image.width, image.height]
        cropped = image.crop(left, top, width, height)
        if cropped.bands != 3 or cropped.format != 'uchar':
            raise ValueError('仅接收RGB 8位原始图片')
        raw = ROOT / 'assets/source-images' / f'{item["id"]}.tif'
        if not tiles_only:
            raw.parent.mkdir(parents=True, exist_ok=True)
            cropped.tiffsave(str(raw), compression='none', tile=False)
        if out.exists():
            raise FileExistsError(f'{out}已经存在，避免覆盖现有资源，请先检查并清理该图片的旧瓦片')
        # 流式读取本地原图切片，不一次性创建整图或在浏览器解码巨图。
        loaded = cropped if tiles_only else pyvips.Image.new_from_file(str(raw), access='sequential')
        loaded.dzsave(str(out), layout='zoomify', tile_size=256, overlap=0,
                      depth='onetile', suffix='.jpg[Q=85,strip]', skip_blanks=-1, keep=0)
        (out.parent / 'vips-properties.xml').unlink(missing_ok=True)
        metadata = ET.parse(out / 'ImageProperties.xml').getroot().attrib
        if not tiles_only:
            preview = ROOT / 'assets/source-images' / f'{item["id"]}-preview.jpg'
            pyvips.Image.thumbnail(str(raw), 1200).jpegsave(str(preview), Q=88, strip=True)
        record = {
            **item, 'url': f'/zoomify/{item["id"]}/', 'sourceUrl': item['url'],
            'sourcePage': config['sourcePage'], 'credit': config['credit'],
            'originalSize': original_size, 'sourceSha256': source_sha256,
            'sourceBytes': source.stat().st_size, 'uncompressedBytes': width * height * 3,
            'tiffBytes': None if tiles_only else raw.stat().st_size, 'tiles': int(metadata['NUMTILES']),
        }
        records.append(record)
        marker.write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n')
        print(f'{item["label"]} {item["dateLabel"]}: {width}×{height}，未压缩RGB为{width * height * 3:,}字节，{record["tiles"]}瓦片', flush=True)
        (ROOT / 'tmp/image-research').mkdir(parents=True, exist_ok=True)
        (ROOT / 'tmp/image-research/import-progress.json').write_text(json.dumps(records, ensure_ascii=False, indent=2))
    (ROOT / 'public/zoomify/manifest.json').write_text(json.dumps(records, ensure_ascii=False, indent=2) + '\n')
    return records


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--download', action='store_true', help='缺少原图时从NASA官方下载')
    parser.add_argument('--tiles-only', action='store_true', help='只生成运行瓦片，不写未压缩TIFF和预览图，供CI使用')
    args = parser.parse_args()
    import_images(args.download, args.tiles_only)
