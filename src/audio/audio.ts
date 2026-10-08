/* SOULFORGE — procedural WebAudio sound engine (no asset files) */

interface ToneOpts {
  /** Exponential pitch / cutoff glide target reached at the end of the sound. */
  slide?: number;
  attack?: number;
  /** Filter type for noise bursts. */
  type?: BiquadFilterType;
  /** Filter cutoff for noise bursts. */
  freq?: number;
}
type SfxFn = (t: number, p?: number) => void;

/** Max concurrently sounding SFX voices (oscillators + noise sources). New sounds are dropped at the cap. */
const MAX_VOICES = 24;
/** Length of the shared white-noise buffer; noise bursts play random slices of it. */
const NOISE_SECONDS = 2;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let sfxGain: GainNode | null = null;
let musicGain: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let enabled = true;
let sfxVol = 0.6;
let musicVol = 0.35;
let voices = 0;
const last: Record<string, number> = {};
let musicOn = false;
let musicNodes: AudioNode[] = [];
let musicTimer: ReturnType<typeof setTimeout> | undefined;

function voiceEnded(): void {
  voices = Math.max(0, voices - 1);
}

function osc(type: OscillatorType, freq: number, t0: number, dur: number, vol: number, dest?: AudioNode | null, opts: ToneOpts = {}): void {
  const c = ctx!;
  const o = c.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (opts.slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, opts.slide), t0 + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + (opts.attack || 0.005));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(dest || sfxGain!);
  voices++; o.onended = voiceEnded;
  o.start(t0); o.stop(t0 + dur + 0.02);
}

function noise(t0: number, dur: number, vol: number, dest?: AudioNode | null, opts: ToneOpts = {}): void {
  const c = ctx!, buf = noiseBuf!;
  const src = c.createBufferSource(); src.buffer = buf;
  const f = c.createBiquadFilter(); f.type = opts.type || 'lowpass';
  f.frequency.setValueAtTime(opts.freq || 1200, t0);
  if (opts.slide) f.frequency.exponentialRampToValueAtTime(opts.slide, t0 + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f); f.connect(g); g.connect(dest || sfxGain!);
  voices++; src.onended = voiceEnded;
  // play a random slice of the shared buffer (loop covers bursts longer than the buffer)
  const len = dur + 0.02;
  if (len >= buf.duration) src.loop = true;
  src.start(t0, Math.random() * Math.max(0, buf.duration - len));
  src.stop(t0 + len);
}

const SFX: Record<string, SfxFn> = {
  shoot: (t) => { osc('triangle', 720, t, 0.08, 0.12, null, { slide: 300 }); },
  zap: (t) => { osc('sawtooth', 1400, t, 0.12, 0.1, null, { slide: 200 }); noise(t, 0.08, 0.08, null, { type: 'highpass', freq: 2500 }); },
  fire: (t) => { noise(t, 0.25, 0.14, null, { freq: 900, slide: 200 }); osc('sine', 180, t, 0.2, 0.1, null, { slide: 60 }); },
  slash: (t) => { noise(t, 0.12, 0.16, null, { type: 'bandpass', freq: 1800, slide: 600 }); },
  hit: (t) => { osc('square', 220, t, 0.05, 0.07, null, { slide: 90 }); noise(t, 0.04, 0.06, null, { freq: 3000 }); },
  kill: (t) => { noise(t, 0.16, 0.12, null, { freq: 1500, slide: 200 }); osc('sine', 300, t, 0.14, 0.08, null, { slide: 80 }); },
  crit: (t) => { osc('square', 900, t, 0.08, 0.1, null, { slide: 1800 }); noise(t, 0.08, 0.1, null, { type: 'highpass', freq: 3000 }); },
  explode: (t) => { noise(t, 0.5, 0.35, null, { freq: 700, slide: 60 }); osc('sine', 90, t, 0.45, 0.35, null, { slide: 30 }); },
  gem: (t, p = 0) => { osc('sine', 880 * Math.pow(1.05946, p), t, 0.09, 0.09); osc('sine', 1320 * Math.pow(1.05946, p), t + 0.03, 0.09, 0.05); },
  gold: (t) => { osc('triangle', 1760, t, 0.08, 0.08); osc('triangle', 2200, t + 0.05, 0.1, 0.06); },
  heal: (t) => { osc('sine', 520, t, 0.25, 0.1, null, { slide: 1040, attack: 0.05 }); osc('sine', 780, t + 0.08, 0.25, 0.08, null, { slide: 1560 }); },
  hurt: (t) => { osc('sawtooth', 200, t, 0.18, 0.18, null, { slide: 60 }); noise(t, 0.15, 0.2, null, { freq: 600 }); },
  levelup: (t) => { [523, 659, 784, 1046].forEach((f, i) => osc('triangle', f, t + i * 0.08, 0.35, 0.12)); noise(t, 0.3, 0.05, null, { type: 'highpass', freq: 4000 }); },
  chest: (t) => { [392, 523, 659, 784, 1046, 1318].forEach((f, i) => osc('sine', f, t + i * 0.07, 0.4, 0.1)); },
  evolve: (t) => { [261, 329, 392, 523, 659, 784, 1046, 1568].forEach((f, i) => { osc('triangle', f, t + i * 0.09, 0.6, 0.12); osc('sine', f * 2, t + i * 0.09, 0.5, 0.05); }); noise(t, 0.8, 0.1, null, { type: 'highpass', freq: 3000, slide: 8000 }); },
  dash: (t) => { noise(t, 0.2, 0.18, null, { type: 'bandpass', freq: 600, slide: 3000 }); },
  freeze: (t) => { osc('sine', 1800, t, 0.4, 0.1, null, { slide: 3600 }); noise(t, 0.4, 0.12, null, { type: 'highpass', freq: 5000 }); },
  thunder: (t) => { noise(t, 0.7, 0.4, null, { freq: 400, slide: 80 }); osc('sawtooth', 60, t, 0.4, 0.25, null, { slide: 30 }); },
  boss: (t) => { osc('sawtooth', 70, t, 1.2, 0.3, null, { slide: 40, attack: 0.2 }); osc('square', 35, t, 1.2, 0.2, null, { slide: 25, attack: 0.2 }); noise(t, 1.0, 0.15, null, { freq: 300 }); },
  ui: (t) => { osc('sine', 660, t, 0.06, 0.06); },
  uiback: (t) => { osc('sine', 440, t, 0.08, 0.06); },
  buy: (t) => { osc('triangle', 880, t, 0.1, 0.08); osc('triangle', 1320, t + 0.06, 0.15, 0.08); osc('triangle', 1760, t + 0.12, 0.2, 0.06); },
  forge: (t) => { osc('square', 300, t, 0.08, 0.12, null, { slide: 150 }); noise(t, 0.2, 0.2, null, { type: 'highpass', freq: 3000, slide: 800 }); osc('sine', 1200, t + 0.02, 0.4, 0.08, null, { slide: 2400 }); },
  death: (t) => { osc('sawtooth', 300, t, 1.5, 0.25, null, { slide: 30, attack: 0.05 }); noise(t, 1.2, 0.2, null, { freq: 800, slide: 80 }); },
  revive: (t) => { [220, 330, 440, 660, 880, 1320].forEach((f, i) => osc('sine', f, t + i * 0.1, 0.8, 0.12)); },
  active: (t) => { osc('sawtooth', 200, t, 0.3, 0.15, null, { slide: 900 }); noise(t, 0.3, 0.12, null, { type: 'bandpass', freq: 1200, slide: 4000 }); },
  nova: (t) => { noise(t, 0.6, 0.25, null, { freq: 2000, slide: 100 }); osc('sine', 500, t, 0.5, 0.15, null, { slide: 50 }); },
  summon: (t) => { osc('triangle', 150, t, 0.4, 0.12, null, { slide: 450 }); noise(t, 0.3, 0.08, null, { freq: 1000 }); },
  pickup: (t) => { osc('sine', 1046, t, 0.12, 0.1, null, { slide: 2093 }); },
};

/** Rare, meaningful sounds (UI, progression, bosses) that are never dropped by the voice cap. */
const PRIORITY = new Set(['ui', 'uiback', 'buy', 'forge', 'levelup', 'chest', 'evolve', 'boss', 'death', 'revive']);

const THROTTLE: Record<string, number> = { hit: 0.04, kill: 0.05, gem: 0.03, shoot: 0.06, zap: 0.06, slash: 0.08, fire: 0.1, explode: 0.08, crit: 0.08, gold: 0.05, hurt: 0.15 };

export const audio = {
  /** Create the AudioContext (call from a user gesture). Safe to call repeatedly. */
  init(): void {
    if (ctx) return;
    try {
      const Ctx: typeof AudioContext = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const c = (ctx = new Ctx());
      master = c.createGain(); master.gain.value = 1; master.connect(c.destination);
      sfxGain = c.createGain(); sfxGain.gain.value = sfxVol; sfxGain.connect(master);
      musicGain = c.createGain(); musicGain.gain.value = musicVol; musicGain.connect(master);
      // reverb-ish delay for sfx richness
      const delay = c.createDelay(); delay.delayTime.value = 0.11;
      const fb = c.createGain(); fb.gain.value = 0.18;
      const wet = c.createGain(); wet.gain.value = 0.25;
      sfxGain.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(wet); wet.connect(master);
      // one shared white-noise buffer; every noise burst plays a random slice of it
      const len = Math.floor(c.sampleRate * NOISE_SECONDS);
      noiseBuf = c.createBuffer(1, len, c.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch {
      enabled = false;
    }
  },
  resume(): void {
    if (ctx && ctx.state === 'suspended') void ctx.resume();
  },
  setSfx(v: number): void {
    sfxVol = v;
    if (sfxGain) sfxGain.gain.value = v;
  },
  setMusic(v: number): void {
    musicVol = v;
    if (musicGain) musicGain.gain.value = v;
  },

  /** Play a named sound effect. Cheap no-op before init, when muted or while the context is suspended. */
  play(name: string, p?: number): void {
    if (!enabled || !ctx || sfxVol <= 0 || ctx.state !== 'running') return;
    if (voices >= MAX_VOICES && !PRIORITY.has(name)) return;
    const fn = SFX[name];
    if (!fn) return;
    const now = ctx.currentTime;
    const thr = THROTTLE[name] || 0;
    const prev = last[name];
    if (thr && prev && now - prev < thr) return;
    last[name] = now;
    try { fn(now, p); } catch { /* ignore */ }
  },

  /* ---- generative ambient music: slow dark pad + pulse ---- */
  startMusic(): void {
    if (!ctx || !musicGain || musicOn) return;
    musicOn = true;
    const c = ctx, out = musicGain;
    const root = 55; // A1
    const chords = [[0, 3, 7, 10], [0, 3, 7, 12], [-2, 2, 5, 10], [-4, 0, 3, 7]];
    const nodes: AudioNode[] = [];
    // pad oscillators (detuned saws through lowpass)
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320; lp.Q.value = 2;
    const lfo = c.createOscillator(); lfo.frequency.value = 0.07;
    const lfoG = c.createGain(); lfoG.gain.value = 160; lfo.connect(lfoG); lfoG.connect(lp.frequency); lfo.start();
    lp.connect(out);
    const padOsc: [OscillatorNode, OscillatorNode][] = [];
    for (let i = 0; i < 4; i++) {
      const o1 = c.createOscillator(); o1.type = 'sawtooth';
      const o2 = c.createOscillator(); o2.type = 'sawtooth'; o2.detune.value = 8;
      const g = c.createGain(); g.gain.value = 0.045;
      o1.connect(g); o2.connect(g); g.connect(lp);
      o1.start(); o2.start();
      padOsc.push([o1, o2]);
      nodes.push(o1, o2, g);
    }
    // sub pulse
    const sub = c.createOscillator(); sub.type = 'sine'; sub.frequency.value = root;
    const subG = c.createGain(); subG.gain.value = 0; sub.connect(subG); subG.connect(out); sub.start();
    nodes.push(sub, subG, lp, lfo, lfoG);
    musicNodes = nodes;
    let step = 0;
    const schedule = (): void => {
      if (!musicOn) return;
      const t = c.currentTime + 0.05;
      const chord = chords[step % chords.length]!;
      padOsc.forEach(([o1, o2], i) => {
        const f = root * 2 * Math.pow(2, chord[i]! / 12);
        o1.frequency.setTargetAtTime(f, t, 0.8);
        o2.frequency.setTargetAtTime(f * 1.003, t, 0.8);
      });
      // heartbeat-like sub pulses
      for (let b = 0; b < 8; b++) {
        const bt = t + b * 1.0;
        subG.gain.setValueAtTime(0.0001, bt);
        subG.gain.exponentialRampToValueAtTime(0.25, bt + 0.05);
        subG.gain.exponentialRampToValueAtTime(0.0001, bt + 0.5);
      }
      step++;
      musicTimer = setTimeout(schedule, 8000);
    };
    schedule();
  },
  stopMusic(): void {
    musicOn = false;
    clearTimeout(musicTimer);
    for (const n of musicNodes) {
      try {
        if ('stop' in n) (n as AudioScheduledSourceNode).stop();
        n.disconnect();
      } catch { /* already stopped */ }
    }
    musicNodes = [];
  },
};
