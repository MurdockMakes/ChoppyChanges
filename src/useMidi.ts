import { useCallback, useEffect, useRef, useState } from 'react';
import { parseMidiNoteMessage } from './midiEvents';

export interface MidiState {
  supported: boolean;
  connected: boolean;
  status: string;
  devices: string[];
  pressed: number[];
}

/** Keeps MIDI input listeners current when a device is plugged in or removed. */
export function useMidi(onNoteOn: (pitch: number, velocity: number) => void, onNoteOff: (pitch: number) => void) {
  const callbacks = useRef({ onNoteOn, onNoteOff });
  callbacks.current = { onNoteOn, onNoteOff };
  const accessRef = useRef<MIDIAccess | null>(null);
  const downRef = useRef(new Set<string>());
  const [state, setState] = useState<MidiState>(() => ({
    supported: typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator,
    connected: false,
    status: typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator
      ? 'Ready to connect a MIDI keyboard.'
      : 'Web MIDI is unavailable. Open this app in Chrome or Edge on localhost, or load the example take.',
    devices: [],
    pressed: [],
  }));

  const refreshInputs = useCallback(() => {
    const access = accessRef.current;
    if (!access) return;
    const inputs = [...access.inputs.values()].filter((input) => input.state === 'connected');
    const liveIds = new Set(inputs.map((input) => input.id));
    const isPitchDown = (pitch: number) => [...downRef.current].some((key) => Number(key.split(':')[2]) === pitch);
    for (const key of [...downRef.current]) {
      if (!liveIds.has(key.split(':')[0])) {
        downRef.current.delete(key);
        const pitch = Number(key.split(':')[2]);
        if (!isPitchDown(pitch)) callbacks.current.onNoteOff(pitch);
      }
    }
    for (const input of inputs) {
      input.onmidimessage = (message) => {
        const note = parseMidiNoteMessage(message.data);
        if (!note) return;
        const { channel, pitch, velocity } = note;
        const key = `${input.id}:${channel}:${pitch}`;
        if (note.kind === 'on') {
          const retrigger = downRef.current.has(key);
          const alreadyDown = isPitchDown(pitch);
          if (retrigger) callbacks.current.onNoteOff(pitch);
          downRef.current.add(key);
          if (!alreadyDown || retrigger) callbacks.current.onNoteOn(pitch, velocity);
        } else {
          if (downRef.current.delete(key) && !isPitchDown(pitch)) callbacks.current.onNoteOff(pitch);
        }
        setState((previous) => ({
          ...previous,
          pressed: [...new Set([...downRef.current].map((item) => Number(item.split(':')[2])))],
        }));
      };
    }
    setState((previous) => ({
      ...previous,
      connected: inputs.length > 0,
      devices: inputs.map((input) => input.name || 'Unnamed MIDI input'),
      pressed: [...new Set([...downRef.current].map((item) => Number(item.split(':')[2])))],
      status: inputs.length > 0
        ? `${inputs.length === 1 ? 'Keyboard' : 'Keyboards'} connected: ${inputs.map((input) => input.name || 'Unnamed MIDI input').join(', ')}`
        : 'MIDI access granted. Plug in a keyboard and it will appear here.',
    }));
  }, []);

  const connect = useCallback(async () => {
    if (!('requestMIDIAccess' in navigator)) {
      setState((previous) => ({ ...previous, status: 'Web MIDI is unavailable. Open this app in Chrome or Edge on localhost, or load the example take.' }));
      return;
    }
    if (accessRef.current) {
      refreshInputs();
      return;
    }
    try {
      setState((previous) => ({ ...previous, status: 'Requesting MIDI permission…' }));
      const access = await navigator.requestMIDIAccess({ sysex: false });
      accessRef.current = access;
      access.onstatechange = refreshInputs;
      refreshInputs();
    } catch {
      setState((previous) => ({ ...previous, status: 'MIDI permission was denied. Allow access in your browser, or load the example take.' }));
    }
  }, [refreshInputs]);

  useEffect(() => () => {
    const access = accessRef.current;
    if (!access) return;
    access.onstatechange = null;
    for (const input of access.inputs.values()) input.onmidimessage = null;
  }, []);

  return { ...state, connect };
}
