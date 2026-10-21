import { useEffect } from 'react';
import {
  IonApp,
  IonButton,
  IonContent,
  IonHeader,
  IonIcon,
  IonLabel,
  IonPage,
  IonRouterOutlet,
  IonSegment,
  IonSegmentButton,
  IonToolbar,
  setupIonicReact,
  useIonRouter,
} from '@ionic/react';
import { IonReactRouter } from '@ionic/react-router';
import { layersOutline, mapOutline, settingsOutline } from 'ionicons/icons';
import { Route } from 'react-router-dom';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { getRole } from './platform/role';
import { MapStage } from './map/MapStage';
import { useSync } from './sync/useSync';
import { ConnectionPanel } from './components/connection/ConnectionPanel';
import '@ionic/react/css/core.css';
import '@ionic/react/css/normalize.css';
import '@ionic/react/css/structure.css';
import '@ionic/react/css/typography.css';
import '@ionic/react/css/palettes/dark.class.css';
import './styles.css';

setupIonicReact({ mode: 'ios', swipeBackEnabled: true });
const role = getRole();
const interactive = role === 'controller';

export default function App() {
  const { state, update, connection, configure, status, peers, error } = useSync(role);

  useEffect(() => {
    if (!interactive && isTauri()) void invoke('start_sync_relay', { port: 8787 }).catch(() => undefined);
  }, []);

  if (!interactive) {
    return (
      <IonApp className="ion-palette-dark">
        <IonPage className="display-page">
          <IonContent className="display-content" scrollY={false} scrollX={false}>
            <MapStage state={state} interactive={false} onChange={update} />
          </IonContent>
        </IonPage>
      </IonApp>
    );
  }

  return (
    <IonApp className="ion-palette-dark">
      <IonReactRouter>
        <IonRouterOutlet>
          <Route exact path="/" render={() => <MapPage state={state} update={update} />} />
          <Route exact path="/settings" render={() => <ConnectionPanel value={connection} onSave={configure} status={status} displays={peers.displays} error={error} homePath={`/${location.search}`} />} />
        </IonRouterOutlet>
      </IonReactRouter>
    </IonApp>
  );
}

function MapPage({ state, update }: { state: ReturnType<typeof useSync>['state']; update: ReturnType<typeof useSync>['update'] }) {
  const router = useIonRouter();
  const selectView = (value: string | undefined) => {
    if (value === 'map' && state.comparison) update({ comparison: false });
    if (value === 'comparison' && !state.comparison) update({ comparison: true });
  };

  return (
    <IonPage className="controller-page">
      <IonHeader className="controller-header">
        <IonToolbar className="main-toolbar">
          <div className="toolbar-control-row">
            <span aria-hidden="true" />
          <IonSegment value={state.comparison ? 'comparison' : 'map'} onIonChange={event => selectView(event.detail.value as string | undefined)}>
            <IonSegmentButton value="comparison" layout="icon-start">
              <IonIcon icon={layersOutline} />
              <IonLabel>三图对比</IonLabel>
            </IonSegmentButton>
            <IonSegmentButton value="map" layout="icon-start">
              <IonIcon icon={mapOutline} />
              <IonLabel>单图探索</IonLabel>
            </IonSegmentButton>
          </IonSegment>
            <IonButton fill="clear" aria-label="打开设置" onClick={() => router.push(`/settings${location.search}`, 'forward', 'push')}>
              <IonIcon slot="icon-only" icon={settingsOutline} />
            </IonButton>
          </div>
        </IonToolbar>
      </IonHeader>
      <IonContent className="controller-content" scrollY={false} scrollX={false}>
        <main className="map-frame">
          <MapStage state={state} interactive onChange={update} />
        </main>
      </IonContent>
    </IonPage>
  );
}
