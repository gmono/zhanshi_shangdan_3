import { useEffect } from 'react';
import {
  IonApp,
  IonButton,
  IonContent,
  IonHeader,
  IonIcon,
  IonPage,
  IonRouterOutlet,
  IonToolbar,
  setupIonicReact,
  useIonRouter,
} from '@ionic/react';
import { IonReactRouter } from '@ionic/react-router';
import { arrowBackOutline, layersOutline, mapOutline, settingsOutline } from 'ionicons/icons';
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
          <Route exact path="/map/:pageId" render={({ match }) => <MapPage state={state} update={update} pageId={match.params.pageId} />} />
          <Route exact path="/settings" render={() => <ConnectionPanel value={connection} onSave={configure} status={status} displays={peers.displays} error={error} homePath={`/${location.search}`} />} />
        </IonRouterOutlet>
      </IonReactRouter>
    </IonApp>
  );
}

function MapPage({ state, update, pageId = 'comparison' }: { state: ReturnType<typeof useSync>['state']; update: ReturnType<typeof useSync>['update']; pageId?: string }) {
  const router = useIonRouter();
  // Route pages remain mounted in Ionic's outlet; initialize only when each page mounts.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (state.page !== pageId) update({ page: pageId, comparison: pageId === 'comparison' }); }, []);

  return (
    <IonPage className="controller-page">
      <IonHeader className="controller-header">
        <IonToolbar className="main-toolbar">
          <div className="toolbar-control-row">
            {pageId !== 'comparison' ? <IonButton fill="clear" aria-label="返回对比图" onClick={() => router.push(`/${location.search}`, 'back', 'pop')}><IonIcon slot="icon-only" icon={arrowBackOutline} /></IonButton> : <span />}
            <nav className="map-page-buttons" aria-label="地图页面">
              {['comparison', 'map-1', 'map-2', 'map-3', 'map-4'].map(id => <IonButton key={id} fill={pageId === id ? 'solid' : 'clear'} onClick={() => { update({ page: id, comparison: id === 'comparison' }); router.push(id === 'comparison' ? `/${location.search}` : `/map/${id}${location.search}`, 'forward', 'push'); }}>
                <IonIcon slot="start" icon={id === 'comparison' ? layersOutline : mapOutline} />{id === 'comparison' ? '对比图' : `图${id.slice(-1)}`}
              </IonButton>)}
            </nav>
            <IonButton fill="clear" aria-label="打开设置" onClick={() => router.push(`/settings${location.search}`, 'forward', 'push')}>
              <IonIcon slot="icon-only" icon={settingsOutline} />
            </IonButton>
          </div>
        </IonToolbar>
      </IonHeader>
      <IonContent className="controller-content" scrollY={false} scrollX={false}>
        <main className="map-frame">
          <MapStage state={state} interactive onChange={update} pageId={pageId} />
        </main>
      </IonContent>
    </IonPage>
  );
}
