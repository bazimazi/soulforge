import type { FixedLoop } from './core/loop';
import type { Game } from './game/game';
import type { Renderer } from './render/renderer';

declare global {
  interface Window {
    /** Debug/automation handle (used by the e2e smoke test and the browser console). */
    __SF?: { game: Game; renderer: Renderer; loop: FixedLoop };
  }
}
