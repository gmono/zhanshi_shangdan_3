import { useState, type FormEvent } from 'react';
import { IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonInput, IonItem, IonLabel, IonList, IonModal, IonPage, IonTitle, IonToolbar } from '@ionic/react';
import { radioOutline } from 'ionicons/icons';
import { invoke, isTauri } from '@tauri-apps/api/core';
import type { Connection, DiscoveredDisplay } from '../../sync/useSync';

interface Props {
  value: Connection;
  onSave: (value: Connection) => void;
  status: string;
  displays: number;
  error: string;
  homePath: string;
}

export function ConnectionPanel({ value, onSave, status, displays, error, homePath }: Props) {
  const [ip, setIp] = useState(value.ip);
  const [discovering, setDiscovering] = useState(false);
  const [searching, setSearching] = useState(false);
  const [devices, setDevices] = useState<DiscoveredDisplay[]>([]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave({ ip: ip.trim() });
  };
  const discover = async () => {
    if (!isTauri()) { setDevices([]); setDiscovering(true); return; }
    setDiscovering(true); setSearching(true);
    try { setDevices(await invoke<DiscoveredDisplay[]>('discover_displays')); }
    catch { setDevices([]); }
    finally { setSearching(false); }
  };

  return (
    <IonPage className="settings-page">
      <IonHeader>
        <IonToolbar className="settings-toolbar">
          <IonButtons slot="start"><IonBackButton defaultHref={homePath} text="返回" /></IonButtons>
          <IonTitle>设置</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="settings-content">
        <form onSubmit={submit}>
          <IonList inset className="settings-list">
            <IonItem lines="none">
              <IonIcon slot="start" icon={radioOutline} color={status === '已连接' ? 'primary' : undefined} />
              <IonLabel>
                <h2>展厅大屏</h2>
                <p>{status === '已连接' ? `已连接 ${displays} 块大屏` : status}</p>
              </IonLabel>
            </IonItem>
          </IonList>
          <IonList inset className="settings-list">
            <IonItem>
              <IonInput label="Windows 地址" labelPlacement="stacked" placeholder="192.168.1.100" value={ip} onIonInput={event => setIp(event.detail.value || '')} inputmode="decimal" autocapitalize="off" autocorrect="off" />
              <IonButton slot="end" fill="outline" onClick={discover}>搜索</IonButton>
            </IonItem>
          </IonList>
          {error && <p className="connection-error" role="alert">{error}</p>}
          <IonButton expand="block" type="submit" className="save-connection">保存连接</IonButton>
        </form>
        <IonModal isOpen={discovering} onDidDismiss={() => setDiscovering(false)}>
          <IonHeader><IonToolbar><IonTitle>搜索 Windows 大屏</IonTitle><IonButtons slot="end"><IonButton onClick={() => setDiscovering(false)}>关闭</IonButton></IonButtons></IonToolbar></IonHeader>
          <IonContent><IonList inset>{devices.length ? devices.map(device => <IonItem button key={device.ip} onClick={() => { setIp(device.ip); setDiscovering(false); }}><IonLabel><h2>{device.name}</h2><p>{device.ip}</p></IonLabel></IonItem>) : <IonItem><IonLabel>{isTauri() ? (searching ? '正在搜索局域网设备…' : '没有发现 Windows 大屏') : '网页调试不支持局域网搜索，请输入 IPv4 地址'}</IonLabel></IonItem>}</IonList></IonContent>
        </IonModal>
      </IonContent>
    </IonPage>
  );
}
