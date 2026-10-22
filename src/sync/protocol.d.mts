export type Role = 'controller' | 'display';
export interface MapViewState { center: [number, number]; zoom: number }
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
export function parseState(value: unknown): MapState | null;
export function canPublish(role: string): boolean;
