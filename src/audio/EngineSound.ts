/** Small synthesized engine + wind sound (Web Audio, no assets). */
export class EngineSound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private engineGain!: GainNode;
  private oscA!: OscillatorNode;
  private oscB!: OscillatorNode;
  private filter!: BiquadFilterNode;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private noise!: AudioBuffer;
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

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
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

  update(throttle: number, airspeed: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const rpm = 0.22 + throttle * 0.78;
    const f = 34 + rpm * 62;
    this.oscA.frequency.setTargetAtTime(f, t, 0.15);
    this.oscB.frequency.setTargetAtTime(f * 2.02, t, 0.15);
    this.filter.frequency.setTargetAtTime(300 + rpm * 900, t, 0.2);
    this.engineGain.gain.setTargetAtTime(0.035 + rpm * 0.085, t, 0.2);
    const w = Math.min(1, airspeed / 70);
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
}
