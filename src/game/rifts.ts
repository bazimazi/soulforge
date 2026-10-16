/** Optional, bounded world objectives. All timing and randomness belong to the simulation. */
import { rand } from '../core/rng';
import { U } from '../core/util';
import { RIFT_DEFS, RIFT_RELICS, type RiftKind, type RiftRelic } from '../data/rifts';
import type { Game } from './game';
import type { Enemy, StatBag } from './types';

export interface RiftEncounter {
  kind: RiftKind;
  x: number;
  y: number;
  phase: 'available' | 'active' | 'complete' | 'failed';
  channel: number;
  remaining: number;
  progress: number;
  waveT: number;
  targets: Enemy[];
  beacons: { x: number; y: number; lit: boolean; channel: number }[];
}

export const RIFT_CHANNEL = 1.25;
export const WARD_TIME = 18;
export const WARD_RADIUS = 145;

export class RiftDirector {
  current: RiftEncounter | null = null;
  completed = 0;
  relics: string[] = [];
  offers: RiftRelic[] = [];
  readonly stats: StatBag = {};
  private nextAt = 22;
  private sequence = 0;
  private kills = 0;

  constructor(private readonly game: Game) {}

  reset(): void {
    this.current = null;
    this.completed = this.sequence = this.kills = 0;
    this.nextAt = 22;
    this.relics = [];
    this.offers = [];
    for (const key in this.stats) delete this.stats[key];
  }

  /** Public for encounter tooling; ordinary play schedules these automatically. */
  spawn(kind?: RiftKind): RiftEncounter {
    const p = this.game.player;
    const angle = Math.atan2(p.face.y, p.face.x) + (rand() - 0.5) * 1.1;
    const selected = kind ?? (['ward', 'hunt', 'relay'] as const)[this.sequence % 3]!;
    this.sequence++;
    return (this.current = {
      kind: selected,
      x: p.x + Math.cos(angle) * 340,
      y: p.y + Math.sin(angle) * 340,
      phase: 'available',
      channel: 0,
      remaining: 100,
      progress: 0,
      waveT: 1.5,
      targets: [],
      beacons: [],
    });
  }

  update(dt: number): void {
    const g = this.game;
    if (!this.current) {
      if (g.time >= this.nextAt && !g.boss && this.relics.length < RIFT_RELICS.length) {
        const r = this.spawn();
        g.fx.ring(r.x, r.y, 90, RIFT_DEFS[r.kind].color, { thin: true });
        g.sfx('shrine');
      }
      return;
    }
    const r = this.current;
    if (r.phase === 'complete' || r.phase === 'failed') {
      r.remaining -= dt;
      if (r.remaining <= 0) this.current = null;
      return;
    }
    r.remaining -= dt;
    const p = g.player;
    if (r.phase === 'available') {
      // A deliberate pause in the core commits the player, without consuming the active-ability key.
      const inside = U.dist2(p.x, p.y, r.x, r.y) < 48 * 48;
      r.channel = inside && Math.hypot(p.move.x, p.move.y) < 0.15 && p.dashT <= 0 ? r.channel + dt : Math.max(0, r.channel - dt * 2);
      if (r.channel >= RIFT_CHANNEL) this.activate(r);
    } else {
      r.waveT -= dt;
      if (r.waveT <= 0) {
        r.waveT = r.kind === 'hunt' ? 7 : 4;
        this.wave(r, 4 + Math.min(4, this.completed));
      }
      if (r.kind === 'ward') {
        const inside = U.dist2(p.x, p.y, r.x, r.y) < WARD_RADIUS * WARD_RADIUS;
        r.progress = U.clamp(r.progress + dt * (inside ? 1 : -0.35), 0, WARD_TIME);
        if (r.progress >= WARD_TIME) this.complete(r);
      } else if (r.kind === 'hunt') {
        r.progress = r.targets.filter((e) => e.dead).length;
        if (r.progress === 3) this.complete(r);
      } else {
        for (const b of r.beacons) {
          if (b.lit) continue;
          if (U.dist2(p.x, p.y, b.x, b.y) < 40 * 40 && p.dashT <= 0) {
            b.channel += dt;
            if (b.channel >= RIFT_CHANNEL) {
              b.lit = true;
              g.fx.ring(b.x, b.y, 80, '#fbbf24');
              g.sfx('shrine');
            }
          } else b.channel = Math.max(0, b.channel - dt);
        }
        r.progress = r.beacons.filter((b) => b.lit).length;
        if (r.progress === 3) this.complete(r);
      }
    }
    if (r.remaining <= 0 && (r.phase === 'available' || r.phase === 'active')) {
      r.phase = 'failed';
      r.remaining = 3;
      this.nextAt = g.time + 45;
      for (const e of r.targets) delete e.riftTarget;
      g.notice('The rift fades. Another light will rise.', '#a1a1aa', 2.5);
    }
  }

  private activate(r: RiftEncounter): void {
    const g = this.game;
    r.phase = 'active';
    r.remaining = RIFT_DEFS[r.kind].duration;
    g.fx.ring(r.x, r.y, WARD_RADIUS, RIFT_DEFS[r.kind].color);
    g.sfx('shrine');
    if (r.kind === 'hunt') {
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * U.TAU;
        const e = g.spawnEnemy(i === 1 ? 'ghoul' : 'skeleton', r.x + Math.cos(a) * 220, r.y + Math.sin(a) * 220, {
          elite: true,
          hpMul: 1.15,
        });
        e.riftTarget = true;
        r.targets.push(e);
      }
    } else if (r.kind === 'relay') {
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * U.TAU - Math.PI / 2;
        r.beacons.push({ x: r.x + Math.cos(a) * 220, y: r.y + Math.sin(a) * 220, lit: false, channel: 0 });
      }
    }
  }

  private wave(r: RiftEncounter, count: number): void {
    const g = this.game,
      angle = rand() * U.TAU;
    for (let i = 0; i < count; i++) {
      const a = angle + (i / count) * U.TAU;
      const e = g.spawnEnemy(i % 3 === 0 && g.time > 120 ? 'ghoul' : 'skeleton', r.x + Math.cos(a) * 330, r.y + Math.sin(a) * 330);
      e.spawnT = 0.65; // existing emerge animation makes arrivals readable
    }
    g.fx.ring(r.x, r.y, 330, RIFT_DEFS[r.kind].color, { thin: true });
  }

  private complete(r: RiftEncounter): void {
    const g = this.game;
    r.phase = 'complete';
    r.remaining = 4;
    for (const e of r.targets) delete e.riftTarget;
    this.completed++;
    this.nextAt = g.time + 70;
    // Shuffle the eligible pool once; the selected offers are the authoritative reward transaction.
    const pool = RIFT_RELICS.filter((x) => !this.relics.includes(x.id));
    U.shuffle(pool);
    this.offers = pool.slice(0, 3);
    g.gold += 35 + this.completed * 15;
    g.embers++;
    g.mats.iron += 2 + this.completed;
    g.fx.ring(r.x, r.y, 220, '#fde68a');
    g.fx.burst(r.x, r.y, '#fde68a', 26, { speed: 150, life: 0.7 });
    g.sfx('chest');
  }

  pick(id: string): boolean {
    const g = this.game,
      relic = this.offers.find((x) => x.id === id);
    if (g.state !== 'relic' || !relic || this.relics.includes(id) || g.player.hp <= 0) return false;
    this.relics.push(id);
    this.offers = [];
    for (const key in relic.stats) this.stats[key] = (this.stats[key] ?? 0) + relic.stats[key]!;
    g.recalc();
    if (id === 'rift_oath') g.heal(g.player.stats.maxHp * 0.2);
    g.state = 'play';
    return true;
  }

  onKill(): void {
    const p = this.game.player;
    this.kills++;
    if (this.relics.includes('rift_feast') && this.kills % 20 === 0) this.game.heal(p.stats.maxHp * 0.04);
    if (this.relics.includes('rift_flow') && p.dashCharges < p.dashMax) p.dashCdT = Math.max(0, p.dashCdT - 0.04);
  }

  onDash(): void {
    const g = this.game,
      p = g.player;
    if (this.relics.includes('rift_stride'))
      g.nova(p.x, p.y, 95, (12 + p.level * 1.5) * p.stats.might, { id: 'relic' }, { color: '#7dd3fc', knock: 0.8 });
  }
}
