import { isTauri } from '@tauri-apps/api/core';
import { type } from '@tauri-apps/plugin-os';
import type { Role } from '../sync/protocol.mjs';

export function getRole(): Role {
  if (isTauri()) return type() === 'ios' || type() === 'android' ? 'controller' : 'display';
  return new URLSearchParams(location.search).get('role') === 'controller' ? 'controller' : 'display';
}
