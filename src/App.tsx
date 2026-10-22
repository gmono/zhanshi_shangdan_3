import { useEffect } from 'react';
import { IonApp, IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonPage, IonRouterOutlet, IonTitle, IonToolbar, setupIonicReact, useIonRouter } from '@ionic/react';
import { IonReactRouter } from '@ionic/react-router';
import { mapOutline, settingsOutline } from 'ionicons/icons';
import { Route, useLocation } from 'react-router-dom';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { getRole } from './platform/role';
import { MapStage } from './map/MapStage';
import { mapPages } from './map/config';
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
type Sync = ReturnType<typeof useSync>;
export default function App() {
  const sync = useSync(role);
  useEffect(() => {
    if (!interactive && isTauri()) void invoke('start_sync_relay', { port: 8787 }).catch(() => undefined);
  }, []);
  return <IonApp className="ion-palette-dark">
    {interactive ? <IonReactRouter><ControllerRoutes sync={sync} /></IonReactRouter> : <IonPage className="display-page">
      <IonContent className="display-content" scrollY={false} scrollX={false}><MapStage state={sync.state} interactive={false} onChange={sync.update} /></IonContent>
    </IonPage>}
  </IonApp>;
}

function ControllerRoutes({ sync }: { sync: Sync }) {
  const route = useLocation();
  const { update } = sync;
  const pageId = route.pathname === '/' ? 'comparison' : mapPages.find(page => route.pathname === `/map/${page.id}`)?.id;
  // 只由当前路由发布页面状态；缓存中的旧页面不会回写自己的页面 ID。
  useEffect(() => { if (pageId) update({ page: pageId, comparison: pageId === 'comparison' }); }, [pageId, update]);
  return <IonRouterOutlet>
    <Route exact path="/" render={() => <MapPage pageId="comparison" state={sync.state} update={sync.update} />} />
    <Route exact path="/map/:pageId" render={({ match }) => <MapPage key={match.params.pageId} pageId={match.params.pageId} state={sync.state} update={sync.update} />} />
    <Route exact path="/settings" render={() => <ConnectionPanel value={sync.connection} onSave={sync.configure} status={sync.status} displays={sync.peers.displays} error={sync.error} homePath={`/${route.search}`} />} />
  </IonRouterOutlet>;
}

function MapPage({ state, update, pageId }: { state: Sync['state']; update: Sync['update']; pageId: string }) {
  const router = useIonRouter();
  const comparison = pageId === 'comparison';
  return <IonPage className="controller-page">
    <IonHeader className="controller-header"><IonToolbar className="main-toolbar">
      {comparison ? <nav className="map-page-buttons" aria-label="地图页面">
        <IonButton fill="clear" disabled>对比图</IonButton>
        {mapPages.map(page => <IonButton key={page.id} fill="clear" routerLink={`/map/${page.id}${location.search}`} routerDirection="forward"><IonIcon slot="start" icon={mapOutline} />{page.label}</IonButton>)}
      </nav> : <>
        <IonButtons slot="start"><IonBackButton defaultHref={`/${location.search}`} text="返回" /></IonButtons>
        <IonTitle>{mapPages.find(page => page.id === pageId)?.label}</IonTitle>
      </>}
      <IonButtons slot="end"><IonButton fill="clear" aria-label="打开设置" onClick={() => router.push(`/settings${location.search}`, 'forward', 'push')}><IonIcon slot="icon-only" icon={settingsOutline} /></IonButton></IonButtons>
    </IonToolbar></IonHeader>
    <IonContent className="controller-content" scrollY={false} scrollX={false}><main className="map-frame"><MapStage state={state} interactive onChange={update} pageId={pageId} /></main></IonContent>
  </IonPage>;
}
