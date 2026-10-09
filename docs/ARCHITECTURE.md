# Architecture

This document explains how SOULFORGE is put together and the rules that keep it fast and maintainable.
It's written for engineers changing the engine, adding content, or debugging.

## Layers and the one hard rule

```
            ┌──────────── main.ts (composition root) ────────────┐
 input ───▶ │  InputManager ─▶ Game.update(dt) ─▶ game.events ───┼─▶ UI · audio · Save
            │                       │                            │
            │                  world state ─▶ Renderer.render(α) ┼─▶ Backend (WebGL2 | Canvas2D)
            └────────────────────────────────────────────────────┘
```

**The simulation (`src/game`, `src/data`, `src/core`) is headless.** It never imports the DOM, UI, audio or
renderer — ESLint enforces this with `no-restricted-imports`. Everything the outside world needs to know is
emitted through `game.events` (`GameEvents` in `src/game/types.ts`): `sfx`, `notice`, `levelUp`, `chest`,
`gameOver`, `runStart`, `discover`, `boon` and `story` (narrative beats that `ui/narrator.ts` voices). Input
arrives through the `InputSource` interface.

That one rule buys three things:

1. **Tests run the real game in Node.** `tests/simulation.test.ts` plays every character for minutes of
   simulated time with scripted input in well under a second each.
2. **Determinism.** See below.
3. **Replaceable presentation.** The renderer, UI and audio can change without touching gameplay.

## Time: fixed steps, interpolated frames

`core/loop.ts` implements a fixed-timestep loop ("Fix Your Timestep"):

- The simulation always advances in exact 1/60 s steps, however fast the display refreshes. A 30 Hz laptop and
  a 240 Hz monitor run identical gameplay.
- Each rendered frame gets `alpha` ∈ [0, 1): how far real time sits between the last two simulation states.
  Every moving entity stores its previous position (`px`, `py`, captured in `Game.snapshotPositions`), and the
  renderer draws `prev + (cur − prev) · alpha`.
- Frame stalls are clamped to 250 ms, so a background tab doesn't trigger a catch-up burst.

Gameplay timers (`game.after(t, fn)`) count simulation time, never wall-clock time. `setTimeout` is only for UI.

## Determinism

All gameplay randomness comes from `simRng` (`core/rng.ts`, sfc32), which `Game.start({ seed })` reseeds.
`U.rand/randi/pick/chance/shuffle/weightedPick` and `rand()` all draw from it. Entity ids are reset per run.
**The same seed and the same inputs replay the same run.** `RunSummary.seed` records the seed.

Rules that keep this true:

- Gameplay code uses `rand()`, never `Math.random()`.
- Visual-only code (particles, shake, audio jitter) uses `Math.random()` and must not feed back into gameplay.
  FX are spawned by the simulation, but their state is never read by it.
- Meta progression (crafting, reforging) has its own `metaRng` in `data/forge.ts`, so menus can't perturb runs.

`tests/simulation.test.ts › is deterministic` guards this.

## Performance design

| Concern             | Approach                                                                                                                                                                                                                                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Broad-phase queries | `SpatialHash`: rebuilt per step into typed-array linked lists. Each bucket entry stores its integer cell, so hash collisions never produce duplicates or false cells. Hot loops (projectile hits, separation) use `candidates()` with dedicated scratch buffers; other code uses `each()`, which is re-entrant. |
| Entity removal      | Mark `dead`, then compact in place once per loop (order-preserving, O(n)). No `splice` inside loops. Allies use a separate `removed` flag, because content sets `dead` to _request_ a death that then runs its effects.                                                                                         |
| Particles           | Struct-of-arrays pool of typed arrays (`render/fx.ts`). No allocation per particle, swap-removal. Flags select glows, streaks, souls that home in on the champion, and pseudo-3D debris (height `z`, gravity, bounce, skid, spin).                                                                              |
| Rendering           | See below.                                                                                                                                                                                                                                                                                                      |
| Audio               | One shared noise buffer; a global voice cap on top of per-sound throttling.                                                                                                                                                                                                                                     |
| Saves               | Writes are debounced (250 ms) and flushed on `pagehide` / `visibilitychange`.                                                                                                                                                                                                                                   |

### The renderer

`render/renderer.ts` draws the world through the `Backend` interface (`render/gfx/backend.ts`): an
immediate-mode API of sprites and analytic shapes (glow, circle, radial gradient, ring, sector, arc, line,
rect, text, pattern, light).

A frame is drawn in this order: ground → per-chunk ground details → decals → zones and telegraphs → cast
shadows → dissolving corpses → pickups → **one y-sorted pass** of props, enemies, allies and the champion (so
the champion can walk behind a tree, which then turns translucent) → ground debris → projectiles → light map
→ additive glows, ribbons and particles → numbers and bars → screen-space overlays → post.

**WebGL2 backend** (`gfx/webgl2.ts`):

- Every primitive is one instance of a unit quad. A single uber-shader picks the shape per instance:
  sprites sample a texture, shapes are evaluated as signed distances with `fwidth` anti-aliasing.
- A frame is recorded into one interleaved `Float32Array` (24 floats per instance) plus a short command list,
  uploaded with one `bufferData`, and replayed. A batch only breaks when the blend mode, texture, view transform
  or render target changes, so a late-game frame with thousands of entities takes about 8 draw calls.
- Procedural sprite canvases are packed into a runtime atlas (`gfx/atlas.ts`) the first time they're drawn.
  Hit flashes and status tints are done in the shader, not by baking extra canvases.
- Text uses a baked bitmap font (`gfx/glyphs.ts`): white fill with a black outline, multiplied by the colour,
  so it's one quad per glyph in any colour.
- **Coloured lighting.** Lights accumulate additively (`ONE, ONE`) into a quarter-resolution light map —
  RGBA16F when renderable, else RGBA8 storing half the light. It is cleared to the stage's ambient level
  (`1 − darkness`, tinted by the darkness colour); a white light of alpha 1 exactly cancels the darkness, and
  every light may carry a colour (fireballs light the ground orange, frost blue, a Herald its eye colour). The
  map is composited in two passes: `scene × min(L, 1)` (`blendFunc(DST_COLOR, ZERO)`), then
  `scene × (1 + over)` (`DST_COLOR, ONE`) where `over` is the part of `L` above 1, Reinhard-compressed so a
  dense horde glows instead of whiting out.
- **Sprite shader extras.** `dissolve` burns a sprite away through value noise with a glowing rim (deaths);
  `skew` shears it about its pivot (cast shadows: every standing thing's silhouette, squashed and sheared onto
  the ground). Both ride in otherwise-unused instance slots, so they cost nothing when unused.
- **De-tiled ground.** The ground pattern samples its tile twice (the second lookup transposed and rescaled)
  and blends them with world-space noise, plus a very low-frequency brightness drift, so the 512 px tile never
  reads as a grid.
- Colours are premultiplied end to end. Context loss is handled: resources rebuild lazily on restore.
- Post-processing (`setPost(PostFX)`, called once per frame): the scene renders into an offscreen buffer, then a
  half-resolution bright pass, a 5-level dual-filter bloom chain and one final pass apply up to eight
  **shockwaves** (a derivative-of-Gaussian displacement ring per explosion or slam, in device pixels), bloom,
  exposure, contrast, saturation, per-stage **split toning** (shadows and highlights pushed towards stage
  colours), a colour wash, chromatic aberration and grain. `setPost(null)` (or identity values)
  renders straight to the canvas at no extra cost.
- Sprites may carry `res` (canvas pixels per world unit). The sprite factory bakes world sprites at `res = 2`
  with an outline so they stay crisp at Retina zoom; the backends draw them at `width / res`.

**Canvas2D backend** (`gfx/canvas2d.ts`) implements the same interface. It is the fallback when WebGL2 is
unavailable, and `?renderer=canvas2d` forces it.

`npm run bench` measures both against a large horde in GPU-accelerated Chrome.

### Slow motion

The simulation asks for slow motion or hit-stop with `fx.timeWarp(scale, seconds)`. `main.ts` passes
`fx.stepWarp` as the loop's `timeScale`, so a slowed frame simply runs fewer fixed steps. Step size never
changes, which keeps runs deterministic.

## Content model

Content is data plus behaviour functions, registered at module load:

- **Weapons** (`data/weapons.ts`, signature weapons in `data/characters.ts`): `registerWeapon({ id, base,
levels, evo, fire(g, w, s) })`. `weaponStats` folds levels, evolution and player stats into a
  `WeaponStats`. A weapon can be cooldown-driven (`fire`) or `continuous` (`update` every step).
- **Characters** (`data/characters.ts`): stats, signature weapon, active ability, talent tree, codex chapters,
  and `hooks` (`onDamage`, `onHit`, `onKill`, `onHurt`, `update`, …) that the simulation calls at fixed points.
- **Enemies, stages, omens, passives, forge, codex:** plain typed tables.
- **Run systems** (`data/synergy.ts`, `data/boons.ts`, `data/shrines.ts`, elite affixes in `data/enemies.ts`):
  resonance tiers, reactions, kill-streak tiers, boons, shrines. See [DESIGN.md](DESIGN.md) for intent.
- **Story** (`data/story.ts`): all narrative text. The simulation emits beats; it never reads story text.

`src/game/types.ts` is the contract. Engine-owned fields are typed exactly. Per-content runtime state (Vesper's
`blood`, a weapon's `orbs`, a status mark like `hunted`) lives on deliberately open records: `Player`, `Weapon`,
`Ally`, `Projectile` and `EnemyStatus` have index signatures. New mechanics don't need engine changes.

**Adding a weapon:** call `registerWeapon` in `data/weapons.ts` (or under a character for a signature weapon),
add an `evo` pairing with a passive, and run `npm test`. The simulation test plays every character and fails on
any thrown error.

## Persistence

`meta/save.ts` keeps everything in one JSON document under `soulforge_save_v1`:

- `SAVE_VERSION` plus a `MIGRATIONS` table upgrades old saves step by step.
- After migrating, the save is merged onto `defaults()` with type guards, so a missing or wrong-typed field
  falls back to its default.
- Unreadable data is never thrown away: it is copied to `soulforge_save_backup` and the game starts fresh.
- Import validates and migrates the incoming save, and backs up the current one before replacing it.
- To change the save shape, bump `SAVE_VERSION`, add a migration, and extend `tests/save.test.ts`.

## Testing

| Suite                      | Runs   | Covers                                                                                     |
| -------------------------- | ------ | ------------------------------------------------------------------------------------------ |
| `tests/core.test.ts`       | Node   | RNG statistics, spatial hash vs brute force (including hash collisions), emitter, FX pool  |
| `tests/save.test.ts`       | Node   | defaults, v1→v2 migration, corrupt-data recovery, import/export, run recording, debouncing |
| `tests/simulation.test.ts` | Node   | every character for 3 minutes, determinism, a full mortal run, late game on every stage    |
| `e2e/smoke.spec.ts`        | Chrome | boot, every meta screen, a full run flow — on both renderers                               |
