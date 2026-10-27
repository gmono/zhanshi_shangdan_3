import { useEffect, useState } from 'react';
import { parseCatalog, type ResourceCatalog } from './resourceCatalog';
import { parseProgress, type ResourceProgress } from './resourceProgress';

export function useResourceCatalog(host: string, enabled: boolean, retain: boolean) {
  const [loaded, setLoaded] = useState<{ host: string; catalog: ResourceCatalog } | null>(null);
  const [message, setMessage] = useState('');
  const [progress, setProgress] = useState<ResourceProgress | null>(null);
  useEffect(() => {
    if (!enabled || !host) return;
    let stopped = false;
    let socket: WebSocket | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let latest: ResourceProgress | null = null;
    const url = `ws://${host}:1421/events`;
    setProgress(null);
    setMessage('正在连接地图处理通知服务…');
    const connect = () => {
      if (stopped) return;
      let ws: WebSocket;
      const failed = () => {
        if (stopped || (ws && socket !== ws)) return;
        if (ws) { ws.onmessage = null; ws.onclose = null; ws.onerror = null; ws.close(); }
        socket = undefined;
        const detail = `Windows 地图通知连接中断：${url}`;
        latest = { ...latest, phase: 'error', completed: latest?.completed || 0, total: latest?.total || 0, elapsedMs: latest?.elapsedMs || 0, message: '地图处理通知连接中断，正在重连', error: detail };
        setProgress(latest); setMessage(latest.message);
        // 仅连接失败后重连；已连接时没有定时查询。
        retry = setTimeout(connect, 1000);
      };
      try { ws = new WebSocket(url); socket = ws; } catch { failed(); return; }
      ws.onmessage = event => {
        if (stopped || socket !== ws) return;
        try {
          const value = JSON.parse(event.data);
          const reported = parseProgress(value?.progress);
          const catalog = parseCatalog(value?.catalog);
          if (!reported || (reported.phase === 'ready' && !catalog)) return;
          latest = reported;
          setProgress(reported); setMessage(catalog ? '' : reported.message);
          if (catalog) setLoaded({ host, catalog });
        } catch { /* 非法消息不能覆盖已验证的状态。 */ }
      };
      ws.onclose = failed;
      ws.onerror = failed;
    };
    connect();
    return () => {
      stopped = true; clearTimeout(retry);
      if (socket) { socket.onmessage = null; socket.onclose = null; socket.onerror = null; socket.close(); }
    };
  }, [host, enabled]);
  return { catalog: loaded && loaded.host === host && (enabled || retain) ? loaded.catalog : null, message, progress };
}
