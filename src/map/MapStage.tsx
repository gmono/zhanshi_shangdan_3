import { useEffect, useRef, useState } from 'react';
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import XYZ from 'ol/source/XYZ';
import Zoomify from 'ol/source/Zoomify';
import { defaults as interactions } from 'ol/interaction/defaults';
import { mapConfig, initialState, locations, mapPages, evenSplits } from './config';
import { SplitContainer } from './SplitContainer';
import type { MapState, MapViewState } from '../sync/protocol.mjs';
import 'ol/ol.css';

interface Props { state: MapState; interactive: boolean; onChange: (patch: Partial<MapState>) => void; pageId?: string }
const quiet = () => undefined;
export function MapStage({ state, interactive, onChange, pageId = state.page }: Props) {
  const comparison = pageId === 'comparison';
  const outer = state.outerSplits?.length === locations.length - 1 ? state.outerSplits : evenSplits(locations.length);
  const mapPage = mapPages.find(page => page.id === pageId) || mapPages[0];
  const camera = state.mapViews?.[pageId] || { center: state.center, zoom: state.zoom };
  return <div className={`map-stage ${interactive ? 'is-interactive' : 'display-map'}`} data-page={pageId} aria-label={comparison ? '地点与图片嵌套对比' : mapPage.label}>
    {comparison ? <SplitContainer splits={outer} interactive={interactive} label="地点" level="outer" onChange={outerSplits => onChange({ outerSplits })}>
      {locations.map((place, placeIndex) => {
        const inner = state.innerSplits?.[placeIndex]?.length === place.images.length - 1 ? state.innerSplits[placeIndex] : evenSplits(place.images.length);
        return <SplitContainer key={place.id} splits={inner} interactive={interactive} label={`${place.label}图片`} level="inner" onChange={splits => {
          const innerSplits = locations.map((item, index) => index === placeIndex ? splits : state.innerSplits?.[index] || evenSplits(item.images.length));
          onChange({ innerSplits });
        }}>
          {place.images.map((url, index) => <MapSurface key={url + index} url={url} interactive={false} showErrors={interactive} fit camera={initialState} onChange={quiet} />)}
        </SplitContainer>;
      })}
    </SplitContainer> : <MapSurface url={mapPage.url} interactive={interactive} showErrors={interactive} fit={false} camera={camera} onChange={next => onChange({ ...next, mapViews: { ...state.mapViews, [pageId]: next } })} />}
  </div>;
}

interface SurfaceProps { url: string; interactive: boolean; showErrors: boolean; fit: boolean; camera: MapViewState; onChange: (value: MapViewState) => void }
function MapSurface({ url, interactive, showErrors, fit, camera, onChange }: SurfaceProps) {
  const root = useRef<HTMLDivElement>(null);
  const view = useRef<View | null>(null);
  const latest = useRef(camera);
  const callback = useRef(onChange);
  const [tileError, setTileError] = useState(false);
  latest.current = camera; callback.current = onChange;
  useEffect(() => {
    const source = mapConfig.image ? new Zoomify({ url, size: [mapConfig.width, mapConfig.height], crossOrigin: 'anonymous' }) : new XYZ({ url, crossOrigin: 'anonymous', attributions: mapConfig.attribution, maxZoom: 19 });
    const active = new View({ projection: mapConfig.projection, center: latest.current.center, zoom: latest.current.zoom, minZoom: 0, maxZoom: 24, enableRotation: false, showFullExtent: mapConfig.image,
      ...(mapConfig.image ? { extent: [0, -mapConfig.height, mapConfig.width, 0], resolutions: (source as Zoomify).getTileGrid()?.getResolutions() } : {}) });
    view.current = active;
    let failed = 0;
    source.on('tileloaderror', () => { if (++failed >= 3) setTileError(true); });
    source.on('tileloadend', () => { failed = 0; setTileError(false); });
    const map = new Map({ target: root.current!, layers: [new TileLayer({ source, cacheSize: 128, className: 'map-raster' })], view: active, controls: [],
      interactions: interactions({ dragPan: interactive, pinchZoom: interactive, pinchRotate: false, altShiftDragRotate: false, doubleClickZoom: interactive, mouseWheelZoom: interactive, shiftDragZoom: interactive, keyboard: interactive }) });
    let frame = 0;
    const publish = () => {
      frame = 0;
      const center = active.getCenter(), zoom = active.getZoom();
      if (interactive && center && zoom !== undefined) callback.current({ center: [...center] as [number, number], zoom });
    };
    const schedule = () => { if (interactive && !frame) frame = requestAnimationFrame(publish); };
    active.on('change:center', schedule); active.on('change:resolution', schedule);
    map.on('moveend', publish);
    const resize = () => {
      if (!root.current || root.current.clientWidth === 0 || root.current.clientHeight === 0) return;
      map.updateSize();
      if (fit && mapConfig.image) active.fit([0, -mapConfig.height, mapConfig.width, 0], { size: map.getSize() });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(root.current!); resize();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); map.dispose(); view.current = null; };
  }, [url, interactive, fit]);
  useEffect(() => {
    const active = view.current;
    if (!active || fit || (interactive && (active.getInteracting() || active.getAnimating()))) return;
    const center = active.getCenter();
    if (!center || Math.abs(center[0] - camera.center[0]) > 0.001 || Math.abs(center[1] - camera.center[1]) > 0.001) active.setCenter(camera.center);
    if (Math.abs((active.getZoom() ?? 0) - camera.zoom) > 0.0001) active.setZoom(camera.zoom);
  }, [camera, fit, interactive]);
  return <div className="map-surface">
    <div className="map-target" ref={root} />
    {showErrors && tileError && <div className="tile-error" role="status">图片加载失败</div>}
    {showErrors && !mapConfig.image && <div className="map-attribution">{mapConfig.attribution}</div>}
  </div>;
}
