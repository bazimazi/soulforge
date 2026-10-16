# Soulforge: browser review and first gameplay expansion

Reviewed on 14 October 2026. Direction: retain the survivors format; deepen combat decisions, exploration, and champion animation.

## Assessment

Soulforge has substantial content already: 12 champions, 35 weapons, five biomes, reactions, resonance, equipment, talents, the Starweb, Soul Arts, contracts, and several endgame layers. The largest quality gap is how that depth is experienced. Much of the world is decorative, progression is presented as dense lists of numbers, and the champions have similar proportions and limited acting. Adding another large stat ladder would do little to address those weaknesses.

The strongest next direction is a survivors game with a recognizable visual identity, readable combat, and meaningful destinations in every run. The work in this change establishes a playable first slice of that direction. It does not establish release quality, human-tested balance, or an AAA production standard.

## Actual browser coverage

The review used installed Chrome through Playwright against the production build. The connected browser surface was unavailable. Each screen was opened and exercised in real Chrome, with screenshots captured and inspected; the initial desktop pass produced 84 screenshots per renderer, including scrolled content. It covered fresh and progressed account states, WebGL2 and Canvas2D, desktop and emulated phone/landscape viewports.

| Screen or flow                                                             | Findings and response                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prologue and title                                                         | The progressed-account currency bar overlapped the title logo. The tall button stack offered little sense of place. Replaced it with a sanctum layout, descriptive navigation, a live champion showcase, and separate currency/header/footer regions. |
| All 12 champion details                                                    | Portraits were static, with most identity conveyed through text and colors. Added the actual animated model on a small stage with Idle, Run, and Cast preview controls. The underlying art remains procedural.                                        |
| All five stages, Torment, and Omens                                        | Stage previews were plain gradient swatches. They now show each biome's actual ground and scenery. Setup explains the new optional encounter loop before a run begins.                                                                                |
| Talents                                                                    | Branches and keystones contain useful identity, but large stat lists bury the consequential choices. Common background and contrast improved. Future work should preview each keystone's actual behavior and surface a suggested build path.          |
| Ascension: Starweb, champion ranks, weapon mastery, Soul Arts, contracts   | Strong mechanical breadth, fragmented across five tabs. Improved shared menu readability. Future work should connect the tabs through clear short-term goals and examples of the resulting play style.                                                |
| Forge: Anvil, Armory, Transmute, Sigils; equipment detail                  | Functional depth is much stronger than its presentation. Improved common surfaces and tab targets; retained established crafting and save transactions. Build comparison and equipment preview deserve a separate design pass.                        |
| Codex: story, champions, bestiary, armory, relics, lexicon, milestones     | Considerable lore and reference material, with many deliberately locked entries on a fresh account. Improved contrast. Future work should lead with discoveries, illustrated entries, and currently attainable rewards.                               |
| Settings and in-run settings                                               | Existing motion/effects/quality settings are useful. New idle/showcase animation follows reduced-motion preferences. Combat actions retain readable poses.                                                                                            |
| Gameplay, HUD, full map, and pause                                         | Endless terrain offered relatively few early movement objectives. Added optional rifts, objective progress, marked targets, map/radar markers and off-screen arrows, relic icons, and an explanation of owned relics in Pause.                        |
| Level-ups, ordinary/evolution chests, boons, death and abandonment results | Existing reward flows were exercised alongside the new relic modal. Rift rewards queue behind existing level-up/chest/boon flows. Results include completed rifts and the run's relics.                                                               |

Phone screenshots also show that several simultaneous narration/banner/HUD layers can crowd the playfield. The new rift tracker avoids duplicating its status in large announcements, and relic icons live alongside the build. A broader mobile HUD/narration redesign remains worthwhile.

## Implemented gameplay

Rifts appear from 22 seconds onward, ahead of the player's movement direction. They are optional. Stand still inside the core for 1.25 seconds to commit; the character ability key remains available for combat. Available rifts expire after 100 seconds. Successful encounters schedule the next rift after 70 seconds, and missed/failed encounters retry after 45 seconds. Each run offers at most six unique relics.

| Encounter         | Player decision                                                              | Completion and risk                                                                                                             |
| ----------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| The Last Light    | Hold ground and use dash/abilities to manage the incoming horde.             | Accumulate 18 seconds inside the sanctuary; time outside drains progress. 55-second deadline.                                   |
| Marked for Death  | Commit to fighting three tougher targets rather than farming nearby enemies. | Defeat all three marked elites in 65 seconds. Unrelated kills do not count. Marked targets remain tracked if you move far away. |
| A Trail of Embers | Plan a route and spend time channeling while enemies approach.               | Kindle three scattered beacons in 70 seconds. Incomplete channels decay when abandoned.                                         |

Encounter waves emerge around the rift at a bounded cadence. Successful encounters grant gold, one Soul Ember, Iron, and a choice of up to three unowned relics. The offered pool is authoritative: invalid IDs, repeated selections, and claims outside the reward state are rejected.

Relics support distinct builds: Thunderstep adds departure-point dash shockwaves; Heart of the Hunt heals every 20 kills; Hourglass Fang makes kills recharge dash; Astral Lens increases area and pickup range; The Unbroken Oath grants health/armor and a heal; Cinder Crown trades maximum health for Might and Growth. These powers last for the current run and reset at the next start. Rewards pass through the existing end-of-run progression system; no save migration is required.

## Implemented animation and presentation

Champions now have eight-frame idle/breath/blink cycles, twelve-frame locomotion, eight-frame attack and cast sequences, and separate dash/hurt poses. Attacks include anticipation, extension, and recovery. Arms, weapon angles, knees, cape hems, and hair move independently. Moving attacks retain a gait underneath the upper-body action. Northern movement has a cape/back-of-head view rather than only horizontal mirroring.

Locomotion advances with distance traveled, including analog input, instead of advancing at one fixed rate regardless of movement speed. Attack and ability animations use explicit simulation timestamps rather than inferring a cast from a weapon timer. Poses remain presentation-only; they do not delay attacks, movement, or invulnerability. Both backends share the same cached sprite frames. Feet now meet the character's ground sigil, and a new run clears old trails and turn state.

Champion previews use higher-resolution versions of the same procedural model and share the application's existing frame loop. Navigating away releases the preview reference; there is no independent preview timer. Menu surfaces are darker and more opaque, giving text a calmer backdrop while preserving the biome atmosphere.

## Verification

- `npm run check`: TypeScript, ESLint, and all 349 unit/simulation tests passed on the final source.
- `tests/rifts.test.ts`: deliberate commitment, ward progress/decay, marked-target accounting, beacon routing/channels, expiry, paused/dead runs, reward validation, determinism, run reset, relic combat hooks, and animation timing/gait.
- `e2e/expansion.spec.ts`: real-browser sanctum layout, animation controls, biome previews, all three encounter/relic flows, paused encounter timers, reward interruptions, pause/results reporting, narrow-phone reward layout, and every champion's six actions in front/back views in both renderers.
- Existing browser checks exercise every screen/tab at 1280×720, 390×844, 844×390, and 320×568; save transactions/imports; offline boot; WebGL recovery; all Heralds/biomes; and crowded evolved/apotheosis arsenals.

The complete production browser pass finished with **43 passing checks and one expected skip** for WebGL context recovery on Canvas2D. Final layout/animation changes received another pass across all eight screen/viewport/renderer combinations and the expansion flows. One relay fixture correctly paused on a level-up during beacon channeling; the browser test was amended to choose the upgrade and continue. The corrected relay and final roster-image checks then passed in both renderers (**four targeted checks**). Screenshots were visually inspected, including front/back action sheets, the title, reward cards, phone layouts, and every menu/tab's initial and scrolled views. Cross-canvas roster captures explicitly synchronize GPU and canvas copies so each labeled image records its own frame.

`npm run format:check` and `git diff --check` pass. Production builds, offline boot, save transactions, and context recovery were exercised by the browser suite. Test artifacts are under `test-results/`, with the final relay and action sheets in `test-results/final-pose-verify/`.

### Local rendering observations

The existing benchmark ran 600 measured frames at 1600×900 after a late-game warm-up and injection of 1,500 enemies. The horde dies during the measurement; both backends ended with 341 enemies and three projectiles. These are local CPU submission times with GPU synchronization disabled, not constant-1,500-enemy throughput or device-independent frame-rate claims.

| Backend                  | Mean simulation | Mean drawing | Worst drawing frame | Errors |
| ------------------------ | --------------- | ------------ | ------------------- | ------ |
| WebGL2                   | 1.262 ms        | 1.951 ms     | 20.6 ms             | None   |
| Canvas2D, isolated rerun | 3.141 ms        | 22.112 ms    | 103.4 ms            | None   |

WebGL2 remains the primary renderer. Canvas2D's mean drawing time alone exceeds the 16.7 ms budget for 60 fps, and its spikes remain a release concern. A separate measured fallback optimization pass is warranted. Roster frame caching and atlas memory should also be measured during long sessions that repeatedly switch champions.

## Roadmap toward a premium release

1. **Authored champion identity.** Choose an art direction and produce a finished champion/enemy/biome slice. Give champions distinct proportions, silhouettes, weapon handling, idle mannerisms, turn poses, and ability acting. The current procedural model is useful for iteration but remains visually toy-like when enlarged. Define the camera scale and animation asset budget before commissioning the full roster.
2. **World layouts with purpose.** Build biome-specific encounter sites, routes, hazards, destructible scenery, and landmarks around this rift loop. Give each biome a navigation mechanic: melting ice lanes, cathedral bells, blight patches, or unstable void bridges. Add a small number of strong authored encounter variations before adding many more weapons.
3. **Combat intent and impact.** Distinguish melee contact, projectile impact, and elemental reactions through timing, directional recoil, sound, and restrained hit effects. Introduce enemy squads whose roles interact. Ensure each new elite or boss has an understandable tell, a counterplay decision, and an identifiable death cause.
4. **Champion-specific encounters and build paths.** Let traits change how objectives are solved. Expand relic families with mechanical synergies and tradeoffs; measure whether they change routes and ability use. Show synergy/evolution intent clearly when players choose upgrades.
5. **Boss and run structure.** Create biome-specific arenas and encounter transitions, meaningful escalation between Heralds, and alternate event routes. Retain the endless mode while establishing short-term goals and memorable run peaks.
6. **Progression presentation and mobile layout.** Connect the Forge, Talents, Codex, and Ascension through concrete next goals and visual payoff. Give small screens a compact objective/narration layer that does not compete with the movement/combat area.
7. **Human balance and production testing.** Playtest fresh, midgame, and endgame saves across the roster. Measure rift participation, completion/failure, survival, relic pick rates, damage distribution, and resource income. Check real controllers/touch devices, different browsers, long sessions, audio quality, and renderer memory/performance. Automated tests establish correctness, not fun or economy balance.

The next useful milestone is a polished playable slice: one champion, one biome, three strong encounters, one memorable Herald fight, authored art/audio, and a measured ten-minute progression loop. Use that slice to set the standard for the rest of Soulforge.
