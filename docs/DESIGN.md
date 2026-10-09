# Game design

What SOULFORGE is trying to be, and how the systems added in the second R&D round serve that. Read this
before adding content: it explains which knobs exist and why they are tuned the way they are. The code
is the source of truth for numbers; this document is for intent.

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

| Time  | What changes                                                                   |
| ----- | ------------------------------------------------------------------------------ |
| 0:00  | Stage title card, the Keeper's opening line. Fodder only.                      |
| ~0:40 | First shrine appears somewhere in the dark (an off-screen arrow points to it). |
| 0:50  | Elites start: one affix each. Kill streaks begin to matter.                    |
| 5:00  | First Herald (boss). Its chest is followed by the first **boon** choice.       |
| 10:00 | Elites roll two affixes; Phasing elites can appear.                            |
| 22:00 | Three affixes per elite.                                                       |
| 25:00 | Events loop with escalating boss tiers.                                        |
| 30:00 | The Eclipse: slow-motion beat, purple grade, the horde grows without end.      |

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
  `eclipse`, `lowHp`, `revive`, `shrine`, `combo`, `boon`, `reaction`, `elite`, `death`).
  `ui/narrator.ts` chooses the line, speaker and timing: high-priority beats queue, low-priority ones are
  dropped when the narrator is busy and spaced at least 12s apart.
- **The Long Night** (Codex) reveals Chronicle chapters as world progress is made (first run, each
  Herald's first kill, stage unlocks, Forge levels, the Eclipse, all champions). New chapters announce
  themselves on the title screen.
- Death ends with the Keeper's epitaph and what killed you.

## Feel and presentation

- **Time warp.** The simulation requests slow motion through `fx.timeWarp(scale, seconds)` (boss intro
  zoom-out, enrage, boss death, elite kill hit-stop, revive, the Eclipse, death). `FixedLoop` runs fewer
  fixed steps per real second — the steps themselves never change, so determinism holds.
- **Camera.** Leads the direction of travel, with spring-loaded zoom punches.
- **Readability.** Damage-direction crescent at the screen edge; telegraphs for every boss AoE and blink;
  hazards fade in harmlessly before they arm; elites carry name tags drawn above the lighting.
- **Art.** World sprites are baked at 2× with a dark outline; champions have a three-pose walk cycle,
  lean into movement, leave afterimages when dashing and kick up dust; enemies rise out of a rune circle
  when they spawn and leave a soul wisp and a splat when they die; explosions scorch the ground.
- **Post-processing (WebGL2).** Bloom, colour grading, a low-health red wash, an Eclipse purple wash,
  chromatic aberration on hits and while a boss is enraged, and film grain. Settings → _Bloom & colour
  grading_ turns it off.
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
