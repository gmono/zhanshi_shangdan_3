export interface ResourceProgress {
  phase: string;
  completed: number;
  total: number;
  elapsedMs: number;
  message: string;
  currentFile?: string;
  sourcePath?: string;
  processorPath?: string;
  error?: string;
  logPath?: string;
}

export const delay = (milliseconds = 0) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));

export function parseProgress(value: unknown): ResourceProgress | null {
  if (!value || typeof value !== 'object') return null;
  const progress = value as ResourceProgress;
  return typeof progress.phase === 'string' && typeof progress.message === 'string'
    && Number.isFinite(progress.completed) && Number.isFinite(progress.total) && progress.total > 0
    && progress.completed >= 0 && progress.completed <= progress.total
    && Number.isFinite(progress.elapsedMs) && progress.elapsedMs >= 0 ? progress : null;
}
