# SOULFORGE: Endless Night

A browser survivors-style game (Vampire Survivors lineage) with a heavy meta-progression layer. No build step, no dependencies — open `index.html` in Chrome/Edge/Firefox.

## Controls

| Key | Action |
| --- | --- |
| WASD / Arrows / left-stick | Move |
| Space / E / Shift / gamepad A | Character active ability |
| 1–4 | Pick a level-up card |
| Esc / P | Pause |

Touch: left side of the screen is a virtual stick, right side taps the ability.

## The run

- Enemies scale steeply with time (HP quadratic in minutes, exponential after 30:00 — *the Eclipse*). Elites every ~75s drop chests, a boss every 5 minutes, scripted swarms and encirclements in between. After 25 minutes the events loop with escalating boss tiers, forever.
- Level up to choose weapons (max 6, 8 levels each) and passives (max 6, 5 levels). A max-level weapon + its paired passive evolves when you open a chest.
- Each character starts with a **signature weapon** nobody else can use, a **trait** (permanent mechanic), an **active ability** on Space, and a **resource** where relevant (Static, Souls, Flow, Blood…).

## Characters (12)

Kael the Ember Knight · Lyra the Stormcaller · Talon the Beast Hunter · Seraphine the Dawn Oracle · Vex the Shadow Blade · Morrow the Grave Warden · Isolde the Frost Queen · Grom the Iron Bulwark · Nyx the Void Witch · Rix the Clockwork Tinkerer · Vesper the Blood Countess · Zephyr the Wind Monk.

Nine of them are unlocked through milestones (survive X minutes, kill totals, boss kills, evolve a weapon, character level 10…).

## Meta progression

- **Character XP & levels** — every run feeds the character; each level grants a talent point (no cap).
- **Talents** — per-character tree with 3 flavoured branches × 4 tiers + a keystone that changes a mechanic (e.g. Kael's *Wildfire*, Vex's *Lethality*, Nyx's *Null Field*). Tier gating by points in that branch; free respec. **Paragon** ranks are endless.
- **Codex → Chronicles** — 5 lore chapters per character; chapters II/IV are *Awakenings* (new mechanics: second dash charge, drone swarm, death marks…), chapter V is an *Ascension*.
- **Codex → Bestiary / Armory / Relics / Milestones** — kill tiers grant global Might, weapon mastery grants permanent weapon damage, milestones pay gold and Soul Embers.
- **Forge**
  - *Anvil*: 38 permanent stat upgrades in 4 tiers; the Mastery tier has infinite ranks.
  - *Armory*: craft gear for 6 slots with 6 rarities; affixes roll from slot pools; Legendary/Mythic carry one of 16 unique powers; upgrade (+8%/level, up to +30), reforge single affixes, salvage, catalysts to guarantee rarity. The Forge itself levels with gold spent, unlocking rarities and features.
  - *Transmute*: convert between Iron → Arcane Dust → Void Crystal → Starshard (and back).
  - *Sigils*: 22 run modifiers bought with Soul Embers (extra level-up choice, +1 weapon slot, timed free levels…).
- **Stages** — 5 biomes with their own palettes, props and difficulty/reward multipliers, unlocked by surviving long enough in the previous one.
- **Omens** — 9 optional difficulty pacts (Heat). Each Heat point is +8% gold, XP and materials.

## Code layout

```
index.html
css/style.css
js/util.js          math, RNG, spatial hash
js/audio.js         procedural WebAudio SFX + ambient music
js/sprites.js       all art is generated at load (characters, enemies, icons, ground, props)
js/data/            passives/stages/omens, weapons, characters, enemies, forge, codex
js/save.js          localStorage save + meta-stat aggregation + all shop transactions
js/game.js          simulation
js/render.js        camera, light map, additive FX pass, particles
js/ui.js            menus, HUD, modals
js/main.js          input + loop
```

Save data lives in `localStorage` (`soulforge_save_v1`); Settings has export/import codes.
