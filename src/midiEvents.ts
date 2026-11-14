export type MidiNoteMessage = {
  kind: 'on' | 'off';
  channel: number;
  pitch: number;
  velocity: number;
};

/** MIDI note-on with velocity zero is a note-off by convention. */
export function parseMidiNoteMessage(data: ArrayLike<number> | null): MidiNoteMessage | null {
  if (!data || data.length < 3) return null;
  const command = data[0] & 0xf0;
  const channel = data[0] & 0x0f;
  const pitch = data[1];
  const velocity = data[2];
  if (pitch < 0 || pitch > 127 || velocity < 0 || velocity > 127) return null;
  if (command === 0x90) return { kind: velocity === 0 ? 'off' : 'on', channel, pitch, velocity };
  if (command === 0x80) return { kind: 'off', channel, pitch, velocity };
  return null;
}
