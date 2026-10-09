/**
 * The narrator: turns the simulation's `story` beats into voiced subtitles (the Keeper, the champion
 * and the bosses), the stage title card and boss introduction banners.
 *
 * Presentation only. Line choice uses Math.random — narration never feeds back into the simulation —
 * and it is rate-limited so that frequent beats (elites, shrines, streaks) stay occasional flavour.
 */
import { audio } from '../audio/audio';
import { U } from '../core/util';
import { CHAR_BY_ID } from '../data/characters';
import { BOSSES } from '../data/enemies';
import { BOON_BY_ID } from '../data/boons';
import { BOSS_LINES, CHAR_LINES, KEEPER, KEEPER_STAGE, REACTIONS, SHRINES, STAGE_CARDS, type StoryBeat } from '../data/story';
import type { Game } from '../game/game';
import type { StoryBeatId } from '../game/types';
import { Save } from '../meta/save';
import { Sprites as S } from '../render/sprites';

interface Spoken {
  who: string;
  text: string;
  /** High-priority lines queue; low-priority ones are dropped when the narrator is busy. */
  high: boolean;
}

const KEEPER_COLOR = '#ffb347';
/** Minimum seconds between two low-priority lines. */
const LOW_GAP = 12;

const pick = <T>(arr: readonly T[] | undefined): T | undefined =>
  arr && arr.length ? arr[Math.floor(Math.random() * arr.length)] : undefined;

export class Narrator {
  /** The Keeper's epitaph for the run that just ended (shown on the death screen). */
  epitaph = '';
  private box: HTMLElement;
  private card: HTMLElement;
  private banner: HTMLElement;
  private queue: Spoken[] = [];
  private showing = false;
  private lastLow = -Infinity;
  private recent: string[] = [];
  private timers: ReturnType<typeof setTimeout>[] = [];
  private portraits = new Map<string, string>();

  constructor(private game: Game) {
    this.box = this.mount('narrator');
    this.card = this.mount('stagecard');
    this.banner = this.mount('bossbanner');
    game.events.on('story', (beat, ref) => this.beat(beat, ref));
  }

  private mount(id: string): HTMLElement {
    const el = document.getElementById(id) ?? document.body.appendChild(document.createElement('div'));
    el.id = id;
    el.className = 'hidden';
    el.setAttribute('aria-live', 'polite');
    return el;
  }

  /** Drop everything on screen and in the queue (run ended, back to the menu). */
  clear(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    this.queue = [];
    this.showing = false;
    for (const el of [this.box, this.card, this.banner]) el.classList.add('hidden');
  }

  private later(ms: number, fn: () => void): void {
    this.timers.push(setTimeout(fn, ms));
  }

  /* ------------------------------------------------------------------ */
  /* beats                                                              */
  /* ------------------------------------------------------------------ */

  private beat(beat: StoryBeatId, ref?: string): void {
    const g = this.game,
      charId = g.char.id,
      ch = CHAR_LINES[charId],
      keeper = (b: StoryBeat) => pick(KEEPER[b]);
    switch (beat) {
      case 'runStart': {
        this.clear();
        this.stageCard(ref ?? g.stage.id);
        const stageLine = Math.random() < 0.5 ? pick(KEEPER_STAGE[ref ?? '']) : undefined;
        this.later(1600, () => this.say('keeper', stageLine ?? keeper('runStart'), true));
        this.later(9000, () => this.say(charId, pick(ch?.start), false));
        break;
      }
      case 'bossIntro': {
        if (!ref) return;
        this.bossBanner(ref);
        this.say(ref, pick(BOSS_LINES[ref]?.intro), true);
        if (Math.random() < 0.7) this.say(charId, pick(ch?.bossIntro), true);
        break;
      }
      case 'bossPhase':
        if (ref) this.say(ref, pick(BOSS_LINES[ref]?.phase), true);
        break;
      case 'bossDown':
        if (ref) this.say(ref, pick(BOSS_LINES[ref]?.death), true);
        this.say(Math.random() < 0.6 ? charId : 'keeper', Math.random() < 0.6 ? pick(ch?.bossDown) : keeper('bossDown'), true);
        break;
      case 'eclipse':
        this.say('keeper', keeper('eclipse'), true);
        this.say(charId, pick(ch?.eclipse), true);
        break;
      case 'evolve':
        if (Math.random() < 0.6) this.say(charId, pick(ch?.evolve), false);
        else this.say('keeper', keeper('evolve'), false);
        break;
      case 'lowHp':
        this.say(Math.random() < 0.65 ? charId : 'keeper', Math.random() < 0.65 ? pick(ch?.lowHp) : keeper('lowHp'), false);
        break;
      case 'revive':
        this.say(charId, pick(ch?.revive), true);
        break;
      case 'shrine':
        if (Math.random() < 0.7) this.say('keeper', pick(SHRINES[ref ?? '']?.lines) ?? keeper('shrine'), false);
        break;
      case 'combo':
        this.say('keeper', keeper('combo'), false);
        break;
      case 'boon':
        if (Math.random() < 0.6) this.say('keeper', keeper('boon'), false);
        break;
      case 'reaction': {
        // the Keeper explains each reaction the first time you ever cause it
        const key = 'react_' + ref;
        if (ref && !Save.data.seen[key]) {
          Save.data.seen[key] = true;
          this.say('keeper', REACTIONS[ref]?.keeper, true);
        } else if (Math.random() < 0.25) this.say('keeper', keeper('reaction'), false);
        break;
      }
      case 'elite':
        if (Math.random() < 0.35) this.say('keeper', keeper('elite'), false);
        break;
      case 'bloodMoon':
        this.say('keeper', keeper('bloodMoon'), true);
        break;
      case 'meteors':
        if (Math.random() < 0.6) this.say('keeper', keeper('meteors'), false);
        break;
      case 'hoarder':
        if (Math.random() < 0.5) this.say('keeper', keeper('hoarder'), false);
        break;
      case 'death':
        this.queue = [];
        this.epitaph = this.fill(keeper('death') ?? '');
        this.say(charId, pick(ch?.death), true);
        break;
    }
  }

  /* ------------------------------------------------------------------ */
  /* subtitles                                                          */
  /* ------------------------------------------------------------------ */

  /** Placeholders: {name} champion, {boss} current boss, {killer} what landed the last blow, {time}. */
  private fill(text: string): string {
    const g = this.game;
    return text
      .replace(/\{name\}/g, g.char.name)
      .replace(/\{boss\}/g, g.boss ? g.boss.def.name : 'the Herald')
      .replace(/\{killer\}/g, g.lastHitBy || 'the night')
      .replace(/\{time\}/g, U.fmtTime(g.time));
  }

  say(who: string, text: string | undefined, high: boolean): void {
    if (!text || this.recent.includes(text)) return;
    if (!high) {
      const now = performance.now() / 1000;
      if (this.showing || this.queue.length || now - this.lastLow < LOW_GAP) return;
      this.lastLow = now;
    }
    if (this.queue.length >= 3) this.queue.shift();
    this.queue.push({ who, text: this.fill(text), high });
    this.recent.push(text);
    if (this.recent.length > 24) this.recent.shift();
    if (!this.showing) this.next();
  }

  private next(): void {
    const line = this.queue.shift();
    if (!line) {
      this.showing = false;
      this.box.classList.add('hidden');
      return;
    }
    this.showing = true;
    const sp = this.speaker(line.who);
    this.box.innerHTML = `<img src="${sp.portrait}" alt=""><div><div class="who" style="color:${sp.color}">${U.esc(sp.name)}</div><div class="line">${U.esc(line.text)}</div></div>`;
    this.box.classList.remove('hidden');
    // restart the entrance animation
    this.box.style.animation = 'none';
    void this.box.offsetWidth;
    this.box.style.animation = '';
    audio.play('narrate');
    const ms = U.clamp(2400 + line.text.length * 45, 3200, 7000);
    this.later(ms, () => this.next());
  }

  private speaker(who: string): { name: string; color: string; portrait: string } {
    let portrait = this.portraits.get(who);
    if (who === 'keeper') {
      portrait ??= S.iconURL({ g: 'anvil', c: KEEPER_COLOR, bg: '#7c2d12' }, 96);
      this.portraits.set(who, portrait);
      return { name: 'The Keeper', color: KEEPER_COLOR, portrait };
    }
    const c = CHAR_BY_ID[who];
    if (c) {
      portrait ??= S.portraitURL(c, 96);
      this.portraits.set(who, portrait);
      return { name: c.name, color: c.colors.accent, portrait };
    }
    const b = BOSSES[who];
    portrait ??= b ? S.enemy(who, 18, b.col, 0).toDataURL() : '';
    this.portraits.set(who, portrait);
    return { name: b ? b.name : who, color: b ? b.col.eye : '#fff', portrait };
  }

  /* ------------------------------------------------------------------ */
  /* title cards                                                        */
  /* ------------------------------------------------------------------ */

  private stageCard(stageId: string): void {
    const c = STAGE_CARDS[stageId];
    if (!c) return;
    this.card.innerHTML = `<div class="rule"></div><h1>${U.esc(c.title)}</h1><div class="line">${U.esc(c.line)}</div><div class="rule"></div>`;
    this.flash(this.card, 4200);
  }

  private bossBanner(bossId: string): void {
    const b = BOSSES[bossId];
    if (!b) return;
    const epithet = BOSS_LINES[bossId]?.epithet ?? '';
    const tier = this.game.boss && this.game.boss.bossTier ? ' · Tier ' + (this.game.boss.bossTier + 1) : '';
    this.banner.style.setProperty('--boss', b.col.eye);
    this.banner.innerHTML = `<div class="warn">A Herald approaches${tier}</div><h1>${U.esc(b.name)}</h1><div class="epithet">${U.esc(epithet)}</div>`;
    this.flash(this.banner, 3600);
  }

  private flash(el: HTMLElement, ms: number): void {
    el.classList.remove('hidden');
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
    this.later(ms, () => el.classList.add('hidden'));
  }

  /** Boon taken: make sure the beat has a name to hang on (used by tests/debug). */
  static boonName(id: string): string {
    return BOON_BY_ID[id]?.name ?? id;
  }
}
