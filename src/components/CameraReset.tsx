import { IonFab, IonFabButton, IonIcon } from '@ionic/react';
import { scanOutline } from 'ionicons/icons';
import { initialCamera } from '../map/initialCamera';
import type { ResourceCatalog } from '../map/resourceCatalog';
import type { MapState, MapViewState } from '../sync/protocol.mjs';

interface Props {
  state: MapState;
  pageId?: string;
  catalog: ResourceCatalog;
  disabled: boolean;
  onChange: (patch: Partial<MapState>, pageId: string) => void;
}

const moved = (camera?: MapViewState) => !!camera && (camera.zoom > 0.0001
  || Math.abs(camera.center[0] - 0.5) > 0.00001 || Math.abs(camera.center[1] - 0.5) > 0.00001);

export function CameraReset({ state, pageId, catalog, disabled, onChange }: Props) {
  if (!pageId || pageId !== state.page) return null;
  const patch: Partial<MapState> = pageId === 'comparison'
    ? { comparisonViews: Object.fromEntries(catalog.locations.filter(place => moved(state.comparisonViews?.[place.id])).map(place => [place.id, initialCamera()])) }
    : { mapViews: moved(state.mapViews?.[pageId]) ? { [pageId]: initialCamera() } : {} };
  if (Object.keys(patch.comparisonViews || patch.mapViews || {}).length === 0) return null;
  return <IonFab className="camera-reset" vertical="top" horizontal="end">
    <IonFabButton aria-label="恢复初始视角" title="恢复初始视角" disabled={disabled} onClick={() => onChange(patch, pageId)}>
      <IonIcon icon={scanOutline} />
    </IonFabButton>
  </IonFab>;
}
