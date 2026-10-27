import { memo, useLayoutEffect, useRef, useState } from 'react';
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import XYZ from 'ol/source/XYZ';
import Zoomify from 'ol/source/Zoomify';
import { defaults as interactions } from 'ol/interaction/defaults';
import { mapConfig, initialState, locations, mapPages, evenSplits, leftEdgeSplits } from './config';
import { SplitContainer } from './SplitContainer';
import type { MapState, MapViewState } from '../sync/protocol.mjs';
import type { ResourceCatalog, ImageResource } from './resourceCatalog';
import Projection from 'ol/proj/Projection';
import { fitZoom, initialCamera, localCamera, relativeCamera } from './initialCamera';
import 'ol/ol.css';

interface Props { state: MapState; interactive: boolean; onChange: (patch: Partial<MapState>) => void; pageId?: string; active?: boolean; tileHost?: string; catalog?: ResourceCatalog }
const quiet = () => undefined;
export const MapStage = memo(function MapStage({ state, interactive, onChange, pageId = state.page, active = true, tileHost, catalog }: Props) {
  const places = catalog?.locations || locations.map(p => ({ ...p, images: p.images.map(url => ({ url, width: mapConfig.width, height: mapConfig.height })) }));
  const pages = catalog?.maps || mapPages.map(p => ({ ...p, width: mapConfig.width, height: mapConfig.height }));
  const comparison = pageId === 'comparison';
  const outer = evenSplits(places.length);
  const mapPage = pages.find(page => page.id === pageId) || pages[0];
  const camera = state.mapViews?.[pageId] || (catalog ? initialCamera() : { center: state.center, zoom: state.zoom });
  return <div className={`map-stage ${interactive ? 'is-interactive' : 'display-map'}`} data-page={pageId} aria-label={comparison ? '地点与图片嵌套对比' : mapPage.label}>
    {comparison ? <SplitContainer splits={outer} interactive={false} label="地点" level="outer" onChange={quiet}>
      {places.map((place, placeIndex) => {
        const inner = state.innerSplits?.[placeIndex]?.length === place.images.length - 1 ? state.innerSplits[placeIndex] : leftEdgeSplits(place.images.length);
        return <SplitContainer key={place.id} splits={inner} interactive={interactive} label={`${place.label}图片`} level="inner" onChange={splits => {
          const innerSplits = places.map((item, index) => index === placeIndex ? splits : state.innerSplits?.[index] || leftEdgeSplits(item.images.length));
          onChange({ innerSplits });
        }}>
          {place.images.map((resource, index) => <MapSurface key={resource.url + index} resource={resource} tileHost={tileHost} interactive={false} active={active} showErrors={interactive} fit camera={initialState} onChange={quiet} />)}
        </SplitContainer>;
      })}
    </SplitContainer> : <MapSurface resource={mapPage} tileHost={tileHost} interactive={interactive} publishing={state.page === pageId} active={active} showErrors={interactive} fit={false} camera={camera} onChange={next => onChange({ ...(next.space ? {} : next), mapViews: { ...state.mapViews, [pageId]: next } })} />}
  </div>;
}, (previous, next) => previous.pageId === next.pageId && previous.interactive === next.interactive && previous.active === next.active && previous.catalog === next.catalog && previous.tileHost === next.tileHost && previous.onChange === next.onChange
  && (previous.state === next.state || (previous.active === false && next.active === false)));

interface SurfaceProps { resource: ImageResource; tileHost?: string; interactive: boolean; publishing?: boolean; active: boolean; showErrors: boolean; fit: boolean; camera: MapViewState; onChange: (value: MapViewState) => void }
function MapSurface({ resource, tileHost, interactive, publishing = false, active, showErrors, fit, camera, onChange }: SurfaceProps) {
  const { url, width, height } = resource;
  const root = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const view = useRef<View | null>(null);
  const running = useRef(false);
  const applying = useRef(false);
  const mayPublish = useRef(publishing);
  const viewport = useRef<[number, number]>([width, height]);
  const frame = useRef(0);
  const latest = useRef(camera);
  const published = useRef<MapViewState | null>(null);
  const callback = useRef(onChange);
  const [tileError, setTileError] = useState(false);
  latest.current = camera; callback.current = onChange; mayPublish.current = publishing;
  useLayoutEffect(() => {
    const tileUrl = tileHost && mapConfig.image ? `http://${tileHost}:1421${url}` : url;
    const source = mapConfig.image ? new Zoomify({ url: tileUrl, size: [width, height], crossOrigin: 'anonymous' }) : new XYZ({ url: tileUrl, crossOrigin: 'anonymous', attributions: mapConfig.attribution, maxZoom: 19 });
    setTileError(false);
    const firstCamera = localCamera(latest.current, { width, height }, viewport.current);
    const resolutions = mapConfig.image ? (source as Zoomify).getTileGrid()?.getResolutions() : undefined;
    const active = new View({ projection: mapConfig.image ? new Projection({code:'exhibition-pixels',units:'pixels',extent:[0,-height,width,0]}) : mapConfig.projection, center: firstCamera.center, zoom: firstCamera.zoom, minZoom: 0, maxZoom: latest.current.space ? 48 : 24, enableRotation: false, showFullExtent: mapConfig.image,
      ...(mapConfig.image ? { extent: [0, -height, width, 0], constrainOnlyCenter: !fit,
        // 单图允许按本机显示区域连续缩放；瓦片级别仍由 source 的网格选择。
        ...(latest.current.space ? { maxResolution: resolutions?.[0] } : { resolutions }) } : {}) });
    view.current = active;
    let failed = 0;
    source.on('tileloaderror', () => { if (++failed >= 3) setTileError(true); });
    source.on('tileloadend', () => { failed = 0; setTileError(false); });
    // 保留地图对象和瓦片缓存；渲染目标由 Ionic 页面生命周期单独管理。
    const map = new Map({ layers: [new TileLayer({ source, cacheSize: 128, className: 'map-raster' })], view: active, controls: [],
      interactions: interactions({ dragPan: interactive, pinchZoom: interactive, pinchRotate: false, altShiftDragRotate: false, doubleClickZoom: interactive, mouseWheelZoom: interactive, shiftDragZoom: interactive, keyboard: interactive }) });
    mapRef.current = map;
    const publish = () => {
      frame.current = 0;
      const center = active.getCenter(), zoom = active.getZoom();
      if (!running.current || !interactive || !mayPublish.current || applying.current || !center || zoom === undefined) return;
      if (latest.current.space && zoom < fitZoom({ width, height }, viewport.current) - 0.0001) {
        applying.current = true; active.cancelAnimations(); active.setZoom(fitZoom({ width, height }, viewport.current)); applying.current = false;
      }
      const local = { center: [...center] as [number, number], zoom: active.getZoom() ?? zoom };
      const next = latest.current.space ? relativeCamera(local, { width, height }, viewport.current) : local;
      if (Math.abs(next.center[0] - latest.current.center[0]) > 0.00001 || Math.abs(next.center[1] - latest.current.center[1]) > 0.00001 || Math.abs(next.zoom - latest.current.zoom) > 0.0001) {
        published.current = next;
        callback.current(next);
      }
    };
    const schedule = () => { if (running.current && interactive && mayPublish.current && !applying.current && !frame.current) frame.current = requestAnimationFrame(publish); };
    active.on('change:center', schedule); active.on('change:resolution', schedule);
    map.on('moveend', publish);
    return () => { running.current = false; cancelAnimationFrame(frame.current); frame.current = 0; map.dispose(); mapRef.current = null; view.current = null; };
  }, [url, width, height, tileHost, interactive, fit]);
  useLayoutEffect(() => {
    const map = mapRef.current;
    const targetView = view.current;
    if (!map || !targetView || !active || !root.current) return;
    // 挂载渲染目标前先复位，禁止旧视角参与首帧或回写同步状态。
    applying.current = true;
    targetView.cancelAnimations();
    if (!fit) {
      const local = localCamera(latest.current, { width, height }, viewport.current);
      targetView.setCenter(local.center);
      targetView.setZoom(local.zoom);
    }
    map.setTarget(root.current);
    const resize = () => {
      if (!root.current || root.current.clientWidth === 0 || root.current.clientHeight === 0) return;
      applying.current = true;
      map.updateSize();
      viewport.current = [root.current.clientWidth, root.current.clientHeight];
      if (fit && mapConfig.image) targetView.fit([0, -height, width, 0], { size: map.getSize() });
      else if (latest.current.space) {
        const local = localCamera(latest.current, { width, height }, viewport.current);
        targetView.setCenter(local.center); targetView.setZoom(local.zoom);
      }
      map.renderSync();
      applying.current = false;
    };
    const observer = new ResizeObserver(resize);
    observer.observe(root.current!); resize();
    // 缓存画布也必须在浏览器绘制前刷新，不能短暂露出上一次的画面。
    map.renderSync();
    applying.current = false;
    running.current = true;
    return () => { running.current = false; cancelAnimationFrame(frame.current); frame.current = 0; targetView.cancelAnimations(); observer.disconnect(); map.setTarget(undefined); };
  }, [active, url, width, height, tileHost, interactive, fit]);
  useLayoutEffect(() => {
    const targetView = view.current;
    if (!active || !targetView || fit) return;
    // 本机操作发出的状态只用于同步大屏，不反向写回并打断本机缩放动画。
    const echo = published.current;
    if (interactive && echo && echo.zoom === camera.zoom && echo.center[0] === camera.center[0] && echo.center[1] === camera.center[1]) return;
    const local = localCamera(camera, { width, height }, viewport.current);
    const center = targetView.getCenter();
    const centerChanged = !center || Math.abs(center[0] - local.center[0]) > 0.001 || Math.abs(center[1] - local.center[1]) > 0.001;
    const zoomChanged = Math.abs((targetView.getZoom() ?? 0) - local.zoom) > 0.0001;
    applying.current = true;
    if (centerChanged || zoomChanged) targetView.cancelAnimations();
    if (centerChanged) targetView.setCenter(local.center);
    if (zoomChanged) targetView.setZoom(local.zoom);
    if (centerChanged || zoomChanged) mapRef.current?.renderSync();
    applying.current = false;
  }, [camera, fit, interactive, active, width, height]);
  return <div className="map-surface">
    <div className="map-target" ref={root} />
    {showErrors && tileError && <div className="tile-error" role="status">图片加载失败</div>}
    {showErrors && !mapConfig.image && <div className="map-attribution">{mapConfig.attribution}</div>}
  </div>;
}
