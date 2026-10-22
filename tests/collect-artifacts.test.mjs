import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { collectArtifacts } from '../scripts/collect-artifacts.mjs';
const commit = '12345678' + 'a'.repeat(32);
async function fixture(t) {
  await mkdir('tmp', { recursive: true });
  const root = await mkdtemp(resolve('tmp/collect-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const ios = join(root, 'signed-12345678'), windows = join(root, 'windows-12345678');
  await mkdir(ios); await mkdir(windows);
  const ipa = Buffer.from('已验证的IPA测试数据');
  const report = { sourceCommit: commit.slice(0, 8), cmsSignatureVerified: true, sha256: createHash('sha256').update(ipa).digest('hex') };
  await writeFile(join(ios, '展厅App.ipa'), ipa);
  await writeFile(join(ios, '校验结果.json'), JSON.stringify(report));
  await writeFile(join(windows, '展厅App_0.1.0_x64-setup.exe'), Buffer.from('MZ安装包测试数据'));
  return { sourceRoot: root, outDir: join(root, 'out'), commit, ios, windows, report };
}
test('同一提交的已签名IPA和Windows安装包归档到out，带校验清单', async t => {
  const options = await fixture(t);
  const result = await collectArtifacts(options);
  assert.equal(result.commit, commit);
  assert.equal(result.artifacts.length, 2);
  for (const item of result.artifacts) {
    const content = await readFile(join(options.outDir, item.file));
    assert.equal(createHash('sha256').update(content).digest('hex'), item.sha256);
  }
  assert.equal(JSON.parse(await readFile(join(options.outDir, '交付清单.json'), 'utf8')).commit, commit);
});
test('签名报告提交号不匹配时拒绝交付，保留已有成品', async t => {
  const options = await fixture(t);
  await mkdir(options.outDir); await writeFile(join(options.outDir, '已有成品.txt'), '保留');
  await writeFile(join(options.ios, '校验结果.json'), JSON.stringify({ ...options.report, sourceCommit: 'aaaaaaaa' }));
  await assert.rejects(collectArtifacts(options), /提交/);
  assert.equal(await readFile(join(options.outDir, '已有成品.txt'), 'utf8'), '保留');
});
test('缺少Windows成品时不交付半套文件', async t => {
  const options = await fixture(t);
  await rm(options.windows, { recursive: true });
  await assert.rejects(collectArtifacts(options), /Windows/);
  await assert.rejects(readFile(join(options.outDir, '展厅App.ipa')));
});
test('IPA被改动时校验失败，不复制到out', async t => {
  const options = await fixture(t);
  await writeFile(join(options.ios, '展厅App.ipa'), '已被修改');
  await assert.rejects(collectArtifacts(options), /校验/);
});
