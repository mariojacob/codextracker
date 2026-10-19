/** Renderer contract comes directly from the sandboxed preload bridge. */
import type { CodexAPI } from '../preload/index';

declare global {
  interface Window { codexAPI: CodexAPI; }
}
export {};
