# SOULFORGE: Endless Night

A browser survivors-like (Vampire Survivors lineage) with a heavy meta-progression layer — 12 characters,
31 weapons with evolutions, elemental reactions, resonance, boons, shrines, a narrated story, talent trees, a
crafting forge and five biomes. Written in strict TypeScript, rendered with a batched **WebGL2** renderer with
bloom and colour grading (Canvas2D fallback), installable and playable offline as a PWA.

```bash
npm install
npm run dev        # http://localhost:5173
```

## Controls

| Key                           | Action                   |
| ----------------------------- | ------------------------ |
| WASD / Arrows / left-stick    | Move                     |
| Space / E / Shift / gamepad A | Character active ability |
| 1–4                           | Pick a level-up card     |
| Esc / P                       | Pause                    |

Touch: left side of the screen is a virtual stick, right side taps the ability.

## The run

- Enemies scale steeply with time (HP quadratic in minutes, exponential after 30:00 — _the Eclipse_). Elites every ~75s drop chests, a boss every 5 minutes, scripted swarms and encirclements in between. After 25 minutes the events loop with escalating boss tiers, forever.
- Level up to choose weapons (max 6, 8 levels each) and passives (max 6, 5 levels). A max-level weapon + its paired passive evolves when you open a chest.
- Each character starts with a **signature weapon** nobody else can use, a **trait** (permanent mechanic), an **active ability** on Space, and a **resource** where relevant (Static, Souls, Flow, Blood…).

## Run systems

See [docs/DESIGN.md](docs/DESIGN.md) for the design intent.

- **Elemental reactions** — burn + chill = _Thermal Shock_, burn + shock = _Overload_, chill + shock =
  _Superconduct_ (Brittle: +30% damage taken). Lightning weapons shock everything they hit.
- **Resonance** — 2 or 3 weapons sharing a tag (fire, ice, lightning, holy, magic, physical, shadow, poison,
  summon) awaken bonuses; tier 3 changes a mechanic.
- **Boons** — every fallen Herald offers one of three run-long boons (18 in all).
- **Elite affixes** — Swift, Warded, Vampiric, Frenzied, Molten, Brood, Colossal, Arcane, Necrotic, Phasing.
- **Boss phases** — Heralds enrage at half health and add barrage, cross-stream and hazard-pool attacks.
- **Shrines** — stand inside to channel: Altar of Blood, Fortune, Soul Well trials, Quickening, Font of Life,
  Cursed Idol.
- **Kill streaks** — Frenzy → Apocalypse tiers grant Might and Growth; getting hit cuts the streak.

## Story

The Keeper of the Soulforge narrates: a prologue on first launch, stage title cards, boss introductions with
epithets, voiced lines for every champion and Herald, an epitaph when you fall, and **The Long Night** — a
14-chapter main story in the Codex that unlocks as you push deeper.

## Characters (12)

Kael the Ember Knight · Lyra the Stormcaller · Talon the Beast Hunter · Seraphine the Dawn Oracle · Vex the Shadow Blade · Morrow the Grave Warden · Isolde the Frost Queen · Grom the Iron Bulwark · Nyx the Void Witch · Rix the Clockwork Tinkerer · Vesper the Blood Countess · Zephyr the Wind Monk.

Nine of them are unlocked through milestones (survive X minutes, kill totals, boss kills, evolve a weapon, character level 10…).

## Meta progression

- **Character XP & levels** — every run feeds the character; each level grants a talent point (no cap).
- **Talents** — per-character tree with 3 flavoured branches × 4 tiers + a keystone that changes a mechanic (e.g. Kael's _Wildfire_, Vex's _Lethality_, Nyx's _Null Field_). Tier gating by points in that branch; free respec. **Paragon** ranks are endless.
- **Codex → The Long Night** — the main story. **Codex → Lexicon** — reactions, resonance, boons, shrines and
  affixes.
- **Codex → Champions** — 5 lore chapters per character; chapters II/IV are _Awakenings_ (new mechanics: second dash charge, drone swarm, death marks…), chapter V is an _Ascension_.
- **Codex → Bestiary / Armory / Relics / Milestones** — kill tiers grant global Might, weapon mastery grants permanent weapon damage, milestones pay gold and Soul Embers.
- **Forge**
  - _Anvil_: 38 permanent stat upgrades in 4 tiers; the Mastery tier has infinite ranks.
  - _Armory_: craft gear for 6 slots with 6 rarities; affixes roll from slot pools; Legendary/Mythic carry one of 16 unique powers; upgrade (+8%/level, up to +30), reforge single affixes, salvage, catalysts to guarantee rarity. The Forge itself levels with gold spent, unlocking rarities and features.
  - _Transmute_: convert between Iron → Arcane Dust → Void Crystal → Starshard (and back).
  - _Sigils_: 22 run modifiers bought with Soul Embers (extra level-up choice, +1 weapon slot, timed free levels…).
- **Stages** — 5 biomes with their own palettes, props and difficulty/reward multipliers, unlocked by surviving long enough in the previous one.
- **Omens** — 9 optional difficulty pacts (Heat). Each Heat point is +8% gold, XP and materials.

## Development

| Command            | What it does                                                                 |
| ------------------ | ---------------------------------------------------------------------------- |
| `npm run dev`      | Vite dev server with hot reload                                              |
| `npm run build`    | Typecheck + production build to `dist/` (with service worker)                |
| `npm run preview`  | Serve the production build                                                   |
| `npm run check`    | Typecheck, lint and run all unit + simulation tests                          |
| `npm test`         | Vitest: core engine, save migrations, headless simulation of every character |
| `npm run test:e2e` | Playwright: real browser flows on both renderers                             |
| `npm run bench`    | Measure simulation/render cost with a large horde in GPU Chrome              |
| `npm run format`   | Prettier                                                                     |

Debugging aids: `?renderer=canvas2d` forces the fallback renderer, **Settings → Show FPS** shows frame,
simulation and draw timings plus draw-call counts, and `window.__SF` exposes the live game in the console.

CI (`.github/workflows/ci.yml`) runs format check, typecheck, lint, tests, build and the e2e suite on every
push and PR. `deploy.yml` publishes `main` to GitHub Pages once Pages is set to "GitHub Actions".

## Architecture

```
src/
  main.ts            composition root: wires input → game → UI/audio/save, runs the loop
  core/              engine primitives (no game knowledge)
    loop.ts          fixed-timestep loop with render interpolation
    rng.ts           seeded sfc32 RNG — the only randomness the simulation uses
    spatial-hash.ts  allocation-free typed-array broad phase
    events.ts        typed event emitter
    input.ts         keyboard / gamepad / touch → InputSource
    storage.ts       crash-proof localStorage wrapper
  game/              headless, deterministic simulation (no DOM)
    game.ts          the run: spawning, combat, weapons, pickups, level-ups
    types.ts         the shared type contract for all content
  data/              content: characters, weapons, enemies, passives, forge, codex,
                     synergy (resonance/reactions/streaks), boons, shrines, story
  meta/save.ts       versioned save (migrations, debounced writes, backups) + meta progression
  render/
    renderer.ts      world renderer (camera, layers, lighting, FX, post)
    fx.ts            visual effects state (struct-of-arrays particle pool)
    sprites.ts       procedural art, generated at load
    gfx/             backends: webgl2.ts (instanced uber-shader + atlas), canvas2d.ts (fallback)
  ui/ui.ts           DOM menus, HUD and modals
  ui/narrator.ts     voices the simulation's story beats (subtitles, title cards, boss banners)
  audio/audio.ts     procedural WebAudio SFX and music
tests/               Vitest (Node): core, save, simulation
e2e/                 Playwright smoke tests
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design in depth.

### Performance

Measured with `npm run bench` (1600×900, RTX 3050 Ti laptop, Chrome; CPU time per frame, late game):

| Horde        | Old Canvas2D renderer | WebGL2 renderer | Worst frame (old → new) |
| ------------ | --------------------- | --------------- | ----------------------- |
| ~200 enemies | 4.2 ms                | 0.30 ms         | 43 ms → 1.5 ms          |
| ~500 enemies | 17.2 ms               | 1.07 ms         | 50 ms → 2.2 ms          |
| ~950 enemies | 57.5 ms               | 2.36 ms         | 294 ms → 5.2 ms         |

Any number of entities renders in ~8 draw calls. Save data lives in `localStorage` (`soulforge_save_v1`, schema
versioned and migrated); Settings has export/import codes.
