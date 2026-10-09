/* SOULFORGE — story: prologue, the Chronicle (“The Long Night”), the Keeper’s narration, champion barks, boss lines, shrines, reactions, tips */

export type StoryBeat = 'runStart' | 'bossIntro' | 'bossPhase' | 'bossDown' | 'evolve' | 'eclipse' | 'lowHp' | 'revive' | 'shrine' | 'combo' | 'boon' | 'reaction' | 'elite' | 'death';
/** Who is speaking: 'keeper', a character id (kael, lyra, ...) or a boss id. */
export interface Line { who: string; text: string }

/* ---------- prologue: shown one line at a time on first launch ---------- */
export const PROLOGUE: string[] = [
  'Once, there was a morning.',
  'Then someone murdered the sun, and the Night that followed forgot how to end.',
  'It fell first on a burning city. Then on the snow, the temple, the swamp. Then on everything.',
  'Beneath the last citadel, one fire still burns. They call it the Soulforge.',
  'I tend it. I am the Keeper. I mend blades, mostly. And souls, when they come back.',
  'They always come back. Champions die out there, the fire calls them home, and I put them on the anvil.',
  'Then I send them out again. A little harder than before.',
  'Bring me gold. Bring me what you find. The fire is hungry, and so, I’m afraid, is the dark.',
  'Up you get. The Night is waiting.',
];

/* ---------- the Chronicle: “The Long Night”, told by the Keeper ---------- */
export type ChronicleUnlock =
  | { kind: 'runs'; v: number }
  | { kind: 'bossKill'; ref: string }
  | { kind: 'bosses'; v: number }
  | { kind: 'stage'; ref: string }
  | { kind: 'time'; v: number }
  | { kind: 'stageTime'; ref: string; v: number }
  | { kind: 'forge'; v: number }
  | { kind: 'chars'; v: number };
export interface ChronicleChapter { id: string; title: string; unlock: ChronicleUnlock; hint: string; text: string[] }

export const CHRONICLE: ChronicleChapter[] = [
  { id: 'last_fire', title: 'The Last Fire', unlock: { kind: 'runs', v: 1 }, hint: 'Complete your first run.', text: [
    'You died. Don’t look so surprised; everyone does, the first time. Out there in the Night, death is cheap and plentiful, like bad ale. But your soul did not scatter into the dark. It came here, the way moths come to a lamp, and landed on my anvil smelling of smoke. I caught it. I always catch them.',
    'This is the Soulforge, beneath the last citadel in the world. Above us are walls, and frightened people, and a sky with no morning in it. Down here there is a fire that has never once gone out. I am the Keeper. I tend the fire, I mend the blades, and when champions fall I hammer them back into shape and send them out again.',
    'Bring back what you find. Gold feeds the fire. Iron, dust and crystal give it something to chew on. The fire grows, and so do you. That is the arrangement. I did not say it was a kind one. I said it works.',
  ] },
  { id: 'king_ash', title: 'The King Beneath the Ash', unlock: { kind: 'bossKill', ref: 'bone_colossus' }, hint: 'Defeat the Bone Colossus.', text: [
    'He was a king once, of a country nobody names now. When the Night came he led his army out to meet it, banners up, horns blowing, and the Night ate every one of them. Then it gave the bones back to him, and the king wore them like a coat. Loyalty, it seems, outlives the loyal.',
    'He is a Herald. There are five of them, and they serve something I will not name lightly. Call it the Hollow Crown. Call it the thing that wears the dark. Nobody has seen it. You only see what it sends: kings in borrowed bones, mothers with too many children, winters that breathe.',
    'You broke him. He will rise again tomorrow night, because nothing out there stays dead for long. But for one moment the Crown felt something it is not used to feeling. I felt it too, down here, through the stone. The fire leapt. I am not sure it has ever leapt before.',
  ] },
  { id: 'frostveil', title: 'The Kingdom That Froze', unlock: { kind: 'stage', ref: 'frost' }, hint: 'Unlock Frostveil Tundra.', text: [
    'The Night spread out from the ashes like a stain through cloth. North, it found Frostveil: bright halls, warm bread, and a young queen who believed winters were something that ended. The frost came in the evening. By morning no one in the kingdom was warm, and the queen had stopped believing in endings.',
    'Isolde rules there still. Her court still bows. They will be bowing until the ice lets go of them, which is to say until the world has a sun again. She came to my forge once, frost on her eyelashes, and asked whether I could reforge a kingdom. I told her I only do one soul at a time. She said she would wait.',
    'She is still waiting. Queens are good at it. I kept her soul on the anvil longer than I needed to, that first time, just to warm it, and she pretended not to notice. Cold people are the ones who know exactly what warmth costs. She paid it without a word of complaint.',
  ] },
  { id: 'mother', title: 'The Mother of Crypts', unlock: { kind: 'bossKill', ref: 'blood_matriarch' }, hint: 'Defeat the Blood Matriarch.', text: [
    'Under every grave in the old world there is a crypt, and under every crypt, if you dig long enough, there is her. The Blood Matriarch. She spun the first web in the dark the night the sun went out, and every spider since is one of her children. She loves them. That is the horror of her. She truly loves them.',
    'Morrow buried her eldest once. Not on purpose; he took it for a large, oddly shaped man. He apologised to the grave for a month afterwards, and the grave, to its credit, never answered. When the Matriarch came looking, he met her at the cemetery gates with a spade and a short speech about property lines.',
    'You killed her. Her children will mourn the way spiders mourn, which is to say by biting. But the web is thinner tonight, and when your soul came home it brought something with it. A shard. Small, gold, warm as a hand. I put it in a drawer and did not look at it for some time.',
  ] },
  { id: 'cathedral', title: 'The Day the Morning Died', unlock: { kind: 'stage', ref: 'cathedral' }, hint: 'Unlock the Crimson Cathedral.', text: [
    'There was a temple to the Dawn on the hill above the old capital. Every morning the priests sang the sun up over the horizon, and every morning, politely, it came. Seraphine was the youngest of them. She had the worst voice in the choir and the steadiest hands, so they gave her the candles.',
    'On the last evening the sun did not set. It was pulled down. The priests watched from the bell tower: a ring of black closing round it like a fist, a sound like a great bell cracking, and then the light came apart. Pieces fell across the world. The largest fell on a city to the south, and the city burned. You know it as the Ashen Wastes. Kael knew it by another name.',
    'He walked into that fire to find his people and came out carrying a flame that was never his. Up on the hill, the priests stopped singing and something else started. The flagstones went red and have stayed red. Seraphine’s candle was the only one left lit. She carried it out while the vaults fell, and she has not put it down since.',
  ] },
  { id: 'winter', title: 'The Winter That Breathes', unlock: { kind: 'bossKill', ref: 'frost_wyrm' }, hint: 'Defeat the Frost Wyrm.', text: [
    'The Frost Wyrm is the reason Frostveil froze. It does not hate warmth; hate would be too warm. It simply eats it, the way you breathe, without thinking: hearth-fire, blood-heat, the small bright warmth of a child asleep. It ate a kingdom in a single night and lay down on the ice to digest.',
    'Isolde has hunted it ever since. She does not call it hunting. She calls it touring her provinces. When you brought it down she was very quiet, and then she asked me, formally, whether the warmth it had eaten would ever come back. I said I did not know. That was a lie. I suspected.',
    'Its heart was a lump of ice with a light inside it. When it thawed on my bench, the light was a shard. Gold. Warm. The second one. I put it in the drawer beside the first, and the two of them hummed at each other all night, like old soldiers meeting after a long war.',
  ] },
  { id: 'feeding', title: 'Feeding the Fire', unlock: { kind: 'forge', v: 5 }, hint: 'Raise the Soulforge to level 5.', text: [
    'You have been feeding the fire. Gold, mostly; the Night is full of it, since the dead don’t spend. Iron, dust, crystal. The fire takes it all and grows, and the champions it reforges come out a little harder each time. You have noticed this. You have not asked why gold should make a soul stronger. Good. Most don’t.',
    'The truth is that the fire is not burning the gold. It is remembering it. Gold was the colour of mornings, once. Iron was the colour of noon on a blade. The fire eats every scrap of old daylight you carry home, and it grows towards something. I would tell you what, if I were sure. I am nearly sure.',
    'Grom asked me why my hands never burn. I told him I have been at this a long time. He thought about it the way mountains think, slowly and all the way down, and then he said, ‘That is not an answer.’ He is right. It is not. Not yet.',
  ] },
  { id: 'blight', title: 'Rot in Bloom', unlock: { kind: 'stage', ref: 'blight' }, hint: 'Unlock the Verdant Blight.', text: [
    'Plants need light. Everyone knows that. The Verdant Blight did not get the message. When the sun died the swamp kept growing: mushrooms the size of houses, vines that glow, flowers that open only for blood. It is spring without a sun, and it is the most wrong thing I have ever seen. I have seen the Void Rift.',
    'They say the Blight is feeding on a shard of the Dawn sunk deep in the mud, and that is why it grows. I think they are right. The light is still down there, poisoned and lonely, trying to do the only thing light knows how to do. Make things live. It simply has nothing good left to work with.',
    'Talon came back from the Blight mud to the shoulders, with a Starshard clenched in his fist. He set it on the anvil and said, ‘It was warm. Felt wrong to leave it.’ That is the most words he has ever said to me at once. The shard went in the drawer. The drawer is getting warm.',
  ] },
  { id: 'rift', title: 'The Wound in the Sky', unlock: { kind: 'bossKill', ref: 'void_leviathan' }, hint: 'Defeat the Void Leviathan.', text: [
    'Far to the east the sky has a hole in it. It did not always. Before the Night there was only a cold spot among the stars that astronomers argued about. Then something pushed through from the other side, the hole tore open, and the dark poured out of it like water through a broken dam. That is the Void Rift. The Night was born there.',
    'The Leviathan is a piece of that hole given a body so it could hunt. It does not think. It does not hate. It is an absence that has learned to move. When you killed it, the Rift shrank. Not much. A finger’s width. Nyx felt it from across the world and laughed, and her passenger went very quiet.',
    'Nyx says the thing that looked back at her from the Rift is not the Crown. It is something older, and it does not like the Crown either. I would like to believe her. I have learned not to believe anything that comes out of that hole, even when it is very polite. Especially then.',
  ] },
  { id: 'general', title: 'The Hand That Held the Knife', unlock: { kind: 'bossKill', ref: 'infernal_titan' }, hint: 'Defeat the Infernal Titan.', text: [
    'Every army needs a general. The Night’s is the Infernal Titan. When the Crown closed its fist around the sun, the Titan was the one who reached into the wound and tore. It has burned ever since with fire it stole from the bleeding Dawn, and it enjoys it. It burns because it wants to.',
    'Grom found it at last. Six days on the wall, and on the seventh he went looking for whoever sent the horde. It took him a great many years. When he came home from that run he set his hammer down very gently, as if it might break, and sat by the fire without a word until morning. There is no morning. He sat anyway.',
    'The Titan’s fire did not die with it. It came home with you, all of it, in a shard as big as my fist and bright enough to hurt. The forge took it the way a starving thing takes bread. For a moment the whole room was full of gold light, and I remembered something. A horizon. A long way down.',
  ] },
  { id: 'eclipse', title: 'The Eye Opens', unlock: { kind: 'time', v: 1800 }, hint: 'Survive 30 minutes and witness the Eclipse.', text: [
    'Stay out long enough and the Night opens its eye. The Eclipse. You have seen it now: the black disc, the ring of cold fire around it, everything beneath it running mad. You thought it was a moon. It is not a moon. It is a hole where the sun used to be, and the ring of fire is all that is left of the sun’s own crown.',
    'That is the Hollow Crown. Not a king. Not a face. The shape of a murder, worn by the murderer. It looks down through that hole when it notices something it does not like, and lately it has noticed you. It sends everything it has. It is not only trying to kill you. It is trying to follow you home.',
    'It is looking for the last fire. For whatever is left of what it killed. It has been looking for a very long time, and it is getting closer. I could ask you to stop going out so far. I will not. We both know you would go anyway, and we both know why I need you to.',
  ] },
  { id: 'keeper', title: 'What the Keeper Is', unlock: { kind: 'forge', v: 10 }, hint: 'Raise the Soulforge to level 10.', text: [
    'All right. You have fed the fire long enough to earn the truth, and I have run out of ways to change the subject. When the sun came apart over the cathedral, most of it fell: shards across the world, a city full of fire. But one small piece did not fall. It ran. It hid underground where the Crown could not see, found an old forge, and pretended to be a smith.',
    'That is me. I am the last ember of the Dawn. Not its spirit, not its god; just the last warm coal of it, with a hammer and opinions. For a long time I did not know what I was. I thought I was simply very old and very good at this. Seraphine knew the moment she saw me. She said nothing. She only bowed, very low, and wept.',
    'The Starshards are not ore. They are me. Pieces of me. Every one you carry home, every soul I reforge and send back into the dark, feeds the fire a little more of the old light. I have not only been building better champions. I have been building a morning, one stubborn death at a time.',
  ] },
  { id: 'twelve', title: 'Twelve Candles', unlock: { kind: 'chars', v: 12 }, hint: 'Unlock all 12 champions.', text: [
    'There are twelve of you now. A knight with a burning oath. A girl the sky talks to. A hunter, a priestess, a killer who took it personally. A gravedigger, a queen, a wall that walks. A witch with a passenger, an inventor with forty machines, a countess nobody should trust, and a monk who caught the wind. You are not an army. You are something worse. You are stubborn.',
    'Each of you has died more times than I can count, and I can count very high. Each time you came home. Each time you went back out. The Night is endless; that is its whole argument. You have been answering it, night after night, with the one word it has no reply to. Again. Again. Again.',
    'Vesper asked me tonight what happens when the fire is bright enough. She was smiling, and she was the only one who thought to ask. I told her the truth, because she would have smelled a lie. When the morning comes back, the ember goes with it. No more Keeper. Just a sky. She stopped smiling. I did not expect that of her.',
  ] },
  { id: 'dawnbreak', title: 'Dawnbreak', unlock: { kind: 'stageTime', ref: 'void', v: 2700 }, hint: 'Survive 45 minutes in the Void Rift.', text: [
    'You stood where the Night was born, under the open eye, for forty-five minutes. Long enough for the Crown to stare at nothing but you. Long enough for it to forget to look anywhere else. And while it looked at you, down here, I opened the forge. All of it. Every shard. Every soul’s worth of heat. I let it rise.',
    'It went up through the citadel, through the walls and the frightened people, through stone and cloud. It went up in a column of gold that the Crown saw far too late. The ring of the Eclipse caught fire from the inside. And on the eastern edge of the world, for the first time in longer than anyone remembers, something pale came over the horizon.',
    'The forge is cold now. That is how you will know it worked. The hammer is on the anvil where I left it; somebody should keep it oiled. The Night is not dead. It never quite is. But now it has a morning to end against, and that will have to be enough. It was always going to cost something. I am glad it was me.',
    'If you are reading this, look up. No, not like that. Don’t stare; you’ll hurt your eyes. Just stand in it a while, the way you stood in the dark. You earned it. All twelve of you. Every stubborn death. I am the light on your face now. I always did like watching you work.',
  ] },
];

/* ---------- area title cards ---------- */
export const STAGE_CARDS: Record<string, { title: string; line: string }> = {
  ashen: { title: 'Ashen Wastes', line: 'Where the Night first fell, and the city never stopped burning.' },
  frost: { title: 'Frostveil Tundra', line: 'A kingdom froze here in one evening. Its queen still holds court.' },
  cathedral: { title: 'Crimson Cathedral', line: 'They sang the sun up here, until the sun stopped answering.' },
  blight: { title: 'Verdant Blight', line: 'Without the sun, things still grow. They just grow wrong.' },
  void: { title: 'The Void Rift', line: 'Where the Night was born. Mind your footing. It is watching.' },
};

/* ---------- the Keeper’s in-run narration ---------- */
export const KEEPER: Record<StoryBeat, string[]> = {
  runStart: [
    'Off you go, {name}. Try to come back in one piece. Two, if you must.',
    'The fire’s warm. The Night isn’t. Mind the difference.',
    'Another night, {name}. Same as the last one. Longer, if you’re any good.',
    'Bring back gold. Bring back stories. Bring back yourself, ideally.',
    'I sharpened everything. Including my expectations.',
    'Walk tall, {name}. They can smell fear. They can also smell you. Wash, sometime.',
    'Out into the dark with you. I’ll keep the anvil hot.',
    'Every step out there is one the Night didn’t want you to take. Take a great many.',
  ],
  bossIntro: [
    'That’s {boss}. One of the Crown’s Heralds. Don’t let it finish its sentence.',
    'Here comes {boss}. Big things fall the same way small things do. Just louder.',
    'The ground’s gone quiet. That means {boss}. Hold your nerve, {name}.',
    '{boss} has come to collect you. Tell it you’re not for sale.',
    'A Herald. The Night only sends those when it’s annoyed. You should be flattered.',
    '{boss}. I’ve melted down uglier. Not many.',
    'Plant your feet, {name}. {boss} doesn’t knock.',
  ],
  bossPhase: [
    'It’s angry now. Angry is sloppy. Watch for the gaps.',
    'Half dead and twice as mean. Typical.',
    '{boss} is bleeding light it stole. Keep pulling it out.',
    'There it goes. This is where they stop pretending to be clever.',
    'Don’t ease off, {name}. It certainly won’t.',
    'It’s afraid. Heralds don’t know what to do with that.',
  ],
  bossDown: [
    '{boss} is down. Somewhere in the dark, the Crown just flinched.',
    'One less Herald. Don’t tell anyone, but I’m proud of you.',
    'It had a shard in it. They always do. Bring it home, {name}.',
    'Down it goes. Mind the pieces. Some of them are still warm.',
    'Well struck. The fire just jumped. I felt it from here.',
    '{boss}, felled. I’ll put it in the ledger, between “impossible” and “done”.',
    'It’ll be back. They always come back. So do you. That’s the whole trick.',
  ],
  evolve: [
    'Now that’s forging. I couldn’t have done it better. Faster, perhaps.',
    'The weapon’s found its true shape. Most things only need a little pressure.',
    'Evolved. It’ll hum at night now. Don’t mind it.',
    'Two good things, married in the fire. I may weep. It’s the soot.',
    'That one remembers the forge. Feel how warm it runs?',
    'There. That’s what a weapon looks like when it stops being polite.',
  ],
  eclipse: [
    'The Night opens its eye. Don’t look up, {name}. Whatever you do, don’t look up.',
    'Thirty minutes. The Crown has noticed you. That was always going to happen.',
    'Eclipse. From here on, they don’t stop coming. Neither do you.',
    'It’s looking for something. It’s looking for me. Keep it busy.',
    'I’ve seen this sky once before. The day the morning died. Hold on.',
    'No more Heralds. Just everything. All of it. All at once.',
  ],
  lowHp: [
    'You’re leaking, {name}. That’s the part that’s meant to stay inside.',
    'Steady. Breathe. Move. In that order, ideally.',
    'Not yet. I haven’t finished paying for your last repairs.',
    'Find a heart, find a gap, find anything. Quickly.',
    'I can hear your soul rattling. Don’t make me come and fetch it.',
    'You’ve been worse. Not often. Move.',
    'Low on blood, high on spite. Spite will carry you a while.',
  ],
  revive: [
    'Not today. I put a little extra in you last time. Go on.',
    'Up. The fire isn’t finished with you.',
    'Death knocked. I answered. I told it you were busy.',
    'Back on your feet, {name}. That was a spare. Don’t get used to spares.',
    'Breathe. There. A second chance, freshly forged.',
    'The ember caught. Lucky for you I build things to last.',
  ],
  shrine: [
    'Old stones. Older promises. Let’s see what this one wants.',
    'The shrines were here before the Night. They remember being useful.',
    'Touch it gently. These things bite back.',
    'Someone prayed here once. The stone kept the prayer. Now it’s yours.',
    'Every gift out there has a price on it. Read the price before you pay.',
    'Take what it gives. The dead won’t miss it.',
  ],
  combo: [
    'Look at them fall. I’d applaud, but I’m holding a hammer.',
    'Keep going, {name}. You’re making the Night count on its fingers.',
    'That isn’t a fight anymore. That’s weather.',
    'Steady rhythm. Like a good hammer. Don’t lose the beat.',
    'The souls are pouring in so fast I can’t name them all.',
    'Remember this feeling. You’ll want it at minute twenty-nine.',
    'Somewhere a Herald is reading the casualty lists and going pale.',
  ],
  boon: [
    'A gift. Not from me. I don’t give gifts. I give invoices.',
    'Something out there still wishes you well. Take it before it changes its mind.',
    'Power. Use it quickly. It spoils.',
    'That’ll help. Not a lot. Enough.',
    'Blessings are rare in the dark. Don’t waste this one on bats.',
    'Feel that? The fire, leaning your way.',
  ],
  reaction: [
    'Two elements in one body. Something had to give. It did.',
    'Mix the elements and they argue. Loudly. Through the enemy.',
    'A reaction. That’s just forging, in a hurry.',
    'Good. Layer them. Nothing in the Night was built to take that.',
    'Lovely. I’ve been doing that to iron for a thousand years.',
    'The world hates being two things at once. So do they, it turns out.',
  ],
  elite: [
    'That one’s wearing a crown of its own. Small one. Knock it off.',
    'An elite. The Night’s best, or the Night’s loudest. Same thing.',
    'Big. Glowing. Proud. Kill it before it gets ideas.',
    'A champion of the horde. It has a name, probably. Don’t ask it.',
    'That one’s carrying something. Elites always have full pockets.',
    'Careful, {name}. That one’s been fed.',
  ],
  death: [
    'Here lies {name}. Felled by {killer} at {time}. The fire remembers.',
    '{time} in the dark. Not bad. Come home. I’ll put the kettle on the anvil.',
    '{killer} got you. Don’t sulk. It’ll get its turn.',
    'You died, {name}. Out there that isn’t the end. It’s just the end of the shift.',
    '{name}: lasted {time}, killed plenty, outlasted by {killer}. Not for long.',
    'Your soul came back singed. I’ve worked with worse.',
    'Every death leaves something on the anvil. Let’s see what you brought me.',
    'The Night won this one. It keeps a very short list of those.',
  ],
};

/** Extra Keeper run-start lines per stage. */
export const KEEPER_STAGE: Record<string, string[]> = {
  ashen: [
    'The Ashen Wastes. That was a city once. Kael won’t tell you its name. Don’t ask him.',
    'Embers on the wind. Some of them are older than you think.',
    'This is where the Night started. Let’s see you finish a little of it.',
  ],
  frost: [
    'Frostveil. Keep moving. The cold here is patient, and it is hungry.',
    'Isolde’s kingdom. Bow if you like. Her subjects can’t do anything else.',
    'Even the moon looks cold up there. Don’t stare back.',
  ],
  cathedral: [
    'The Crimson Cathedral. They sang to the sun here. Now something else does the singing.',
    'Blood on the flagstones. Most of it’s old. Try not to add yours.',
    'Something still prays in there. I’d rather you didn’t find out to whom.',
  ],
  blight: [
    'The Verdant Blight. If it glows, don’t eat it. If it moves, don’t let it eat you.',
    'Smell that? Rot, pretending to be spring.',
    'Things still grow without the sun. That should frighten you more than it does.',
  ],
  void: [
    'The Void Rift. The Night was born here. I’d prefer you didn’t die here.',
    'Reality’s thin out here. Step lightly. Hit hard.',
    'A hole in the world, still bleeding dark. Go and close it a little.',
  ],
};

/* ---------- champion barks ---------- */
export const CHAR_LINES: Record<string, { start: string[]; bossIntro: string[]; bossDown: string[]; lowHp: string[]; evolve: string[]; eclipse: string[]; death: string[]; revive: string[] }> = {
  kael: {
    start: ['The oath still holds. Then so do I.', 'For the Dawn. For what is left of it.', 'I have walked through fire. The dark is nothing.'],
    bossIntro: ['Herald. I swore to stand against you. I keep my oaths.', 'Come, then. Let us both burn.', 'You took my city. I have come to collect.'],
    bossDown: ['Rest. I will remember you, if no one else does.', 'One debt paid. Many remain.', 'It burns. Good. Now it knows.'],
    lowHp: ['The fire burns hotter when I bleed.', 'Not yet. The oath is not finished.', 'Pain is fuel. I have plenty.'],
    evolve: ['The blade knows its purpose now. As do I.', 'Forged twice. Like me.', 'Now it burns the way the morning did.'],
    eclipse: ['So that is your face. I expected more.', 'I watched the Dawn die. I will not look away now.', 'Let it watch. Let it see what it made.'],
    death: ['Keeper… I failed the oath again.', 'Keep… the fire…', 'Light the forge. I will return.'],
    revive: ['The fire will not let me rest.', 'Up. The oath stands.', 'Again. As many times as it takes.'],
  },
  lyra: {
    start: ['Hear that? The sky’s in a mood. Let’s give it something to do!', 'Storm’s coming. It’s me. I’m the storm.', 'Oh, it’s a good night for lightning!'],
    bossIntro: ['You’re enormous! You’ll conduct beautifully.', 'Look how tall you are. The sky loves tall things.', 'Finally, something worth the thunder!'],
    bossDown: ['Ha! Did you hear it crack? Did you hear it?', 'Down you go! The sky says goodnight.', 'Struck clean. I could kiss the clouds.'],
    lowHp: ['Ow! Rude. Very rude.', 'Still standing! Mostly! Somewhat!', 'The sky won’t let me fall. Will you, sky? …Sky?'],
    evolve: ['It’s singing! Can you hear it singing?', 'Oh, that’s new. I love new.', 'More sparks! Always more sparks!'],
    eclipse: ['The sky went quiet. The sky is never quiet.', 'I can’t hear the wind. That’s… not good.', 'Fine! I’ll make my own thunder!'],
    death: ['Huh. Quiet up here…', 'Tell the sky… I’ll be back…', 'Lightning never strikes twice… oh. Oh, it does.'],
    revive: ['Thunder doesn’t stay down!', 'Back! Missed me? Of course you did!', 'Round two! The sky’s still laughing!'],
  },
  talon: {
    start: ['Tracks everywhere. Good.', 'Hunt’s on.', 'Stay downwind. Shoot first.'],
    bossIntro: ['Big one. Bigger target.', 'There’s a seam. There always is.', 'Hawk. Eyes up.'],
    bossDown: ['Clean kill.', 'One more for the wall.', 'Hawk, mark it. We’re done here.'],
    lowHp: ['Bleeding. Keep moving.', 'Wounded animals bite hardest.', 'Not the first time. Not the last.'],
    evolve: ['Better string. Better hunt.', 'Hm. That’ll do.', 'Now we’re hunting.'],
    eclipse: ['The prey’s turned. So have I.', 'Whole forest’s waking up.', 'Every one of them’s a hunter now. Fine.'],
    death: ['Should’ve… watched my back.', 'Hawk… go home.', 'Good hunt.'],
    revive: ['Not done.', 'Back on the trail.', 'Takes more than that.'],
  },
  seraphine: {
    start: ['Light, be with us. What little of you remains.', 'I carry the morning. Let the dark watch me walk.', 'Peace to the dead. And to the living, if they let me.'],
    bossIntro: ['You are lost, poor thing. Let me show you the way to rest.', 'Herald, I forgive you. I will still unmake you.', 'Even you were born under a sun once.'],
    bossDown: ['Go gently. The light is waiting.', 'Be at peace. I will say your name in my prayers.', 'There. The dark lifts, a little.'],
    lowHp: ['My light is dimming… not yet. Please, not yet.', 'I can mend this. I must.', 'Hold, flesh. The prayer is not finished.'],
    evolve: ['Oh. It shines like an old morning.', 'A blessing, given form.', 'I felt the Dawn stir. Just for a moment.'],
    eclipse: ['That is not an eye. That is a grave where the sun should be.', 'I will not kneel to you.', 'Shine, little light. Shine harder.'],
    death: ['Keep… the candle lit…', 'I see it… the morning…', 'Forgive me. I am only tired.'],
    revive: ['The light returns. It always returns.', 'The candle did not go out.', 'Thank you, Keeper. I am not finished.'],
  },
  vex: {
    start: ['Another night, another unpaid contract.', 'Right. Who’s first? Don’t all queue at once.', 'I’ll be quick. I’m always quick.'],
    bossIntro: ['Oh good, a big one. Bigger arteries.', 'You’re the Herald? I’ve had scarier landlords.', 'Lovely. Let’s skip the speech.'],
    bossDown: ['Invoice is in the post.', 'Was that it? Was that the whole Herald?', 'Professional courtesy: you died well. Mostly.'],
    lowHp: ['That’s my blood. I was using that.', 'Oh, now I’m annoyed.', 'Fine. Bleeding. Noted.'],
    evolve: ['Sharper. Didn’t think that was possible. I was wrong. Once.', 'Ooh. Pointy.', 'Now that’s a professional’s tool.'],
    eclipse: ['The night’s staring at me. Rude.', 'Big eye. Shame I can’t reach it.', 'Fine. Overtime it is.'],
    death: ['Should have… charged more…', 'Tell the night… it owes me.', 'Ugh. Sloppy.'],
    revive: ['Death and I have an understanding. I don’t pay it.', 'Missed me.', 'Right. Where was I? Ah. Stabbing.'],
  },
  morrow: {
    start: ['Lovely night for a burial. Theirs, ideally.', 'Up you get, lads. Shift’s starting.', 'Forty years with a spade. This is just faster digging.'],
    bossIntro: ['Bit big for a standard plot. I’ll make do.', 'I’ve measured you already. Six feet won’t cover it.', 'Evening. Don’t mind the lads. They’re harmless. They’re not.'],
    bossDown: ['Down you go. I’ll fill it in later.', 'Another name for the ledger. Big letters.', 'Rest easy. Or don’t. I could use another hand.'],
    lowHp: ['Not my grave. Not yet. I haven’t dug it.', 'Bit of a draught in the ribs.', 'Lads? Lads, a little help?'],
    evolve: ['Well. That’s a new kind of shovel.', 'The dead approve. I can tell. They’ve stopped groaning.', 'Grave work deserves good tools.'],
    eclipse: ['Never seen a sky dig its own grave before.', 'That’s a lot of customers.', 'Everyone’s up tonight. Even the ones I buried properly.'],
    death: ['Bury me… shallow. I’ll be back.', 'Someone… tend the plots…', 'Ah. My turn, then.'],
    revive: ['Told you I wouldn’t stay buried.', 'Back from the plot. Mud and all.', 'Gravedigger’s privilege.'],
  },
  isolde: {
    start: ['Kneel, or be frozen. I am not particular.', 'My kingdom extends wherever I walk.', 'They call this cold. How quaint.'],
    bossIntro: ['You stand in the presence of a queen. Bow.', 'You come to my court uninvited.', 'I have frozen better things than you.'],
    bossDown: ['Shattered. As is proper.', 'Your audience is concluded.', 'Another statue for the court.'],
    lowHp: ['A queen does not bleed in public.', 'This is beneath me. Rise.', 'I endured a winter without end. I will endure you.'],
    evolve: ['Exquisite. Like hoarfrost on a crown.', 'Fit for a throne.', 'At last, an instrument worthy of me.'],
    eclipse: ['So the Night wears a crown too. There can be only one.', 'You dare to look upon me?', 'Then let us see whose winter is longer.'],
    death: ['My court… waits…', 'Even ice… breaks…', 'Remember me… as I was.'],
    revive: ['A queen does not stay fallen.', 'Winter returns. It always returns.', 'I permit myself to live.'],
  },
  grom: {
    start: ['I will stand.', 'Send them. I am here.', 'Hammer is ready. So am I.'],
    bossIntro: ['You sent the horde. I have come.', 'Big. I am bigger.', 'Stand still. I will come to you.'],
    bossDown: ['It fell.', 'Good. Next.', 'Wall still stands.'],
    lowHp: ['Cracked. Not broken.', 'Six days I stood. I stand now.', 'Stone does not fall easy.'],
    evolve: ['Heavier. Good.', 'The hammer is glad.', 'Hm. Strong.'],
    eclipse: ['Like the seventh day. I remember.', 'Let them all come. Wall is here.', 'Eye or no eye. I stand.'],
    death: ['Wall… fell…', 'Hold… the line…', 'Sorry. Too tired.'],
    revive: ['Again.', 'I am still here.', 'Mountain rises.'],
  },
  nyx: {
    start: ['It wants to see what you do. So do I.', 'Shh. The void is listening. It likes to listen.', 'We go out together. We always go out together.'],
    bossIntro: ['Oh, you are from the rift too. Hello, cousin.', 'It knows you. It says you were always rude.', 'Come closer. It wants a taste.'],
    bossDown: ['Into the dark. Say hello for us.', 'It says thank you for the meal.', 'Everything ends. You ended sooner.'],
    lowHp: ['It is getting impatient with me.', 'Not yet. The arrangement is not finished.', 'Something is pulling. Not me. Not yet.'],
    evolve: ['It likes this one. It is purring.', 'Deeper. Darker. Lovely.', 'Look. It grew teeth.'],
    eclipse: ['Oh. Oh, it is so much bigger than I thought.', 'It looks at us. It looks through us.', 'My friend is frightened. I have never seen it frightened.'],
    death: ['It… will keep me… for a while…', 'The arrangement… is concluded…', 'Dark… quiet… familiar…'],
    revive: ['It gave me back. It is not finished with me.', 'The void spat me out. I was too bitter.', 'We return. We always return.'],
  },
  rix: {
    start: ['Ooh, field test! Everyone stand back. No, further.', 'Version forty-two! Lucky number! Probably!', 'Spanner, spark, schematics… right, let’s break something.'],
    bossIntro: ['Big target! Big data! Big boom!', 'Hold still, I need your measurements. For science. And aiming.', 'Oh, you’re magnificent. I’m going to take you apart.'],
    bossDown: ['Ha! The maths works!', 'Noted: big ones explode. Very satisfying.', 'I’m keeping a bolt. Souvenir.'],
    lowHp: ['Structural integrity: questionable!', 'Ow! That’s coming out of the budget.', 'Reroute power to… me! Reroute to me!'],
    evolve: ['It’s alive! Well. It’s improved. Close enough.', 'Upgrade complete! I want to hug it. I won’t. It’s hot.', 'Beautiful. Let’s see if it explodes.'],
    eclipse: ['Okay. Okay. Never seen that before. Taking notes.', 'The sky has an eye. I have forty machines. Fair fight.', 'Overclock everything. Everything!'],
    death: ['Note… to self… more armour…', 'Prototype… failed… again…', 'Next version… will…'],
    revive: ['Rebooting! Never doubt the backup!', 'I’m back! Self-repair works! Write that down!', 'Failure is just a data point!'],
  },
  vesper: {
    start: ['Such a lovely dark. And all these guests.', 'Shall we dine, darlings?', 'The night is a banquet. I intend to have seconds.'],
    bossIntro: ['A Herald. How very formal. Do tell me you’re full-blooded.', 'You are terribly large. Do you taste of it?', 'At last, a proper course.'],
    bossDown: ['Delicious. A little gamey.', 'Thank you for having me. I had you.', 'There. Now we are both satisfied. Well. I am.'],
    lowHp: ['I am being drunk from. How dreadfully rude.', 'I need a drink. Anyone. Anyone at all.', 'Darling, I have survived worse company.'],
    evolve: ['Oh, now that is decadent.', 'Beautiful. It thirsts like I do.', 'Crimson suits it.'],
    eclipse: ['The night has an eye, and it is looking at me. Flattering.', 'More guests! I did not lay enough places.', 'An endless night. I used to dream of this. It’s rather crowded.'],
    death: ['How… gauche…', 'I was… still hungry…', 'Bring me back… thirsty…'],
    revive: ['I have died before. It never takes.', 'Back for dessert.', 'Death and I are old acquaintances. It owes me.'],
  },
  zephyr: {
    start: ['Breathe. Move. The wind asks nothing more.', 'The night is still. I am not.', 'Thirty years of stillness. Now, motion.'],
    bossIntro: ['Great weight. Great slowness. Both are useful to me.', 'You are a mountain. I am the wind across it.', 'Let us see who tires first.'],
    bossDown: ['The storm passes. The sky remains.', 'It fell as leaves fall. Simply.', 'Rest now. You were very loud.'],
    lowHp: ['Breath shortens. Mind steadies.', 'Pain is a guest. It does not stay.', 'Bend. Do not break.'],
    evolve: ['The form is complete. For now.', 'Ah. A new kind of stillness.', 'The wind has learned a new word.'],
    eclipse: ['Even the wind holds its breath.', 'I have no fear left to spend. Come.', 'The eye watches. The wind does not care.'],
    death: ['The wind… rests…', 'One last… breath…', 'Still… at last…'],
    revive: ['The wind returns. It always does.', 'Breathe in. Begin again.', 'A pause. Not an ending.'],
  },
};

/* ---------- the five Heralds ---------- */
export const BOSS_LINES: Record<string, { epithet: string; intro: string[]; phase: string[]; death: string[] }> = {
  bone_colossus: { epithet: 'The King Beneath the Ash',
    intro: ['Kneel. Your king has risen.', 'My soldiers followed me into death. You will follow them.', 'I wear ten thousand loyal men. Come, add yourself.'],
    phase: ['Rise, my legion! Rise for your king!', 'I died once. I did not care for it. I refuse!', 'The bones remember the war. So do I!'],
    death: ['My army… scatters…', 'The Crown… promised me… a kingdom…', 'At last… discharged…'] },
  blood_matriarch: { epithet: 'Mother of the Crypt',
    intro: ['You stepped on my children.', 'Hush, little ones. Mother is here.', 'So many eggs. So little time. Stay for supper.'],
    phase: ['My brood! Come to Mother!', 'You will be swaddled. You will be fed upon.', 'Every thread in this crypt is a part of me.'],
    death: ['My children… scatter… live…', 'The webs… go… quiet…', 'Mother… is… tired…'] },
  frost_wyrm: { epithet: 'The Winter That Breathes',
    intro: ['I ate a kingdom’s warmth in a single night.', 'Little ember. I will put you out.', 'Hush. Let the cold have you.'],
    phase: ['There is no spring. I ate it.', 'Your breath is warm. I will take it.', 'Freeze. Freeze! Be still forever!'],
    death: ['Thaw… no… not the thaw…', 'Warmth… I remember… warmth…', 'The cold… outlives… me…'] },
  void_leviathan: { epithet: 'The Rift Made Flesh',
    intro: ['I am the hole you fall into.', 'The Crown dreamed me. I woke hungry.', 'Come. There is room inside the dark.'],
    phase: ['Unmake. Unmake. Unmake.', 'I swallow the light. I swallow you.', 'You are already falling. You simply have not landed.'],
    death: ['The rift… closes… a little…', 'Back… into… nothing…', 'The Crown… will dream… another…'] },
  infernal_titan: { epithet: 'General of the Endless Night',
    intro: ['I put out the sun. I will put out you.', 'Every fire in the world answers to me. Except one.', 'Kneel, ember. Your morning is dead.'],
    phase: ['I burn because I choose to!', 'This fire? I tore it from the sun as it bled.', 'Where is it hiding? Where is the last ember?'],
    death: ['The fire… goes home…', 'The Crown… will find… your forge…', 'It burned… so bright… once…'] },
};

/* ---------- map shrines ---------- */
export const SHRINES: Record<string, { name: string; desc: string; lines: string[] }> = {
  blood: { name: 'Altar of Blood', desc: 'An altar slick with old offerings. Pay it in health; it pays your weapons in fury.', lines: ['Blood for steel. Fair trade, if you can spare it.', 'Don’t give it too much. Altars never say when.'] },
  fortune: { name: 'Shrine of Fortune', desc: 'A gilded idol to forgotten luck. It still pays out, to the bold and the quick.', lines: ['Gold! Bring it home. The fire likes to eat well.', 'Fortune favours the living. Stay that way.'] },
  trial: { name: 'Soul Well', desc: 'A well of restless souls. Wake them, outlast their fury, and claim what they guarded.', lines: ['You woke the Well. Now outlast it.', 'Every soul in there wants out. Show them the door.'] },
  haste: { name: 'Shrine of Quickening', desc: 'A shrine to a god of swift things. For a little while, the world moves at your pace.', lines: ['Strike while the iron’s hot. Everything’s hot. Go.', 'Quick hands, quick feet. Don’t waste it standing still.'] },
  life: { name: 'Font of Life', desc: 'A spring of clean water that should not exist in the Night. It heals, and wards the healed.', lines: ['Drink. That water remembers sunlight.', 'There. Patched and plated. Try to keep it that way.'] },
  curse: { name: 'Cursed Idol', desc: 'A grinning idol that bargains in danger: more foes, richer spoils, and a gift up front.', lines: ['You touched the idol. Of course you did.', 'More of them, more for you. The idol keeps excellent books.'] },
};

/* ---------- elemental reactions ---------- */
export const REACTIONS: Record<string, { name: string; keeper: string }> = {
  thermal: { name: 'THERMAL SHOCK', keeper: 'Burn and chill in one body. It can’t decide whether to melt or crack, so it does both. Loudly.' },
  overload: { name: 'OVERLOAD', keeper: 'Fire and lightning together. Too much heat, nowhere to go. That’s how forges lose their roofs.' },
  superconduct: { name: 'SUPERCONDUCT', keeper: 'Frost, then a spark. The cold makes it brittle; the lightning finds the cracks. Hit it while it’s glass.' },
};

/* ---------- title-screen tips & whispers ---------- */
export const TIPS: string[] = [
  'Max a weapon, hold its paired passive, then open a chest. The fire does the rest.',
  'Two or three weapons sharing an element resonate. Fire with fire, frost with frost.',
  'Burning and chilled at once: Thermal Shock. Burning and shocked: Overload.',
  'Chill plus shock leaves a target Brittle. Brittle things break. Hit them harder.',
  'Shrines glow on the map. Most of them help. The Cursed Idol helps in its own way.',
  'The Altar of Blood takes health and gives fury. Don’t kneel at it when you’re already bleeding.',
  'A Soul Well wakes a surge of the dead. Outlast it and the Well pays well.',
  'The Font of Life heals and shields. Save it for when the night gets crowded.',
  'Omens make the Night harder. Heat makes the rewards richer. Choose your poison.',
  'Gold spent at the Forge feeds the fire. A brighter fire makes stronger champions.',
  'Elites glow and carry plunder. Kill them before they ruin your plans.',
  'A Herald comes every five minutes. The fifth is the worst. Then it gets worse.',
  'At thirty minutes, the Eclipse. After that, the horde stops being a horde and becomes weather.',
  'Bone Shamans knit the dead back together. Kill the shaman first.',
  'Blight Slimes split when struck. Area damage settles the argument.',
  'Each champion has a codex. Live long enough and their story grants new power.',
  'Rerolls, skips and banishes shape a build. Spend them before you’re desperate.',
  'Bring back iron, dust and crystal. The Keeper can make almost anything out of almost anything.',
  'Never stop moving. The dead are slow, but there are a great many of them.',
  'The sun did not set. It was murdered. Some of us remember the knife.',
  'The Keeper’s hands never blister. Nobody has thought to ask why.',
  'Embers drift over the Ashen Wastes. They have been drifting for a very long time.',
  'Every soul that returns to the Forge leaves a little warmth behind.',
  'In Frostveil the queen’s court still bows. It has no choice.',
  'Something in the Crimson Cathedral is still praying. It isn’t praying to the sun.',
  'The Hollow Crown has never been seen. Only the shape it leaves in the sky.',
  'They say the Void Rift was a door. They never say who knocked.',
  'Death is not the end out there. It is the long walk home.',
  'A Starshard is warm in the hand. Warmer than any stone should be.',
  'The Night does not sleep. Neither, it seems, does the Keeper.',
  'Kael never says the name of his city. The ashes say it for him.',
];
