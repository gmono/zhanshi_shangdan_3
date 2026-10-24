import { useEffect, useState } from 'react';
import { parseCatalog, type ResourceCatalog } from './resourceCatalog';
import { BehaviorSubject } from 'rxjs';
import { delay, parseProgress, resourceProgress$, type ResourceProgress } from './resourceProgress';

export function useResourceCatalog(host: string, enabled: boolean, retain: boolean) {
  const [loaded, setLoaded] = useState<{ host: string; catalog: ResourceCatalog } | null>(null);
  const [message, setMessage] = useState('');
  const [progress, setProgress] = useState<ResourceProgress | null>(null);
  useEffect(() => {
    if (!enabled || !host) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let request: AbortController;
    const subject = new BehaviorSubject<ResourceProgress | null>(null);
    const subscription = subject.subscribe(value => { setProgress(value); resourceProgress$.next(value); });
    const poll = async () => {
      await delay(0);
      if (stopped) return;
      request = new AbortController();
      const deadline = setTimeout(() => request.abort(), 5000);
      try {
        const response = await fetch(`http://${host}:1421/catalog`, { signal: request.signal, cache: 'no-store' });
        const value = await response.json();
        await delay(0);
        if (stopped) return;
        const catalog = response.ok ? parseCatalog(value) : null;
        const reported = parseProgress(value?.progress);
        subject.next(catalog ? { phase: 'ready', completed: reported?.total || 11, total: reported?.total || 11, elapsedMs: reported?.elapsedMs || subject.value?.elapsedMs || 0, message: '全部地图准备完成' } : reported);
        await delay(0);
        if (stopped) return;
        if (catalog) { setLoaded({ host, catalog }); setMessage(''); return; }
        setMessage(typeof value?.message === 'string' ? value.message : 'Windows 地图资源尚未就绪');
      } catch (error) {
        await delay(0);
        if (!stopped) {
          const detail = `无法读取 Windows 地图状态：http://${host}:1421/catalog\n${error instanceof Error ? error.message : String(error)}`;
          subject.next({ ...subject.value, phase: 'error', completed: subject.value?.completed || 0, total: subject.value?.total || 11, elapsedMs: subject.value?.elapsedMs || 0, message: '无法读取 Windows 地图处理状态，正在重连', error: detail });
          setMessage(detail);
        }
      }
      finally { clearTimeout(deadline); }
      await delay(0);
      if (!stopped) timer = setTimeout(poll, 500);
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); request?.abort(); subscription.unsubscribe(); subject.complete(); };
  }, [host, enabled]);
  return { catalog: loaded && loaded.host === host && (enabled || retain) ? loaded.catalog : null, message, progress };
}
