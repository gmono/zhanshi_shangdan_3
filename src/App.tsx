import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { IonApp, IonButton, IonContent, IonIcon, IonPage, IonRouterOutlet, setupIonicReact, useIonRouter } from '@ionic/react';
import { IonReactRouter } from '@ionic/react-router';
import { arrowBackOutline, mapOutline, settingsOutline } from 'ionicons/icons';
import { Route, useLocation } from 'react-router-dom';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { getRole } from './platform/role';
import { MapStage } from './map/MapStage';
import { evenSplits, leftEdgeSplits } from './map/config';
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
  const router = useIonRouter();
  const frame = useRef<HTMLDivElement>(null);
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
  useEffect(() => { if (catalog) update({ outerSplits: evenSplits(catalog.locations.length), innerSplits: catalog.locations.map(p => leftEdgeSplits(p.images.length)) }); }, [catalog, update]);
  const pageId = route.pathname === '/' ? 'comparison' : catalog?.maps.find(page => route.pathname === `/map/${page.id}`)?.id;
  // 只由当前路由发布页面状态；缓存中的旧页面不会回写自己的页面 ID。
  useLayoutEffect(() => {
    if (!pageId) { preparedPage.current = null; return; }
    // 按钮已在导航前准备状态；这里仅处理直接打开地址与浏览器返回。
    if (preparedPage.current !== pageId) preparePage(pageId);
    preparedPage.current = null;
  }, [pageId, preparePage]);
  return <div className="controller-shell" ref={frame}><IonRouterOutlet>
    <Route exact path="/" render={() => <MapPage pageId="comparison" state={sync.state} update={sync.update} connected={connected} tileHost={sync.connection.ip} catalog={catalog} resourceMessage={resources.message} progress={resources.progress} />} />
    <Route exact path="/map/:pageId" render={({ match }) => <MapPage key={match.params.pageId} pageId={match.params.pageId} state={sync.state} update={sync.update} connected={connected} tileHost={sync.connection.ip} catalog={catalog} resourceMessage={resources.message} progress={resources.progress} />} />
    <Route exact path="/settings" render={() => <ConnectionPanel value={sync.connection} onSave={sync.configure} status={sync.status} displays={sync.peers.displays} error={sync.error} homePath={`/${route.search}`} />} />
  </IonRouterOutlet>
    <FloatingControls pathname={route.pathname} search={route.search} catalog={catalog} onMap={id => {
      const box = frame.current?.getBoundingClientRect();
      preparePage(id, box ? [box.width, box.height] : undefined);
      router.push(`/map/${id}${route.search}`, 'none', 'replace');
    }} />
  </div>;
}

function MapPage({ state, update, pageId, connected, tileHost, catalog, resourceMessage, progress }: { state: Sync['state']; update: Sync['update']; pageId: string; connected: boolean; tileHost: string; catalog: ResourceCatalog | null; resourceMessage: string; progress?: ResourceProgress | null }) {
  const router = useIonRouter();
  return <IonPage className="controller-page">
    <IonContent className="controller-content" scrollY={false} scrollX={false}><main className="map-frame">{connected && catalog ? <MapStage state={state} interactive active onChange={update} pageId={pageId} tileHost={tileHost} catalog={catalog} /> : connected ? <ResourceStatus message={resourceMessage} progress={progress} /> : <IonButton className="connection-required" fill="clear" expand="full" onClick={() => router.push(`/settings${location.search}`, 'none', 'replace')}>连接 Windows 大屏</IonButton>}</main></IonContent>

  </IonPage>;
}

function FloatingControls({ pathname, search, catalog, onMap }: { pathname: string; search: string; catalog: ResourceCatalog | null; onMap: (id: string) => void }) {
  const router = useIonRouter();
  const comparison = pathname === '/';
  const pageId = pathname.split('/')[2];
  const mapPages = catalog?.maps || [];
  return (
    <div className="floating-controls" hidden={pathname === '/settings'} role="region" aria-label="地图操作面板">
      {comparison ? <nav className="map-page-buttons" aria-label="地图页面">
        {mapPages.map(page => <IonButton key={page.id} fill="clear" onClick={() => onMap(page.id)}><IonIcon slot="start" icon={mapOutline} />{page.label}</IonButton>)}
      </nav> : <>
      <IonButton fill="clear" onClick={() => router.push(`/${search}`, 'none', 'replace')}><IonIcon slot="start" icon={arrowBackOutline} />返回</IonButton>
        <span className="floating-page-title">{mapPages.find(page => page.id === pageId)?.label}</span>
      </>}
      <IonButton className="floating-settings" fill="clear" aria-label="打开设置" onClick={() => router.push(`/settings${search}`, 'none', 'replace')}><IonIcon slot="icon-only" icon={settingsOutline} /></IonButton>
    </div>
  );
}
