import { useEffect, useRef, useState } from 'react';
import { IonButton, IonIcon } from '@ionic/react';
import { arrowBackOutline, cameraOutline } from 'ionicons/icons';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { createCameraRenderer, type CameraRenderer } from './cameraRenderer';

interface Props {
  controller: boolean;
  host: string;
  onBack?: () => void;
  disabled?: boolean;
}

const labels = { near: '近焦', far: '远焦', in: '放大', out: '缩小' } as const;
interface SharedBufferEvent { getBuffer: () => ArrayBuffer; additionalData: string }
interface WebViewBridge {
  addEventListener(name: string, handler: (event: SharedBufferEvent) => void): void;
  removeEventListener(name: string, handler: (event: SharedBufferEvent) => void): void;
}
type Action = keyof typeof labels;

export function CameraPage({ controller, host, onBack, disabled = false }: Props) {
  const [status, setStatus] = useState('正在等待相机画面…');
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState('');
  const [live, setLive] = useState(false);
  const [testFrame, setTestFrame] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<CameraRenderer | null>(null);

  useEffect(() => {
    if (controller || !isTauri()) return;
    const webview = (window as unknown as { chrome?: { webview?: WebViewBridge } }).chrome?.webview;
    if (!webview) return;
    const onBuffer = (event: SharedBufferEvent) => {
      try {
        const meta = JSON.parse(event.additionalData);
        if (!canvas.current) return;
        renderer.current?.dispose();
        renderer.current = createCameraRenderer(canvas.current, event.getBuffer(), meta, source => {
          setLive(true);
          setTestFrame(source === 0);
          setStatus(source === 1 ? '相机画面' : '测试画面（等待 GB28181 摄像机）');
        });
      } catch (reason) {
        setError(`共享画面初始化失败：${reason instanceof Error ? reason.message : String(reason)}`);
      }
    };
    webview.addEventListener('sharedbufferreceived', onBuffer);
    void invoke('camera_attach').catch(reason => setError(`共享画面初始化失败：${reason instanceof Error ? reason.message : String(reason)}`));
    return () => {
      webview.removeEventListener('sharedbufferreceived', onBuffer);
      renderer.current?.dispose();
      renderer.current = null;
    };
  }, [controller]);

  const control = async (action: Action) => {
    if (!controller || !host || busy) return;
    setBusy(action);
    setError('');
    setStatus(`正在${labels[action]}…`);
    try {
      const response = await fetch(`http://${host}:1422/camera/${action === 'in' || action === 'out' ? 'zoom' : 'focus'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({} as { message?: string }));
        throw new Error(body.message || `HTTP ${response.status}`);
      }
      setStatus(`${labels[action]}已发送`);
    } catch (reason) {
      setError(`控制失败：${reason instanceof Error ? reason.message : String(reason)}`);
      setStatus('相机控制服务未连接');
    } finally {
      setBusy(null);
    }
  };

  const controls = controller ? <>
    <IonButton fill="clear" className="camera-back" disabled={disabled} onClick={onBack}>
      <IonIcon slot="start" icon={arrowBackOutline} />返回
    </IonButton>
    <span className="camera-title">拍照</span>
    <div className="camera-control-group" role="group" aria-label="相机聚焦">
      <IonButton fill="clear" disabled={disabled || !host || busy === 'near'} onClick={() => void control('near')}>近焦</IonButton>
      <IonButton fill="clear" disabled={disabled || !host || busy === 'far'} onClick={() => void control('far')}>远焦</IonButton>
    </div>
    <div className="camera-control-group" role="group" aria-label="相机变倍">
      <IonButton fill="clear" disabled={disabled || !host || busy === 'out'} onClick={() => void control('out')}>缩小</IonButton>
      <IonButton fill="clear" disabled={disabled || !host || busy === 'in'} onClick={() => void control('in')}>放大</IonButton>
    </div>
  </> : null;

  return <div className={`camera-page${controller ? ' camera-controller' : ' camera-display'}`} data-camera-mode={controller ? 'controller' : 'display'}>
    <div className="camera-view" aria-label="相机画面">
      <canvas ref={canvas} className="camera-canvas" width={1280} height={720} />
      {(!live || controller) && <div className="camera-waiting">
        <IonIcon icon={cameraOutline} />
        <strong>{controller ? '相机画面在大屏显示' : '相机画面'}</strong>
        <span>{status}</span>
        {!controller && !isTauri() && <small>浏览器预览不提供共享内存画面；Windows 显示端由 Rust 解码后写入 SAB。</small>}
        {error && <small className="camera-error" role="alert">{error}</small>}
      </div>}
      {!controller && live && testFrame && <div className="camera-test-badge">测试画面 · 等待 GB28181 摄像机</div>}
    </div>
    {controller && <div className="camera-controls" role="region" aria-label="相机操作面板">{controls}</div>}
  </div>;
}
