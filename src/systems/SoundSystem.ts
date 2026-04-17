import { Game, GameSystem } from '../core/Game';
import { CarSystem } from './CarSystem';
import { WalkSystem } from './WalkSystem';
import { EventBus, Events, CarHitEvent } from '../core/EventBus';
import { WALK_SPEED } from '../constants';

const STEP_INTERVAL_WALK = 1.4 / WALK_SPEED; // ~0.28s

const ENGINE_IDLE_FREQ = 48;   // Hz
const ENGINE_MAX_FREQ = 140;   // Hz at full speed
const ENGINE_MAX_KMH = 80;

export class SoundSystem implements GameSystem {
  readonly name = 'sound';

  private car!: CarSystem;
  private walker!: WalkSystem;
  private ctx!: AudioContext;
  private masterGain!: GainNode;
  private ready = false;

  // Engine nodes (continuous oscillators)
  private engineOsc1!: OscillatorNode;
  private engineOsc2!: OscillatorNode;
  private engineFilter!: BiquadFilterNode;
  private engineGain!: GainNode;

  // Road rumble (low-freq noise layer)
  private rumbleSource!: AudioBufferSourceNode;
  private rumbleGain!: GainNode;

  // Footstep state
  private stepTimer = 0;
  private stepBuffer!: AudioBuffer;

  private readonly onLockChange = (): void => {
    if (!this.ready) return;
    const active = document.pointerLockElement !== null;
    this.masterGain.gain.setTargetAtTime(active ? 0.5 : 0, this.ctx.currentTime, 0.05);
  };

  private readonly onHitWall = (e: CarHitEvent): void => { this.playImpact('wall', e.speed); };
  private readonly onHitPed  = (e: CarHitEvent): void => { this.playImpact('ped',  e.speed); };
  private readonly onHitObj  = (e: CarHitEvent): void => { this.playImpact('obj',  e.speed); };

  init(game: Game): void {
    this.car = game.getSystem<CarSystem>('car')!;
    this.walker = game.getSystem<WalkSystem>('player')!;
    this.ctx = new AudioContext();

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.5;
    this.masterGain.connect(this.ctx.destination);

    this.buildStepBuffer();
    this.buildEngineNodes();
    this.buildRumbleNode();
    document.addEventListener('pointerlockchange', this.onLockChange);
    EventBus.on(Events.CAR_HIT_WALL,   this.onHitWall);
    EventBus.on(Events.CAR_HIT_PED,    this.onHitPed);
    EventBus.on(Events.CAR_HIT_OBJECT, this.onHitObj);
    this.ready = true;
  }

  private buildStepBuffer(): void {
    const sr = this.ctx.sampleRate;
    const len = Math.floor(sr * 0.055);
    const buf = this.ctx.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      // Noise with fast attack, exponential decay
      const env = Math.exp(-i / (len * 0.3));
      data[i] = (Math.random() * 2 - 1) * env;
    }
    this.stepBuffer = buf;
  }

  private buildEngineNodes(): void {
    const ctx = this.ctx;

    this.engineOsc1 = ctx.createOscillator();
    this.engineOsc1.type = 'sawtooth';
    this.engineOsc1.frequency.value = ENGINE_IDLE_FREQ;

    this.engineOsc2 = ctx.createOscillator();
    this.engineOsc2.type = 'sawtooth';
    this.engineOsc2.frequency.value = ENGINE_IDLE_FREQ * 1.07; // slight detune for thickness

    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 220;
    this.engineFilter.Q.value = 1.2;

    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;

    this.engineOsc1.connect(this.engineFilter);
    this.engineOsc2.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.masterGain);

    this.engineOsc1.start();
    this.engineOsc2.start();
  }

  private buildRumbleNode(): void {
    const ctx = this.ctx;
    const sr = ctx.sampleRate;
    // 2-second looping noise buffer for road rumble
    const len = sr * 2;
    const buf = ctx.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    this.rumbleSource = ctx.createBufferSource();
    this.rumbleSource.buffer = buf;
    this.rumbleSource.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 80;

    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0;

    this.rumbleSource.connect(filter);
    filter.connect(this.rumbleGain);
    this.rumbleGain.connect(this.masterGain);
    this.rumbleSource.start();
  }

  private playImpact(type: 'wall' | 'ped' | 'obj', speed: number): void {
    if (!this.ready || this.ctx.state === 'suspended') return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const speedNorm = Math.min(speed / 22, 1); // 22 m/s = ~80 km/h max

    const sr = ctx.sampleRate;
    const dur = type === 'wall' ? 0.18 : 0.12;
    const len = Math.floor(sr * dur);
    const buf = ctx.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const env = Math.exp(-i / (len * (type === 'wall' ? 0.25 : 0.15)));
      data[i] = (Math.random() * 2 - 1) * env;
    }

    const src = ctx.createBufferSource();
    src.buffer = buf;

    const filter = ctx.createBiquadFilter();
    if (type === 'wall') {
      filter.type = 'lowpass';
      filter.frequency.value = 300 + speedNorm * 200;
      filter.Q.value = 0.8;
    } else if (type === 'ped') {
      filter.type = 'bandpass';
      filter.frequency.value = 350 + speedNorm * 150;
      filter.Q.value = 1.5;
    } else {
      filter.type = 'bandpass';
      filter.frequency.value = 500 + speedNorm * 300;
      filter.Q.value = 1.0;
    }

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.4 + speedNorm * 0.5, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    src.start(now);
  }

  private playFootstep(): void {
    const ctx = this.ctx;

    const src = ctx.createBufferSource();
    src.buffer = this.stepBuffer;

    // Bandpass at slightly randomized frequency for variation
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 450 + Math.random() * 250;
    filter.Q.value = 1.5;

    const gain = ctx.createGain();
    gain.gain.value = 0.5 + Math.random() * 0.2;

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    src.start();
  }

  update(delta: number): void {
    if (!this.ready) return;
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
      return;
    }

    const now = this.ctx.currentTime;

    // --- Footsteps ---
    if (this.walker.isWalking) {
      this.stepTimer -= delta;
      if (this.stepTimer <= 0) {
        this.playFootstep();
        // Use sprint cadence when moving fast (approximate — we don't store sprint flag)
        this.stepTimer = STEP_INTERVAL_WALK;
      }
    } else {
      this.stepTimer = 0;
    }

    // --- Car engine + road rumble ---
    if (this.car.isOccupied) {
      const kmh = this.car.getSpeedKmh();
      const t = Math.min(kmh / ENGINE_MAX_KMH, 1);

      const freq = ENGINE_IDLE_FREQ + t * (ENGINE_MAX_FREQ - ENGINE_IDLE_FREQ);
      this.engineOsc1.frequency.setTargetAtTime(freq, now, 0.08);
      this.engineOsc2.frequency.setTargetAtTime(freq * 1.07, now, 0.08);

      // Filter opens up as RPM rises
      this.engineFilter.frequency.setTargetAtTime(180 + t * 500, now, 0.08);

      // Volume: idle is quieter, rises with speed
      const engineVol = 0.35 + t * 0.3;
      this.engineGain.gain.setTargetAtTime(engineVol, now, 0.1);

      // Road rumble scales with speed
      this.rumbleGain.gain.setTargetAtTime(t * 0.18, now, 0.1);
    } else {
      this.engineGain.gain.setTargetAtTime(0, now, 0.4);
      this.rumbleGain.gain.setTargetAtTime(0, now, 0.4);
    }
  }

  dispose(): void {
    document.removeEventListener('pointerlockchange', this.onLockChange);
    EventBus.off(Events.CAR_HIT_WALL,   this.onHitWall);
    EventBus.off(Events.CAR_HIT_PED,    this.onHitPed);
    EventBus.off(Events.CAR_HIT_OBJECT, this.onHitObj);
    this.engineOsc1?.stop();
    this.engineOsc2?.stop();
    this.rumbleSource?.stop();
    this.ctx?.close();
  }
}
