import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMidiNoteMessage } from './midiEvents.ts';

test('MIDI note-on, note-off, and velocity-zero note-on are parsed', () => {
  assert.deepEqual(parseMidiNoteMessage([0x92, 60, 90]), { kind: 'on', channel: 2, pitch: 60, velocity: 90 });
  assert.deepEqual(parseMidiNoteMessage([0x82, 60, 64]), { kind: 'off', channel: 2, pitch: 60, velocity: 64 });
  assert.deepEqual(parseMidiNoteMessage([0x92, 60, 0]), { kind: 'off', channel: 2, pitch: 60, velocity: 0 });
  assert.equal(parseMidiNoteMessage([0xb2, 60, 90]), null);
});
