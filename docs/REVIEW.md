# Soulforge review — October 2026

This review preserves the existing game, progression model, procedural art, audio, and both renderers. It fixes reproducible defects and adds repeatable coverage. It does not establish that every possible build is balanced or that the game is ready for an AAA release.

## Scope

The review followed the architecture and design documents, then traced the simulation, content definitions, persistence, input, rendering, and UI. The content matrix covers all 12 champions, 35 weapons in base/evolved/Apotheosis forms, eight Soul Arts, five stages, normal play, Omens, Torment, and the Eclipse.

Browser coverage includes the prologue/title, champion selection/details, stage/difficulty setup, Talents, all five Ascension tabs, all four Forge tabs, all seven Codex tabs, Settings, HUD, map, pause, level-up choices, ordinary and evolution chests, boons, death/abandon results, and returning to the menu. Screenshots include scrolled content as well as initial views. Fresh and progressed accounts exercise different availability states.

## Corrected defects

| Area                 | Defect and correction                                                                                                                                                                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Movement             | Diagonal movement produced a short facing vector and overstated distance travelled. Facing and distance now use normalized movement.                                                                                                                                                       |
| Dash                 | The final simulation step could overshoot the declared dash distance. Movement now uses only the remaining dash time.                                                                                                                                                                      |
| Teleports            | Blink and recycled enemies interpolated across the arena. Previous positions now reset at the destination.                                                                                                                                                                                 |
| Projectile collision | Fast bolts could cross targets between fixed steps. Fast travelling player projectiles sweep their path in impact order; enemy bolts also test their travelled path. Piercing and ricochet behavior have regression coverage. Orbiting weapons do not sweep through a champion's teleport. |
| Damage bonuses       | Weapon knockback and fire burn bonuses were applied in both weapon stats and impact handling. They now apply once, at impact/status application.                                                                                                                                           |
| Fireball             | The direct impact target was excluded from the explosion but never received burn. It now receives the same burn as the surrounding targets.                                                                                                                                                |
| Chill                | Slow strength above 100% could reverse enemy movement. Ordinary slows stop at 100%; the boss cap remains 70%.                                                                                                                                                                              |
| Ability ranks        | Sustained damage from Lyra, Morrow, Vesper, and Zephyr, plus Nyx's delayed Oblivion explosion, missed rank scaling. These effects retain the cast's rank multiplier.                                                                                                                       |
| Streaks              | Taking damage lowered the streak counter without immediately removing its stat tier. Stats now update at that boundary.                                                                                                                                                                    |
| Death                | Later phases in the lethal simulation step could collect rewards or heal a dead champion. Phase guards, damage/heal guards, and copied result counters prevent that continuation. New runs also clear the previous cause of death.                                                         |
| Actions              | Ability, dash, and Soul Art entry points now reject casts outside live play.                                                                                                                                                                                                               |
| Boons                | Owning all ordinary boons made remaining legendary boons unavailable. Eligible late-game offers now fall back to the remaining legendary pool.                                                                                                                                             |
| Damage report        | Soul Arts were grouped into the champion ability. They have their own source, and Starweb/keystone sources have readable labels.                                                                                                                                                           |
| Mastery              | Reload normalization promoted an unearned level-zero mastery to level one. Zero is now a valid persisted mastery level.                                                                                                                                                                    |
| Transmutation        | A partially completed bulk operation could return before requesting a save. Completed exchanges now persist even when materials run out.                                                                                                                                                   |
| Forge validation     | Locked catalysts, invalid equipment slots, and invalid reforge indices are rejected before payment. A stale catalyst selection resets after importing a lower-level Forge.                                                                                                                 |
| Persistence          | Failed durable writes remain pending for retry. Session fallback values take precedence over stale disk values, and failed removals remain removed in-session.                                                                                                                             |
| Save recovery        | Nested malformed gear, contracts, progression records, and settings are normalized while usable progress survives. Load repairs retain the original save in the backup key. Imports from a newer schema are rejected.                                                                      |
| Character preview    | Health percentage bonuses, cooldown/dodge caps, luck-derived crit, and armor-derived Starweb Might are reflected in the preview.                                                                                                                                                           |
| Forge display        | Currency changes now also refresh Forge XP and level.                                                                                                                                                                                                                                      |
| Difficulty text      | Reward descriptions now distinguish gold, character XP, Iron/Dust, and Soul Embers. Existing rare-material economics were preserved.                                                                                                                                                       |
| Quick Start          | The former “Continue” action actually began a new run. Its label now says “Quick Start,” and it restores the saved difficulty consistently.                                                                                                                                                |
| Narration            | Independently chosen speakers and lines could disagree. A single choice now selects the matching pair.                                                                                                                                                                                     |
| Keyboard             | Space activates focused buttons/cards without also queuing a dash. Modals receive focus, contain Tab navigation, and restore focus on close. Repeated keydowns no longer repeatedly choose rewards or toggle stars. The minimap is keyboard focusable.                                     |
| Touch/gamepad        | Additional fingers no longer steal the movement stick; simultaneous ability taps are handled. Blur clears queued actions. Gamepad disconnect resets button edges for reconnection.                                                                                                         |
| Settings             | Imported settings immediately apply quality, audio, damage meter, and motion preferences. The operating system's reduced-motion preference is respected.                                                                                                                                   |
| Responsive UI        | Headers/currencies/tabs wrap, short title screens scroll, phone talent/character lists have explicit heights, panels and reward cards fit narrow screens, and HUD controls no longer cover the damage meter.                                                                               |

These balance changes correct calculations or make effects agree with their descriptions. They intentionally do not retune champion damage, drop rates, prices, or progression curves based only on short synthetic fights.

## Repeatable checks

`npm run check` runs TypeScript, ESLint, and the unit/simulation suite. The expanded suite contains 336 tests across seven files, up from 143 tests at the start of the review.

- `tests/audit.test.ts`: focused reproductions for the corrected combat, progression, and persistence defects.
- `tests/content.test.ts`: 105 weapon-form simulations, all champion endgame setups, all maximum-rank Soul Arts, and content-reference validation.
- `tests/input.test.ts`: focus loss, simultaneous touch input, gamepad edges, reconnection, and radial dead zones.
- Existing suites continue to exercise determinism, reactions, resonance, affixes, shrines, hazards, boss mechanics, world events, talent/Starweb/Ascension transactions, contracts, sets, Overdrive, Apotheosis, Overflow, and migration.

`npm run test:e2e -- --workers=1` builds the production game and exercises Chrome with both WebGL2 and Canvas2D. `SF_E2E_PORT` can select a separate server port when another local server is running. The expanded browser matrix uses 1280×720, 390×844, 844×390, and 320×568 windows. It also checks purchases across a fresh page load, imported settings, offline boot after assets are installed, and WebGL context restoration. Screenshots and failed-run traces are written under `test-results/`.

`npm run format:check` and `git diff --check` verify formatting and patch whitespace. Production builds include the PWA assets and service worker.

The full browser run completed with **23 passing checks and one intentional skip** (WebGL context recovery does not apply to Canvas2D). Later equipment-panel and landscape-HUD refinements received targeted layout checks. The results-screen fixture explicitly disables ward/rebirth protection before its forced lethal hit; otherwise a correctly functioning defensive boon can prevent the test from reaching results.

## Performance observations

The existing benchmark ran 600 measured frames at 1600×900 after warming a late-game run and injecting 1,500 additional enemies. Both backends completed without reported errors. The horde is allowed to die during this test; it ended with 341 enemies, so these figures are not a constant-1,500-enemy throughput claim.

| Backend/settings                                 | Mean simulation | Mean drawing | Worst drawing frame |
| ------------------------------------------------ | --------------- | ------------ | ------------------- |
| WebGL2, default quality                          | 1.226 ms        | 2.288 ms     | 20.1 ms             |
| Canvas2D, default quality                        | 3.735 ms        | 35.364 ms    | 92.3 ms             |
| Canvas2D, 60% render quality / 50% spell effects | 3.597 ms        | 32.707 ms    | 74.1 ms             |

These are local CPU submission timings from `scripts/bench.mjs`, with GPU synchronization disabled. They exclude HUD/audio work and are not device-independent frame-rate guarantees. The lower Canvas2D settings help only modestly in this scene. Heavy-combat performance of the fallback renderer remains a release concern; profiling and reducing its draw cost deserve a separate measured optimization pass. WebGL2 remains the primary renderer.

## Follow-up: spell readability and in-run settings

The gameplay HUD now has a 44px Settings control beside Pause, and the pause menu also links to Settings. Opening it pauses simulation, changes apply immediately, and Resume, Escape, or P return to the run. Save import/reset remain available in the main-menu settings. Sliders stack on narrow phones, and returning to play clears button focus so Space can dash.

Spell effects now support 10–100% intensity. Overlapping spell families share a decorative brightness budget; large effects and crowded individual families fade more strongly. Projectile bodies, baked sprite halos, trails, particles, black-hole fills, meteors, mines, lighting, bloom, and screen flashes have reduced coverage/brightness. Large projectile silhouettes retain their geometry but become more transparent. Decorative particle admission is bounded, including unusually large individual bursts. Enemy attack warnings retain their opacity, and hostile projectile cores draw above friendly effects. Damage, collision radii, durations, evolutions, and progression are unchanged.

Verification added 35 deterministic Apotheosis comparisons between minimum and maximum effects, a particle-budget regression, and a save/reload check for 10% intensity. Browser checks cover in-run settings at 1280×720, 320×568, and 844×390 in both backends; all 35 Apotheosis weapons in six crowded arsenals at both intensity limits; and unchanged warning opacity while existing effects dim. The initial full browser pass passed 31 tests with the expected Canvas2D skip for WebGL recovery. All 12 targeted browser checks passed again after final visual/focus refinements. Screenshots were inspected for desktop/mobile layout and crowded combat.

The same local benchmark after this follow-up reported:

| Backend, default quality | Mean simulation | Mean drawing | Worst drawing frame | Final particles |
| ------------------------ | --------------- | ------------ | ------------------- | --------------- |
| WebGL2                   | 1.194 ms        | 1.872 ms     | 18.5 ms             | 1197            |
| Canvas2D                 | 2.019 ms        | 22.839 ms    | 59.9 ms             | 1199            |

Both runs ended with 341 enemies and three projectiles and reported no errors. Canvas2D drawing improved from the earlier 35.364 ms measurement to 22.839 ms in this fixture, but it still exceeds a 60fps drawing budget. These remain local CPU submission measurements, not a guarantee for every device or arsenal.

## Follow-up: spell presence at full intensity — 15 October 2026

Spell silhouettes now have a separate, bounded visibility curve from decorative glow. The earlier combined crowd, size, and family fades could make large projectiles, beams, slashes, novas, and pools almost disappear even at 100% effects. Friendly projectile bodies and pool boundaries now draw after ambient lighting; the slider still dims them at lower settings. Large bodies retain their silhouette, and overlapping area boundaries soften without vanishing.

Colored beam/slash cores use normal compositing with narrow highlights, while broad glows, particles, lighting, bloom, and flashes keep their decorative limits. Friendly orbs have independently controlled halos and colored centers. Repeated rings, explosions, and novas soften as they stack. Pool fills remain subtle, and their overlap budget counts visible pools so distant pools do not suppress a local boundary. Combat damage, hitboxes, timing, and enemy warning/projectile opacity are unchanged.

Browser verification compares sparse and crowded scenes at 10%, 50%, and 100%, including large projectiles, beams, slashes, novas, pool boundaries, stacked pools, bloom/glow limits, and hostile warnings. The same six crowded arsenals cover all 35 Apotheosis weapons in both renderers. The existing deterministic tests continue to verify identical combat at minimum and maximum effects.

`npm run check` passes all 349 tests, TypeScript, and ESLint. The initial browser pass passed 14 checks, including desktop/phone/landscape settings and complete runs. After visual refinements, all six targeted arsenal/visibility checks passed again; the final live-run and visibility pass added four successful checks. Before/after screenshots are in `test-results/spell-before/`, `spell-final/`, and `spell-live-final/`. Formatting and patch whitespace checks pass.

The same local 600-frame benchmark with 1,500 injected enemies ended with 341 enemies and three projectiles on each backend. WebGL2 averaged 1.183 ms simulation / 1.806 ms drawing (worst drawing 22.8 ms); Canvas2D averaged 2.755 ms / 22.126 ms (worst drawing 198.8 ms). Both reported no errors. These are CPU submission timings with GPU synchronization disabled; fallback-renderer frame spikes remain a profiling concern.

## Corrective pass: late-game effects and level-up input — 15 October 2026

The preceding visibility pass left inconsistent paths and missed a real WebGL resource bug. Atlas overflow deleted textures while the current frame still referenced them. Pages now remain valid throughout frame submission, cold excess pages retire between frames, and oversized spell textures are resampled without changing their world geometry or pivots. Halo-free orbs also use much smaller texture bounds.

Player spells now use one intensity curve for their bodies and a separate shared budget for broad decoration. Only effects intersecting the view contribute to that budget; extra family multipliers no longer repeatedly fade the same spell. Dense projectile volleys share opacity locally with a visibility floor. Frost spikes respect their upgraded size, and champion auras, shields, summons, friendly targeting markers, meteors and existing spell ripples respond to the slider. Hostile meteor-shower markers and hostile projectile cores remain readable. Targeting warnings draw above friendly effects.

Cluster mines retain pulsing runes while their trigger-radius hints stay subtle. Overlapping pools of the same type/color expose the outside boundary of their combined footprint, removing the internal ring mesh. Exact circle intersections preserve isolated pool sizes; newborn and expired pools cannot hide an active boundary. The boundary calculation merges coverage incrementally and stops when an interior rim is fully covered. A local browser CPU microbenchmark reduced the 300-pool boundary calculation from about 11.4 ms to 1.42 ms; this excludes draw submission and is not a whole-game frame-rate claim.

Space is intercepted on both keydown and keyup during level-up choices, including repeats and a held press released after another key selects an upgrade. Cards, reroll, skip and banish cannot activate from Space. Mouse, Enter and numeric choices remain available, and a fresh Space press still dashes after play resumes.

Browser coverage now includes a rendered-pixel matrix of **125 cases** (35 weapons at level 4, evolved maximum and Apotheosis/Overdrive, 12 champion abilities, eight Soul Arts), sampled during casts, travel and delayed impacts at 10%, 50% and 100%. Separate sustained level-80 fixtures cover all 35 weapons in six dense arsenals at 20-minute and Eclipse game times across all five biome palettes. These deliberately mixed builds and durable targets exercise presentation; their damage totals are not normal-run balance measurements. Screenshots and roster sheets were visually inspected in Chrome with both rendering backends.

Regression coverage also forces atlas overflow and oversized textures, checks cold-page re-upload, verifies live ripple intensity and friendly/hostile meteor separation, and exercises held-Space input around the level-up modal. Seven geometry tests cover pool union boundaries, including independent point-coverage comparisons. The broader browser review corrected two fixture assumptions: an interruption handler could accidentally click a newly opened relic, and the smoke test could randomly choose Oath of Silence before asserting that abilities still worked.

`npm run check` passes TypeScript, ESLint and **356 unit/simulation tests**. The complete production browser suite passed **54 checks**, with two expected Canvas2D skips for the WebGL-only atlas/context tests. Final shield-layer refinements then passed both renderer checks again. Production builds, formatting and patch-whitespace checks pass. Browser artifacts are in `test-results/vfx-verified-final/` and `test-results/vfx-shield-final/`.

## Limits and release work

Synthetic combat is useful for catching broken effects and non-finite state. It does not measure human win rates, build diversity, perceived fairness, or the full progression economy. No exhaustive claim is made about every combination of talents, equipment, boons, and weapon levels.

Desktop Chrome and its emulated viewport sizes are covered here. Physical touch devices/controllers, Safari/Firefox, sustained thermal behavior on low-end hardware, and subjective audio/accessibility quality still require device and player testing. Input unit tests simulate device events; they are not physical-device certification.

For a release decision, follow this review with sustained play sessions across early, mid, and endgame accounts. Record survival time, death cause, weapon contribution, resource income, and chosen/avoided upgrades by champion and difficulty. Use that evidence to tune the balance curves without erasing distinct play styles. Retain exported player saves when evaluating future schema changes.
