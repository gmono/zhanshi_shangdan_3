import type { ResourceProgress } from './resourceProgress';

export function ResourceStatus({ message, progress }: { message: string; progress?: ResourceProgress | null }) {
  const failed = progress?.phase === 'error';
  return <div className={`display-status resource-status ${failed ? 'resource-failed' : ''}`} role="status" aria-live="polite">
    <section>
      <h1>{failed ? '地图准备失败' : '正在准备地图资源'}</h1>
      <p>{progress?.message || message || '正在连接地图处理服务…'}</p>
      {progress && <>
        <label>已完成 {progress.completed} / {progress.total} 张原图（{Math.floor(progress.completed / progress.total * 100)}%）
          <progress max={progress.total} value={progress.completed} aria-label="地图准备进度" />
        </label>
        <p>已耗时 {(progress.elapsedMs / 1000).toFixed(1)} 秒{progress.currentFile ? ` · 当前文件：${progress.currentFile}` : ''}</p>
        {progress.phase === 'processing' && <p>当前文件正在处理中，完成后更新总进度。</p>}
        {progress.sourcePath && <p className="resource-path">原图路径：{progress.sourcePath}</p>}
      </>}
      {(failed || !progress) && <pre className="resource-error">{progress?.error || message}</pre>}
      {failed && <>
        {progress.processorPath && <p className="resource-path">图片处理器：{progress.processorPath}</p>}
        {progress.logPath && <p className="resource-path">错误记录：{progress.logPath}</p>}
        <p>请检查上面的文件、目录权限和错误信息。修复后程序会自动重试。</p>
      </>}
    </section>
  </div>;
}
