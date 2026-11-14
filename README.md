# Changes Coach

A practice app for a single-note jazz solo over looping changes. Click a key on the **circle of fifths**, then choose a four-bar **ii–V–I** or a **12-bar blues**: I7 | I7 | I7 | I7 | IV7 | IV7 | I7 | I7 | V7 | IV7 | I7 | V7. The final V7 is the turnaround. The original C turnaround is available as a preset. Each chart loops in 4/4 at 90 BPM. The app plays a metronome and fixed chord cues, captures on-screen piano, MIDI, or monophonic sax microphone notes, shows a live note guide and piano roll, and explains specific resolutions after a take. It does not generate music or score the player's overall “jazz correctness.”

## Run

```bash
npm install
npm run dev
```

`npm run dev` starts the Vite app and the local `/api/coach` server. The app still works without a Gemini key; requesting a practice plan uses its local fallback. To enable Gemini coaching, copy `.env.example` to `.env`, replace the placeholder key, and restart `npm run dev`. The local Node server reads `.env` on startup. You can also set a server environment variable before starting the app:

```bash
export GEMINI_API_KEY='your-key-from-Google-AI-Studio'
npm run dev
```

Create the key in [Google AI Studio](https://aistudio.google.com/app/apikey). The optional `GEMINI_MODEL` defaults to `gemini-3.8-flash`. Keep the key out of `VITE_` variables, client code, and commits. `.env` is ignored by Git; `.env.example` is only a template. Exported environment variables take precedence over `.env` values.

Open the local URL printed by Vite in Chrome or Edge. Click a circle key and choose **ii–V–I** or **12-bar blues** while the transport is stopped. Takes are kept separately for each key and form during the current session; switching back restores that chart's take. Web MIDI requires a supported browser and a secure context; `localhost` works. With a keyboard plugged in, click **Connect MIDI**, then **Start MIDI take** and **Stop take**. You can also click **Load example take** to see analysis without hardware; the example follows the selected key and form. The piano roll scrolls along with longer charts.

The colored piano keys play freely with mouse or touch, including multiple notes at once. You can also Tab to a key and hold Space or Enter. Click **Start piano take** to record on-screen notes, then **Stop take** to show them in the piano roll and analyze the phrase. Piano recording needs no MIDI device or microphone.

For sax, use headphones so the metronome and chord cues do not leak into the microphone. Click **Start sax take**, allow microphone access, play one note at a time, then **Stop take**. The browser estimates concert pitch locally and turns stable pitches into notes. Use **Correct the notes** below the piano roll to adjust pitch, start beat, or length, or to add and delete notes. The example take is editable too, so the correction flow can be demonstrated without microphone permission. Analysis updates after each edit. The microphone stream stops when the take ends; raw audio is not uploaded or saved.

Click an evidence card or an arrow on the piano roll to inspect its passage. **Replay at 60% speed** plays the recorded note events with a simple Web Audio tone; **Try with piano**, **Try with MIDI**, or **Try with mic** starts a new take at 75% tempo with a short lead-in. Stop that take to see fresh evidence.

After a take, click **Make practice plan**. The app builds a symbolic summary from the recorded notes and its deterministic theory analysis. Gemini sees that summary and a reviewed exercise catalog, then chooses a priority and a few short drills; it receives no microphone audio. The app checks every returned exercise and musical reference against the actual take. An unavailable key, API error, or unsupported response produces a local practice plan. A thin or ambiguous take gets a labeled general warmup rather than a diagnosis. Plans link back to the evidence and passage replay/retry controls.

## Deploy

Build and run the Node server on a host that supports a long-running Node process:

```bash
npm ci
npm run build
GEMINI_API_KEY='your-key' npm start
```

Set `GEMINI_API_KEY` as a **server-side secret** in the host's environment; set `PORT` if the host assigns one. The Node process serves `dist/` and `/api/coach` on the same origin. A static-file-only host cannot serve the coach endpoint. The app remains usable there through the local fallback, but Gemini coaching requires the Node endpoint (or an equivalent server deployment). No raw audio is sent to the endpoint.

## Checks

```bash
npm test
npm run build
```

The focused tests cover piano press/release and simultaneous inputs, cancellation cleanup, sustained audio voices, recorded note timing, the 12 circle keys in both forms, known guide-tone and ♭9 resolutions, chord spelling, loop boundaries, the C turnaround, chromatic approaches, neutral feedback for ambiguous passages, the three MIDI note-message forms, pitch estimation on synthetic tones and noise, note segmentation through dropouts and pitch changes, and a mocked Gemini API response. Acoustic sax accuracy still needs a real instrument and microphone check in the demo room.
