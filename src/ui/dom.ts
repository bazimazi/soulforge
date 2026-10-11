/* SOULFORGE — small DOM helpers shared by the UI modules. */
import { U } from '../core/util';
import type { IconSpec } from '../game/types';
import { Sprites as S } from '../render/sprites';

export const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
export const $$ = (root: ParentNode, sel: string): NodeListOf<HTMLElement> => root.querySelectorAll<HTMLElement>(sel);
export const ic = (spec: IconSpec, cls = ''): string => `<img class="icon ${cls}" src="${S.iconURL(spec)}" alt="">`;
export const esc = U.esc;
/** Attributes for a non-<button> element that acts as one (keyboard activation is delegated in UI init). */
export const BTN = 'role="button" tabindex="0"';
/** Roman numerals for ranks (1-based; 0 → ''). */
export const roman = (n: number): string =>
  ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX'][
    n
  ] ?? String(n);
