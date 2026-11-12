/**
 * All sound is made in code with the Web Audio API: no audio files.
 *
 *   ambience: wind (filtered noise, slow gusts), birdsong (FM chirps), lapping
 *             water near the lake (louder as you approach)
 *   music:    a gentle generative piece in D major pentatonic: soft pad chords
 *             through I-vi-IV-V, with sparse plucked notes and a lazy echo
 *   effects:  footsteps (grass or path), UI taps, dialogue blips, quest chime,
 *             coins, a grumble
 *
 * Browsers only allow sound after a user gesture, so nothing plays until unlock().
 */
export interface Volumes {
  music: number;
  sfx: number;
}

const D_PENTA = [293.66, 329.63, 369.99, 440.0, 493.88]; // D E F# A B
const CHORDS = [
  [146.83, 220.0, 293.66, 369.99], // D
  [123.47, 246.94, 293.66, 369.99], // Bm
  [98.0, 196.0, 293.66, 392.0], // G
  [110.0, 220.0, 277.18, 329.63], // A
];

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private ambBus!: GainNode;
  private reverb!: ConvolverNode;
  /** One shared echo for all plucked notes (a new feedback loop per note would pile up forever). */
  private echo!: DelayNode;
  private noise!: AudioBuffer;
  private waterGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private volumes: Volumes = { music: 0.6, sfx: 0.8 };
  private timers: number[] = [];
  private chord = 0;
  private lastBlip = 0;
  private started = false;
  private analyser: AnalyserNode | null = null;

  /** Output loudness right now: RMS and peak of the last ~40 ms (for checks and debugging). */
  level() {
    if (!this.analyser) return { rms: 0, peak: 0, hiss: 0 };
    const d = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(d);
    let sum = 0;
    let peak = 0;
    for (const v of d) {
      sum += v * v;
      peak = Math.max(peak, Math.abs(v));
    }
    // Share of energy above 2.5 kHz: a rough measure of hiss.
    const bins = new Float32Array(this.analyser.frequencyBinCount);
    this.analyser.getFloatFrequencyData(bins);
    const hz = this.ctx!.sampleRate / 2 / bins.length;
    let hi = 0;
    let all = 0;
    bins.forEach((db, i) => {
      const e = Math.pow(10, db / 10);
      all += e;
      if (i * hz > 2500) hi += e;
    });
    return { rms: Math.sqrt(sum / d.length), peak, hiss: all > 0 ? hi / all : 0 };
  }

  /** 'locked' until a user gesture, then the audio context's state. */
  get state(): string {
    return this.ctx ? this.ctx.state : 'locked';
  }

  get unlocked() {
    return this.started;
  }

  /** Call from a user gesture. Safe to call repeatedly. */
  unlock() {
    if (this.started) {
      if (this.ctx?.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    this.started = true;
    const ctx = new Ctx();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.gain.linearRampToValueAtTime(1.6, ctx.currentTime + 2.5); // fade in
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    comp.connect(this.analyser);
    this.musicBus = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.ambBus = ctx.createGain();
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(1.8);
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    this.reverb.connect(wet).connect(this.master);
    for (const bus of [this.musicBus, this.sfxBus, this.ambBus]) bus.connect(this.master);
    this.musicBus.connect(this.reverb);
    this.echo = ctx.createDelay(1);
    this.echo.delayTime.value = 0.42;
    const fb = ctx.createGain();
    fb.gain.value = 0.3;
    const echoTone = ctx.createBiquadFilter();
    echoTone.type = 'lowpass';
    echoTone.frequency.value = 2500; // each repeat a little softer and darker
    this.echo.connect(echoTone).connect(fb).connect(this.echo);
    fb.connect(this.musicBus);
    this.ambBus.connect(this.reverb);
    this.noise = this.noiseBuffer(4);
    this.setVolumes(this.volumes);
    this.startWind();
    this.startWater();
    this.scheduleBirds();
    this.startMusic();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) void ctx.suspend();
      else void ctx.resume();
    });
  }

  setVolumes(v: Volumes) {
    this.volumes = v;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.musicBus.gain.setTargetAtTime(v.music * 0.55, t, 0.1);
    this.sfxBus.gain.setTargetAtTime(v.sfx, t, 0.1);
    this.ambBus.gain.setTargetAtTime(v.sfx * 0.8, t, 0.1);
  }

  /** How close the listener is to the lake shore: 0 (far) to 1 (at the water). */
  setNearWater(k: number) {
    if (!this.ctx) return;
    this.waterGain.gain.setTargetAtTime(0.02 + 0.32 * k * k, this.ctx.currentTime, 0.4);
  }

  // ---------------------------------------------------------------- building blocks

  private noiseBuffer(seconds: number) {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const d = buf.getChannelData(0);
    // Pink-ish noise (Paul Kellet's filter): softer than white noise.
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
    }
    return buf;
  }

  private impulse(seconds: number) {
    const ctx = this.ctx!;
    const len = ctx.sampleRate * seconds;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    return buf;
  }

  private loopNoise() {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.loopStart = Math.random();
    src.start();
    return src;
  }

  private lfo(freq: number, depth: number, target: AudioParam) {
    const o = this.ctx!.createOscillator();
    o.frequency.value = freq;
    const g = this.ctx!.createGain();
    g.gain.value = depth;
    o.connect(g).connect(target);
    o.start();
  }

  private later(fn: () => void, seconds: number) {
    this.timers.push(window.setTimeout(fn, seconds * 1000));
  }

  // ---------------------------------------------------------------- ambience

  private startWind() {
    const ctx = this.ctx!;
    // Two gentle lowpass stages keep it a soft rush, never a hiss.
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 280;
    this.windFilter.Q.value = 0.4;
    const soften = ctx.createBiquadFilter();
    soften.type = 'lowpass';
    soften.frequency.value = 600;
    soften.Q.value = 0.3;
    const g = ctx.createGain();
    g.gain.value = 0.1;
    this.loopNoise().connect(this.windFilter).connect(soften).connect(g).connect(this.ambBus);
    // Gusts: the filter opens a little and the level swells slowly, at two unrelated rates.
    this.lfo(0.07, 110, this.windFilter.frequency);
    this.lfo(0.031, 60, this.windFilter.frequency);
    this.lfo(0.05, 0.045, g.gain);
  }

  private startWater() {
    const ctx = this.ctx!;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 420;
    f.Q.value = 0.5;
    const lap = ctx.createGain();
    lap.gain.value = 0.5;
    this.lfo(0.42, 0.4, lap.gain); // gentle lapping rhythm
    this.lfo(0.17, 90, f.frequency);
    this.waterGain = ctx.createGain();
    this.waterGain.gain.value = 0.02;
    this.loopNoise().connect(f).connect(lap).connect(this.waterGain).connect(this.ambBus);
    this.scheduleDrops();
  }

  /** Little water plips, only audible near the lake (they go through the water level). */
  private scheduleDrops() {
    this.later(() => {
      const ctx = this.ctx!;
      const t = ctx.currentTime;
      const o = ctx.createOscillator();
      o.type = 'sine';
      const f0 = 700 + Math.random() * 600;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f0 * 1.8, t + 0.06);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.5, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
      o.connect(g).connect(this.waterGain);
      o.start(t);
      o.stop(t + 0.12);
      this.scheduleDrops();
    }, 0.4 + Math.random() * 1.6);
  }

  private scheduleBirds() {
    this.later(() => {
      this.birdPhrase();
      this.scheduleBirds();
    }, 2.5 + Math.random() * 6);
  }

  private birdPhrase() {
    const ctx = this.ctx!;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    const out = ctx.createGain();
    out.gain.value = 0.05 + Math.random() * 0.05;
    out.connect(pan).connect(this.ambBus);
    const notes = 2 + Math.floor(Math.random() * 4);
    const base = 2200 + Math.random() * 1600;
    let t = ctx.currentTime + 0.05;
    for (let i = 0; i < notes; i++) {
      const dur = 0.06 + Math.random() * 0.1;
      const o = ctx.createOscillator();
      o.type = 'sine';
      const f0 = base * (0.9 + Math.random() * 0.3);
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f0 * (1.2 + Math.random() * 0.5), t + dur * 0.6);
      o.frequency.exponentialRampToValueAtTime(f0 * 0.85, t + dur);
      // A little FM warble.
      const m = ctx.createOscillator();
      m.frequency.value = 30 + Math.random() * 40;
      const mg = ctx.createGain();
      mg.gain.value = f0 * 0.04;
      m.connect(mg).connect(o.frequency);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(1, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g).connect(out);
      o.start(t);
      m.start(t);
      o.stop(t + dur + 0.02);
      m.stop(t + dur + 0.02);
      t += dur + 0.03 + Math.random() * 0.08;
    }
  }

  // ---------------------------------------------------------------- music

  private startMusic() {
    this.later(() => this.musicBar(), 1.5);
  }

  private musicBar() {
    const ctx = this.ctx!;
    const bar = 6.4; // seconds per chord
    const t = ctx.currentTime + 0.05;
    const chord = CHORDS[this.chord % CHORDS.length];
    this.chord++;
    // Pad: soft detuned triangles through a gentle lowpass, slow swell in and out.
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1100;
    const pad = ctx.createGain();
    pad.gain.setValueAtTime(0, t);
    pad.gain.linearRampToValueAtTime(0.07, t + 1.8);
    pad.gain.setValueAtTime(0.07, t + bar - 1.2);
    pad.gain.linearRampToValueAtTime(0, t + bar + 1.4);
    lp.connect(pad).connect(this.musicBus);
    for (const f of chord) {
      for (const det of [-5, 5]) {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = f;
        o.detune.value = det;
        o.connect(lp);
        o.start(t);
        o.stop(t + bar + 1.5);
      }
    }
    // Plucks: a few pentatonic notes at loose, unhurried times, with an echo.
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const when = t + 0.4 + Math.random() * (bar - 1);
      const f = D_PENTA[Math.floor(Math.random() * D_PENTA.length)] * (Math.random() < 0.3 ? 2 : 1);
      this.pluck(f, when, 0.09);
    }
    this.later(() => this.musicBar(), bar);
  }

  private pluck(freq: number, when: number, level: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = freq * 2.01; // a bell-like overtone
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(level, when + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0005, when + 2.2);
    const g2 = ctx.createGain();
    g2.gain.value = 0.25;
    o.connect(g);
    o2.connect(g2).connect(g);
    g.connect(this.musicBus);
    g.connect(this.echo);
    o.start(when);
    o2.start(when);
    o.stop(when + 2.4);
    o2.stop(when + 2.4);
  }

  // ---------------------------------------------------------------- effects

  private tone(freq: number, dur: number, level: number, type: OscillatorType = 'sine', when = 0, slideTo?: number) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    o.connect(g).connect(this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** A soft footstep: a short noise thump; brighter and crunchier on the path. */
  step(onPath: boolean, strength = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = onPath ? 'bandpass' : 'lowpass';
    f.frequency.value = (onPath ? 1000 : 420) * (0.85 + Math.random() * 0.3);
    f.Q.value = onPath ? 1.2 : 0.7;
    const g = ctx.createGain();
    const level = (onPath ? 0.32 : 0.22) * strength;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t + (onPath ? 0.09 : 0.13));
    src.connect(f).connect(g).connect(this.sfxBus);
    src.start(t, Math.random() * 3, 0.2);
  }

  tap() {
    this.tone(880, 0.07, 0.08, 'triangle');
  }

  /** Dialogue typing blip, rate-limited, pitched per speaker. */
  blip(pitch = 1) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.lastBlip < 0.055) return;
    this.lastBlip = now;
    this.tone(520 * pitch * (0.96 + Math.random() * 0.08), 0.045, 0.035, 'triangle');
  }

  open() {
    this.tone(523, 0.18, 0.06, 'sine');
    this.tone(784, 0.25, 0.05, 'sine', 0.06);
  }

  /** A rising pentatonic arpeggio: new quest, quest complete. */
  chime() {
    [587.33, 739.99, 880, 1174.66].forEach((f, i) => this.tone(f, 1.2, 0.07, 'sine', i * 0.11));
  }

  coin() {
    this.tone(1318, 0.12, 0.07, 'square', 0);
    this.tone(1760, 0.35, 0.06, 'square', 0.07);
  }

  grumble() {
    this.tone(200, 0.32, 0.06, 'sawtooth', 0, 120);
  }

  /** The result of a market morning: bright if it balanced, a soft fall if not. */
  result(good: boolean) {
    if (good) [587.33, 880, 1174.66].forEach((f, i) => this.tone(f, 0.8, 0.07, 'sine', i * 0.09));
    else [440, 369.99].forEach((f, i) => this.tone(f, 0.5, 0.06, 'triangle', i * 0.14));
  }
}
