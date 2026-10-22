import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
const catalog = JSON.parse(await readFile(new URL('../src/map/catalog.json', import.meta.url), 'utf8'));

test('三个地点使用独立的真实大图，各地点内部保留相同区域的三个月份对比', async () => {
  const manifest = JSON.parse(await readFile(new URL('../public/zoomify/manifest.json', import.meta.url), 'utf8'));
  const urls = catalog.locations.flatMap(place => place.images);
  assert.equal(new Set(urls).size, 9, '不能在三个地点重复使用同一套图片');
  assert.equal(manifest.length, 9);
  for (const place of catalog.locations) {
    const records = place.images.map(url => manifest.find(item => item.url === url));
    assert.ok(records.every(Boolean));
    assert.equal(new Set(records.map(item => item.region)).size, 1);
    assert.equal(new Set(records.map(item => item.sourceSha256)).size, 3);
    assert.equal(new Set(records.map(item => JSON.stringify(item.crop))).size, 1, '同一地点必须保持相同配准范围');
    for (const item of records) {
      assert.ok(item.originalSize[0] >= 16000 && item.originalSize[1] >= 9000);
      assert.equal(item.width, 16000); assert.equal(item.height, 9000);
      assert.equal(item.uncompressedBytes, 432000000);
      assert.ok(item.sourceUrl.startsWith('https://assets.science.nasa.gov/'));
      const folder = resolve('public', item.url.slice(1));
      const xml = await readFile(join(folder, 'ImageProperties.xml'), 'utf8');
      assert.match(xml, /WIDTH="16000"/); assert.match(xml, /HEIGHT="9000"/);
      const groups = (await readdir(folder)).filter(name => name.startsWith('TileGroup'));
      const tiles = (await Promise.all(groups.map(name => readdir(join(folder, name))))).flat();
      assert.equal(tiles.length, item.tiles);
      const first = await readFile(join(folder, 'TileGroup0', '0-0-0.jpg'));
      assert.equal(first.readUInt16BE(0), 0xffd8);
    }
  }
  assert.ok(catalog.maps.every(page => urls.includes(page.url)));
});
