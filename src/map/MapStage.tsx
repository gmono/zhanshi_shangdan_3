import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import XYZ from 'ol/source/XYZ';
import Zoomify from 'ol/source/Zoomify';
import VectorSource from 'ol/source/Vector';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import { Circle, Fill, Stroke, Style } from 'ol/style';
import { defaults as interactions } from 'ol/interaction/defaults';
import { defaults as controls } from 'ol/control/defaults';
import { IonIcon } from '@ionic/react';
import { reorderThreeOutline } from 'ionicons/icons';
import { mapConfig, initialState } from './config';
import type { MapState } from '../sync/protocol.mjs';
import 'ol/ol.css';

interface Props { state: MapState; interactive: boolean; onChange: (patch: Partial<MapState>) => void; pageId?: string }
export function MapStage({ state, interactive, onChange, pageId = state.page }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const targets = useRef<(HTMLDivElement | null)[]>([]);
  const view = useRef<View | null>(null);
  const vectors = useRef<VectorLayer[]>([]);
  const current = useRef(state);
  const callback = useRef(onChange);
  const [tileError, setTileError] = useState(false);
  const [dragging, setDragging] = useState<number | null>(null);
  const canNavigate = interactive && pageId !== 'comparison';
  current.current = state; callback.current = onChange;

  useEffect(() => {
    const shared = new View({ showFullExtent: mapConfig.image, projection: mapConfig.projection, center: current.current.center, zoom: current.current.zoom, minZoom: 0, maxZoom: 24, enableRotation: false, ...(mapConfig.image ? { extent: [0, -mapConfig.height, mapConfig.width, 0], resolutions: new Zoomify({ url: mapConfig.urls[0], size: [mapConfig.width, mapConfig.height] }).getTileGrid()?.getResolutions() } : {}) });
    view.current = shared;
    let failed = 0;
    const maps = targets.current.map((target, index) => {
      const source = mapConfig.image
        ? new Zoomify({ url: mapConfig.urls[index], size: [mapConfig.width, mapConfig.height], crossOrigin: 'anonymous' })
        : new XYZ({ url: mapConfig.urls[index], crossOrigin: 'anonymous', attributions: mapConfig.attribution, maxZoom: 19 });
      source.on('tileloaderror', () => { failed++; if (failed >= 3) setTileError(true); });
      source.on('tileloadend', () => { failed = 0; setTileError(false); });
      const points = new VectorLayer({ source: new VectorSource({ features: [
        new Feature(new Point(initialState.center)),
        new Feature(new Point([initialState.center[0] + (mapConfig.image ? mapConfig.width * 0.12 : 1700), initialState.center[1] + (mapConfig.image ? mapConfig.height * 0.1 : 1200)])),
      ] }), style: new Style({ image: new Circle({ radius: 7, fill: new Fill({ color: '#2dd4ae' }), stroke: new Stroke({ color: '#fff', width: 3 }) }) }) });
      vectors.current.push(points);
      return new Map({ target: target!, layers: [new TileLayer({ source, cacheSize: 256, className: 'map-raster' }), points], view: shared, controls: controls({ zoom: false, rotate: false, attribution: interactive && index === 0 }), interactions: interactions({ dragPan: canNavigate, pinchZoom: canNavigate, pinchRotate: false, altShiftDragRotate: false, doubleClickZoom: canNavigate, mouseWheelZoom: canNavigate, shiftDragZoom: canNavigate, keyboard: canNavigate }) });
    });
    const publish = () => {
      if (!canNavigate) return;
      const center = shared.getCenter(); const zoom = shared.getZoom();
      const old = current.current;
      if (center && zoom !== undefined && (Math.abs(center[0] - old.center[0]) > 0.001 || Math.abs(center[1] - old.center[1]) > 0.001 || Math.abs(zoom - old.zoom) > 0.0001)) callback.current({ center: [...center] as [number, number], zoom });
    };
    let frame = 0;
    const schedule = () => {
      if (!frame && canNavigate) frame = requestAnimationFrame(() => { frame = 0; publish(); });
    };
    shared.on('change:center', schedule);
    shared.on('change:resolution', schedule);
    maps[0].on('moveend', publish);
    const resize = () => {
      maps.forEach(map => map.updateSize());
      if (mapConfig.image && current.current.comparison && maps[0].getSize()) {
        shared.fit([0, -mapConfig.height, mapConfig.width, 0], { size: maps[0].getSize() });
      }
    };
    const observer = new ResizeObserver(resize);
    resize();
    if (root.current) observer.observe(root.current);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); maps.forEach(map => map.dispose()); vectors.current = []; view.current = null; };
  }, [interactive, canNavigate, pageId]);

  useEffect(() => {
    const active = view.current;
    if (!active) return;
    vectors.current.forEach(layer => layer.setVisible(interactive && state.showPoints));
    if (pageId === 'comparison' && mapConfig.image) return;
    if (interactive && (active.getInteracting() || active.getAnimating())) return;
    const center = active.getCenter();
    if (!center || Math.abs(center[0] - state.center[0]) > 0.001 || Math.abs(center[1] - state.center[1]) > 0.001) active.setCenter(state.center);
    if (Math.abs((active.getZoom() || 0) - state.zoom) > 0.0001) active.setZoom(state.zoom);
  }, [state.center, state.zoom, state.showPoints, interactive, canNavigate, pageId]);

  const moveSplit = (index: number, value: number, outerLayer = false, groupIndex = 0) => {
    if (outerLayer) {
      const outerSplits = [...(state.outerSplits || [0.5])];
      outerSplits[index] = Math.max(index ? outerSplits[index - 1] + 0.08 : 0.05, Math.min(value, index < outerSplits.length - 1 ? outerSplits[index + 1] - 0.08 : 0.95));
      onChange({ outerSplits });
      return;
    }
    const groups = (state.innerSplits || [state.splits]).map(group => [...group]);
    const splits = groups[groupIndex] || groups[0];
    splits[index] = Math.max(index ? splits[index - 1] + 0.08 : 0.05, Math.min(value, index < splits.length - 1 ? splits[index + 1] - 0.08 : 0.95));
    groups[groupIndex] = splits;
    onChange({ splits: splits as [number, number], innerSplits: groups });
  };
  const drag = (event: PointerEvent<HTMLDivElement>, index: number, outerLayer = false, groupIndex = 0) => {
    if (dragging !== index || !root.current) return;
    const box = root.current.getBoundingClientRect();
    const absolute = (event.clientX - box.left) / box.width;
    if (outerLayer) { moveSplit(index, absolute, true); return; }
    const groupCount = state.innerSplits?.length || 1;
    moveSplit(index, (absolute - groupIndex / groupCount) * groupCount, false, groupIndex);
  };
  const key = (event: KeyboardEvent, index: number) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); moveSplit(index, state.splits[index] + (event.key === 'ArrowLeft' ? -0.02 : 0.02)); }
  };
  const inner = state.innerSplits?.[0] || state.splits;
  const edges = [0, ...inner, 1];
  return <div className={`map-stage ${interactive ? 'is-interactive show-map-annotations' : 'display-map'}`} ref={root} aria-label={pageId === 'comparison' ? '嵌套地图对比' : '地图'}>
    {[0, 1, 2].map(index => <div key={index} className="map-slice" style={{ clipPath: pageId === 'comparison' ? `inset(0 ${(1 - edges[index + 1]) * 100}% 0 ${edges[index] * 100}%)` : undefined, visibility: pageId !== 'comparison' && index > 0 ? 'hidden' : 'visible' }}>
      <div className="map-target" ref={node => { targets.current[index] = node; }} />
    </div>)}
    {pageId === 'comparison' && <>
      {(state.outerSplits || [0.5]).map((split, index) => <div className="divider outer-divider" key={`outer-${index}`} style={{ left: `${split * 100}%` }}>
        {interactive ? <div className="divider-grip" role="slider" tabIndex={0} aria-label={`外层分割线 ${index + 1}`} aria-valuenow={Math.round(split * 100)} aria-valuemin={5} aria-valuemax={95} aria-orientation="horizontal" onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); setDragging(index); }} onPointerMove={event => drag(event, index, true)} onPointerUp={event => { drag(event, index, true); setDragging(null); }} /> : null}
      </div>)}
      {(state.innerSplits || [inner]).map((group, groupIndex) => {
        const start = groupIndex / (state.innerSplits?.length || 1);
        const end = (groupIndex + 1) / (state.innerSplits?.length || 1);
        return group.map((split, index) => <div className="divider inner-divider" key={`inner-${groupIndex}-${index}`} style={{ left: `${(start + (end - start) * split) * 100}%` }}>
          {interactive ? <div className="divider-grip" role="slider" tabIndex={0} aria-label={`地点${groupIndex + 1}内分割线 ${index + 1}`} aria-valuenow={Math.round(split * 100)} aria-valuemin={5} aria-valuemax={95} aria-orientation="horizontal"
            onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); setDragging(index); }} onPointerMove={event => drag(event, index, false, groupIndex)} onPointerUp={event => { drag(event, index, false, groupIndex); setDragging(null); }} onPointerCancel={() => setDragging(null)} onLostPointerCapture={() => setDragging(null)} onKeyDown={event => key(event, index)}><IonIcon icon={reorderThreeOutline} /></div> : null}
        </div>);
      })}
    </>}
    {interactive && tileError && <div className="tile-error" role="status">地图瓦片加载失败，请检查网络或地图源地址</div>}
    {interactive && !mapConfig.image && <div className="map-attribution">{mapConfig.attribution}</div>}
  </div>;
}
