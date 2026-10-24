import { memo, useEffect, useRef, useState } from 'react';
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import XYZ from 'ol/source/XYZ';
import Zoomify from 'ol/source/Zoomify';
import { defaults as interactions } from 'ol/interaction/defaults';
import { mapConfig, initialState, locations, mapPages, evenSplits } from './config';
import { SplitContainer } from './SplitContainer';
import type { MapState, MapViewState } from '../sync/protocol.mjs';
import type { ResourceCatalog, ImageResource } from './resourceCatalog';
import Projection from 'ol/proj/Projection';
import 'ol/ol.css';

interface Props { state: MapState; interactive: boolean; onChange: (patch: Partial<MapState>) => void; pageId?: string; active?: boolean; tileHost?: string; catalog?: ResourceCatalog }
const quiet = () => undefined;
export const MapStage = memo(function MapStage({ state, interactive, onChange, pageId = state.page, active = true, tileHost, catalog }: Props) {
  const places = catalog?.locations || locations.map(p => ({ ...p, images: p.images.map(url => ({ url, width: mapConfig.width, height: mapConfig.height })) }));
  const pages = catalog?.maps || mapPages.map(p => ({ ...p, width: mapConfig.width, height: mapConfig.height }));
  const comparison = pageId === 'comparison';
  const outer = state.outerSplits?.length === places.length - 1 ? state.outerSplits : evenSplits(places.length);
  const mapPage = pages.find(page => page.id === pageId) || pages[0];
  const camera = state.mapViews?.[pageId] || (catalog ? {center:[mapPage.width/2,-mapPage.height/2] as [number,number],zoom:0} : { center: state.center, zoom: state.zoom });
  return <div className={`map-stage ${interactive ? 'is-interactive' : 'display-map'}`} data-page={pageId} aria-label={comparison ? '地点与图片嵌套对比' : mapPage.label}>
    {comparison ? <SplitContainer splits={outer} interactive={interactive} label="地点" level="outer" onChange={outerSplits => onChange({ outerSplits })}>
      {places.map((place, placeIndex) => {
        const inner = state.innerSplits?.[placeIndex]?.length === place.images.length - 1 ? state.innerSplits[placeIndex] : evenSplits(place.images.length);
        return <SplitContainer key={place.id} splits={inner} interactive={interactive} label={`${place.label}图片`} level="inner" onChange={splits => {
          const innerSplits = places.map((item, index) => index === placeIndex ? splits : state.innerSplits?.[index] || evenSplits(item.images.length));
          onChange({ innerSplits });
        }}>
          {place.images.map((resource, index) => <MapSurface key={resource.url + index} resource={resource} tileHost={tileHost} interactive={false} active={active} showErrors={interactive} fit camera={initialState} onChange={quiet} />)}
        </SplitContainer>;
      })}
    </SplitContainer> : <MapSurface resource={mapPage} tileHost={tileHost} interactive={interactive} active={active} showErrors={interactive} fit={false} camera={camera} onChange={next => onChange({ ...next, mapViews: { ...state.mapViews, [pageId]: next } })} />}
  </div>;
}, (previous, next) => previous.pageId === next.pageId && previous.interactive === next.interactive && previous.active === next.active && previous.catalog === next.catalog && previous.tileHost === next.tileHost && previous.onChange === next.onChange
  && (previous.state === next.state || (previous.active === false && next.active === false)));

interface SurfaceProps { resource: ImageResource; tileHost?: string; interactive: boolean; active: boolean; showErrors: boolean; fit: boolean; camera: MapViewState; onChange: (value: MapViewState) => void }
function MapSurface({ resource, tileHost, interactive, active, showErrors, fit, camera, onChange }: SurfaceProps) {
  const { url, width, height } = resource;
  const root = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const view = useRef<View | null>(null);
  const running = useRef(false);
  const frame = useRef(0);
  const latest = useRef(camera);
  const callback = useRef(onChange);
  const [tileError, setTileError] = useState(false);
  latest.current = camera; callback.current = onChange;
  useEffect(() => {
    const tileUrl = tileHost && mapConfig.image ? `http://${tileHost}:1421${url}` : url;
    const source = mapConfig.image ? new Zoomify({ url: tileUrl, size: [width, height], crossOrigin: 'anonymous' }) : new XYZ({ url: tileUrl, crossOrigin: 'anonymous', attributions: mapConfig.attribution, maxZoom: 19 });
    setTileError(false);
    const active = new View({ projection: mapConfig.image ? new Projection({code:'exhibition-pixels',units:'pixels',extent:[0,-height,width,0]}) : mapConfig.projection, center: latest.current.center, zoom: latest.current.zoom, minZoom: 0, maxZoom: 24, enableRotation: false, showFullExtent: mapConfig.image,
      ...(mapConfig.image ? { extent: [0, -height, width, 0], resolutions: (source as Zoomify).getTileGrid()?.getResolutions() } : {}) });
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
      if (running.current && interactive && center && zoom !== undefined) callback.current({ center: [...center] as [number, number], zoom });
    };
    const schedule = () => { if (running.current && interactive && !frame.current) frame.current = requestAnimationFrame(publish); };
    active.on('change:center', schedule); active.on('change:resolution', schedule);
    map.on('moveend', publish);
    return () => { running.current = false; cancelAnimationFrame(frame.current); frame.current = 0; map.dispose(); mapRef.current = null; view.current = null; };
  }, [url, width, height, tileHost, interactive, fit]);
  useEffect(() => {
    const map = mapRef.current;
    const targetView = view.current;
    if (!map || !targetView || !active || !root.current) return;
    running.current = true;
    map.setTarget(root.current);
    const resize = () => {
      if (!root.current || root.current.clientWidth === 0 || root.current.clientHeight === 0) return;
      map.updateSize();
      if (fit && mapConfig.image) targetView.fit([0, -height, width, 0], { size: map.getSize() });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(root.current!); resize();
    return () => { running.current = false; cancelAnimationFrame(frame.current); frame.current = 0; observer.disconnect(); map.setTarget(undefined); };
  }, [active, url, width, height, tileHost, interactive, fit]);
  useEffect(() => {
    const targetView = view.current;
    if (!active || !targetView || fit || (interactive && (targetView.getInteracting() || targetView.getAnimating()))) return;
    const center = targetView.getCenter();
    if (!center || Math.abs(center[0] - camera.center[0]) > 0.001 || Math.abs(center[1] - camera.center[1]) > 0.001) targetView.setCenter(camera.center);
    if (Math.abs((targetView.getZoom() ?? 0) - camera.zoom) > 0.0001) targetView.setZoom(camera.zoom);
  }, [camera, fit, interactive, active]);
  return <div className="map-surface">
    <div className="map-target" ref={root} />
    {showErrors && tileError && <div className="tile-error" role="status">图片加载失败</div>}
    {showErrors && !mapConfig.image && <div className="map-attribution">{mapConfig.attribution}</div>}
  </div>;
}
