/* SOULFORGE — the Ascension hub: Starweb, Champion Ascension, Weapon Mastery, Soul Arts, Night Contracts.
 * DOM only; every transaction goes through `Save` (meta/save.ts). */
import { audio } from '../audio/audio';
import { U } from '../core/util';
import { CHARACTERS, CHAR_BY_ID } from '../data/characters';
import { DAILY_BONUS, DAY_MS, contractProgressText, contractText, type Contract } from '../data/contracts';
import type { Reward } from '../data/forge';
import { MAT_BY_ID, PASSIVE_BY_ID, statFmt, statName } from '../data/passives';
import { ASCENSIONS, ASCENSION_PER_RANK, ASCENSION_STAR_POINTS, MASTERY_DMG_PER_LEVEL, MASTERY_MAX, MASTERY_PERKS, featText, masteryXpFor, soulXpFor } from '../data/progression';
import { ART_MAX_LEVEL, SOUL_ARTS, artCooldown, artPower, artUpgradeCost } from '../data/soularts';
import { CONSTELLATIONS, STARWEB, STARWEB_SIZE, STAR_BY_ID, sectorAngle, starReachable, type StarNode } from '../data/starweb';
import { WEAPONS } from '../data/weapons';
import { Save } from '../meta/save';
import { Sprites as S } from '../render/sprites';
import { $, $$, BTN, esc, ic, roman } from './dom';

export type AscTab = 'starweb' | 'champions' | 'mastery' | 'arts' | 'contracts';

/** The slice of the UI controller the hub needs. */
export interface UiHost {
  selChar: string;
  screen(name: string, html: string): HTMLDivElement;
  head(title: string, extra?: string): string;
  bindBack(fn: () => void): void;
  toast(text: string): void;
  notice(text: string, color?: string, dur?: number): void;
  refreshCurrency(): void;
  showTitle(): void;
}

const TABS: [AscTab, string][] = [['starweb', 'Starweb'], ['champions', 'Ascension'], ['mastery', 'Weapon Mastery'], ['arts', 'Soul Arts'], ['contracts', 'Night Contracts']];
const CURRENCY: Record<string, string> = { gold: 'gold', embers: 'Soul Embers' };

/** "15 Soul Embers, 1 Starshard". */
export function fmtReward(r: Reward): string {
  return (Object.keys(r) as (keyof Reward)[]).filter((k) => r[k]).map((k) => U.fmt(r[k]!) + ' ' + (CURRENCY[k] ?? MAT_BY_ID[k]?.name ?? k)).join(', ') || 'free';
}
/** Claimable contracts + bonus (for the title badge). */
export function contractsReady(): number {
  Save.refreshContracts();
  const cs = Save.data.contracts;
  let n = cs.list.filter((c) => !c.claimed && c.progress >= c.target).length;
  if (cs.weekly && !cs.weekly.claimed && cs.weekly.progress >= cs.weekly.target) n++;
  if (Save.dailyBonusReady()) n++;
  return n;
}
/** Soul Rank line for the title screen. */
export function soulRankHtml(): string {
  const s = Save.data.soul, need = soulXpFor(s.level), free = Save.starPointsFree();
  return `<div class="soul-rank"><b>Soul Rank ${s.level}</b><div class="bar"><i style="width:${Math.min(100, (s.xp / need) * 100).toFixed(1)}%"></i></div><span class="tip">${U.fmt(s.xp)} / ${U.fmt(need)}${free > 0 ? ` · <span class="gold">${free} star${free === 1 ? '' : 's'} to light</span>` : ''}</span></div>`;
}

export function showAscension(ui: UiHost, tab: AscTab = 'starweb'): void {
  const s = Save.data.soul;
  ui.screen('ascension', ui.head('Ascension') + `<div class="screen-body"><div class="row" style="margin-bottom:10px;flex-wrap:wrap"><b class="gold">Soul Rank ${s.level}</b><div class="bar grow" style="max-width:300px"><i style="width:${Math.min(100, (s.xp / soulXpFor(s.level)) * 100).toFixed(1)}%"></i></div><span class="tip">${U.fmt(s.xp)} / ${U.fmt(soulXpFor(s.level))} Soul XP · every champion's runs feed the same rank</span></div>
    <div class="tabs">${TABS.map(([id, n]) => `<button class="${tab === id ? 'on' : ''}" data-t="${id}">${n}${id === 'contracts' && contractsReady() ? ' <span class="badge">!</span>' : ''}</button>`).join('')}</div><div id="ascBody"></div></div>`);
  ui.bindBack(() => ui.showTitle());
  $$(document, '#ascension .tabs button').forEach((b) => (b.onclick = () => { audio.play('ui'); showAscension(ui, b.dataset.t as AscTab); }));
  const refresh = (): void => showAscension(ui, tab);
  switch (tab) {
    case 'starweb': starweb(ui); break;
    case 'champions': champions(ui, refresh); break;
    case 'mastery': mastery(); break;
    case 'arts': arts(ui, refresh); break;
    case 'contracts': contracts(ui, refresh); break;
  }
}

/* ------------------------------------------------------------------ */
/* Starweb                                                            */
/* ------------------------------------------------------------------ */

const UNIT = 62;
const RADIUS: Record<StarNode['kind'], number> = { origin: 15, minor: 7, bridge: 8, notable: 12, keystone: 17 };
let starSel: string | null = null;

/** Bridges join two constellations (inner `X…` stars and outer `Y…` notables); they belong to neither count. */
const isBridge = (n: StarNode): boolean => n.kind === 'bridge' || n.id[0] === 'Y';
function starColor(n: StarNode): string { return n.sector < 0 ? '#fde68a' : isBridge(n) ? '#e2e8f0' : CONSTELLATIONS[n.sector]!.color; }

function starweb(ui: UiHost): void {
  const d = Save.data, lit = d.starweb;
  const isLit = (id: string): boolean => id === 'origin' || !!lit[id];
  // edges once each, brightest state wins
  const edges: string[] = [];
  for (const n of STARWEB) for (const l of n.links) {
    if (l < n.id) continue;
    const m = STAR_BY_ID[l]!, a = isLit(n.id), b = isLit(l);
    const cls = a && b ? 'lit' : a || b ? 'open' : '';
    const col = a && b ? starColor(n.kind === 'origin' ? m : n) : '';
    edges.push(`<line class="edge ${cls}" x1="${n.x * UNIT}" y1="${n.y * UNIT}" x2="${m.x * UNIT}" y2="${m.y * UNIT}"${col ? ` style="stroke:${col}"` : ''}/>`);
  }
  const free = Save.starPointsFree();
  const stars = STARWEB.map((n) => {
    const on = isLit(n.id), avail = !on && free > 0 && starReachable(n.id, lit), reach = !on && starReachable(n.id, lit);
    const c = starColor(n), r = RADIUS[n.kind];
    const shape = n.kind === 'keystone'
      ? `<polygon points="${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => { const a = (i / 8) * Math.PI * 2 - Math.PI / 2, rr = i % 2 ? r * 0.55 : r; return (Math.cos(a) * rr).toFixed(1) + ',' + (Math.sin(a) * rr).toFixed(1); }).join(' ')}"/>`
      : n.kind === 'notable' ? `<rect x="${-r * 0.8}" y="${-r * 0.8}" width="${r * 1.6}" height="${r * 1.6}" rx="3" transform="rotate(45)"/>` : `<circle r="${r}"/>`;
    return `<g class="star k-${n.kind} ${on ? 'lit' : avail ? 'avail' : reach ? 'reach' : ''} ${starSel === n.id ? 'sel' : ''}" data-id="${n.id}" transform="translate(${(n.x * UNIT).toFixed(1)},${(n.y * UNIT).toFixed(1)})" style="--c:${c}" role="button" tabindex="0" aria-label="${esc(n.name)}"><title>${esc(n.name)}: ${esc(n.desc)}</title>${shape}</g>`;
  }).join('');
  const labels = CONSTELLATIONS.map((c, i) => { const a = sectorAngle(i), r = 7.25 * UNIT; return `<text class="cons-lbl" x="${(Math.cos(a) * r).toFixed(1)}" y="${(Math.sin(a) * r + 5).toFixed(1)}" fill="${c.color}">${esc(c.name)}</text>`; }).join('');
  const total = Save.starPoints(), litN = Save.starsLit(), cost = Save.starRespecCost();
  $('ascBody').innerHTML = `<div class="starweb-layout">
    <div class="panel starweb-wrap"><svg class="starweb" viewBox="-500 -500 1000 1000" role="group" aria-label="The Starweb">${edges.join('')}${stars}${labels}</svg></div>
    <div class="col">
      <div class="panel" style="padding:14px"><h3 class="gold" style="margin:0 0 6px">The Starweb</h3>
        <div class="row"><span class="tag" style="background:${free > 0 ? 'var(--gold)' : '#333'};color:${free > 0 ? '#000' : '#999'}">${free} point${free === 1 ? '' : 's'} free</span><span class="tip">${litN} / ${STARWEB_SIZE} stars lit · ${total} points earned</span></div>
        <p class="tip">Light a star next to one already lit. Points come from <b>Soul Rank</b> (one per rank) and from <b>Ascension</b> (${ASCENSION_STAR_POINTS} per champion rank). The web is shared by every champion.</p>
        <div class="legend"><span><i class="lg minor"></i>Star</span><span><i class="lg notable"></i>Notable</span><span><i class="lg keystone"></i>Keystone</span></div>
        <button class="btn small danger" id="swRespec" ${cost && d.gold >= cost ? '' : 'disabled'}>Reset web${cost ? ' — ' + U.fmt(cost) + ' gold' : ''}</button>
      </div>
      <div class="panel" style="padding:14px" id="starDetail"></div>
      <div class="panel" style="padding:14px">${CONSTELLATIONS.map((c, i) => { const mine = STARWEB.filter((n) => n.sector === i && !isBridge(n)), own = mine.filter((n) => lit[n.id]).length, all = mine.length; return `<div class="row" style="margin:3px 0">${ic(c.icon, 'sm')}<div class="grow"><b style="color:${c.color}">${c.name}</b><div class="tip">${c.theme}</div></div><span class="tip">${own}/${all}</span></div>`; }).join('')}</div>
    </div></div>`;
  const detail = (id: string | null): void => {
    const box = $('starDetail'); if (!box) return;
    const n = id ? STAR_BY_ID[id] : null;
    if (!n) { box.innerHTML = '<div class="tip">Hover or tap a star to read it. Tap a lit star to unlight it (only if nothing else hangs from it).</div>'; return; }
    const on = isLit(n.id), reach = starReachable(n.id, lit);
    const kind = n.kind === 'keystone' ? 'Keystone' : n.kind === 'notable' ? 'Notable' : n.kind === 'origin' ? 'Origin' : n.kind === 'bridge' ? 'Bridge' : 'Star';
    const cons = n.sector >= 0 ? CONSTELLATIONS[n.sector]! : null;
    box.innerHTML = `<div class="tip" style="color:${starColor(n)}">${kind}${cons ? ' · ' + cons.name : ''}</div><h3 style="margin:2px 0 6px">${esc(n.name)}</h3><div>${esc(n.desc)}</div>
      <div class="tip" style="margin-top:8px">${n.kind === 'origin' ? 'Always lit.' : on ? 'Lit. Tap again to unlight.' : reach ? (free > 0 ? 'Tap to light (1 point).' : 'No points free.') : 'Light a neighbouring star first.'}</div>`;
  };
  detail(starSel);
  $$($('ascBody'), 'g.star').forEach((g) => {
    const id = g.dataset.id!;
    g.addEventListener('mouseenter', () => detail(id));
    g.addEventListener('focus', () => detail(id));
    const act = (): void => {
      starSel = id;
      if (id === 'origin') { detail(id); return; }
      const err = isLit(id) ? Save.unlightStar(id) : Save.lightStar(id);
      if (err) { ui.toast(err); detail(id); return; }
      audio.play(isLit(id) ? 'evolve' : 'uiback');
      starweb(ui);
    };
    g.addEventListener('click', act);
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); } });
  });
  $('swRespec').onclick = () => { if (!confirm('Unlight every star for ' + U.fmt(cost) + ' gold?')) return; const err = Save.respecStarweb(); if (err) ui.toast(err); else { audio.play('uiback'); ui.refreshCurrency(); starweb(ui); } };
}

/* ------------------------------------------------------------------ */
/* Champion Ascension                                                 */
/* ------------------------------------------------------------------ */

function champions(ui: UiHost, refresh: () => void): void {
  if (!CHAR_BY_ID[ui.selChar]) ui.selChar = 'kael';
  const c = CHAR_BY_ID[ui.selChar]!, cd = Save.charData(c.id), next = Save.nextAscension(c.id);
  const per = Object.keys(ASCENSION_PER_RANK).map((k) => statName(k) + ' ' + statFmt(k, ASCENSION_PER_RANK[k]!)).join(', ');
  const ladder = ASCENSIONS.map((a) => {
    const done = cd.ascension >= a.rank, isNext = next === a;
    const lvlOk = cd.level >= a.level, featOk = Save.featMet(c.id, a.feat), prog = Save.featProgress(c.id, a.feat);
    const progTxt = a.feat.kind === 'time' ? U.fmtTime(prog) : U.fmt(prog);
    return `<div class="asc-rank ${done ? 'done' : isNext ? 'next' : 'locked'}"><div class="num">${a.numeral}</div><div class="grow">
      <div><b>${esc(a.desc)}</b></div>
      ${done ? '' : `<div class="tip"><span class="${lvlOk ? 'good' : ''}">${lvlOk ? '✓' : '✗'} Character level ${a.level} (${cd.level})</span> · <span class="${featOk ? 'good' : ''}">${featOk ? '✓' : '✗'} ${esc(featText(a.feat))} (${progTxt})</span></div><div class="tip">Cost: ${fmtReward(a.cost)}</div>`}
    </div>${done ? '<span class="tag" style="background:#1f3a2a;color:#4ade80">Ascended</span>' : isNext ? `<button class="btn small primary" id="ascBtn" ${Save.ascendBlockers(c.id).length ? 'disabled' : ''}>Ascend</button>` : ''}</div>`;
  }).join('');
  $('ascBody').innerHTML = `<div class="talent-layout"><div class="char-list panel" style="padding:8px">${CHARACTERS.map((x) => { const xd = Save.charData(x.id); return `<div class="ci ${x.id === c.id ? 'sel' : ''} ${xd.unlocked ? '' : 'muted'}" data-id="${x.id}" ${BTN}><img src="${S.portraitURL(x, 48)}" alt=""><div><b>${x.name}</b>${xd.ascension ? ` <span class="asc-pip">${roman(xd.ascension)}</span>` : ''}<div class="tip">Lv ${xd.level}</div></div></div>`; }).join('')}</div>
    <div><div class="row" style="margin-bottom:10px"><img src="${S.portraitURL(c, 96)}" alt="" style="width:72px;height:72px;border-radius:8px"><div><h3 style="margin:0;color:var(--gold)">${c.name}${cd.ascension ? ` <span class="asc-pip big">${roman(cd.ascension)}</span>` : ''}</h3><div class="muted">${c.title} · level ${cd.level}</div></div></div>
      <p class="tip">Ascension reforges a champion in the Soulforge. Every rank: ${per}, and +${ASCENSION_STAR_POINTS} Starweb point for the whole account. Ranks I and III open the Mastery and Apex tiers of every talent branch.</p>
      <div class="asc-ladder">${ladder}</div></div></div>`;
  $$($('ascBody'), '.ci').forEach((el) => (el.onclick = () => { ui.selChar = el.dataset.id!; audio.play('ui'); refresh(); }));
  const btn = document.getElementById('ascBtn');
  if (btn) btn.onclick = () => {
    const err = Save.ascend(c.id);
    if (err) { ui.toast(err); return; }
    audio.play('evolve'); ui.refreshCurrency();
    ui.notice(`${c.name} ascends: ${roman(Save.charData(c.id).ascension)}`, '#fde68a', 4);
    refresh();
  };
}

/* ------------------------------------------------------------------ */
/* Weapon Mastery                                                     */
/* ------------------------------------------------------------------ */

function mastery(): void {
  const d = Save.data;
  const ws = Object.values(WEAPONS).slice().sort((a, b) => Save.masteryLevel(b.id) - Save.masteryLevel(a.id) || a.name.localeCompare(b.name));
  let total = 0; for (const w of ws) total += Save.masteryLevel(w.id);
  $('ascBody').innerHTML = `<p class="tip">Every weapon learns from the damage it deals. Each Mastery level adds ${Math.round(MASTERY_DMG_PER_LEVEL * 100)}% damage for that weapon, permanently, and milestones grant perks — Mastery ${MASTERY_PERKS[1]!.level} unlocks <b>Apotheosis</b>, the second evolution. Total mastery: <b class="gold">${total}</b> / ${ws.length * MASTERY_MAX}.</p>
    <div class="codex-grid">${ws.map((w) => {
      const seen = !!(d.codex.weapons[w.id] && d.codex.weapons[w.id]!.found), m = Save.mastery(w.id), L = m.level, need = L < MASTERY_MAX ? masteryXpFor(L) : 0;
      return `<div class="entry ${seen ? '' : 'locked'}"><div class="row">${ic(w.icon)}<div class="grow"><h4>${seen ? w.name : '???'}</h4><div class="tip">${w.char ? 'Signature · ' + CHAR_BY_ID[w.char]!.name : 'General'}${seen && w.evo ? ' · evolves with ' + PASSIVE_BY_ID[w.evo.with]!.name : ''}</div></div><div class="mastery-lvl">${L}<small>/${MASTERY_MAX}</small></div></div>
        <div class="bar" style="margin:6px 0"><i style="width:${L >= MASTERY_MAX ? 100 : Math.min(100, (m.xp / need) * 100).toFixed(1)}%"></i></div>
        <div class="tip">${L >= MASTERY_MAX ? 'Mastered.' : U.fmt(m.xp) + ' / ' + U.fmt(need) + ' XP'} · damage +${Math.round(L * MASTERY_DMG_PER_LEVEL * 100)}%</div>
        <div class="perks">${MASTERY_PERKS.map((pk) => `<span class="perk ${L >= pk.level ? 'on' : ''}" title="${esc(pk.desc)}">${pk.level} ${pk.name}</span>`).join('')}</div></div>`;
    }).join('')}</div>`;
}

/* ------------------------------------------------------------------ */
/* Soul Arts                                                          */
/* ------------------------------------------------------------------ */

function arts(ui: UiHost, refresh: () => void): void {
  const d = Save.data, rank = Save.soulRank();
  $('ascBody').innerHTML = `<p class="tip">A Soul Art is a second ability any champion can carry into the night — press <span class="kbd">R</span> (gamepad <span class="kbd">Y</span>). Equip one; learn more with Soul Rank and Soul Embers, and raise each to level ${ART_MAX_LEVEL} (+15% power and -5% cooldown per level).</p>
    <div class="art-grid">${SOUL_ARTS.map((a) => {
      const L = Save.artLevel(a.id), eq = d.art === a.id, locked = rank < a.rank;
      const action = L < 1
        ? `<button class="btn small primary" data-buy="${a.id}" ${locked || !Save.canAfford(a.cost) ? 'disabled' : ''}>${locked ? 'Soul Rank ' + a.rank : 'Learn — ' + fmtReward(a.cost)}</button>`
        : `<div class="row"><button class="btn small ${eq ? '' : 'primary'}" data-eq="${a.id}">${eq ? 'Unequip' : 'Equip'}</button>${L < ART_MAX_LEVEL ? `<button class="btn small" data-up="${a.id}" ${Save.canAfford(artUpgradeCost(L)) ? '' : 'disabled'}>Level ${L + 1} — ${fmtReward(artUpgradeCost(L))}</button>` : '<span class="tag" style="background:#1f3a2a;color:#4ade80">Mastered</span>'}</div>`;
      return `<div class="art-card ${eq ? 'eq' : ''} ${L < 1 ? 'unlearned' : ''}" style="--c:${a.color}"><div class="row">${ic(a.icon, 'lg')}<div class="grow"><h4>${a.name}${eq ? ' <span class="tag new">Equipped</span>' : ''}</h4><div class="tip">Cooldown ${artCooldown(a, Math.max(1, L)).toFixed(1)}s${L ? ` · power ×${artPower(L).toFixed(2)}` : ''}</div>${L ? `<div class="pips">${Array.from({ length: ART_MAX_LEVEL }, (_, k) => `<i class="${k < L ? 'on' : ''}"></i>`).join('')}</div>` : ''}</div></div><p>${esc(a.desc)}</p>${action}</div>`;
    }).join('')}</div>`;
  const body = $('ascBody');
  $$(body, 'button[data-buy]').forEach((b) => (b.onclick = () => { const err = Save.buyArt(b.dataset.buy!); if (err) ui.toast(err); else { audio.play('evolve'); ui.refreshCurrency(); refresh(); } }));
  $$(body, 'button[data-up]').forEach((b) => (b.onclick = () => { const err = Save.upgradeArt(b.dataset.up!); if (err) ui.toast(err); else { audio.play('forge'); ui.refreshCurrency(); refresh(); } }));
  $$(body, 'button[data-eq]').forEach((b) => (b.onclick = () => { const id = b.dataset.eq!; Save.equipArt(d.art === id ? '' : id); audio.play('ui'); refresh(); }));
}

/* ------------------------------------------------------------------ */
/* Night Contracts                                                    */
/* ------------------------------------------------------------------ */

function contracts(ui: UiHost, refresh: () => void): void {
  Save.refreshContracts();
  const cs = Save.data.contracts, ctx = Save.contractContext(), now = Save.now();
  const untilDay = DAY_MS - (now % DAY_MS), untilWeek = untilDay + ((7 - ((Math.floor(now / DAY_MS) + 3) % 7) - 1) * DAY_MS);
  const hrs = (ms: number): string => { const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000); return h >= 24 ? Math.floor(h / 24) + 'd ' + (h % 24) + 'h' : h + 'h ' + m + 'm'; };
  const row = (c: Contract, daily: boolean): string => {
    const done = c.progress >= c.target, pct = Math.min(100, (c.progress / c.target) * 100);
    return `<div class="contract ${c.claimed ? 'claimed' : done ? 'done' : ''}"><div class="grow"><b>${esc(contractText(c, ctx))}</b><div class="bar" style="margin:6px 0"><i style="width:${pct.toFixed(1)}%"></i></div><div class="tip">${esc(contractProgressText(c))} · Reward: ${fmtReward(c.reward)}</div></div>
      <div class="col" style="gap:6px;align-items:flex-end">${c.claimed ? '<span class="tag" style="background:#1f3a2a;color:#4ade80">Claimed</span>' : `<button class="btn small primary" data-claim="${esc(c.id)}" ${done ? '' : 'disabled'}>Claim</button>`}${daily && !c.claimed && !done ? `<button class="btn small ghost" data-reroll="${esc(c.id)}" ${cs.rerolls > 0 ? '' : 'disabled'}>Reroll (${cs.rerolls})</button>` : ''}</div></div>`;
  };
  $('ascBody').innerHTML = `<div class="contracts">
    <div class="row"><h3 class="gold" style="margin:0">Daily contracts</h3><span class="tip">New contracts in ${hrs(untilDay)}. Progress counts from every run you finish today.</span></div>
    ${cs.list.map((c) => row(c, true)).join('')}
    <div class="contract bonus ${cs.bonus ? 'claimed' : ''}"><div class="grow"><b>The Keeper's Cache</b><div class="tip">Claim all three daily contracts · Reward: ${fmtReward(DAILY_BONUS)}</div></div>${cs.bonus ? '<span class="tag" style="background:#1f3a2a;color:#4ade80">Claimed</span>' : `<button class="btn small primary" id="bonusBtn" ${Save.dailyBonusReady() ? '' : 'disabled'}>Claim</button>`}</div>
    <div class="row" style="margin-top:16px"><h3 class="gold" style="margin:0">Grand Contract</h3><span class="tip">This week's great work · resets in ${hrs(untilWeek)}</span></div>
    ${cs.weekly ? row(cs.weekly, false) : ''}
    <p class="tip">Contracts completed: ${Save.data.stats.contracts}</p></div>`;
  const body = $('ascBody');
  $$(body, 'button[data-claim]').forEach((b) => (b.onclick = () => { const err = Save.claimContract(b.dataset.claim!); if (err) ui.toast(err); else { audio.play('buy'); ui.refreshCurrency(); refresh(); } }));
  $$(body, 'button[data-reroll]').forEach((b) => (b.onclick = () => { const err = Save.rerollContract(b.dataset.reroll!); if (err) ui.toast(err); else { audio.play('ui'); refresh(); } }));
  const bb = document.getElementById('bonusBtn');
  if (bb) bb.onclick = () => { const err = Save.claimDailyBonus(); if (err) ui.toast(err); else { audio.play('evolve'); ui.refreshCurrency(); refresh(); } };
}
