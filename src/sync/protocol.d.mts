export type Role = 'controller' | 'display';
export interface MapViewState { center: [number, number]; zoom: number; space?: 'image-relative' }
export interface MapState {
  center: [number, number];
  zoom: number;
  showPoints: boolean;
  comparison: boolean;
  page: string;
  outerSplits: number[];
  innerSplits: number[][];
  mapViews?: Record<string, MapViewState>;
  splits: [number, number];
}
export type StatePatch = Omit<Partial<MapState>, 'innerSplits'> & { innerSplits?: number[][] | Record<string, number[]> };
export function parseState(value: unknown): MapState | null;
export function mergeStatePatch(base: unknown, pageId: string, patch: StatePatch | Record<string, unknown>, replace?: boolean): MapState | null;
export function canPublish(role: string): boolean;
