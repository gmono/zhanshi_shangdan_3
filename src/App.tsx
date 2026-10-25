import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { IonApp, IonButton, IonContent, IonIcon, IonPage, IonRouterOutlet, setupIonicReact, useIonRouter, useIonViewWillEnter, useIonViewWillLeave } from '@ionic/react';
import { IonReactRouter } from '@ionic/react-router';
import { arrowBackOutline, mapOutline, settingsOutline } from 'ionicons/icons';
import { Route, useLocation } from 'react-router-dom';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { getRole } from './platform/role';
import { MapStage } from './map/MapStage';
import { evenSplits } from './map/config';
import { initialCamera } from './map/initialCamera';
import type { ResourceCatalog } from './map/resourceCatalog';
import { useSync } from './sync/useSync';
import { ConnectionPanel } from './components/connection/ConnectionPanel';
import { useResourceCatalog } from './map/useResourceCatalog';
import { ResourceStatus } from './map/ResourceStatus';
import type { ResourceProgress } from './map/resourceProgress';
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
    {interactive ? <IonReactRouter><ControllerRoutes sync={sync} /></IonReactRouter> : <DisplayApp sync={sync} />}
  </IonApp>;
}

function DisplayApp({ sync }: { sync: Sync }) {
  const resources = useResourceCatalog('127.0.0.1', true, true);
  const catalog = resources.catalog;
  return <IonPage className="display-page"><IonContent className="display-content" scrollY={false} scrollX={false}>
    {catalog ? <MapStage state={sync.state} interactive={false} onChange={sync.update} catalog={catalog} tileHost="127.0.0.1" /> : <ResourceStatus message={resources.message} progress={resources.progress} />}
  </IonContent></IonPage>;
}

function ControllerRoutes({ sync }: { sync: Sync }) {
  const route = useLocation();
  const { update } = sync;
  const latestState = useRef(sync.state);
  const preparedPage = useRef<string | null>(null);
  latestState.current = sync.state;
  const connected = sync.status === '已连接';
  const resources = useResourceCatalog(sync.connection.ip, connected, false);
  const catalog = resources.catalog;
  const preparePage = useCallback((targetPage: string, size: [number, number] = [window.innerWidth, window.innerHeight]) => {
    const map = catalog?.maps.find(item => item.id === targetPage);
    const camera = map ? initialCamera(map, size) : undefined;
    update({ page: targetPage, comparison: targetPage === 'comparison', ...(camera ? {
      ...camera, mapViews: { ...latestState.current.mapViews, [targetPage]: camera },
    } : {}) });
    preparedPage.current = targetPage;
  }, [catalog, update]);
  useEffect(() => { if (catalog) update({ outerSplits: evenSplits(catalog.locations.length), innerSplits: catalog.locations.map(p => evenSplits(p.images.length)) }); }, [catalog, update]);
  const pageId = route.pathname === '/' ? 'comparison' : catalog?.maps.find(page => route.pathname === `/map/${page.id}`)?.id;
  // 只由当前路由发布页面状态；缓存中的旧页面不会回写自己的页面 ID。
  useLayoutEffect(() => {
    if (!pageId) { preparedPage.current = null; return; }
    // 按钮已在导航前准备状态；这里仅处理直接打开地址与浏览器返回。
    if (preparedPage.current !== pageId) preparePage(pageId);
    preparedPage.current = null;
  }, [pageId, preparePage]);
  return <IonRouterOutlet>
    <Route exact path="/" render={() => <MapPage pageId="comparison" state={sync.state} update={sync.update} preparePage={preparePage} connected={connected} tileHost={sync.connection.ip} catalog={catalog} resourceMessage={resources.message} progress={resources.progress} />} />
    <Route exact path="/map/:pageId" render={({ match }) => <MapPage key={match.params.pageId} pageId={match.params.pageId} state={sync.state} update={sync.update} preparePage={preparePage} connected={connected} tileHost={sync.connection.ip} catalog={catalog} resourceMessage={resources.message} progress={resources.progress} />} />
    <Route exact path="/settings" render={() => <ConnectionPanel value={sync.connection} onSave={sync.configure} status={sync.status} displays={sync.peers.displays} error={sync.error} homePath={`/${route.search}`} />} />
  </IonRouterOutlet>;
}

function MapPage({ state, update, preparePage, pageId, connected, tileHost, catalog, resourceMessage, progress }: { state: Sync['state']; update: Sync['update']; preparePage: (pageId: string, size?: [number, number]) => void; pageId: string; connected: boolean; tileHost: string; catalog: ResourceCatalog | null; resourceMessage: string; progress?: ResourceProgress | null }) {
  const router = useIonRouter();
  const [mapActive, setMapActive] = useState(false);
  useIonViewWillEnter(() => setMapActive(true), []);
  useIonViewWillLeave(() => setMapActive(false), []);
  const comparison = pageId === 'comparison';
  const mapPages = catalog?.maps || [];
  return <IonPage className="controller-page">
    <IonContent className="controller-content" scrollY={false} scrollX={false}><main className="map-frame">{connected && catalog ? <MapStage state={state} interactive active={mapActive && state.page === pageId} onChange={update} pageId={pageId} tileHost={tileHost} catalog={catalog} /> : connected ? <ResourceStatus message={resourceMessage} progress={progress} /> : <IonButton className="connection-required" fill="clear" expand="full" onClick={() => router.push(`/settings${location.search}`, 'forward', 'push')}>连接 Windows 大屏</IonButton>}</main></IonContent>
    <div className="floating-controls" role="region" aria-label="地图操作面板">
      {comparison ? <nav className="map-page-buttons" aria-label="地图页面">
        {mapPages.map(page => <IonButton key={page.id} fill="clear" onClick={event => {
          const frame = event.currentTarget.closest('.ion-page')?.querySelector('.map-frame')?.getBoundingClientRect();
          preparePage(page.id, frame ? [frame.width, frame.height] : undefined);
          router.push(`/map/${page.id}${location.search}`, 'forward', 'push');
        }}><IonIcon slot="start" icon={mapOutline} />{page.label}</IonButton>)}
      </nav> : <>
        <IonButton fill="clear" onClick={() => router.push(`/${location.search}`, 'back', 'pop')}><IonIcon slot="start" icon={arrowBackOutline} />返回</IonButton>
        <span className="floating-page-title">{mapPages.find(page => page.id === pageId)?.label}</span>
      </>}
      <IonButton className="floating-settings" fill="clear" aria-label="打开设置" onClick={() => router.push(`/settings${location.search}`, 'forward', 'push')}><IonIcon slot="icon-only" icon={settingsOutline} /></IonButton>
    </div>
  </IonPage>;
}
