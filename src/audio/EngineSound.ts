import type { Propulsion } from '../sim/aircraft/AircraftConfig';

/**
 * Small synthesized engine + wind sound (Web Audio, no assets).
 * Piston: a buzzy firing-rate tone. Turboprop: propeller drone plus turbine whine.
 * Jet: broadband roar with a fan whine that climbs with thrust.
 */
export class EngineSound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private engineGain!: GainNode;
  private oscA!: OscillatorNode;
  private oscB!: OscillatorNode;
  private filter!: BiquadFilterNode;
  private whine!: OscillatorNode;
  private whineGain!: GainNode;
  private roarFilter!: BiquadFilterNode;
  private roarGain!: GainNode;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private noise!: AudioBuffer;
  private rainGain!: GainNode;
  private profile: Propulsion = 'piston';
  muted = false;

  /** Must be called from a user gesture. */
  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.6;
    this.master.connect(ctx.destination);

    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 500;
    this.filter.Q.value = 2;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0.05;
    this.filter.connect(this.engineGain).connect(this.master);
    this.oscA = ctx.createOscillator();
    this.oscA.type = 'sawtooth';
    this.oscB = ctx.createOscillator();
    this.oscB.type = 'square';
    const bGain = ctx.createGain();
    bGain.gain.value = 0.35;
    this.oscA.connect(this.filter);
    this.oscB.connect(bGain).connect(this.filter);
    this.oscA.start();
    this.oscB.start();

    this.whine = ctx.createOscillator();
    this.whine.type = 'sine';
    this.whineGain = ctx.createGain();
    this.whineGain.gain.value = 0;
    this.whine.connect(this.whineGain).connect(this.master);
    this.whine.start();

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    const roarSrc = ctx.createBufferSource();
    roarSrc.buffer = this.noise;
    roarSrc.loop = true;
    this.roarFilter = ctx.createBiquadFilter();
    this.roarFilter.type = 'lowpass';
    this.roarFilter.frequency.value = 400;
    this.roarFilter.Q.value = 0.7;
    this.roarGain = ctx.createGain();
    this.roarGain.gain.value = 0;
    roarSrc.connect(this.roarFilter).connect(this.roarGain).connect(this.master);
    roarSrc.start(0, 1.3);

    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 700;
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    src.connect(this.windFilter).connect(this.windGain).connect(this.master);
    src.start();

    const rainSrc = ctx.createBufferSource();
    rainSrc.buffer = this.noise;
    rainSrc.loop = true;
    const rainFilter = ctx.createBiquadFilter();
    rainFilter.type = 'highpass';
    rainFilter.frequency.value = 2500;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    rainSrc.connect(rainFilter).connect(this.rainGain).connect(this.master);
    rainSrc.start(0, 0.7);
  }

  /** Which engine voice to synthesize. */
  setProfile(p: Propulsion): void {
    this.profile = p;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.6, this.ctx.currentTime, 0.05);
  }

  /** Silences the engine (e.g. paused / menu) without destroying the graph. */
  suspend(): void {
    void this.ctx?.suspend();
  }

  resume(): void {
    void this.ctx?.resume();
  }

  /**
   * @param engine 0 = off, 0..1 while starting, 1 = running
   */
  update(throttle: number, airspeed: number, engine = 1, rain = 0): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const on = engine > 0;
    if (this.profile === 'piston') {
      const rpm = engine < 1 ? engine * 0.18 : 0.22 + throttle * 0.78;
      const f = 34 + rpm * 62;
      this.oscA.frequency.setTargetAtTime(f, t, 0.15);
      this.oscB.frequency.setTargetAtTime(f * 2.02, t, 0.15);
      this.filter.frequency.setTargetAtTime(300 + rpm * 900, t, 0.2);
      this.engineGain.gain.setTargetAtTime(on ? 0.035 + rpm * 0.085 : 0, t, 0.2);
      this.whineGain.gain.setTargetAtTime(0, t, 0.2);
      this.roarGain.gain.setTargetAtTime(0, t, 0.2);
    } else if (this.profile === 'turboprop') {
      // Gas generator spools up during the start; the propeller beat follows torque.
      const n = engine < 1 ? engine * 0.55 : 0.6 + throttle * 0.4;
      const blade = 48 + throttle * 26;
      this.oscA.frequency.setTargetAtTime(blade, t, 0.25);
      this.oscB.frequency.setTargetAtTime(blade * 2.01, t, 0.25);
      this.filter.frequency.setTargetAtTime(220 + throttle * 700, t, 0.3);
      this.engineGain.gain.setTargetAtTime(engine >= 1 ? 0.03 + throttle * 0.07 : 0, t, 0.4);
      this.whine.frequency.setTargetAtTime(1500 + n * 1900, t, 0.4);
      this.whineGain.gain.setTargetAtTime(on ? 0.006 + n * 0.012 : 0, t, 0.4);
      this.roarFilter.frequency.setTargetAtTime(500 + throttle * 900, t, 0.3);
      this.roarGain.gain.setTargetAtTime(on ? 0.01 + throttle * 0.03 : 0, t, 0.4);
    } else {
      const n1 = engine < 1 ? engine * 0.25 : 0.25 + throttle * 0.75;
      this.oscA.frequency.setTargetAtTime(28 + n1 * 30, t, 0.5);
      this.oscB.frequency.setTargetAtTime(56 + n1 * 60, t, 0.5);
      this.filter.frequency.setTargetAtTime(160 + n1 * 200, t, 0.5);
      this.engineGain.gain.setTargetAtTime(on ? 0.012 + n1 * 0.03 : 0, t, 0.6);
      this.whine.frequency.setTargetAtTime(900 + n1 * 2600, t, 0.6);
      this.whineGain.gain.setTargetAtTime(on ? 0.004 + n1 * 0.01 : 0, t, 0.6);
      this.roarFilter.frequency.setTargetAtTime(250 + n1 * 1400, t, 0.6);
      this.roarGain.gain.setTargetAtTime(on ? 0.015 + n1 * n1 * 0.16 : 0, t, 0.6);
    }
    this.rainGain.gain.setTargetAtTime(rain * 0.09, t, 0.5);
    const w = Math.min(1, airspeed / (this.profile === 'jet' ? 120 : this.profile === 'turboprop' ? 95 : 70));
    this.windGain.gain.setTargetAtTime(w * w * 0.12, t, 0.3);
    this.windFilter.frequency.setTargetAtTime(500 + w * 900, t, 0.3);
  }

  /** Tyre chirp / thump on touchdown, intensity 0..1. */
  touchdown(intensity: number): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1400 - intensity * 900;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.15 + intensity * 0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25 + intensity * 0.3);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 0.7);
  }

  /** Rolling thunder after `delay` seconds, intensity 0..1. */
  thunder(delay: number, intensity: number): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 160 + intensity * 120;
    const g = ctx.createGain();
    const t = ctx.currentTime + delay;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25 + intensity * 0.55, t + 0.12);
    g.gain.exponentialRampToValueAtTime(0.001, t + 2.6 + intensity * 1.5);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 4.5);
  }
}
