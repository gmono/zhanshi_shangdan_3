import { useRef, useState } from 'react';
import { IonAlert, IonButton, IonIcon } from '@ionic/react';
import { exitOutline } from 'ionicons/icons';
import { invoke, isTauri } from '@tauri-apps/api/core';

export function TabletExit({ disabled }: { disabled: boolean }) {
  const [confirm, setConfirm] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [error, setError] = useState('');
  const requested = useRef(false);
  const exit = async () => {
    if (requested.current) return;
    requested.current = true;
    setExiting(true);
    try {
      if (!isTauri()) throw new Error('请在平板 App 中退出，网页预览无法关闭系统应用。');
      await invoke('exit_tablet');
    } catch (reason) {
      requested.current = false;
      setExiting(false);
      setError(String(reason instanceof Error ? reason.message : reason));
    }
  };
  return <>
    <IonButton className="tablet-exit" disabled={disabled || exiting} onClick={() => setConfirm(true)}>
      <IonIcon slot="start" icon={exitOutline} />退出
    </IonButton>
    <IonAlert isOpen={confirm} header="退出应用？" message="确认退出展厅App？" backdropDismiss={false}
      buttons={[{ text: '取消', role: 'cancel' }, { text: '确认退出', role: 'confirm' }]}
      onDidDismiss={event => {
        setConfirm(false);
        if (event.detail.role === 'confirm') void exit();
      }} />
    <IonAlert isOpen={!!error} header="无法退出" message={error} backdropDismiss={false}
      buttons={[{ text: '好', role: 'cancel' }]} onDidDismiss={() => setError('')} />
  </>;
}
