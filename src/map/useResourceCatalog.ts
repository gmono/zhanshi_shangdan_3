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
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let latest: ResourceProgress | null = null;
    const url = `ws://${host}:1421/events`;
    setProgress(null);
    setMessage('正在连接地图处理通知服务…');
    const connect = () => {
      if (stopped) return;
      let ws: WebSocket;
      const failed = (reason = '通知连接已关闭。请检查 Windows 程序和 TCP 1421 端口。', message = '地图处理通知连接中断，正在重连') => {
        if (stopped || (ws && socket !== ws)) return;
        clearTimeout(timeout);
        if (ws) { ws.onopen = null; ws.onmessage = null; ws.onclose = null; ws.onerror = null; ws.close(); }
        socket = undefined;
        const detail = `Windows 地图通知地址：${url}\n${reason}`;
        latest = { ...latest, phase: 'error', completed: latest?.completed || 0, total: latest?.total || 0, elapsedMs: latest?.elapsedMs || 0, message, error: detail };
        setProgress(latest); setMessage(latest.message);
        // 仅连接失败后重连；已连接时没有定时查询。
        retry = setTimeout(connect, 1000);
      };
      try { ws = new WebSocket(url); socket = ws; }
      catch (error) { failed(`无法创建地图通知连接：${String(error)}`); return; }
      // 只约束建连及首条有效状态的等待，不限制后续巨图处理时长。
      timeout = setTimeout(() => failed('连接超时：10秒内未能建立通知连接。请确认 Windows 程序已启动，且防火墙允许 TCP 1421；同步端口 8787 连通不代表资源端口已连通。'), 10000);
      ws.onopen = () => {
        if (stopped || socket !== ws) return;
        clearTimeout(timeout);
        if (!latest) setMessage('地图通知连接已建立，正在等待 Windows 返回当前状态…');
        timeout = setTimeout(() => failed('通知连接已建立，但10秒内未收到首条有效状态。请检查 Windows 地图服务和两端版本。'), 10000);
      };
      ws.onmessage = event => {
        if (stopped || socket !== ws) return;
        try {
          const value = JSON.parse(event.data);
          const reported = parseProgress(value?.progress);
          const catalog = parseCatalog(value?.catalog);
          if (!reported) {
            failed(`地图进度消息格式无效，缺少有效状态、数量或耗时。\n收到的进度：${JSON.stringify(value?.progress ?? null)}`, '地图通知消息错误，正在重连');
            return;
          }
          if (reported.phase === 'ready' && !catalog) {
            failed('Windows 已报告准备完成，但地图目录缺失或格式无效。请确认两端使用同一版本；目录应包含左屏、中屏、右屏各两张图，以及连续编号的图1至图10中的实际地图。', '地图资源目录错误，正在重连');
            return;
          }
          clearTimeout(timeout);
          latest = reported;
          setProgress(reported); setMessage(catalog ? '' : reported.message);
          if (catalog) setLoaded({ host, catalog });
        } catch (error) { failed(`地图通知 JSON 解析失败：${String(error)}`, '地图通知消息错误，正在重连'); }
      };
      ws.onclose = () => failed();
      ws.onerror = () => failed('地图通知连接发生网络错误。请检查 Windows 程序是否运行、地址是否正确，以及防火墙是否允许 TCP 1421。');
    };
    connect();
    return () => {
      stopped = true; clearTimeout(retry); clearTimeout(timeout);
      if (socket) { socket.onopen = null; socket.onmessage = null; socket.onclose = null; socket.onerror = null; socket.close(); }
    };
  }, [host, enabled]);
  return { catalog: loaded && loaded.host === host && (enabled || retain) ? loaded.catalog : null, message, progress };
}
