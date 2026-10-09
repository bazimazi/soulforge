# Game design

What SOULFORGE is trying to be, and how the systems added in the second and third R&D rounds serve that.
Read this before adding content: it explains which knobs exist and why they are tuned the way they are.
The code is the source of truth for numbers; this document is for intent.

## Pillars

1. **Every run is a build.** Weapons, passives, resonance and boons should combine into something that
   feels like _yours_ by minute ten. Choices must have visible consequences.
2. **Decisions while moving.** A survivors-like is mostly about positioning. New systems add things to
   _walk towards or away from_ (shrines, hazards, telegraphs) rather than more menus.
3. **The night has a voice.** The world is told through short lines at the right moment, not walls of
   text. The roguelite loop is part of the fiction.
4. **Readable chaos.** Hundreds of enemies are fine; not being able to tell what hit you isn't. Every
   threat is telegraphed, every big moment gets a beat of slow motion, and the screen tells you where
   damage came from.

## The run, minute by minute

| Time  | What changes                                                                                      |
| ----- | ------------------------------------------------------------------------------------------------- |
| 0:00  | Stage title card, the Keeper's opening line. Fodder only.                                         |
| ~0:40 | First shrine appears somewhere in the dark (an off-screen arrow points to it).                    |
| ~0:45 | First cluster of **Ember Casks** ahead of you; another every 40–55s.                              |
| 0:50  | Elites start: one affix each. Kill streaks begin to matter.                                       |
| ~2:15 | First **Gilded Hoarder** (then every 150–210s; scripted ones at 4:00 and 9:30).                   |
| 5:00  | First Herald (boss). Its chest is followed by the first **boon** choice.                          |
| 6:00  | **Grave Worms** start tunnelling in.                                                              |
| 7:00  | **Wailing Banshees** join the horde.                                                              |
| 9:00  | **Bastion Knights** march in behind their shields.                                                |
| 10:00 | Elites roll two affixes; Phasing elites can appear.                                               |
| 12:00 | **Hex Totems** rise ahead of you every 60–90s.                                                    |
| 13:00 | The first **Blood Moon** (45s).                                                                   |
| 17:00 | A **meteor shower** (14s).                                                                        |
| 21:30 | The second Blood Moon.                                                                            |
| 22:00 | Three affixes per elite.                                                                          |
| 25:00 | Events loop with escalating boss tiers; meteors, Blood Moon and the Hoarder rotate in every 4.5m. |
| 30:00 | The Eclipse: slow-motion beat, purple grade, the horde grows without end.                         |

## Run systems

All of these live in the headless simulation (`src/game/game.ts`), are deterministic, and are covered by
`tests/simulation.test.ts › run systems`.

### Elemental reactions (`data/synergy.ts`)

Weapons apply elements: fire **burns**, ice **chills/freezes**, and _any_ hit from a weapon tagged
`lightning` **shocks** for 3s. When a second element lands on an enemy carrying the first, they react:

| Reaction      | Recipe        | Effect                                                         |
| ------------- | ------------- | -------------------------------------------------------------- |
| Thermal Shock | burn + chill  | Burst of damage (+12% of max HP on non-bosses); clears the ice |
| Overload      | burn + shock  | Explosion around the target; consumes the shock                |
| Superconduct  | chill + shock | Target turns **Brittle**: +30% damage from everything for 4s   |

Reactions consume an ingredient and each enemy has a 0.8s reaction cooldown, so they read as punctuation,
not noise. Damage scales with player level, Might and the `reactDmg` stat. The first time a player ever
causes each reaction, the Keeper explains it.

_Why:_ it makes mixing weapon families a deliberate strategy and gives otherwise unrelated weapons a
reason to be picked together.

### Resonance (`data/synergy.ts`)

Carrying weapons that share a tag awakens a bonus at 2 and 3 weapons (Pyre, Rime, Tempest, Sanctum,
Arcana, Steel, Umbra, Blight, Legion). Tier 2 is a stat bonus; tier 3 is usually a _mechanic_ (burning
enemies explode, crits bleed, a once-per-run save…). Level-up cards show the resonance a new weapon would
advance, highlighted when it would awaken a tier; the HUD shows live chips.

Seven general weapons were added so every resonance is reachable from the general pool: Ball Lightning,
Frost Lance, Reaper's Crescent, Venom Spores, Radiant Judgment, Soul Lantern and Cinder Rain. Each has an
evolution paired with a passive that previously had none.

### Elite affixes (`data/enemies.ts › ELITE_AFFIXES`)

Elites roll 1–3 affixes (by minute) that change how they fight: Swift, Warded (regrowing barrier),
Vampiric, Frenzied, Molten (burning trail), Brood (splits), Colossal, Arcane (bolt rings), Necrotic
(raises the dead), Phasing (telegraphed blink). Their name is prefixed in-world ("Molten Swift Grave
Brute"), each affix draws a coloured orbit, and each affix adds materials to the drop.

### Boss phases and attacks

At half health a Herald **enrages**: slow-motion beat, shockwave, faster attacks, and its `phase2`
attacks join the rotation. New attack types: **barrage** (telegraphed impacts raining around the player,
the first one at where you are walking), **cross** (rotating four-way streams) and **hazard** (lingering
pools that hurt, and for the Frost Wyrm slow you).

### Shrines (`data/shrines.ts`)

Every ~55–80s a shrine appears 600–900px away (max two unused at once). Stand inside to channel it
(1.6s; leaving bleeds the charge). Each is a bargain: Altar of Blood (25% HP → a weapon level), Shrine of
Fortune (chest + gold), Soul Well (survive a 25s surge → chest, embers, dust), Quickening (30s haste),
Font of Life (heal + shield), Cursed Idol (+20% curse for the run, a free level).

_Why:_ shrines give the map a reason to be explored and create risk/reward decisions that are made by
walking.

### Kill streaks (`data/synergy.ts › COMBO_TIERS`)

Kills within 2.5s of each other build a streak; tiers (Frenzy 25 → Apocalypse 1200) grant +3% Might and
+5% Growth each. Taking HP damage cuts the streak by a quarter, so dodging is rewarded. The best streak
is recorded per run and lifetime.

### Boons (`data/boons.ts`)

After a Herald's chest, choose one of three run-long boons (18 in total). They are deliberately
_mechanical_ rather than stat sticks: Chain Reaction, Time Dilation, Prismatic Strikes (random elements
→ reactions for any build), Abyssal Gaze, Phoenix Feather, Volatile Arsenal… A few are pure trade-offs
(Glass Cannon, Bulwark). Boons are recorded in the codex.

## Narrative

The fiction explains the loop: the sun ("the Dawn") was murdered; the **Soulforge** beneath the last
citadel reforges fallen champions; the **Keeper** who tends it narrates. Gold and materials brought back
"feed the fire". The slow-burn mystery (the Keeper is the Dawn's last ember; Starshards are pieces of the
sun) pays off in the final chapter, _Dawnbreak_.

- `data/story.ts` holds all text: prologue, 14 Chronicle chapters, stage title cards, the Keeper's lines
  per story beat, each champion's voice, boss epithets and lines, shrine and reaction lines, title tips.
- The simulation only emits `story` beats (`runStart`, `bossIntro`, `bossPhase`, `bossDown`, `evolve`,
  `eclipse`, `lowHp`, `revive`, `shrine`, `combo`, `boon`, `reaction`, `elite`, `death`, `bloodMoon`,
  `meteors`, `hoarder`).
  `ui/narrator.ts` chooses the line, speaker and timing: high-priority beats queue, low-priority ones are
  dropped when the narrator is busy and spaced at least 12s apart.
- **The Long Night** (Codex) reveals Chronicle chapters as world progress is made (first run, each
  Herald's first kill, stage unlocks, Forge levels, the Eclipse, all champions). New chapters announce
  themselves on the title screen.
- Death ends with the Keeper's epitaph and what killed you.

## Third R&D round — new threats and the living map

The second round gave the run _systems_. This one gives the map _things_: enemies that each ask a
different movement question, objects worth walking towards, and events that change the rules for a
while. Every one of them is something to walk towards or away from (pillar 2), and every threat is
telegraphed or readable from its silhouette (pillar 4). Tuning lives in `data/enemies.ts` (the defs and
the `BLOOD_MOON`, `METEOR_SHOWER`, `CASK`, `HOARDER`, `TOTEM` tables); behaviour lives in `game/game.ts`.
All of it is deterministic and covered by `tests/simulation.test.ts › third round`.

### New enemies

| Enemy               | Question it asks                         | How it works                                                                                                                                                                                    |
| ------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Gilded Hoarder**  | _Do you leave the safe spot?_            | Appears just off-screen on its own timer (first ~2:00–2:30, then every 150–210s, max two). Never fights; zig-zags away. Escapes after 20s. Caught: chest + a fountain of gold, gems, materials. |
| **Grave Worm**      | _Are you watching the ground?_           | Tunnels toward you untargetable, stops ~90px away, telegraphs an 80px eruption for 0.8s, erupts (hurts you, throws the horde clear), fights for 3.5s, burrows again.                            |
| **Bastion Knight**  | _Can you get around it?_                 | Slow and tanky; its tower shield turns to face you (4 rad/s). Real weapon hits from the front 120° deal 25%, from the rear 120° 125%. Ticks, reactions and executes ignore the shield.          |
| **Wailing Banshee** | _Are you standing in the obvious place?_ | Hovers ~210px out. Every ~5s it locks a 70°, 280px cone at where you stood, winds up 0.9s, then screams: 2.2× its contact damage and a 1.6s slow.                                               |
| **Hex Totem**       | _What do you kill first?_                | From 12:00 every 60–90s, 300–500px ahead of you (max three). Stationary, harmless, tough. Enemies within 220px move 35% faster and take 25% less damage.                                        |

- The **Hoarder** is the reward for leaving a good position. It runs at 87% of the base champion speed
  (143, so even Grom keeps pace), but its zig-zag costs it ground, every hit staggers it for 0.3s, and it
  tires while chased (−3% speed per second, down to 65%). A committed chase catches it in roughly 6–16
  seconds for every champion; ignoring it costs you the hoard. It creeps back to the edge of sight when you
  stop chasing, so the off-screen arrow always has something to point at. Its sack is heavy (mass 6), so
  your own knockback doesn't carry it away. Blood Moon and totems never speed it up.
- The **Grave Worm** punishes standing still: the telegraph gives a full 0.8s to step out of an 80px ring,
  which a champion clears comfortably. While buried it is out of the spatial grid, so nothing can target
  or hit it — damage-over-time already on it keeps ticking.
- The **Bastion Knight** turns the horde's front line into terrain. The shield is judged from the hit's
  push direction, so projectiles from you strike the front; area blasts behind it, boomerangs, orbitals,
  summons and Ember Casks are how you get the back. Its facing turns fast but not instantly, so circling
  it works too.
- The **Banshee's** cone is locked when the windup starts, so a single sidestep beats it; she exists to
  break the habit of kiting in a straight line.
- The **Totem** is a priority-target puzzle: it hides in the direction you are travelling, and the horde
  around it becomes the thing you least want to walk into. It does not empower bosses, Hoarders, other
  totems or casks.

### Ember Casks (the living map)

Clusters of 3–5 explosive barrels appear 350–650px ahead of you every 40–55s (at most fifteen on the
map). They are `Enemy` entities flagged `object`, so every weapon can set them off through
`damageEnemy` — but they are never _chosen_: auto-aim, `WH.targets`, chain lightning, allies, homing and
mines all ignore them. Any hit breaks one. The blast (120px) deals `(60 × enemy-HP scaling × tier + 5 ×
level) × Might` — enough to one-shot fodder at the current minute — burns, sets the ground alight for
2.5s, and chain-detonates casks within 140px 0.15s later. Bosses lose at most 3% of max health per blast.

Casks are a pure reward for luring: they never hurt you, never count as kills, streak hits or bestiary
entries, give no loot, XP or lifesteal, trigger no character hooks or on-hit effects, and are ignored by
bombs, the Phoenix and revival blasts. They don't count toward the horde size the spawner maintains, and
ones left more than ~2× the view behind simply crumble.

### Boss attacks

- **Sweep** (Frost Wyrm and Void Leviathan, phase two): the Herald locks onto you and telegraphs a beam
  for 0.9s, then a 520×44px beam rotates 130° over 1.6s, biting for 60% of its contact damage every 0.25s
  you stay in it. Step off the line, then move against the rotation or out of reach.
- **Rings** (Bone Colossus and Infernal Titan, phase two): three rings of bolts 0.45s apart, each missing
  three adjacent bolts. The lane rotates between rings, so you weave from gap to gap rather than finding
  one safe spot.

### Run events

- **Blood Moon** (13:00, 21:30, and in the late loop): for 45s enemies move 20% faster and drop 60% more
  XP. `game.bloodMoon` holds the seconds left for the presentation (red grade, sky). It is a risk dial: the
  horde is more dangerous exactly while it is most rewarding.
- **Meteor shower** (17:00, and in the late loop): for 14s a meteor falls every 0.35s somewhere within
  450px of you, each telegraphed for a second. Impacts (70px) hit enemies as hard as an Ember Cask, bosses
  for at most 2%, and you for a moderate 16× the enemy damage scale; they also set off casks.
- **Hoarder** events at 4:00 and 9:30 guarantee the first chases even on unlucky timers.
- After 25:00 the loop keeps its boss-every-third-cycle structure; each ring cycle also brings one of
  meteors → Blood Moon → Hoarder in rotation, and Bastion Knights join the ring pool.

### Feel

- **Loot pops.** Drops from kills, braziers and shrines burst outward at 60–160px/s
  (the Hoarder's fountain at up to 240px/s) and decay within a fraction of a second, so a pile of kills
  reads as a spray rather than a stack. The magnet takes over the moment it grabs a pickup, and the
  700-pickup gem merge is unchanged.
- **Hit-stop.** Catching the Hoarder gets the same short slow-motion beat and zoom punch as an elite kill;
  no other global slow motion was added.

## Feel and presentation

- **Time warp.** The simulation requests slow motion through `fx.timeWarp(scale, seconds)` (boss intro
  zoom-out, enrage, boss death, elite kill hit-stop, revive, the Eclipse, death). `FixedLoop` runs fewer
  fixed steps per real second — the steps themselves never change, so determinism holds.
- **Camera.** Leads the direction of travel, with spring-loaded zoom punches, and eases out while a Herald
  is on the field so the arena and its telegraphs fit on screen.
- **Readability.** Damage-direction crescent at the screen edge; telegraphs for every boss AoE and blink
  (circles fill towards impact and their rims beat faster; charge lanes carry racing chevrons); hazards fade
  in harmlessly before they arm; elites carry name tags drawn above the lighting. Hits squash enemies and
  wash them pale for a heartbeat instead of turning crowds into white blobs, damage numbers landing on the
  same spot merge into one climbing total, and the champion stands on a sigil in their colour with a soft
  halo, so they are findable in any horde. Hoarders and Hex Totems get off-screen arrows.
- **Light.** The night is a coloured light map (see ARCHITECTURE.md): the champion carries a lantern
  tinted per stage, and fireballs, frost, lightning, explosions, shrines, braziers, candelabras, lava
  fissures and every monster's eyes cast light of their own colour. Where lights pile up the scene glows
  rather than clipping.
- **Animation.** Every enemy has a six-frame locomotion loop (wings beat, legs march, slimes squash,
  tentacles writhe), leans into its stride, stretches under knockback and lunges when it bites. Champions
  have a seven-frame walk with breathing at rest, pivot through a quick turn instead of mirror-snapping,
  and flash a cast pose when their signature weapon fires. Heralds descend in a column of light.
- **Death.** The fallen topple away from the killing blow and burn out through a glowing dissolve;
  bodies burst into debris that arcs, bounces and skids to rest; souls stream into the champion (a
  torrent from elites and Heralds). A Herald's death is a chain of eruptions across its body, then one
  last blast and shockwave. Opened chests stay a moment, lid up, light pouring out.
- **The world.** Props and creatures cast silhouette shadows; props are y-sorted with everything else and
  turn translucent when the champion walks behind them. Per-chunk ground details (ash drifts, roots,
  puddles, runestones), rare breathing ritual circles, emissive fissures and toxic pools, and cloud shadows
  sliding over the ground replace the old repeating tile.
- **Post-processing (WebGL2).** Bloom, per-stage split toning, shockwave refraction rings (explosions,
  slams, level-ups, Herald deaths), a low-health red wash with a quickening heartbeat, an Eclipse purple
  wash, a Blood Moon crimson grade, chromatic aberration on hits and while a boss is enraged, and film
  grain. Settings → _Bloom & colour grading_ turns it off; _Render quality: Low_ drops silhouette shadows
  for fodder.
- **Weather.** Per-stage ambient motes: rising embers, driving snow, falling ash, spores, void drift.
- **Audio.** Reactions, shrines, streak tiers and narration have their own cues; the music gains war
  drums and a brighter filter as bosses and hordes raise the intensity, and bell notes drift over the pad.

## Tuning notes

- Reaction damage is level-based plus a slice of max HP on Thermal Shock so it stays relevant against
  quadratic enemy HP; bosses never take the HP-based part.
- Resonance tiers at 2/3 (not 2/4) because six weapon slots must also hold the signature weapon.
- Kill-streak bonuses are intentionally small: in the late game the streak never breaks, and it must not
  become the dominant scaling source.
- Shrine spawn distance (600–900px) is just beyond the view on a 1080p screen, so the arrow is always
  needed and walking to one is a real decision.
- Casks and totems spawn _ahead_ of your travel direction (deterministically, from the seeded RNG) so the
  map responds to how you move: a long kite runs you into barrels, and into totems.
- Environmental damage (casks, meteors) scales with the same HP curve as the horde, so it stays a
  one-shot on fodder at any minute; the boss cap keeps it from replacing a build against Heralds.
- The new enemies' per-entity state (`buried`, `face`, `scream`, `hexed`, `escapeT`, …) is declared in
  every enemy's object literal, and the hot loops branch on entity fields rather than `e.def.*`: enemy
  objects keep one hidden class and those loops stay monomorphic. Keep it that way when adding more.
