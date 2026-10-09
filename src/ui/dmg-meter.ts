/**
 * Damage meter: a live, per-source breakdown of the damage dealt this run (weapons, the character's
 * skill kit, burns, boons, allies…), shown in the HUD above the health bar and toggled with T or by
 * clicking its header. The same breakdown, with kills, closes the run on the game-over screen.
 *
 * Presentation-only: it reads `Game.dmgByWeapon` / `killsBySource` and never writes to the sim.
 */
import { U } from '../core/util';
import { WEAPONS } from '../data/weapons';
import type { Game } from '../game/game';
import type { CharacterDef, IconSpec, RunSummary } from '../game/types';
import { Sprites as S } from '../render/sprites';

/** Rows shown in the HUD meter (the rest stay in the total). */
const HUD_ROWS = 6;
/** Rows shown in the end-of-run report. */
const REPORT_ROWS = 12;
/** Game seconds between meter refreshes, and the sliding window the live DPS is measured over. */
const TICK = 0.5;
const WINDOW = 5;

export interface SourceInfo {
  name: string;
  icon: IconSpec;
  /** Short explanation for the tooltip. */
  hint: string;
}

/** Damage sources that aren't weapons (see `Game.damageEnemy` callers). */
const SYNTHETIC: Record<string, SourceInfo> = {
  burn: { name: 'Burning', icon: { g: 'flame', c: '#ff7043' }, hint: 'Burn damage over time' },
  bleed: { name: 'Bleeding', icon: { g: 'drop', c: '#ef4444' }, hint: 'Bleed damage over time' },
  reaction: { name: 'Reactions', icon: { g: 'spiral', c: '#a5f3fc' }, hint: 'Elemental reactions' },
  boon: { name: 'Boons', icon: { g: 'star', c: '#fbbf24' }, hint: 'Boon effects' },
  unique: { name: 'Relic powers', icon: { g: 'ring', c: '#fde68a' }, hint: 'Unique relic effects' },
  thorns: { name: 'Thorns', icon: { g: 'shield', c: '#a3e635' }, hint: 'Damage reflected by thorns' },
  resonance: { name: 'Resonance', icon: { g: 'rune', c: '#c4b5fd' }, hint: 'Resonance bonuses' },
  ally: { name: 'Allies', icon: { g: 'minion', c: '#86efac' }, hint: 'Summoned allies' },
};

/** Display name, icon and tooltip of a damage-source key. `evolved` tells whether a weapon id is evolved. */
export function sourceInfo(id: string, char: CharacterDef, evolved: (id: string) => boolean): SourceInfo {
  const w = WEAPONS[id];
  if (w) {
    const evo = evolved(id) ? w.evo : undefined;
    return evo ? { name: evo.name, icon: evo.icon, hint: 'Evolved ' + w.name } : { name: w.name, icon: w.icon, hint: 'Weapon' };
  }
  if (id === 'skill') return { name: char.active.name, icon: char.active.icon, hint: 'Active skill, trait and talent effects' };
  const syn = SYNTHETIC[id];
  if (syn) return syn;
  if (id.startsWith('ally_')) {
    const kind = id.slice(5);
    return { name: kind.charAt(0).toUpperCase() + kind.slice(1) + 's', icon: SYNTHETIC.ally!.icon, hint: 'Summoned allies' };
  }
  return { name: 'Other', icon: { g: 'star', c: '#cbd5e1' }, hint: 'Other sources' };
}

/** Sources sorted by damage, highest first, skipping empty ones. */
function ranked(dmg: Record<string, number>): [string, number][] {
  return Object.entries(dmg)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
}

function sum(dmg: Record<string, number>): number {
  let t = 0;
  for (const k in dmg) t += dmg[k]!;
  return t;
}

const fmtDps = (v: number): string => U.fmt(v) + '/s';

/** One HUD meter row, reused across refreshes so icons aren't reloaded. */
interface Row {
  el: HTMLElement;
  img: HTMLImageElement;
  name: HTMLElement;
  val: HTMLElement;
  dps: HTMLElement;
  bar: HTMLElement;
  id: string;
}

export class DamageMeter {
  private root: HTMLElement;
  private head: HTMLButtonElement;
  private totalEl: HTMLElement;
  private dpsEl: HTMLElement;
  private list: HTMLElement;
  private rows: Row[] = [];
  /** Snapshots of the per-source totals every {@link TICK}s of game time, for the windowed DPS. */
  private hist: { t: number; total: number; dmg: Record<string, number> }[] = [];
  private nextT = 0;
  private open: boolean;

  /** `onToggle` persists the new state. */
  constructor(
    parent: HTMLElement,
    open: boolean,
    private onToggle: (open: boolean) => void,
  ) {
    this.open = open;
    this.root = document.createElement('div');
    this.root.id = 'dmgmeter';
    this.root.innerHTML =
      '<button type="button" class="dm-head" title="Damage meter (T)"><span class="dm-title">Damage</span><b class="dm-total">0</b><span class="dm-dps"></span><span class="dm-caret"></span></button><div class="dm-list"></div>';
    parent.prepend(this.root);
    this.head = this.root.querySelector('.dm-head')!;
    this.totalEl = this.root.querySelector('.dm-total')!;
    this.dpsEl = this.root.querySelector('.dm-dps')!;
    this.list = this.root.querySelector('.dm-list')!;
    this.head.onclick = () => {
      this.toggle();
      this.head.blur(); // a later SPACE must dash, not click the header again
    };
    for (let i = 0; i < HUD_ROWS; i++) {
      const el = document.createElement('div');
      el.className = 'dm-row hidden';
      el.innerHTML = '<i class="dm-bar"></i><img alt=""><span class="dm-nm"></span><span class="dm-rdps"></span><b class="dm-v"></b>';
      this.list.append(el);
      this.rows.push({
        el,
        img: el.querySelector('img')!,
        name: el.querySelector('.dm-nm')!,
        val: el.querySelector('.dm-v')!,
        dps: el.querySelector('.dm-rdps')!,
        bar: el.querySelector('.dm-bar')!,
        id: '',
      });
    }
    this.applyOpen();
  }

  toggle(): void {
    this.setOpen(!this.open);
    this.onToggle(this.open);
  }

  /** Open or collapse without reporting it (the caller already persisted it). */
  setOpen(open: boolean): void {
    this.open = open;
    this.applyOpen();
    this.nextT = 0; // refresh on the next frame
  }

  private applyOpen(): void {
    this.root.classList.toggle('collapsed', !this.open);
    this.head.setAttribute('aria-expanded', String(this.open));
  }

  /** Forget the previous run. */
  reset(): void {
    this.hist.length = 0;
    this.nextT = 0;
    for (const r of this.rows) {
      r.id = '';
      r.el.classList.add('hidden');
    }
    this.totalEl.textContent = '0';
    this.dpsEl.textContent = '';
  }

  /** Called every rendered frame; only does work every {@link TICK}s of game time. */
  update(g: Game): void {
    const last = this.hist[this.hist.length - 1];
    if (last && g.time < last.t)
      this.reset(); // a new run started
    else if (last && g.time < this.nextT) return;
    this.nextT = g.time + TICK;
    const total = sum(g.dmgByWeapon);
    this.hist.push({ t: g.time, total, dmg: { ...g.dmgByWeapon } });
    while (this.hist.length > 2 && this.hist[1]!.t <= g.time - WINDOW) this.hist.shift();
    const old = this.hist[0]!,
      span = g.time - old.t;
    this.totalEl.textContent = U.fmt(total);
    this.dpsEl.textContent = span > 0 ? fmtDps((total - old.total) / span) : '';
    if (!this.open) return;
    const p = g.player,
      evolved = (id: string): boolean => p.weapons.some((w) => w.id === id && w.evolved);
    const list = ranked(g.dmgByWeapon),
      top = list.length ? list[0]![1] : 1;
    for (let i = 0; i < HUD_ROWS; i++) {
      const r = this.rows[i]!,
        e = list[i];
      if (!e) {
        r.el.classList.add('hidden');
        continue;
      }
      const [id, v] = e,
        info = sourceInfo(id, p.char, evolved);
      r.el.classList.remove('hidden');
      if (r.id !== id || r.name.textContent !== info.name) {
        r.id = id;
        r.img.src = S.iconURL(info.icon);
        r.name.textContent = info.name;
        r.el.title = info.hint;
        r.el.style.setProperty('--c', info.icon.c);
      }
      r.val.textContent = U.fmt(v) + ' · ' + Math.round((v / (total || 1)) * 100) + '%';
      r.dps.textContent = span > 0 ? fmtDps((v - (old.dmg[id] ?? 0)) / span) : '';
      r.bar.style.width = ((v / top) * 100).toFixed(1) + '%';
    }
  }
}

/** End-of-run damage report: share of the total, damage, average DPS and kills per source. */
export function damageReport(s: RunSummary, char: CharacterDef): string {
  const list = ranked(s.dmgByWeapon);
  if (!list.length) return '<div class="muted">No damage dealt.</div>';
  const total = sum(s.dmgByWeapon),
    top = list[0]![1],
    time = Math.max(1, s.time),
    evolved = (id: string): boolean => s.weapons.some((w) => w.id === id && w.evolved),
    kills = s.killsBySource;
  const rows = list.slice(0, REPORT_ROWS).map(([id, v]) => {
    const info = sourceInfo(id, char, evolved),
      pct = (v / total) * 100;
    return `<tr title="${U.esc(info.hint)}"><td><div class="src"><img src="${S.iconURL(info.icon)}" alt=""><span>${U.esc(info.name)}</span></div></td><td class="share"><div class="dm-share"><i style="width:${((v / top) * 100).toFixed(1)}%;background:${info.icon.c}"></i></div><span>${pct < 1 ? '<1' : Math.round(pct)}%</span></td><td>${U.fmt(v)}</td><td>${U.fmt(v / time)}</td><td>${U.fmt(kills[id] ?? 0)}</td></tr>`;
  });
  const rest = list.slice(REPORT_ROWS);
  if (rest.length) {
    const v = rest.reduce((a, [, x]) => a + x, 0),
      k = rest.reduce((a, [id]) => a + (kills[id] ?? 0), 0);
    rows.push(
      `<tr class="muted"><td>${rest.length} more</td><td class="share"><span>${Math.round((v / total) * 100)}%</span></td><td>${U.fmt(v)}</td><td>${U.fmt(v / time)}</td><td>${U.fmt(k)}</td></tr>`,
    );
  }
  const allKills = Object.values(kills).reduce((a, x) => a + x, 0);
  return `<table class="dmg-table dmg-report"><thead><tr><th>Source</th><th>Share</th><th>Damage</th><th>DPS</th><th>Kills</th></tr></thead><tbody>${rows.join('')}</tbody><tfoot><tr><td>Total</td><td></td><td>${U.fmt(total)}</td><td>${U.fmt(total / time)}</td><td>${U.fmt(allKills)}</td></tr></tfoot></table>`;
}
