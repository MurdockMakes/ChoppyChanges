import assert from 'node:assert/strict';
import test from 'node:test';
import { AudioEngine } from './audio.ts';
import { DEFAULT_PROGRESSION } from './theory.ts';

type GainEvent = { kind: string; value?: number; time: number };

class FakeGainParam {
  value = 1;
  events: GainEvent[] = [];
  setValueAtTime(value: number, time: number) {
    this.value = value;
    this.events.push({ kind: 'set', value, time });
  }
  exponentialRampToValueAtTime(value: number, time: number) {
    this.value = value;
    this.events.push({ kind: 'exponential', value, time });
  }
  linearRampToValueAtTime(value: number, time: number) {
    this.value = value;
    this.events.push({ kind: 'linear', value, time });
  }
  cancelScheduledValues(time: number) {
    this.events.push({ kind: 'cancel', time });
  }
  setTargetAtTime(value: number, time: number) {
    this.value = value;
    this.events.push({ kind: 'target', value, time });
  }
}

class FakeGain {
  gain = new FakeGainParam();
  connect(destination: unknown) { return destination; }
  disconnect() {}
}

class FakeOscillator {
  frequency = { value: 0 };
  type: OscillatorType = 'sine';
  onended: (() => void) | null = null;
  starts: number[] = [];
  stops: number[] = [];
  connect(destination: unknown) { return destination; }
  disconnect() {}
  start(time: number) { this.starts.push(time); }
  stop(time?: number) { this.stops.push(time ?? 0); }
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  currentTime = 12;
  state = 'running';
  destination = {};
  oscillators: FakeOscillator[] = [];
  gains: FakeGain[] = [];
  constructor() { FakeAudioContext.instances.push(this); }
  createOscillator() {
    const oscillator = new FakeOscillator();
    this.oscillators.push(oscillator);
    return oscillator;
  }
  createGain() {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }
  async resume() { this.state = 'running'; }
}

function installAudioContext() {
  const originalWindow = globalThis.window;
  const originalAudioContext = globalThis.AudioContext;
  FakeAudioContext.instances = [];
  Object.assign(globalThis, { window: globalThis, AudioContext: FakeAudioContext });
  return () => {
    if (originalWindow === undefined) delete (globalThis as { window?: Window }).window;
    else globalThis.window = originalWindow;
    if (originalAudioContext === undefined) delete (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
    else globalThis.AudioContext = originalAudioContext;
  };
}

test('sustained note starts immediately and stops after a short release envelope', async () => {
  const restore = installAudioContext();
  try {
    const engine = new AudioEngine();
    await engine.resume();
    const context = FakeAudioContext.instances[0];
    engine.noteOn(60);
    const oscillator = context.oscillators[0];
    const gain = context.gains[0].gain;
    assert.deepEqual(oscillator.starts, [context.currentTime]);
    assert.deepEqual(oscillator.stops, []);
    assert.ok(gain.events.some((event) => event.kind === 'exponential' && event.value! > 0.01));

    const releaseEventIndex = gain.events.length;
    engine.noteOff(60);
    assert.equal(oscillator.stops.length, 1);
    assert.ok(oscillator.stops[0] > context.currentTime);
    assert.ok(oscillator.stops[0] <= context.currentTime + 0.25);
    assert.ok(gain.events.slice(releaseEventIndex).some((event) => event.time >= context.currentTime && (event.value ?? 1) <= 0.001));
  } finally {
    restore();
  }
});

test('releasing one note leaves a simultaneous voice sounding', async () => {
  const restore = installAudioContext();
  try {
    const engine = new AudioEngine();
    await engine.resume();
    const context = FakeAudioContext.instances[0];
    engine.noteOn(60);
    engine.noteOn(64);
    assert.equal(context.oscillators.length, 2);
    engine.noteOff(60);
    assert.equal(context.oscillators[0].stops.length, 1);
    assert.deepEqual(context.oscillators[1].stops, []);
    engine.noteOff(64);
    assert.equal(context.oscillators[1].stops.length, 1);
  } finally {
    restore();
  }
});

test('stopAll clears sustained voices even when a key never sends note-off', async () => {
  const restore = installAudioContext();
  try {
    const engine = new AudioEngine();
    await engine.resume();
    const context = FakeAudioContext.instances[0];
    engine.noteOn(60);
    engine.noteOn(67);
    engine.stopAll();
    assert.ok(context.oscillators.every((oscillator) => oscillator.stops.length === 1));
    engine.noteOff(60);
    assert.ok(context.oscillators.every((oscillator) => oscillator.stops.length === 1));
  } finally {
    restore();
  }
});

test('metronome, chord, and replay tones remain separate from held piano keys', async () => {
  const restore = installAudioContext();
  try {
    const engine = new AudioEngine();
    await engine.resume();
    const context = FakeAudioContext.instances[0];
    engine.noteOn(60);
    const held = context.oscillators[0];
    engine.click(true);
    engine.chordCue(DEFAULT_PROGRESSION.chords[0]);
    engine.playNote(72, 0.3);
    assert.equal(context.oscillators.length, 7);
    assert.deepEqual(held.stops, []);
    engine.stopTimed();
    assert.deepEqual(held.stops, []);
    assert.ok(context.oscillators.slice(1).every((oscillator) => oscillator.stops.length >= 1));
    engine.noteOff(60);
    assert.equal(held.stops.length, 1);
  } finally {
    restore();
  }
});
