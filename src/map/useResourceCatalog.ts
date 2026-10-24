import { useEffect, useState } from 'react';
import { parseCatalog, type ResourceCatalog } from './resourceCatalog';

export function useResourceCatalog(host: string, enabled: boolean, retain: boolean) {
  const [loaded, setLoaded] = useState<{ host: string; catalog: ResourceCatalog } | null>(null);
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!enabled || !host) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let request: AbortController;
    const poll = async () => {
      request = new AbortController();
      const deadline = setTimeout(() => request.abort(), 5000);
      try {
        const response = await fetch(`http://${host}:1421/catalog`, { signal: request.signal, cache: 'no-store' });
        const value = await response.json();
        if (stopped) return;
        const catalog = response.ok ? parseCatalog(value) : null;
        if (catalog) { setLoaded({ host, catalog }); setMessage(''); return; }
        setMessage(typeof value?.message === 'string' ? value.message : 'Windows 地图资源尚未就绪');
      } catch { if (!stopped) setMessage('请连接 Windows 大屏'); }
      finally { clearTimeout(deadline); }
      if (!stopped) timer = setTimeout(poll, 2000);
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); request?.abort(); };
  }, [host, enabled]);
  return { catalog: loaded && loaded.host === host && (enabled || retain) ? loaded.catalog : null, message };
}
