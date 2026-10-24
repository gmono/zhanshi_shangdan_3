import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function filesBelow(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = await Promise.all(entries.map(entry => entry.isDirectory() ? filesBelow(join(root, entry.name)) : [join(root, entry.name)]));
  return files.flat();
}
async function dirSummary(root) {
  try {
    const files = (await filesBelow(root)).filter(file => !file.split(sep).includes('.cache'));
    let bytes = 0;
    for (const file of files) bytes += (await stat(file)).size;
    return { path: '地图资源', files: files.length, bytes };
  } catch { return null; }
}
export async function collectArtifacts({ commit, sourceRoot, outDir }) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('需要完整的 Git 提交号');
  const short = commit.slice(0, 8);
  const iosRoot = join(sourceRoot, `signed-${short}`);
  const report = JSON.parse(await readFile(join(iosRoot, '校验结果.json'), 'utf8'));
  if (![short, commit].includes(report.sourceCommit)) throw new Error('IPA 校验报告与当前提交不一致');
  const ipa = join(iosRoot, '展厅App.ipa');
  const ipaBytes = await readFile(ipa);
  if (!report.cmsSignatureVerified || digest(ipaBytes) !== report.sha256) throw new Error('IPA 签名或文件校验失败');
  let windows;
  try { windows = (await filesBelow(join(sourceRoot, `windows-${short}`))).filter(file => file.endsWith('-setup.exe')); }
  catch { throw new Error('缺少当前提交的 Windows 安装包'); }
  if (windows.length !== 1) throw new Error('Windows 安装包必须唯一');
  const winBytes = await readFile(windows[0]);
  if (winBytes.subarray(0, 2).toString() !== 'MZ') throw new Error('Windows 成品不是有效的 EXE');
  const entries = [
    { source: ipa, file: '展厅App.ipa', bytes: ipaBytes },
    { source: windows[0], file: '展厅App-Windows-x64-setup.exe', bytes: winBytes },
  ];
  const manifest = { commit, collectedAt: new Date().toISOString(), resources: await dirSummary(join(outDir, '地图资源')), artifacts: entries.map(({ file, bytes }) => ({ file, bytes: bytes.length, sha256: digest(bytes) })) };
  // 所有来源校验通过后才开始写入交付目录；不删除用户的其他文件。
  await mkdir(outDir, { recursive: true });
  const staging = join(outDir, `.staging-${short}`);
  await mkdir(staging, { recursive: true });
  try {
    for (const item of entries) await copyFile(item.source, join(staging, item.file));
    await writeFile(join(staging, '交付清单.json'), JSON.stringify(manifest, null, 2) + '\n');
    for (const name of [...entries.map(item => item.file), '交付清单.json']) await rename(join(staging, name), join(outDir, name));
  } finally { await rm(staging, { recursive: true, force: true }); }
  return manifest;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const changes = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root, encoding: 'utf8' }).trim();
  if (changes) throw new Error('工作区有未提交修改，不能将旧提交成品作为本次交付');
  const manifest = await collectArtifacts({ commit, sourceRoot: join(root, 'tmp'), outDir: join(root, 'out') });
  console.log(`已归档提交 ${commit.slice(0, 8)} 的 ${manifest.artifacts.length} 个成品到 ${join(root, 'out')}`);
}
