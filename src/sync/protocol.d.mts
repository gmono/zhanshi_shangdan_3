export type Role = 'controller' | 'display';
export interface MapState {
  center: [number, number];
  zoom: number;
  showPoints: boolean;
  comparison: boolean;
  page: string;
  outerSplits: number[];
  innerSplits: number[][];
  splits: [number, number];
}
export function parseState(value: unknown): MapState | null;
export function canPublish(role: string): boolean;
