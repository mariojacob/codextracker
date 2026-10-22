import { PROVIDER_IDS, type ProviderId } from './providers.js';

export type ModuleId = 'codex' | ProviderId;
export const MODULE_IDS: readonly ModuleId[] = ['codex', ...PROVIDER_IDS];

/** Keep saved positions, including disabled modules, and append newly added modules. */
export function moduleOrder(saved: readonly ModuleId[] = []): ModuleId[] {
  return [...new Set([...saved, ...MODULE_IDS])];
}

/** Move to another visible module's position without losing hidden modules. */
export function moveModule(order: readonly ModuleId[], source: ModuleId, target: ModuleId): ModuleId[] {
  const next = moduleOrder(order);
  const from = next.indexOf(source);
  const to = next.indexOf(target);
  if (from === to) return next;
  next.splice(from, 1);
  next.splice(to, 0, source);
  return next;
}
