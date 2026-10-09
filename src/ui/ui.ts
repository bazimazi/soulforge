/* SOULFORGE — DOM user interface: menus, HUD, modals */
import { audio } from '../audio/audio';
import type { InputManager } from '../core/input';
import { U } from '../core/util';
import { CHARACTERS, CHAR_BASE, CHAR_BY_ID } from '../data/characters';
import { ARMORY_STAGES, BESTIARY_REWARD, BESTIARY_TIERS, BOSS_REWARD, BOSS_TIERS, MILESTONES, PARAGON, charXpFor } from '../data/codex';
import { BOONS, BOON_BY_ID } from '../data/boons';
import { BOSSES, BOSS_ORDER, ELITE_AFFIXES, ENEMIES } from '../data/enemies';
import { SHRINE_DEFS } from '../data/shrines';
import { BOSS_LINES, CHRONICLE, PROLOGUE, TIPS } from '../data/story';
import { COMBO_TIERS, COMBO_WINDOW, REACTION_DEFS, RESONANCES, RESONANCE_BY_TAG, resonanceTier } from '../data/synergy';
import { ANVIL, ANVIL_BY_ID, ANVIL_TIER_REQ, CATALYSTS, RARITY_BY_ID, SIGILS, SIGIL_BY_ID, SLOTS, SLOT_BY_ID, TRANSMUTE, UNIQUES, UNIQUE_BY_ID, anvilCost, craftCost, forgeLevelPerks, forgeXpFor, itemAffixValue, reforgeCost, salvageValue, upgradeCost } from '../data/forge';
import type { Reward } from '../data/forge';
import { MATERIALS, MAT_BY_ID, OMENS, OMEN_BY_ID, PASSIVE_BY_ID, STAGES, STAGE_BY_ID, heatBonus, statFmt, statName } from '../data/passives';
import { WEAPONS, WH } from '../data/weapons';
import { DASH, type Game } from '../game/game';
import type { BoonDef, Chapter, ChestReward, Enemy, EnemyDef, IconSpec, LevelOption, RunSummary } from '../game/types';
import { Save } from '../meta/save';
import type { FX } from '../render/fx';
import { Sprites as S } from '../render/sprites';
import { DamageMeter, damageReport } from './dmg-meter';
import { MapView } from './minimap';
import { Narrator } from './narrator';

/** The slice of the renderer the UI needs (settings screen). */
export interface RendererLike {
  quality: number;
  postEnabled: boolean;
  resize(): void;
  fx: FX;
}

export interface UiDeps {
  game: Game;
  renderer: RendererLike;
  input: InputManager;
}

type ForgeTab = 'anvil' | 'armory' | 'transmute' | 'sigils';
type CodexTab = 'story' | 'chronicles' | 'bestiary' | 'armory' | 'relics' | 'milestones' | 'lexicon';
type KeyHandler = (e: KeyboardEvent) => void;

/** Delay between the sim reporting death and the summary appearing (lets the death FX play). */
const GAME_OVER_DELAY_MS = 900;

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const $$ = (root: ParentNode, sel: string): NodeListOf<HTMLElement> => root.querySelectorAll<HTMLElement>(sel);
const ic = (spec: IconSpec, cls = ''): string => `<img class="icon ${cls}" src="${S.iconURL(spec)}" alt="">`;
const esc = U.esc;
/** Attributes for a non-<button> element that acts as one (keyboard activation is delegated in init). */
const BTN = 'role="button" tabindex="0"';
const matName = (k: string): string => (k === 'gold' ? 'gold' : k === 'embers' ? 'embers' : MAT_BY_ID[k]!.name);
const fmtLevel = (n: number): string => 'LV ' + n;
const fmtHp = (hp: number, max: number): string => hp + ' / ' + max;

/**
 * A HUD element that only writes to the DOM when what it displays changes.
 * `updateHud` runs every rendered frame, so every setter compares against a cached value first.
 */
class HudSlot<E extends HTMLElement = HTMLElement> {
  private text: string | null = null;
  private num = NaN;
  private k1 = NaN;
  private k2 = NaN;
  private width = NaN;
  private scale = NaN;
  private readonly classes = new Map<string, boolean>();

  constructor(readonly el: E) {}

  setText(s: string): void {
    if (s === this.text) return;
    this.text = s;
    this.num = this.k1 = this.k2 = NaN;
    this.el.textContent = s;
  }
  /** Text derived from one number; `fmt` only runs when the number changes. */
  setNum(n: number, fmt: (n: number) => string): void {
    if (n === this.num) return;
    this.setText(fmt(n));
    this.num = n;
  }
  /** Text derived from two numbers; `fmt` only runs when either changes. */
  setPair(a: number, b: number, fmt: (a: number, b: number) => string): void {
    if (a === this.k1 && b === this.k2) return;
    this.setText(fmt(a, b));
    this.k1 = a;
    this.k2 = b;
  }
  /** Width as a 0..1 fraction, rounded to 0.1%. */
  setWidth(frac: number): void {
    const w = Math.round(U.clamp(frac, 0, 1) * 1000) / 10;
    if (w === this.width) return;
    this.width = w;
    this.el.style.width = w + '%';
  }
  /** Vertical scale (cooldown wipe), rounded to 0.001. */
  setScaleY(k: number): void {
    const v = Math.round(k * 1000);
    if (v === this.scale) return;
    this.scale = v;
    this.el.style.transform = 'scaleY(' + v / 1000 + ')';
  }
  toggle(cls: string, on: boolean): void {
    if (this.classes.get(cls) === on) return;
    this.classes.set(cls, on);
    this.el.classList.toggle(cls, on);
  }
}

interface HudEls {
  xp: HudSlot;
  xpTxt: HudSlot;
  kills: HudSlot;
  gold: HudSlot;
  timer: HudSlot;
  heat: HTMLElement;
  stage: HTMLElement;
  bossbar: HudSlot;
  bossNm: HudSlot;
  bossHp: HudSlot;
  hp: HudSlot;
  hpS: HudSlot;
  hpTxt: HudSlot;
  resbar: HudSlot;
  res: HudSlot;
  reslabel: HudSlot;
  slots: HTMLElement;
  abImg: HTMLImageElement;
  abCd: HudSlot;
  abBtn: HudSlot;
  abCh: HudSlot;
  abLbl: HTMLElement;
  dashBtn: HudSlot;
  dashCd: HudSlot;
  dashImg: HTMLImageElement;
  combo: HudSlot;
  comboN: HudSlot;
  comboName: HudSlot;
  comboBar: HudSlot;
  boons: HTMLElement;
  reso: HTMLElement;
  buff: HudSlot;
  bossEp: HudSlot;
}

class UiController {
  game!: Game;
  R!: RendererLike;
  input!: InputManager;
  selChar = 'kael';
  selStage = 'ashen';
  forgeTab: ForgeTab = 'anvil';
  codexTab: CodexTab = 'story';
  selItem: string | null = null;
  craftSlot = 'charm';
  craftCat = 'none';
  banishMode = false;
  hudEls: HudEls | null = null;
  screenName: string | null = null;
  narrator!: Narrator;
  map: MapView | null = null;
  meter: DamageMeter | null = null;
  private hudBoons = -1;
  private hudBuff = '';
  /** Flattened weapon/passive state last rendered into the HUD slot bar (rebuilt on any change). */
  private slotState: (string | number | boolean)[] = [];
  private slotDirty = true;
  private hudBoss: Enemy | null = null;
  private hudBossTier = -1;
  private resName = '';
  private lvlKeys: KeyHandler | null = null;
  private claims: Record<string, [string, Reward]> = {};

  init({ game, renderer, input }: UiDeps): void {
    this.game = game; this.R = renderer; this.input = input;
    const d = Save.data;
    this.selChar = CHAR_BY_ID[d.lastChar] ? d.lastChar : 'kael';
    this.selStage = STAGE_BY_ID[d.lastStage] ? d.lastStage : 'ashen';
    this.applyDisplaySettings();
    this.narrator = new Narrator(game);
    this.buildHud();
    game.events.on('levelUp', (options) => this.showLevelUp(options));
    game.events.on('chest', (rewards, boss) => this.showChest(rewards, boss));
    game.events.on('boon', (options) => this.showBoon(options));
    game.events.on('gameOver', (summary) => { setTimeout(() => this.showGameOver(summary), GAME_OVER_DELAY_MS); });
    game.events.on('notice', (text, color, dur) => this.notice(text, color, dur));
    game.events.on('runStart', () => { this.map?.reset(); this.meter?.reset(); });
    input.onMapKey = () => { if (this.game.state === 'play') this.map?.toggle(); };
    input.onMeterKey = () => { if (this.game.state === 'play') this.meter?.toggle(); };
    this.showTitle();
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if ($('modal').classList.contains('hidden')) { if (this.game.state === 'play') this.showPause(); }
        else if (this.game.state === 'paused') this.closePause();
      }
    });
    // Keyboard activation for clickable cards/rows rendered as role="button". On `window` (registered
    // after InputManager's listener) so a SPACE that picks a level-up card is flushed, not cast.
    window.addEventListener('keydown', (e) => {
      const t = e.target;
      if ((e.key === 'Enter' || e.key === ' ') && t instanceof HTMLElement && t.tagName !== 'BUTTON' && t.getAttribute('role') === 'button') { e.preventDefault(); t.click(); }
    });
  }

  /** Push persisted display settings into the renderer FX / FPS overlay. */
  applyDisplaySettings(): void {
    const s = Save.data.settings;
    this.R.fx.shakeMul = s.reducedMotion ? 0 : s.shake;
    this.R.fx.flashMul = s.reducedMotion ? 0.25 : 1;
    this.R.fx.dmgEnabled = s.dmgNumbers;
    this.R.postEnabled = s.postfx;
    document.getElementById('fps')?.classList.toggle('hidden', !s.fps);
  }

  /* ---------- basic helpers ---------- */
  screen(name: string, html: string): HTMLDivElement {
    const root = $('screens'); root.innerHTML = '';
    const d = document.createElement('div'); d.className = 'screen'; d.id = name; d.innerHTML = html; root.appendChild(d);
    this.screenName = name;
    return d;
  }
  modal(html: string, cls = ''): HTMLElement { const m = $('modal'); m.innerHTML = `<div class="panel modal-box ${cls}">${html}</div>`; m.classList.remove('hidden'); return m; }
  closeModal(): void { const m = $('modal'); m.classList.add('hidden'); m.innerHTML = ''; }
  currencyBar(): string {
    const d = Save.data;
    return `<div class="currency"><span title="Gold">${ic({ g: 'coin', c: '#f5c542' }, 'sm')} ${U.fmt(d.gold)}</span><span title="Soul Embers">${ic({ g: 'ember', c: '#ff8a3c' }, 'sm')} ${d.embers}</span>` +
      MATERIALS.map((m) => `<span title="${m.name}">${ic(m.icon, 'sm')} ${d.mats[m.id]}</span>`).join('') + '</div>';
  }
  head(title: string, extra = ''): string {
    return `<div class="screen-head"><div class="row"><button class="btn small" id="backBtn">◀ Back</button><h2>${title}</h2></div><div class="row">${extra}${this.currencyBar()}</div></div>`;
  }
  bindBack(fn: () => void): void { const b = document.getElementById('backBtn'); if (b) b.onclick = () => { audio.play('uiback'); fn(); }; }
  toast(text: string): void { const t = document.createElement('div'); t.className = 'toast'; t.textContent = text; document.body.appendChild(t); setTimeout(() => t.remove(), 2200); }
  notice(text: string, color?: string, dur?: number): void {
    const n = document.createElement('div'); n.className = 'notice'; n.textContent = text; n.style.color = color || '#fff'; n.style.animationDuration = `0.4s, 0.6s`; n.style.animationDelay = `0s, ${(dur || 2.5) - 0.6}s`;
    $('notices').appendChild(n); setTimeout(() => n.remove(), (dur || 2.5) * 1000);
  }
  /** Replace the level-up hotkey handler. Bound on `window` so it runs after InputManager's listener. */
  private setLvlKeys(fn: KeyHandler | null): void {
    if (this.lvlKeys) window.removeEventListener('keydown', this.lvlKeys);
    this.lvlKeys = fn;
    if (fn) window.addEventListener('keydown', fn);
  }
  /** Called whenever a modal closes back into gameplay: drop the key press that closed it. */
  private resumePlay(): void {
    this.slotDirty = true;
    this.input.flush();
  }

  /* ============ TITLE ============ */
  showTitle(): void {
    this.game.state = 'idle'; $('hud').classList.add('hidden'); this.closeModal(); this.setLvlKeys(null); this.narrator.clear();
    const d = Save.data;
    const lastC = CHAR_BY_ID[d.lastChar], lastS = STAGE_BY_ID[d.lastStage];
    const canContinue = d.stats.runs > 0 && lastC && Save.charData(lastC.id).unlocked && lastS && d.stages.unlocked.includes(lastS.id);
    const tip = TIPS[Math.floor(Math.random() * TIPS.length)] ?? '';
    this.screen('title', `
      <div class="title-stats panel" style="padding:8px 14px">${this.currencyBar()}</div>
      <div class="logo"><div class="ember-ring"></div><h1>SOULFORGE</h1><div class="sub">Endless Night</div></div>
      <div class="menu">
        ${canContinue ? `<button class="btn primary continue" id="contBtn"><img src="${S.portraitURL(lastC, 64)}" alt=""><span><b>Continue</b><small>${lastC.name} · ${lastS.name}</small></span></button>` : ''}
        <button class="btn ${canContinue ? '' : 'primary'}" id="playBtn">${canContinue ? 'New Night' : 'Play'}</button>
        <button class="btn" id="talentsBtn">Talents</button>
        <button class="btn" id="forgeBtn">Forge</button>
        <button class="btn" id="codexBtn">Codex</button>
        <button class="btn" id="settingsBtn">Settings</button>
      </div>
      <div class="whisper">“${esc(tip)}”</div>
      <div class="title-foot">Best: ${U.fmtTime(d.stats.bestTime)} · Kills: ${U.fmt(d.stats.kills)} · Runs: ${d.stats.runs}<span class="kbd-hint"> &nbsp;|&nbsp; <span class="kbd">WASD</span> move · <span class="kbd">SPACE</span> dash · <span class="kbd">E</span> ability · <span class="kbd">M</span> map · <span class="kbd">T</span> damage · <span class="kbd">ESC</span> pause</span></div>`);
    $('playBtn').onclick = () => { audio.play('ui'); this.showChars(); };
    if (canContinue) $('contBtn').onclick = () => { audio.play('buy'); this.selChar = lastC.id; this.selStage = lastS.id; this.startRun(); };
    $('talentsBtn').onclick = () => { audio.play('ui'); this.showTalents(); };
    $('forgeBtn').onclick = () => { audio.play('ui'); this.showForge(); };
    $('codexBtn').onclick = () => { audio.play('ui'); this.showCodex(); };
    $('settingsBtn').onclick = () => { audio.play('ui'); this.showSettings(); };
    if (!d.story.prologue) { this.showPrologue(); return; }
    const nu = Save.checkUnlocks();
    if (nu.length) {
      Save.save();
      // a long stack of notices would bury the menu: show a few, summarise the rest
      const shown = nu.length > 4 ? nu.slice(0, 3) : nu;
      shown.forEach((n, i) => setTimeout(() => this.notice(n.text, '#4ade80', 4), i * 600));
      if (shown.length < nu.length) setTimeout(() => this.notice(`+${nu.length - shown.length} more unlocks — see the Codex`, '#4ade80', 4), shown.length * 600);
    }
  }

  /** First launch: the Keeper's prologue, one line at a time (click / any key advances, Esc skips). */
  showPrologue(): void {
    const el = document.createElement('div'); el.id = 'prologue'; document.body.appendChild(el);
    let i = -1, timer: ReturnType<typeof setTimeout> | undefined;
    const done = (): void => { clearTimeout(timer); window.removeEventListener('keydown', key); el.classList.add('out'); setTimeout(() => el.remove(), 900); Save.data.story.prologue = true; Save.save(); this.showTitle(); };
    const next = (): void => {
      clearTimeout(timer);
      i++;
      if (i >= PROLOGUE.length) { done(); return; }
      el.innerHTML = `<div class="pl-line" style="--d:0s">${esc(PROLOGUE[i])}</div><div class="pl-who">— The Keeper</div><div class="pl-hint">${i + 1} / ${PROLOGUE.length} · click to continue · Esc to skip</div>`;
      audio.play('narrate');
      timer = setTimeout(next, 3200 + PROLOGUE[i]!.length * 45);
    };
    const key = (e: KeyboardEvent): void => { e.preventDefault(); if (e.key === 'Escape') done(); else next(); };
    el.onclick = next;
    window.addEventListener('keydown', key);
    next();
  }

  /* ============ CHARACTER SELECT ============ */
  showChars(): void {
    this.screen('chars', this.head('Choose your Champion') + `<div class="screen-body layout-2"><div class="char-grid" id="charGrid"></div><div class="panel" style="padding:16px" id="charDetail"></div></div>`);
    this.bindBack(() => this.showTitle());
    const grid = $('charGrid');
    grid.innerHTML = CHARACTERS.map((c) => {
      const cd = Save.charData(c.id);
      return `<div class="char-card ${cd.unlocked ? '' : 'locked'} ${c.id === this.selChar ? 'sel' : ''}" data-id="${c.id}" ${BTN} aria-label="${c.name}">
        <img src="${S.portraitURL(c)}" alt=""><div class="lvl">Lv ${cd.level}</div><div class="nm">${c.name}</div><div class="tt">${c.title}</div>
        ${cd.unlocked ? '' : `<div class="lock">${ic({ g: 'lock', c: '#999' }, 'sm')}<div>${c.unlock.text || 'Locked'}</div></div>`}</div>`;
    }).join('');
    $$(grid, '.char-card').forEach((el) => el.onclick = () => { this.selChar = el.dataset.id!; audio.play('ui'); $$(grid, '.char-card').forEach((x) => x.classList.toggle('sel', x.dataset.id === this.selChar)); this.renderCharDetail(); });
    this.renderCharDetail();
  }
  renderCharDetail(): void {
    const c = CHAR_BY_ID[this.selChar]!, cd = Save.charData(c.id), meta = Save.computeMeta(c.id);
    const sig = WEAPONS[c.signature]!;
    const base = Object.assign({}, CHAR_BASE, c.stats);
    const ms = (k: string): number => meta.stats[k] || 0;
    const show: [string, string | number][] = [['maxHp', Math.round(base.maxHp + ms('maxHp'))], ['armor', (base.armor + ms('armor')).toFixed(1)], ['speed', Math.round(base.speed * (1 + ms('speed')))], ['might', U.pct(base.might + ms('might'))], ['area', U.pct(base.area + ms('area'))], ['cooldown', U.pct(base.cooldown * (1 - ms('cooldown')))], ['crit', U.pct(base.crit + ms('crit'))], ['dodge', U.pct(base.dodge + ms('dodge'))], ['luck', U.pct(base.luck + ms('luck'))], ['growth', U.pct(base.growth + ms('growth'))]];
    const chapters = c.codex.map((ch, i) => cd.chapters[i] ? `<span class="tag" style="background:#3b2a5a;color:#e9d5ff">${ch.title}</span>` : '').join(' ');
    const xpNeed = charXpFor(cd.level);
    const evo = sig.evo;
    $('charDetail').innerHTML = `
      <div class="char-detail"><div><img class="big-portrait" src="${S.portraitURL(c, 260)}" alt="${c.name}"><h2 style="margin:8px 0 0;color:var(--gold)">${c.name}</h2><div class="muted">${c.title}</div>
        <div style="margin:8px 0 4px;font-size:13px" class="muted">Level ${cd.level} · ${U.fmt(cd.xp)} / ${U.fmt(xpNeed)} XP · ${Save.talentPointsFree(c.id)} talent pts free</div><div class="bar"><i style="width:${(cd.xp / xpNeed * 100).toFixed(1)}%"></i></div>
        <p style="font-style:italic;color:#b9b5c8;font-size:14px">${c.lore}</p><div>${chapters}</div></div>
      <div class="col">
        <div class="stat-grid">${show.map(([k, v]) => `<div><span class="muted">${statName(k)}</span><b>${v}</b></div>`).join('')}</div>
        <div class="kit">${ic(sig.icon)}<div><h4>${sig.name} <span class="muted" style="font-weight:400;font-size:12px">— signature weapon</span></h4><p>${sig.desc}</p>${evo ? `<p class="muted" style="font-size:12px">Evolves with ${PASSIVE_BY_ID[evo.with]!.name} → <b>${evo.name}</b></p>` : ''}</div></div>
        <div class="kit">${ic({ g: 'star', c: c.colors.accent })}<div><h4>${c.trait.name} <span class="muted" style="font-weight:400;font-size:12px">— trait</span></h4><p>${c.trait.desc}</p></div></div>
        <div class="kit">${ic(c.active.icon)}<div><h4>${c.active.name} <span class="muted" style="font-weight:400;font-size:12px">— active · ${c.active.cd}s · E</span></h4><p>${c.active.desc}</p></div></div>
      </div></div>
      <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn" id="toTalents">Talents</button><button class="btn primary" id="toSetup" ${cd.unlocked ? '' : 'disabled'}>Continue ▶</button></div>`;
    $('toTalents').onclick = () => { audio.play('ui'); this.showTalents(c.id, () => this.showChars()); };
    $('toSetup').onclick = () => { audio.play('ui'); Save.data.lastChar = c.id; Save.save(); this.showSetup(); };
  }

  /* ============ STAGE + OMENS ============ */
  showSetup(): void {
    const d = Save.data;
    if (!d.stages.unlocked.includes(this.selStage)) this.selStage = 'ashen';
    const omensUnlocked = d.stats.bossKills >= 1;
    this.screen('setup', this.head('Choose the Night') + `<div class="screen-body layout-2"><div><h3 class="gold">Stage</h3><div class="stage-list" id="stageList"></div>
      <h3 class="gold" style="margin-top:20px">Omens <span class="muted" style="font-size:13px;font-weight:400">— optional pacts that raise the Heat. Each Heat: +8% gold, XP and materials.</span></h3>
      ${omensUnlocked ? '<div class="col" id="omenList"></div>' : '<div class="muted panel" style="padding:12px">Defeat your first boss to unlock Omens.</div>'}</div>
      <div class="panel" style="padding:16px;position:sticky;top:10px" id="setupSide"></div></div>`);
    this.bindBack(() => this.showChars());
    const renderStages = (): void => {
      $('stageList').innerHTML = STAGES.map((s) => { const un = d.stages.unlocked.includes(s.id); return `<div class="stage-card ${un ? '' : 'locked'} ${s.id === this.selStage ? 'sel' : ''}" data-id="${s.id}" ${BTN}${un ? '' : ' aria-disabled="true"'}><div class="swatch" style="background:linear-gradient(135deg,${s.pal.groundLight},${s.pal.ground} 60%,${s.pal.groundDark})"></div><h3>${s.name}</h3><div class="tip">${s.desc}</div><div class="row" style="margin-top:6px;font-size:13px"><span class="bad">Difficulty ×${s.diff}</span><span class="gold">Reward ×${s.reward}</span></div><div class="tip">Best: ${U.fmtTime(d.stages.best[s.id] || 0)}${un || !s.unlock ? '' : ` · Unlock: survive ${U.fmtTime(s.unlock.time)} in ${STAGE_BY_ID[s.unlock.stage]!.name}`}</div></div>`; }).join('');
      $$($('stageList'), '.stage-card').forEach((el) => el.onclick = () => { const id = el.dataset.id!; if (!d.stages.unlocked.includes(id)) return; this.selStage = id; audio.play('ui'); renderStages(); renderSide(); });
    };
    const renderOmens = (): void => {
      if (!omensUnlocked) return;
      $('omenList').innerHTML = OMENS.map((o) => { const r = d.omens[o.id] || 0; return `<div class="omen">${ic(o.icon, 'sm')}<div class="grow"><b>${o.name}</b> <span class="muted">${o.desc}</span></div><div class="rk"><button data-id="${o.id}" data-d="-1" aria-label="Lower ${o.name}">−</button><b style="min-width:36px;text-align:center">${r} / ${o.max}</b><button data-id="${o.id}" data-d="1" aria-label="Raise ${o.name}">+</button></div></div>`; }).join('');
      $$($('omenList'), 'button').forEach((b) => b.onclick = () => { const o = OMEN_BY_ID[b.dataset.id!]!; d.omens[o.id] = U.clamp((d.omens[o.id] || 0) + Number(b.dataset.d), 0, o.max); audio.play('ui'); Save.save(); renderOmens(); renderSide(); });
    };
    const renderSide = (): void => {
      const c = CHAR_BY_ID[this.selChar]!, st = STAGE_BY_ID[this.selStage]!;
      let heat = 0; for (const id in d.omens) heat += d.omens[id] || 0;
      $('setupSide').innerHTML = `<div class="row"><img src="${S.portraitURL(c, 96)}" alt="" style="width:72px;height:72px;border-radius:8px"><div><h3 style="margin:0;color:var(--gold)">${c.name}</h3><div class="muted">${c.title}</div></div></div>
        <div style="margin:12px 0"><b>${st.name}</b><div class="tip">${st.desc}</div></div>
        <div class="heat">HEAT ${heat}</div><div class="tip">Rewards ×${heatBonus(heat).toFixed(2)} · Stage ×${st.reward}</div>
        <button class="btn primary" id="beginBtn" style="width:100%;margin-top:16px;font-size:20px">Begin the Night</button>`;
      $('beginBtn').onclick = () => { audio.play('buy'); d.lastStage = this.selStage; Save.save(); this.startRun(); };
    };
    renderStages(); renderOmens(); renderSide();
  }
  startRun(): void {
    const d = Save.data;
    const omens: Record<string, number> = {}; for (const id in d.omens) { const r = d.omens[id] || 0; if (r > 0) omens[id] = r; }
    $('screens').innerHTML = ''; this.screenName = null;
    $('hud').classList.remove('hidden');
    audio.resume(); if (d.settings.music > 0) audio.startMusic();
    this.narrator.clear();
    this.game.start({ charId: this.selChar, stageId: this.selStage, omens, meta: Save.computeMeta(this.selChar), tutorial: d.stats.runs < 3 });
    this.input.flush();
    this.buildSlots();
  }

  /* ============ TALENTS ============ */
  showTalents(charId?: string, back?: () => void): void {
    if (charId) this.selChar = charId;
    this.screen('talents', this.head('Talents', '<button class="btn small" id="respecBtn">Respec (free)</button>') + `<div class="screen-body talent-layout"><div class="char-list panel" style="padding:8px" id="tCharList"></div><div id="tTree"></div></div>`);
    this.bindBack(back || (() => this.showTitle()));
    $('respecBtn').onclick = () => { if (confirm('Reset all talent points for this character?')) { Save.respec(this.selChar); audio.play('ui'); this.renderTalents(); } };
    const list = $('tCharList');
    const renderList = (): void => { list.innerHTML = CHARACTERS.map((c) => { const cd = Save.charData(c.id); return `<div class="ci ${c.id === this.selChar ? 'sel' : ''} ${cd.unlocked ? '' : 'muted'}" data-id="${c.id}" ${BTN}><img src="${S.portraitURL(c, 48)}" alt=""><div><b>${c.name}</b><div class="tip">Lv ${cd.level} · ${Save.talentPointsFree(c.id)} pts</div></div></div>`; }).join(''); $$(list, '.ci').forEach((el) => el.onclick = () => { this.selChar = el.dataset.id!; audio.play('ui'); renderList(); this.renderTalents(); }); };
    renderList(); this.renderTalents();
  }
  renderTalents(): void {
    const c = CHAR_BY_ID[this.selChar]!, cd = Save.charData(c.id), free = Save.talentPointsFree(c.id);
    const branches = c.talents.map((b) => {
      const pts = Save.branchPoints(c.id, b.id);
      return `<div class="branch"><h3 style="color:${b.color}">${b.name} <span class="muted" style="font-size:12px">${pts} pts</span></h3>${b.nodes.map((n) => {
        const r = cd.talents[n.id] || 0, avail = Save.nodeAvailable(c.id, n), maxed = r >= n.max;
        return `<div class="tier-lbl">${n.keystone ? 'Keystone · needs 16 pts' : 'Tier ' + (n.tier + 1) + (n.tier ? ' · needs ' + n.tier * 4 + ' pts' : '')}</div><div class="node ${avail ? '' : 'locked'} ${maxed ? 'maxed' : ''} ${n.keystone ? 'keystone' : ''}" data-id="${n.id}" ${BTN}><div class="grow"><div class="nm">${n.name}</div><div class="ds">${n.desc}</div></div><div class="rank">${r}/${n.max}</div></div>`;
      }).join('')}</div>`;
    }).join('');
    const paragon = `<div class="panel" style="padding:14px;margin-top:16px"><h3 style="margin:0 0 4px;color:#c084fc">Paragon <span class="muted" style="font-size:13px;font-weight:400">— endless ranks, spend points here at any time</span></h3><div class="paragon">${PARAGON.map((p) => `<div class="node" data-p="${p.id}" ${BTN}>${ic(p.icon, 'sm')}<div class="grow"><div class="nm">${p.name}</div><div class="ds">${statFmt(p.stat, p.per)} per rank</div></div><div class="rank">${cd.paragon[p.id] || 0}</div></div>`).join('')}</div></div>`;
    const tree = $('tTree');
    tree.innerHTML = `<div class="row" style="margin-bottom:10px"><h3 style="margin:0;color:var(--gold)">${c.name}</h3><span class="muted">Level ${cd.level}</span><span class="tag" style="background:${free > 0 ? 'var(--gold)' : '#333'};color:${free > 0 ? '#000' : '#999'}">${free} points available</span><span class="tip grow">Each character level grants 1 point. Tiers unlock with points spent in that branch.</span></div><div class="branches">${branches}</div>${paragon}`;
    $$(tree, '.node[data-id]').forEach((el) => el.onclick = () => { const node = c.talents.flatMap((b) => b.nodes).find((n) => n.id === el.dataset.id)!; const err = Save.buyTalent(c.id, node); if (err) this.toast(err); else audio.play('buy'); this.renderTalents(); const li = document.querySelector('#tCharList .ci.sel .tip'); if (li) li.textContent = `Lv ${cd.level} · ${Save.talentPointsFree(c.id)} pts`; });
    $$(tree, '.node[data-p]').forEach((el) => el.onclick = () => { const err = Save.buyParagon(c.id, el.dataset.p!); if (err) this.toast(err); else audio.play('buy'); this.renderTalents(); });
  }

  /* ============ FORGE ============ */
  showForge(tab?: ForgeTab): void {
    if (tab) this.forgeTab = tab;
    const f = Save.data.forge, need = forgeXpFor(f.level);
    const tabs: [ForgeTab, string][] = [['anvil', 'Anvil'], ['armory', 'Armory'], ['transmute', 'Transmute'], ['sigils', 'Sigils']];
    this.screen('forge', this.head('The Forge') + `<div class="screen-body"><div class="row" style="margin-bottom:10px"><b class="gold">Forge Level ${f.level}</b><div class="bar grow" style="max-width:300px"><i style="width:${(f.xp / need * 100).toFixed(1)}%"></i></div><span class="tip">${U.fmt(f.xp)} / ${U.fmt(need)} · gold spent here levels the Forge: better rarities, stronger affixes, new features</span></div>
      <div class="tabs">${tabs.map(([id, n]) => `<button class="${this.forgeTab === id ? 'on' : ''}" data-t="${id}">${n}</button>`).join('')}</div><div id="forgeBody"></div></div>`);
    this.bindBack(() => this.showTitle());
    $$(document, '.tabs button').forEach((b) => b.onclick = () => { audio.play('ui'); this.showForge(b.dataset.t as ForgeTab); });
    switch (this.forgeTab) {
      case 'anvil': this.forge_anvil(); break;
      case 'armory': this.forge_armory(); break;
      case 'transmute': this.forge_transmute(); break;
      case 'sigils': this.forge_sigils(); break;
    }
  }
  refreshCurrency(): void { $$(document, '.currency').forEach((el) => el.outerHTML = this.currencyBar()); }
  forge_anvil(): void {
    const d = Save.data, total = Save.anvilTotal();
    const tiers: [number, string][] = [[1, 'Foundation'], [2, 'Refinement'], [3, 'Mastercraft'], [4, 'Mastery — endless']];
    const body = $('forgeBody');
    body.innerHTML = tiers.map(([t, name]) => { const req = ANVIL_TIER_REQ[t] || 0, locked = total < req; return `<h3 class="gold" style="margin:14px 0 8px">${name} <span class="muted" style="font-size:13px;font-weight:400">${locked ? `— unlocks at ${req} total ranks (you have ${total})` : ''}</span></h3><div class="anvil-grid">${ANVIL.filter((a) => a.tier === t).map((a) => { const r = d.anvil[a.id] || 0, cost = anvilCost(a, r), maxed = r >= a.max; return `<div class="upg ${locked ? 'locked' : ''}">${ic(a.icon)}<div class="grow"><div class="nm">${a.name} <span class="muted">${a.max >= 999 ? r : r + '/' + a.max}</span></div><div class="ds">${statName(a.stat)} ${statFmt(a.stat, a.per)} per rank · total ${statFmt(a.stat, a.per * r)}</div>${a.max < 999 ? `<div class="pips">${Array.from({ length: a.max }, (_, i) => `<i class="${i < r ? 'on' : ''}"></i>`).join('')}</div>` : ''}</div><button class="btn small ${maxed ? '' : 'primary'}" data-id="${a.id}" ${maxed || locked || d.gold < cost ? 'disabled' : ''}>${maxed ? 'MAX' : U.fmt(cost)}</button></div>`; }).join('')}</div>`; }).join('');
    $$(body, 'button[data-id]').forEach((b) => b.onclick = () => { const err = Save.buyAnvil(ANVIL_BY_ID[b.dataset.id!]!); if (err) this.toast(err); else audio.play('forge'); this.refreshCurrency(); this.forge_anvil(); });
  }
  forge_armory(): void {
    const d = Save.data, L = d.forge.level, perks = forgeLevelPerks(L), cost = craftCost(L);
    const cats = CATALYSTS.filter((c) => !c.req || perks[c.req]);
    $('forgeBody').innerHTML = `<div class="forge-layout">
      <div class="col"><h3 class="gold" style="margin:0">Equipped</h3><div class="slots" id="eqSlots"></div>
        <h3 class="gold" style="margin:10px 0 0">Craft</h3><div class="panel" style="padding:10px" class="col">
          <label class="tip" for="craftSlot">Slot</label><select id="craftSlot" style="width:100%">${SLOTS.map((s) => `<option value="${s.id}" ${s.id === this.craftSlot ? 'selected' : ''}>${s.name}</option>`).join('')}</select>
          <label class="tip" for="craftCat" style="margin-top:6px;display:block">Catalyst</label><select id="craftCat" style="width:100%">${cats.map((c) => `<option value="${c.id}" ${c.id === this.craftCat ? 'selected' : ''}>${c.name}${c.desc ? ' — ' + c.desc : ''}</option>`).join('')}</select>
          <div class="tip" style="margin:8px 0" id="craftCost"></div><button class="btn primary" id="craftBtn" style="width:100%">Craft</button>
          <div class="tip" style="margin-top:8px">Rarity odds improve with Forge level. Epic from L4, Legendary from L6, Mythic from L10. Legendary+ items carry a unique power.</div></div></div>
      <div><h3 class="gold" style="margin:0 0 8px">Inventory <span class="muted" style="font-size:13px;font-weight:400">${d.items.length}/60</span></h3><div class="inv" id="inv"></div></div>
      <div class="panel" style="padding:12px;position:sticky;top:10px" id="itemDetail"><div class="muted">Select an item.</div></div></div>`;
    const renderCost = (): void => { const cat = CATALYSTS.find((c) => c.id === this.craftCat) || CATALYSTS[0]!; const cc = cat.cost as Record<string, number>; $('craftCost').innerHTML = `Cost: <b class="gold">${cost.gold} gold</b>, ${cost.iron} Iron` + Object.keys(cc).map((m) => `, ${cc[m]} ${MAT_BY_ID[m]!.name}`).join(''); };
    $<HTMLSelectElement>('craftSlot').onchange = (e) => { this.craftSlot = (e.target as HTMLSelectElement).value; };
    $<HTMLSelectElement>('craftCat').onchange = (e) => { this.craftCat = (e.target as HTMLSelectElement).value; renderCost(); };
    $('craftBtn').onclick = () => { const r = Save.craft(this.craftSlot, this.craftCat); if (r.err !== undefined) { this.toast(r.err); return; } audio.play('forge'); this.selItem = r.item.uid; this.refreshCurrency(); this.forge_armory(); const rar = RARITY_BY_ID[r.item.rarity]!; if (rar.index >= 3) { this.notice(`Forged: ${r.item.name} (${rar.name})`, rar.color, 3); audio.play('evolve'); } else this.toast(`Forged: ${r.item.name} (${rar.name})`); };
    renderCost();
    // NOTE: item fields come from the save, which can be imported from an arbitrary string — escape them.
    const renderSlots = (): void => { $('eqSlots').innerHTML = SLOTS.map((s) => { const it = d.items.find((x) => x.uid === d.equipped[s.id]); return `<div class="slot ${it && it.uid === this.selItem ? 'sel' : ''}" data-uid="${it ? esc(it.uid) : ''}" ${it ? BTN : ''}>${ic(s.icon, 'sm')}<div><div class="tip">${s.name}</div>${it ? `<div class="r-${esc(it.rarity)}"><b>${esc(it.name)}</b> +${esc(it.level)}</div>` : '<div class="muted">— empty —</div>'}</div></div>`; }).join(''); $$($('eqSlots'), '.slot').forEach((el) => el.onclick = () => { if (el.dataset.uid) { this.selItem = el.dataset.uid; renderInv(); renderSlots(); renderDetail(); } }); };
    const renderInv = (): void => { const items = d.items.slice().sort((a, b) => RARITY_BY_ID[b.rarity]!.index - RARITY_BY_ID[a.rarity]!.index || b.level - a.level); $('inv').innerHTML = items.map((it) => { const eq = d.equipped[it.slot] === it.uid; return `<div class="item r-${esc(it.rarity)} ${it.uid === this.selItem ? 'sel' : ''}" data-uid="${esc(it.uid)}" ${BTN}><div class="row">${ic(SLOT_BY_ID[it.slot]!.icon, 'sm')}<div><div class="nm">${esc(it.name)}</div><div class="rar">${RARITY_BY_ID[it.rarity]!.name} +${esc(it.level)}</div></div></div>${eq ? '<div class="eq">EQUIPPED</div>' : ''}</div>`; }).join('') || '<div class="muted">No items yet. Craft one!</div>'; $$($('inv'), '.item').forEach((el) => el.onclick = () => { this.selItem = el.dataset.uid!; audio.play('ui'); renderInv(); renderSlots(); renderDetail(); }); };
    const renderDetail = (): void => {
      const it = d.items.find((x) => x.uid === this.selItem); const box = $('itemDetail');
      if (!it) { box.innerHTML = '<div class="muted">Select an item.</div>'; return; }
      const r = RARITY_BY_ID[it.rarity]!, eq = d.equipped[it.slot] === it.uid, up = upgradeCost(it), maxed = it.level >= r.maxUp, u = it.unique ? UNIQUE_BY_ID[it.unique] : null, sv = salvageValue(it) as Record<string, number>;
      const upMats = up.mats as Record<string, number>;
      box.innerHTML = `<h3 class="r-${esc(it.rarity)}" style="margin:0">${esc(it.name)}</h3><div class="tip">${r.name} ${SLOT_BY_ID[it.slot]!.name} · +${esc(it.level)}/${r.maxUp} · item level ${esc(it.ilvl)}</div>
        <div style="margin:10px 0">${it.affixes.map((a, i) => `<div class="affix"><span>${esc(statName(a.stat))}</span><span><b class="good">${esc(statFmt(a.stat, itemAffixValue(it, a)))}</b> ${perks.reforge ? `<button class="btn small ghost" data-rf="${i}" title="Reforge this affix (${reforgeCost().gold}g, 4 Dust, 1 Crystal)" aria-label="Reforge affix">⟳</button>` : ''}</span></div>`).join('')}
        ${u ? `<div class="affix" style="border-color:rgba(251,146,60,0.4)"><span class="r-legendary">★ ${u.name}</span></div><div class="tip" style="color:#fdba74">${u.desc}</div>` : ''}</div>
        <div class="col"><button class="btn ${eq ? '' : 'primary'}" id="eqBtn">${eq ? 'Unequip' : 'Equip'}</button>
        <button class="btn" id="upBtn" ${maxed ? 'disabled' : ''}>${maxed ? 'Max upgrade' : `Upgrade (+8% affixes) — ${up.gold}g` + Object.keys(upMats).map((m) => `, ${upMats[m]} ${MAT_BY_ID[m]!.name}`).join('')}</button>
        <button class="btn danger" id="salvBtn">Salvage → ${Object.keys(sv).filter((k) => sv[k]).map((k) => sv[k] + ' ' + (k === 'gold' ? 'gold' : MAT_BY_ID[k]!.name)).join(', ')}</button></div>`;
      $('eqBtn').onclick = () => { if (eq) Save.unequip(it.slot); else Save.equip(it.uid); audio.play('buy'); renderInv(); renderSlots(); renderDetail(); };
      $('upBtn').onclick = () => { const err = Save.upgradeItem(it.uid); if (err) this.toast(err); else audio.play('forge'); this.refreshCurrency(); renderInv(); renderSlots(); renderDetail(); };
      $('salvBtn').onclick = () => { if (!confirm('Salvage ' + it.name + '?')) return; Save.salvage(it.uid); this.selItem = null; audio.play('explode'); this.refreshCurrency(); renderInv(); renderSlots(); renderDetail(); };
      $$(box, 'button[data-rf]').forEach((b) => b.onclick = () => { const err = Save.reforge(it.uid, Number(b.dataset.rf)); if (err) this.toast(err); else audio.play('forge'); this.refreshCurrency(); renderDetail(); });
    };
    renderSlots(); renderInv(); renderDetail();
  }
  forge_transmute(): void {
    const perks = forgeLevelPerks(Save.data.forge.level), body = $('forgeBody');
    if (!perks.transmute) { body.innerHTML = '<div class="panel" style="padding:20px" class="muted">Transmutation unlocks at Forge level 2. Spend gold in the Forge to level it.</div>'; return; }
    const fmtCost = (c: Reward): string => (Object.keys(c) as (keyof Reward)[]).map((k) => c[k] + ' ' + (k === 'gold' ? 'gold' : MAT_BY_ID[k]!.name)).join(', ');
    body.innerHTML = TRANSMUTE.map((r) => `<div class="recipe"><div class="grow"><b>${r.name}</b><div class="tip">${fmtCost(r.from)} → <span class="good">${fmtCost(r.to)}</span></div></div><button class="btn small" data-id="${r.id}" data-n="1">×1</button><button class="btn small" data-id="${r.id}" data-n="10">×10</button></div>`).join('');
    $$(body, 'button').forEach((b) => b.onclick = () => { const r = TRANSMUTE.find((x) => x.id === b.dataset.id)!; const err = Save.transmute(r, Number(b.dataset.n)); if (err) this.toast(err); else audio.play('forge'); this.refreshCurrency(); });
  }
  forge_sigils(): void {
    const d = Save.data, body = $('forgeBody');
    body.innerHTML = `<div class="tip" style="margin-bottom:10px">Sigils are permanent run modifiers bought with <b style="color:#ff8a3c">Soul Embers</b> (dropped by bosses and elites).</div><div class="sigil-grid">${SIGILS.map((s) => { const own = !!d.sigils[s.id]; return `<div class="sigil ${own ? 'owned' : ''}">${ic(s.icon)}<div class="grow"><b>${s.name}</b><div class="tip">${s.desc}</div></div><button class="btn small ${own ? '' : 'primary'}" data-id="${s.id}" ${own || d.embers < s.cost ? 'disabled' : ''}>${own ? 'OWNED' : s.cost + ' ✦'}</button></div>`; }).join('')}</div>`;
    $$(body, 'button[data-id]').forEach((b) => b.onclick = () => { const err = Save.buySigil(SIGIL_BY_ID[b.dataset.id!]!); if (err) this.toast(err); else audio.play('buy'); this.refreshCurrency(); this.forge_sigils(); });
  }

  /* ============ CODEX ============ */
  showCodex(tab?: CodexTab): void {
    if (tab) this.codexTab = tab;
    const tabs: [CodexTab, string][] = [['story', 'The Long Night'], ['chronicles', 'Champions'], ['bestiary', 'Bestiary'], ['armory', 'Armory'], ['relics', 'Relics'], ['lexicon', 'Lexicon'], ['milestones', 'Milestones']];
    this.screen('codex', this.head('Codex') + `<div class="screen-body"><div class="tabs">${tabs.map(([id, n]) => `<button class="${this.codexTab === id ? 'on' : ''}" data-t="${id}">${n}</button>`).join('')}</div><div id="codexBody"></div></div>`);
    this.bindBack(() => this.showTitle());
    $$(document, '.tabs button').forEach((b) => b.onclick = () => { audio.play('ui'); this.showCodex(b.dataset.t as CodexTab); });
    switch (this.codexTab) {
      case 'story': this.codex_story(); break;
      case 'lexicon': this.codex_lexicon(); break;
      case 'chronicles': this.codex_chronicles(); break;
      case 'bestiary': this.codex_bestiary(); break;
      case 'armory': this.codex_armory(); break;
      case 'relics': this.codex_relics(); break;
      case 'milestones': this.codex_milestones(); break;
    }
  }
  claimBtn(key: string, reward: Reward, ok: boolean, label = 'Claim'): string {
    const claimed = Save.data.codex.claimed[key];
    const rw = (Object.keys(reward) as (keyof Reward)[]).map((k) => reward[k] + ' ' + matName(k)).join(', ');
    return claimed ? `<span class="tag" style="background:#1f3a2a;color:#4ade80">Claimed</span>` : `<button class="btn small primary" data-claim="${key}" ${ok ? '' : 'disabled'}>${label}: ${rw}</button>`;
  }
  bindClaims(refresh: () => void): void { $$($('codexBody'), 'button[data-claim]').forEach((b) => b.onclick = () => { const [key, reward] = this.claims[b.dataset.claim!]!; if (Save.claim(key, reward)) { audio.play('buy'); this.refreshCurrency(); refresh(); } }); }
  /** The main story: chapters unlock with world progress; unread ones are marked. */
  codex_story(): void {
    const d = Save.data, body = $('codexBody');
    const open = CHRONICLE.filter((c) => Save.chronicleUnlocked(c)).length;
    body.innerHTML = `<p class="tip">The Keeper's account of the Long Night — ${open} of ${CHRONICLE.length} chapters revealed. Chapters unlock as you push deeper into the dark.</p>
      <div class="chronicle">${CHRONICLE.map((c, i) => { const un = Save.chronicleUnlocked(c), fresh = un && !d.story.read[c.id]; return `<details class="lore-ch ${un ? '' : 'locked'}" data-id="${c.id}" ${un ? '' : 'inert'}><summary><span class="num">${i + 1}</span><b>${un ? esc(c.title) : '???'}</b>${fresh ? '<span class="tag new">New</span>' : ''}<span class="tip grow" style="text-align:right">${un ? '' : esc(c.hint)}</span></summary>${un ? c.text.map((t) => `<p>${esc(t)}</p>`).join('') : ''}</details>`; }).join('')}</div>`;
    $$(body, 'details.lore-ch').forEach((el) => el.addEventListener('toggle', () => { const id = el.dataset.id!; if ((el as HTMLDetailsElement).open && !d.story.read[id]) { d.story.read[id] = true; Save.save(); el.querySelector('.tag.new')?.remove(); } }));
  }
  /** Reference for the run systems: reactions, resonance, boons, elite affixes, shrines. */
  codex_lexicon(): void {
    const d = Save.data;
    const reactions = Object.values(REACTION_DEFS).map((r) => `<div class="entry ${d.codex.reactions[r.id] ? '' : 'locked'}"><h4 style="color:${r.color}">${r.name}</h4><div class="tip">${r.recipe}</div><div class="lore">${r.desc}</div></div>`).join('');
    const reso = RESONANCES.map((r) => `<div class="entry"><div class="row">${ic(r.icon, 'sm')}<h4 style="color:${r.color};margin:0">${r.name} <span class="muted" style="font-size:12px">· ${r.tag} weapons</span></h4></div>${r.tiers.map((t) => `<div class="tip"><b>${t.n}:</b> ${t.desc}</div>`).join('')}</div>`).join('');
    const boons = BOONS.map((b) => { const seen = d.codex.boons[b.id]; return `<div class="entry ${seen ? '' : 'locked'}"><div class="row">${ic(b.icon, 'sm')}<h4 style="margin:0">${seen ? b.name : '???'}</h4></div><div class="lore">${seen ? b.desc : 'Offered when a Herald falls.'}</div></div>`; }).join('');
    const affixes = ELITE_AFFIXES.map((a) => `<div class="entry"><h4 style="color:${a.color}">${a.name}</h4><div class="lore">${a.desc}</div><div class="tip">From ${a.minute}:00</div></div>`).join('');
    const shrines = Object.values(SHRINE_DEFS).map((s) => `<div class="entry"><div class="row">${ic(s.icon, 'sm')}<h4 style="color:${s.color};margin:0">${s.name}</h4></div><div class="lore">${s.desc}</div></div>`).join('');
    $('codexBody').innerHTML = `<h3 class="gold">Elemental reactions</h3><p class="tip">Two elements on one enemy react. Lightning weapons Shock, ice Chills, fire Burns.</p><div class="codex-grid">${reactions}</div>
      <h3 class="gold">Resonance</h3><p class="tip">Carry weapons that share a tag to awaken resonance bonuses.</p><div class="codex-grid">${reso}</div>
      <h3 class="gold">Boons</h3><p class="tip">Each fallen Herald offers a choice of three run-long boons.</p><div class="codex-grid">${boons}</div>
      <h3 class="gold">Shrines</h3><p class="tip">Stand inside a shrine to channel it.</p><div class="codex-grid">${shrines}</div>
      <h3 class="gold">Elite affixes</h3><div class="codex-grid">${affixes}</div>`;
  }
  codex_chronicles(): void {
    this.claims = {};
    const c = CHAR_BY_ID[this.selChar]!, cd = Save.charData(c.id);
    const reqText = (r: Chapter['req']): string => r.type === 'runs' ? `Complete ${r.v} run` : r.type === 'time' ? `Survive ${U.fmtTime(r.v)}` : r.type === 'kills' ? `Kill ${U.fmt(r.v)} enemies` : `Defeat ${r.v} bosses`;
    const prog = (r: Chapter['req']): number => r.type === 'runs' ? cd.runs : r.type === 'time' ? cd.bestTime : r.type === 'kills' ? cd.kills : cd.bosses;
    const body = $('codexBody');
    body.innerHTML = `<div class="talent-layout"><div class="char-list panel" style="padding:8px">${CHARACTERS.map((x) => `<div class="ci ${x.id === this.selChar ? 'sel' : ''}" data-id="${x.id}" ${BTN}><img src="${S.portraitURL(x, 48)}" alt=""><div><b>${x.name}</b><div class="tip">${Object.keys(Save.charData(x.id).chapters).length}/5 chapters</div></div></div>`).join('')}</div>
      <div><h3 class="gold" style="margin:0 0 4px">${c.name}, ${c.title}</h3><p class="tip" style="margin:0 0 12px">Chapters unlock as you play this character. Each chapter grants a permanent reward — awakenings expand the character's kit.</p>
      ${c.codex.map((ch, i) => { const done = !!cd.chapters[i], met = Save.chapterMet(c.id, i); const rw = ch.reward, stats = rw.stats; const rwText = [rw.desc ? `<span style="color:#e9d5ff">${rw.desc}</span>` : '', stats ? Object.keys(stats).map((k) => statName(k) + ' ' + statFmt(k, stats[k]!)).join(', ') : ''].filter(Boolean).join(' · '); return `<div class="chapter ${done ? 'done' : met ? '' : 'locked'}"><div class="num">${['I', 'II', 'III', 'IV', 'V'][i]}</div><div class="grow"><b>${ch.title}</b><div class="lore" style="font-style:italic;color:#b9b5c8;font-size:13px">${done || met ? ch.lore : '???'}</div><div class="tip">Requirement: ${reqText(ch.req)} (${ch.req.type === 'time' ? U.fmtTime(prog(ch.req)) : U.fmt(prog(ch.req))})</div><div style="font-size:14px;margin-top:4px">Reward: ${rwText}</div></div><div>${done ? '<span class="tag" style="background:#1f3a2a;color:#4ade80">Unlocked</span>' : `<button class="btn small primary" data-ch="${i}" ${met ? '' : 'disabled'}>Unlock</button>`}</div></div>`; }).join('')}</div></div>`;
    $$(body, '.ci').forEach((el) => el.onclick = () => { this.selChar = el.dataset.id!; audio.play('ui'); this.codex_chronicles(); });
    $$(body, 'button[data-ch]').forEach((b) => b.onclick = () => { const i = Number(b.dataset.ch); if (Save.claimChapter(c.id, i)) { audio.play('evolve'); this.notice('Chapter unlocked: ' + c.codex[i]!.title, '#e9d5ff', 3); this.codex_chronicles(); } });
  }
  codex_bestiary(): void {
    const d = Save.data; this.claims = {};
    const ent = (id: string, def: EnemyDef, kills: number, tiers: number[], rewards: Reward[], statText: string, isBoss: boolean): string => { const seen = kills > 0 || d.codex[isBoss ? 'bosses' : 'enemies'][id] != null; return `<div class="entry ${seen ? '' : 'locked'}"><div class="row"><img src="${S.enemy(id, 18, def.col, 0).toDataURL()}" alt="" style="width:56px;height:56px;border-radius:8px;background:#0006"><div><h4>${seen ? def.name : '???'}</h4><div class="tip">${U.fmt(kills)} kills</div></div></div><div class="lore">${seen ? def.lore : 'Not yet encountered.'}</div><div class="tip">${statText} per tier</div><div class="col" style="gap:4px;margin-top:6px">${tiers.map((t, i) => { const key = (isBoss ? 'boss_' : 'be_') + id + '_' + i; this.claims[key] = [key, rewards[i]!]; return `<div class="row" style="font-size:13px"><span class="grow">Tier ${i + 1}: ${U.fmt(t)} kills</span>${this.claimBtn(key, rewards[i]!, kills >= t)}</div>`; }).join('')}</div></div>`; };
    $('codexBody').innerHTML = `<p class="tip">Every bestiary tier grants a permanent global bonus. Bosses grant max health.</p><div class="codex-grid">${Object.keys(ENEMIES).filter((k) => !ENEMIES[k]!.noSpawn).map((id) => ent(id, ENEMIES[id]!, d.codex.enemies[id] || 0, BESTIARY_TIERS, BESTIARY_REWARD, '+1% Might', false)).join('')}</div><h3 class="gold">Bosses</h3><div class="codex-grid">${BOSS_ORDER.map((id) => ent(id, BOSSES[id]!, d.codex.bosses[id] || 0, BOSS_TIERS, BOSS_REWARD, '+2% Max Health', true)).join('')}</div>`;
    this.bindClaims(() => this.codex_bestiary());
  }
  codex_armory(): void {
    const d = Save.data; this.claims = {};
    const ws = Object.values(WEAPONS);
    $('codexBody').innerHTML = `<p class="tip">Discover, master (max level) and evolve each weapon. Mastered weapons deal +5% damage, evolved +10% more — permanently.</p><div class="codex-grid">${ws.map((w) => { const e = d.codex.weapons[w.id] || {}; const seen = !!e.found; return `<div class="entry ${seen ? '' : 'locked'}"><div class="row">${ic(w.icon)}<div><h4>${seen ? w.name : '???'}</h4><div class="tip">${w.char ? 'Signature: ' + CHAR_BY_ID[w.char]!.name : 'General weapon'}${e.dmg ? ' · best ' + U.fmt(e.dmg) + ' dmg' : ''}</div></div></div><div class="lore">${seen ? w.desc : 'Undiscovered.'}</div>${seen && w.evo ? `<div class="tip">Evolves with ${PASSIVE_BY_ID[w.evo.with]!.name} → <b>${w.evo.name}</b>: ${w.evo.desc}</div>` : ''}<div class="col" style="gap:4px;margin-top:6px">${ARMORY_STAGES.map((st) => { const key = 'ar_' + w.id + '_' + st.id; this.claims[key] = [key, st.reward]; return `<div class="row" style="font-size:13px"><span class="grow">${st.name}</span>${this.claimBtn(key, st.reward, !!e[st.id])}</div>`; }).join('')}</div></div>`; }).join('')}</div>`;
    this.bindClaims(() => this.codex_armory());
  }
  codex_relics(): void {
    const d = Save.data;
    $('codexBody').innerHTML = `<p class="tip">Unique powers found on Legendary and Mythic gear crafted at the Forge.</p><div class="codex-grid">${UNIQUES.map((u) => { const seen = !!d.codex.uniques[u.id]; return `<div class="entry ${seen ? '' : 'locked'}"><h4>${seen ? u.name : '???'}</h4><div class="lore">${seen ? u.desc : 'Not yet forged.'}</div></div>`; }).join('')}</div>`;
  }
  codex_milestones(): void {
    const d = Save.data; this.claims = {};
    $('codexBody').innerHTML = `<div class="codex-grid">${MILESTONES.map((m) => { let ok = false; try { ok = m.check(d); } catch { /* malformed save */ } const key = 'ms_' + m.id; this.claims[key] = [key, m.reward]; return `<div class="entry ${ok || d.codex.claimed[key] ? '' : 'locked'}"><h4>${m.name}</h4><div class="lore">${m.desc}</div>${this.claimBtn(key, m.reward, ok)}</div>`; }).join('')}</div>`;
    this.bindClaims(() => this.codex_milestones());
  }

  /* ============ SETTINGS ============ */
  showSettings(): void {
    const s = Save.data.settings;
    this.screen('settings', this.head('Settings') + `<div class="screen-body" style="max-width:700px"><div class="panel" style="padding:10px 16px">
      <label class="setting"><span>Sound effects</span><input type="range" min="0" max="1" step="0.05" value="${s.sfx}" id="sfxR"></label>
      <label class="setting"><span>Music</span><input type="range" min="0" max="1" step="0.05" value="${s.music}" id="musR"></label>
      <label class="setting"><span>Screen shake</span><input type="checkbox" ${s.shake ? 'checked' : ''} id="shakeC"></label>
      <label class="setting"><span>Reduced motion</span><input type="checkbox" ${s.reducedMotion ? 'checked' : ''} id="motionC"></label>
      <label class="setting"><span>Damage numbers</span><input type="checkbox" ${s.dmgNumbers ? 'checked' : ''} id="dmgC"></label>
      <label class="setting"><span>Bloom &amp; colour grading</span><input type="checkbox" ${s.postfx ? 'checked' : ''} id="postC"></label>
      <label class="setting"><span>Damage meter (T)</span><input type="checkbox" ${s.dmgMeter ? 'checked' : ''} id="meterC"></label>
      <label class="setting"><span>Show FPS</span><input type="checkbox" ${s.fps ? 'checked' : ''} id="fpsC"></label>
      <label class="setting"><span>Render quality</span><select id="qualS"><option value="0.6" ${s.quality === 0.6 ? 'selected' : ''}>Low</option><option value="0.8" ${s.quality === 0.8 ? 'selected' : ''}>Medium</option><option value="1" ${s.quality === 1 ? 'selected' : ''}>High</option></select></label>
      <div class="setting"><span>Save data</span><div class="row"><button class="btn small" id="expBtn">Export</button><button class="btn small" id="impBtn">Import</button><button class="btn small danger" id="resetBtn">Reset</button></div></div>
      <textarea id="saveTxt" aria-label="Save code" placeholder="Export writes your save code here. Paste a code and press Import to restore."></textarea></div></div>`);
    this.bindBack(() => this.showTitle());
    const val = (e: Event): HTMLInputElement => e.target as HTMLInputElement;
    $('sfxR').oninput = (e) => { s.sfx = Number(val(e).value); audio.setSfx(s.sfx); Save.save(); };
    $('sfxR').onchange = () => audio.play('ui');
    $('musR').oninput = (e) => { s.music = Number(val(e).value); audio.setMusic(s.music); Save.save(); };
    $('shakeC').onchange = (e) => { s.shake = val(e).checked ? 1 : 0; this.applyDisplaySettings(); Save.save(); };
    $('motionC').onchange = (e) => { s.reducedMotion = val(e).checked; this.applyDisplaySettings(); Save.save(); };
    $('dmgC').onchange = (e) => { s.dmgNumbers = val(e).checked; this.applyDisplaySettings(); Save.save(); };
    $('postC').onchange = (e) => { s.postfx = val(e).checked; this.applyDisplaySettings(); Save.save(); };
    $('fpsC').onchange = (e) => { s.fps = val(e).checked; this.applyDisplaySettings(); Save.save(); };
    $('meterC').onchange = (e) => { s.dmgMeter = val(e).checked; this.meter?.setOpen(s.dmgMeter); Save.save(); };
    $('qualS').onchange = (e) => { s.quality = Number((e.target as HTMLSelectElement).value); this.R.quality = s.quality; this.R.resize(); Save.save(); };
    const txt = $<HTMLTextAreaElement>('saveTxt');
    $('expBtn').onclick = () => { txt.value = Save.export(); this.toast('Save code exported. Copy it somewhere safe.'); };
    $('impBtn').onclick = () => { if (Save.import(txt.value.trim())) { this.applyDisplaySettings(); this.toast('Save imported.'); this.showTitle(); } else this.toast('Invalid save code.'); };
    $('resetBtn').onclick = () => { if (confirm('Erase ALL progress? This cannot be undone.')) { Save.reset(); this.applyDisplaySettings(); this.showTitle(); } };
  }

  /* ============ HUD ============ */
  buildHud(): void {
    $('hud').innerHTML = `<div class="top"><div id="xpbar"><i></i><span id="xpTxt"></span></div><div class="toprow"><div class="col" style="gap:2px"><div class="hud-stat">${ic({ g: 'skull', c: '#f87171' }, 'sm')}<span id="killsTxt">0</span></div><div class="hud-stat">${ic({ g: 'coin', c: '#f5c542' }, 'sm')}<span id="goldTxt">0</span></div></div><div id="timer">00:00</div><div class="col" style="gap:2px;align-items:flex-end"><button type="button" class="hud-pause" id="pauseBtn" aria-label="Pause">❚❚</button><div class="hud-stat" id="heatTxt"></div><div class="hud-stat" id="stageTxt"></div></div></div></div>
      <div id="bossbar" class="hidden"><div class="nm" id="bossNm"></div><div class="bar"><i id="bossHp"></i><u></u></div><div class="ep" id="bossEp"></div></div>
      <div id="combo" class="hidden"><b id="comboN">0</b><span id="comboName"></span><div class="cbar"><i id="comboBar"></i></div></div>
      <div id="boons"></div>
      <div class="bottom-left"><div id="buff" class="hidden"></div><div id="reso"></div><div id="hpbar"><i></i><s></s><b id="hpTxt"></b></div><div id="resbar" class="hidden"><i></i></div><div id="reslabel"></div><div id="slots"></div></div>
      <div id="mapslot"></div>
      <div id="active"><div class="abw"><button type="button" class="ab dash" id="dashBtn" aria-label="Dash"><img id="dashImg" alt=""><span class="cd" id="dashCd"></span></button><div class="lbl">Dash</div></div><div class="abw"><button type="button" class="ab" id="abBtn" aria-label="Use ability"><img id="abImg" alt=""><span class="cd" id="abCd"></span><span class="charges hidden" id="abCh"></span></button><div class="lbl" id="abLbl"></div></div></div>
      <div class="bottom-right" id="hudHint"><span class="kbd">SPACE</span> dash · <span class="kbd">E</span> ability · <span class="kbd">M</span> map · <span class="kbd">T</span> damage · <span class="kbd">ESC</span> pause</div>`;
    const slot = (el: Element | null): HudSlot => new HudSlot(el as HTMLElement);
    this.hudEls = { xp: slot($('xpbar').firstElementChild), xpTxt: slot($('xpTxt')), kills: slot($('killsTxt')), gold: slot($('goldTxt')), timer: slot($('timer')), heat: $('heatTxt'), stage: $('stageTxt'), bossbar: slot($('bossbar')), bossNm: slot($('bossNm')), bossHp: slot($('bossHp')), hp: slot($('hpbar').firstElementChild), hpS: slot($('hpbar').querySelector('s')), hpTxt: slot($('hpTxt')), resbar: slot($('resbar')), res: slot($('resbar').firstElementChild), reslabel: slot($('reslabel')), slots: $('slots'), abImg: $<HTMLImageElement>('abImg'), abCd: slot($('abCd')), abBtn: slot($('abBtn')), abCh: slot($('abCh')), abLbl: $('abLbl'), dashBtn: slot($('dashBtn')), dashCd: slot($('dashCd')), dashImg: $<HTMLImageElement>('dashImg'), combo: slot($('combo')), comboN: slot($('comboN')), comboName: slot($('comboName')), comboBar: slot($('comboBar')), boons: $('boons'), reso: $('reso'), buff: slot($('buff')), bossEp: slot($('bossEp')) };
    // the HUD markup starts with these states
    this.hudEls.bossbar.toggle('hidden', true); this.hudEls.resbar.toggle('hidden', true); this.hudEls.abCh.toggle('hidden', true); this.hudEls.combo.toggle('hidden', true); this.hudEls.buff.toggle('hidden', true);
    const ab = $('abBtn');
    // blur so a later SPACE keyup can't "click" the focused button and fire the ability twice
    ab.onclick = () => { this.input.pressActive(); ab.blur(); };
    const db = $('dashBtn');
    db.onclick = () => { this.input.pressDash(); db.blur(); };
    this.map = new MapView($('mapslot'), document.body);
    this.meter = new DamageMeter($('hud').querySelector<HTMLElement>('.bottom-left')!, Save.data.settings.dmgMeter, (open) => { Save.data.settings.dmgMeter = open; Save.save(); });
    // touch players have no Esc/P key
    const pb = $('pauseBtn');
    pb.onclick = () => { pb.blur(); this.showPause(); };
  }
  buildSlots(): void {
    const g = this.game, p = g.player, E = this.hudEls!;
    E.abImg.src = S.iconURL(p.char.active.icon); E.abLbl.textContent = p.char.active.name; E.abBtn.el.setAttribute('aria-label', 'Use ability: ' + p.char.active.name);
    E.dashImg.src = S.iconURL({ g: 'boot', c: p.char.colors.accent });
    E.heat.innerHTML = g.heat ? `<span style="color:#fb923c">HEAT ${g.heat}</span>` : ''; E.stage.innerHTML = `<span class="muted" style="font-size:14px">${g.stage.name}</span>`;
    const res = p.char.resource;
    if (res) { E.resbar.toggle('hidden', false); E.res.el.style.background = res.color; E.res.el.style.boxShadow = '0 0 8px ' + res.color; this.resName = res.name; }
    else { E.resbar.toggle('hidden', true); this.resName = ''; }
    E.reslabel.setText(''); // also drops the cached value so a new run's label is always written
    this.hudBoss = null; this.hudBossTier = -1; this.hudBoons = -1; this.hudBuff = '';
    this.slotState.length = 0; this.slotDirty = true;
  }
  private fmtRes = (v: number, max: number): string => this.resName + (max > 1 ? ' ' + v + '/' + max : ' ' + v + '%');
  /** Record one value of the slot-bar state; marks the bar dirty when it differs from last frame. */
  private slotPut(i: number, v: string | number | boolean): number {
    if (this.slotState[i] !== v) { this.slotState[i] = v; this.slotDirty = true; }
    return i + 1;
  }
  /** Refresh the HUD from the sim. Called once per rendered frame; only touches the DOM on change. */
  updateHud(g: Game): void {
    const p = g.player, E = this.hudEls; if (!p || !E) return;
    E.xp.setWidth(p.xp / p.xpNext); E.xpTxt.setNum(p.level, fmtLevel);
    E.kills.setNum(g.kills, U.fmt); E.gold.setNum(Math.round(g.gold), U.fmt);
    E.timer.setNum(Math.floor(g.time), U.fmtTime); E.timer.toggle('eclipse', g.eclipse);
    const maxHp = p.stats.maxHp, hpk = Math.max(0, p.hp / maxHp);
    E.hp.setWidth(hpk); E.hp.toggle('low', hpk < 0.3); E.hpTxt.setPair(Math.ceil(p.hp), maxHp, fmtHp);
    E.hpS.setWidth(p.shield / maxHp);
    if (p.char.resource) { E.res.setWidth(p.res / (p.resMax || 1)); E.reslabel.setPair(p.resMax > 1 ? Math.floor(p.res) : Math.round(p.res * 100), p.resMax, this.fmtRes); }
    // boss
    const b = g.boss;
    if (b && !b.dead) {
      E.bossbar.toggle('hidden', false);
      if (b !== this.hudBoss || b.bossTier !== this.hudBossTier) { this.hudBoss = b; this.hudBossTier = b.bossTier; E.bossNm.setText(b.def.name + (b.bossTier ? ' · Tier ' + (b.bossTier + 1) : '')); E.bossEp.setText(BOSS_LINES[b.bossId ?? b.type]?.epithet ?? ''); }
      E.bossHp.setWidth(b.hp / b.maxHp);
      E.bossbar.toggle('enraged', b.phase === 2);
    } else E.bossbar.toggle('hidden', true);
    // active
    E.abBtn.toggle('ready', p.activeCharges > 0);
    const cd = p.char.active.cd * p.stats.activeCd;
    E.abCd.setScaleY(p.activeCharges >= p.activeMax ? 0 : Math.max(0, p.activeCdT / cd));
    if (p.activeMax > 1) { E.abCh.toggle('hidden', false); E.abCh.setNum(p.activeCharges, String); } else E.abCh.toggle('hidden', true);
    E.dashBtn.toggle('ready', p.dashCdT <= 0);
    E.dashCd.setScaleY(Math.max(0, p.dashCdT / DASH.cd));
    this.map?.update(g);
    this.meter?.update(g);
    // kill streak
    if (g.comboTier > 0) {
      const ct = COMBO_TIERS[g.comboTier - 1]!;
      E.combo.toggle('hidden', false); E.comboN.setNum(g.combo, String); E.comboName.setText(ct.name);
      E.combo.el.style.color = ct.color; E.combo.toggle('t' + g.comboTier, true);
      for (let t = 1; t <= COMBO_TIERS.length; t++) if (t !== g.comboTier) E.combo.toggle('t' + t, false);
      E.comboBar.setWidth(g.comboT / (COMBO_WINDOW + (p.f.b_frenzy ? 1.5 : 0)));
    } else E.combo.toggle('hidden', true);
    // boons
    const nb = (p.boons as string[]).length * 2 + (g.phoenixUsed ? 1 : 0); // a spent Phoenix Feather greys out
    if (nb !== this.hudBoons) { this.hudBoons = nb; E.boons.innerHTML = (p.boons as string[]).map((id) => { const b = BOON_BY_ID[id]!, spent = id === 'b_phoenix' && g.phoenixUsed; return `<div class="boon${spent ? ' spent' : ''}" title="${b.name}${spent ? ' (spent)' : ''} — ${b.desc}"><img src="${S.iconURL(b.icon)}" alt="${b.name}"></div>`; }).join(''); }
    // shrine buff / soul well trial
    const buff = g.trial ? 'Soul Well · ' + Math.ceil(g.trial.t) + 's' : g.buffs.length ? 'Quickening · ' + Math.ceil(g.buffs[0]!.t) + 's' : '';
    if (buff !== this.hudBuff) { this.hudBuff = buff; E.buff.toggle('hidden', !buff); E.buff.setText(buff); E.buff.toggle('trial', !!g.trial); }
    // slots: compare the flattened build state without allocating; rebuild markup only on change
    let i = 0;
    for (const w of p.weapons) { i = this.slotPut(i, w.id); i = this.slotPut(i, w.level); i = this.slotPut(i, w.evolved); }
    i = this.slotPut(i, '|');
    for (const x of p.passives) { i = this.slotPut(i, x.id); i = this.slotPut(i, x.level); }
    if (this.slotState.length !== i) { this.slotState.length = i; this.slotDirty = true; }
    if (this.slotDirty) {
      this.slotDirty = false;
      E.reso.innerHTML = g.resonance.filter((r) => r.count >= 1).map((r) => { const next = r.def.tiers[r.tier]; return `<div class="chip ${r.tier ? 'on' : ''}" style="--c:${r.def.color}" title="${r.def.name}: ${r.def.tiers.map((t) => t.n + ' — ' + t.desc).join(' · ')}"><img src="${S.iconURL(r.def.icon)}" alt=""><b>${r.def.name}</b> ${r.count}${next ? '/' + next.n : ' ★'}</div>`; }).join('');
      E.slots.innerHTML = p.weapons.map((w) => { const evo = w.evolved ? w.def.evo : undefined; return `<div class="s ${evo ? 'evo' : w.level >= w.def.max ? 'max' : ''}" title="${evo ? evo.name : w.def.name} Lv${w.level}"><img src="${S.iconURL(evo ? evo.icon : w.def.icon)}" alt=""><b>${evo ? '★' : w.level}</b></div>`; }).join('') + '<div class="sep"></div>' + p.passives.map((x) => `<div class="s ${x.level >= x.def.max ? 'max' : ''}" title="${x.def.name} Lv${x.level}"><img src="${S.iconURL(x.def.icon)}" alt=""><b>${x.level}</b></div>`).join('');
    }
  }

  /* ============ LEVEL UP ============ */
  showLevelUp(options: LevelOption[]): void {
    const g = this.game, p = g.player;
    this.banishMode = false;
    const card = (o: LevelOption, i: number): string => {
      if (o.type === 'gold') return `<div class="card" data-i="${i}" ${BTN}><div class="head">${ic({ g: 'coin', c: '#f5c542' })}<div class="nm">Gold Pouch</div></div><div class="desc">+${o.value} gold. Everything is maxed — the Forge awaits.</div></div>`;
      if (o.type === 'heal') return `<div class="card" data-i="${i}" ${BTN}><div class="head">${ic({ g: 'heart', c: '#ff5c7a' })}<div class="nm">Second Wind</div></div><div class="desc">Heal 30% of your max health.</div></div>`;
      let kind: string, name: string, icon: IconSpec, next: string, evoHint: string, curLevel: number;
      if (o.type === 'weapon') {
        const d = o.def, cur = p.weapons.find((w) => w.id === o.id), evolved = !!(cur && cur.evolved && d.evo);
        kind = d.char ? 'Signature weapon' : 'Weapon';
        name = evolved ? d.evo!.name : d.name; icon = evolved ? d.evo!.icon : d.icon; curLevel = cur ? cur.level : 0;
        next = o.isNew ? d.desc : (o.empowered ? WH.describe(d.levels[o.level - 3] || {}) + ' & ' : '') + WH.describe(d.levels[o.level - 2] || {});
        evoHint = d.evo ? `<div class="tip">Evolves with ${PASSIVE_BY_ID[d.evo.with]!.name}${p.passives.some((x) => x.id === d.evo!.with) ? ' ✓' : ''}</div>` : '';
        if (o.isNew) evoHint += (d.tags || []).map((tag) => { const r = RESONANCE_BY_TAG[tag]; if (!r) return ''; const have = p.weapons.filter((w) => (w.def.tags || []).includes(tag)).length, t0 = resonanceTier(r, have), t1 = resonanceTier(r, have + 1); return t1 > t0 ? `<div class="reso-hint" style="--c:${r.color}">${r.name} awakens: ${r.tiers[t1 - 1]!.desc}</div>` : `<div class="tip" style="color:${r.color}">${r.name} ${have + 1}/${(r.tiers[t0] ?? r.tiers[r.tiers.length - 1]!).n}</div>`; }).join('');
      } else {
        const d = o.def, cur = p.passives.find((x) => x.id === o.id);
        kind = 'Passive'; name = d.name; icon = d.icon; curLevel = cur ? cur.level : 0; next = d.desc;
        const ws = p.weapons.filter((w) => w.def.evo && w.def.evo.with === o.id && !w.evolved);
        evoHint = ws.length ? `<div class="tip" style="color:#c084fc">Evolves ${ws.map((w) => w.def.name).join(', ')}</div>` : '';
      }
      const max = o.def.max;
      return `<div class="card deal ${o.empowered ? 'emp' : ''} ${this.banishMode ? 'banish-mode' : ''}" data-i="${i}" style="--i:${i}" ${BTN}><div class="hot">${i + 1}</div><div class="head">${ic(icon)}<div><div class="kind">${kind}</div><div class="nm">${name}</div></div></div>
          <div class="row" style="gap:6px">${o.isNew ? '<span class="tag new">New</span>' : `<div class="pips">${Array.from({ length: max }, (_, k) => `<i class="${k < curLevel ? 'on' : k < o.level ? 'next' : ''}"></i>`).join('')}</div><span class="tip">Lv ${o.level}</span>`}${o.empowered ? '<span class="tag emp">Empowered +2</span>' : ''}</div>
          <div class="desc">${o.isNew ? o.def.desc : ''}</div><div class="next">${o.isNew ? '' : '▲ ' + next}</div>${evoHint}</div>`;
    };
    const pick = (o: LevelOption): void => { this.setLvlKeys(null); this.closeModal(); g.pickOption(o); this.resumePlay(); };
    const render = (opts: LevelOption[]): void => {
      this.modal(`<h2>Level ${p.level}</h2><div class="sub">${this.banishMode ? '<span class="bad">Choose an option to BANISH for this run</span>' : 'Choose an upgrade · press 1-4'}</div><div class="cards">${opts.map(card).join('')}</div>
        <div class="lvl-actions"><button class="btn small" id="rerollBtn" ${p.rerolls > 0 ? '' : 'disabled'}>Reroll (${p.rerolls})</button><button class="btn small" id="skipBtn" ${p.skips > 0 ? '' : 'disabled'}>Skip (${p.skips})</button><button class="btn small ${this.banishMode ? 'danger' : ''}" id="banishBtn" ${p.banishes > 0 ? '' : 'disabled'}>Banish (${p.banishes})</button></div>`);
      $$($('modal'), '.card').forEach((el) => el.onclick = () => {
        const o = opts[Number(el.dataset.i)]!;
        if (this.banishMode) { const n = g.banish(o); this.banishMode = false; if (n) render(n); return; }
        pick(o);
      });
      $('rerollBtn').onclick = () => { const n = g.reroll(); if (n) { audio.play('ui'); render(n); } };
      $('skipBtn').onclick = () => { if (p.skips > 0) { audio.play('ui'); this.setLvlKeys(null); this.closeModal(); g.skip(); this.resumePlay(); } };
      $('banishBtn').onclick = () => { this.banishMode = !this.banishMode; render(opts); };
      this.setLvlKeys((e) => { const i = parseInt(e.key) - 1; if (i >= 0 && i < opts.length) { const c = document.querySelector<HTMLElement>(`#modal .card[data-i="${i}"]`); if (c) c.click(); } });
    };
    render(options);
  }

  /* ============ CHEST ============ */
  showChest(rewards: ChestReward[], boss: boolean): void {
    const g = this.game;
    const html = rewards.map((r, i) => {
      const st = `style="--i:${i}"`;
      if (r.type === 'evolve') return `<div class="reward evo reveal" ${st}>${ic(r.icon, 'lg')}<div><span class="tag evo">Evolution</span><div class="cinzel" style="font-size:20px;color:#e9d5ff;margin:4px 0">${r.name}</div><div class="tip" style="color:#d8d0e8">${r.desc}</div></div></div>`;
      if (r.type === 'gold') return `<div class="reward reveal" ${st}>${ic({ g: 'coin', c: '#f5c542' })}<div><b class="gold">+${r.value} gold</b></div></div>`;
      if (r.type === 'mat') { const m = MAT_BY_ID[r.mat]!; return `<div class="reward reveal" ${st}>${ic(m.icon)}<div><b style="color:${m.color}">+1 ${m.name}</b></div></div>`; }
      return `<div class="reward reveal" ${st}>${ic(r.def.icon)}<div><b>${r.def.name}</b><div class="tip">Level ${r.level}${r.level >= r.def.max ? ' · MAX' : ''}</div></div></div>`;
    }).join('');
    this.modal(`<div class="chest-art ${boss ? 'boss' : ''}">${ic({ g: 'chest', c: boss ? '#ff44aa' : '#ffd700' }, 'lg')}</div><h2>${boss ? 'Boss Trove' : 'Treasure Chest'}</h2><div class="sub">${rewards.some((r) => r.type === 'evolve') ? 'A weapon has transcended its form.' : boss ? 'Five treasures.' : 'The night rewards the brave.'}</div><div class="rewards">${html}</div><div class="lvl-actions"><button class="btn primary" id="chestOk">Continue</button></div>`);
    let done = false;
    // on `window` (registered after InputManager) so the flush in resumePlay() runs after it queued SPACE
    const kh = (e: KeyboardEvent): void => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); ok(); } };
    const ok = (): void => { if (done) return; done = true; window.removeEventListener('keydown', kh); this.closeModal(); g.closeChest(); this.resumePlay(); };
    $('chestOk').onclick = ok;
    window.addEventListener('keydown', kh);
  }

  /* ============ BOONS ============ */
  showBoon(options: BoonDef[]): void {
    const g = this.game;
    const card = (b: BoonDef, i: number): string => `<div class="card boon-card deal" data-i="${i}" style="--i:${i}" ${BTN}><div class="hot">${i + 1}</div><div class="boon-icon">${ic(b.icon, 'lg')}</div><div class="nm">${b.name}</div><div class="desc">${b.desc}</div></div>`;
    this.modal(`<h2 class="boon-title">A Herald's Gift</h2><div class="sub">The fallen Herald's power is yours to bind. Choose one boon for the rest of this night · press 1-3</div><div class="cards">${options.map(card).join('')}</div>`, 'boon-modal');
    let done = false;
    const pick = (b: BoonDef): void => { if (done) return; done = true; this.setLvlKeys(null); this.closeModal(); g.pickBoon(b); this.notice('Boon: ' + b.name, '#e9d5ff', 2.5); this.resumePlay(); };
    $$($('modal'), '.card').forEach((el) => el.onclick = () => pick(options[Number(el.dataset.i)]!));
    this.setLvlKeys((e) => { const i = parseInt(e.key) - 1; if (i >= 0 && i < options.length) pick(options[i]!); });
  }

  /* ============ PAUSE ============ */
  showPause(): void {
    const g = this.game, p = g.player; if (g.state !== 'play') return;
    g.state = 'paused';
    const st = p.stats;
    const rows: [string, string | number][] = [['maxHp', st.maxHp], ['regen', st.regen.toFixed(2) + '/s'], ['armor', st.armor.toFixed(1)], ['speed', Math.round(st.speed)], ['might', U.pct(st.might)], ['area', U.pct(st.area)], ['projSpeed', U.pct(st.projSpeed)], ['duration', U.pct(st.duration)], ['amount', '+' + st.amount], ['cooldown', U.pct(st.cooldown)], ['crit', U.pct(st.crit)], ['critDmg', U.pct(st.critDmg)], ['dodge', U.pct(st.dodge)], ['lifesteal', U.pct(st.lifesteal, 1)], ['luck', U.pct(st.luck)], ['growth', U.pct(st.growth)], ['greed', U.pct(st.greed)], ['magnet', Math.round(st.magnet)], ['curse', U.pct(st.curse)], ['revival', p.revivals]];
    this.modal(`<h2>Paused</h2><div class="sub">${p.char.name} · ${g.stage.name} · ${U.fmtTime(g.time)} · Heat ${g.heat}</div><div class="pause-grid"><div><h3 class="gold" style="margin:0 0 6px">Stats</h3><div class="stat-grid">${rows.map(([k, v]) => `<div><span class="muted">${statName(k)}</span><b>${v}</b></div>`).join('')}</div></div>
      <div><h3 class="gold" style="margin:0 0 6px">Arsenal</h3><div class="pause-items">${p.weapons.map((w) => { const evo = w.evolved ? w.def.evo : undefined; return `<div class="it"><img src="${S.iconURL(evo ? evo.icon : w.def.icon)}" alt=""><span>${evo ? evo.name : w.def.name} <b>Lv${w.level}</b><br><span class="tip">${U.fmt(w.dmgDealt)} dmg</span></span></div>`; }).join('')}</div><h3 class="gold" style="margin:10px 0 6px">Passives</h3><div class="pause-items">${p.passives.map((x) => `<div class="it"><img src="${S.iconURL(x.def.icon)}" alt=""><span>${x.def.name} <b>Lv${x.level}</b></span></div>`).join('') || '<span class="muted">None yet</span>'}</div>
      ${(p.boons as string[]).length ? `<h3 class="gold" style="margin:10px 0 6px">Boons</h3><div class="pause-items">${(p.boons as string[]).map((id) => { const b = BOON_BY_ID[id]!; return `<div class="it" title="${b.desc}"><img src="${S.iconURL(b.icon)}" alt=""><span>${b.name}</span></div>`; }).join('')}</div>` : ''}
      ${g.resonance.some((r) => r.tier) ? `<h3 class="gold" style="margin:10px 0 6px">Resonance</h3>${g.resonance.filter((r) => r.tier).map((r) => `<div class="tip"><b style="color:${r.def.color}">${r.def.name} ${r.count}</b> — ${r.def.tiers.slice(0, r.tier).map((t) => t.desc).join(' ')}</div>`).join('')}` : ''}
      <h3 class="gold" style="margin:10px 0 6px">${p.char.trait.name}</h3><div class="tip">${p.char.trait.desc}</div></div></div>
      <div class="lvl-actions"><button class="btn primary" id="resumeBtn">Resume</button><button class="btn danger" id="quitBtn">Abandon Run</button></div>`);
    $('resumeBtn').onclick = () => this.closePause();
    $('quitBtn').onclick = () => { if (confirm('Abandon this run? Rewards are still collected.')) { this.closeModal(); g.quit(); this.narrator.clear(); this.narrator.epitaph = ''; this.showGameOver(g.summary(), true); } };
  }
  closePause(): void { this.closeModal(); if (this.game.state === 'paused') { this.game.state = 'play'; this.input.flush(); } }

  /* ============ GAME OVER ============ */
  showGameOver(sum: RunSummary, abandoned = false): void {
    audio.stopMusic(); this.setLvlKeys(null);
    const prevBest = Save.data.stats.bestTime, prevStage = Save.data.stages.best[sum.stageId] || 0, prevCombo = Save.data.stats.bestCombo;
    const res = Save.recordRun(sum);
    const rec = (on: boolean): string => (on ? '<i class="rec">NEW RECORD</i>' : '');
    const epitaph = abandoned ? '' : this.narrator.epitaph;
    const cd = Save.charData(sum.charId), c = CHAR_BY_ID[sum.charId]!;
    const mats = (Object.keys(sum.mats) as (keyof typeof sum.mats)[]).filter((k) => sum.mats[k]).map((k) => `<span style="color:${MAT_BY_ID[k]!.color}">+${sum.mats[k]} ${MAT_BY_ID[k]!.name}</span>`).join(' · ');
    this.modal(`<h2>${abandoned ? 'Run Abandoned' : sum.eclipse ? 'Consumed by the Eclipse' : 'You Have Fallen'}</h2><div class="sub">${c.name} survived ${U.fmtTime(sum.time)} in ${STAGE_BY_ID[sum.stageId]!.name}${sum.heat ? ' at Heat ' + sum.heat : ''}</div>
      ${epitaph ? `<blockquote class="epitaph">${esc(epitaph)}<cite>— The Keeper</cite></blockquote>` : ''}
      ${!abandoned && sum.killedBy ? `<div class="tip" style="text-align:center;margin:-4px 0 10px">Slain by <b class="bad">${esc(sum.killedBy)}</b></div>` : ''}
      <div class="summary"><div class="st"><b>${U.fmtTime(sum.time)}</b><span>Survived</span>${rec(sum.time > prevBest && sum.time > 30) || rec(sum.time > prevStage && sum.time > 30)}</div><div class="st"><b>${sum.level}</b><span>Level</span></div><div class="st"><b>${U.fmt(sum.kills)}</b><span>Kills</span></div><div class="st"><b>${sum.bossKills}</b><span>Bosses</span></div><div class="st"><b>${sum.evolves}</b><span>Evolutions</span></div><div class="st"><b>${U.fmt(sum.bestCombo)}</b><span>Best streak</span>${rec(sum.bestCombo > prevCombo && sum.bestCombo >= 25)}</div><div class="st"><b>${U.fmt(sum.reactions)}</b><span>Reactions</span></div></div>
      ${sum.boons.length ? `<div class="row" style="justify-content:center;gap:6px;margin-bottom:10px">${sum.boons.map((id) => { const b = BOON_BY_ID[id]; return b ? `<span class="tag" style="background:#2e1f47;color:#e9d5ff">${ic(b.icon, 'sm')} ${b.name}</span>` : ''; }).join('')}</div>` : ''}
      <div class="rewards"><div class="reward">${ic({ g: 'coin', c: '#f5c542' })}<div><b class="gold">+${U.fmt(sum.gold)} gold</b></div></div><div class="reward">${ic({ g: 'ember', c: '#ff8a3c' })}<div><b style="color:#ff8a3c">+${sum.embers} Soul Embers</b></div></div><div class="reward">${ic({ g: 'book', c: '#c4b5fd' })}<div><b style="color:#c4b5fd">+${U.fmt(sum.charXp)} character XP</b><div class="tip">${c.name} is now level ${cd.level}${res.levelUps ? ` (+${res.levelUps} — new talent points!)` : ''}</div></div></div>${mats ? `<div class="reward">${ic({ g: 'shard', c: '#fde68a' })}<div>${mats}</div></div>` : ''}</div>
      ${res.unlocks.length ? `<div class="unlock-list">${res.unlocks.map((u) => `<div>✦ ${u.text}</div>`).join('')}</div>` : ''}
      <div class="pause-grid report-grid"><div><h3 class="gold" style="margin:0 0 6px">Damage report</h3>${damageReport(sum, c)}</div><div><h3 class="gold" style="margin:0 0 6px">Final build</h3><div class="pause-items">${sum.weapons.map((w) => { const d = WEAPONS[w.id]!, evo = w.evolved ? d.evo : undefined; return `<div class="it"><img src="${S.iconURL(evo ? evo.icon : d.icon)}" alt=""><span>${evo ? evo.name : d.name} <b>Lv${w.level}</b></span></div>`; }).join('')}${sum.passives.map((x) => { const d = PASSIVE_BY_ID[x.id]!; return `<div class="it"><img src="${S.iconURL(d.icon)}" alt=""><span>${d.name} <b>Lv${x.level}</b></span></div>`; }).join('')}</div></div></div>
      <div class="lvl-actions"><button class="btn" id="goMenu">Main Menu</button><button class="btn" id="goTalents">Talents</button><button class="btn" id="goForge">Forge</button><button class="btn primary" id="goAgain">Play Again</button></div>`);
    $('goMenu').onclick = () => this.showTitle();
    $('goTalents').onclick = () => { this.game.state = 'idle'; $('hud').classList.add('hidden'); this.closeModal(); this.showTalents(sum.charId); };
    $('goForge').onclick = () => { this.game.state = 'idle'; $('hud').classList.add('hidden'); this.closeModal(); this.showForge(); };
    $('goAgain').onclick = () => { this.closeModal(); this.startRun(); };
  }
}

export const UI = new UiController();
export type { UiController };
