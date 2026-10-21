import { useState, type FormEvent } from 'react';
import { IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonInput, IonItem, IonLabel, IonList, IonPage, IonTitle, IonToolbar } from '@ionic/react';
import { radioOutline } from 'ionicons/icons';
import type { Connection } from '../../sync/useSync';

interface Props {
  value: Connection;
  onSave: (value: Connection) => void;
  status: string;
  displays: number;
  error: string;
  homePath: string;
}

export function ConnectionPanel({ value, onSave, status, displays, error, homePath }: Props) {
  const [url, setUrl] = useState(value.url);
  const [room, setRoom] = useState(value.room);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave({ url: url.trim(), room: room.trim() });
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
              <IonInput label="同步服务地址" labelPlacement="stacked" placeholder="ws://192.168.1.100:8787" value={url} onIonInput={event => setUrl(event.detail.value || '')} autocapitalize="off" autocorrect="off" />
            </IonItem>
            <IonItem>
              <IonInput label="房间密钥" labelPlacement="stacked" placeholder="至少 8 位字母或数字" value={room} onIonInput={event => setRoom(event.detail.value || '')} autocapitalize="off" autocorrect="off" />
            </IonItem>
          </IonList>
          {error && <p className="connection-error" role="alert">{error}</p>}
          <IonButton expand="block" type="submit" className="save-connection">保存连接</IonButton>
        </form>
      </IonContent>
    </IonPage>
  );
}
