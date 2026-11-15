# Resolve Labs

[Open Resolve Labs](https://resolvelabs.study/)

Resolve Labs is a practice app for a single-note jazz solo over looping changes. Click a key on the **circle of fifths**, then choose a four-bar **ii–V–I** or a **12-bar blues**: I7 | I7 | I7 | I7 | IV7 | IV7 | I7 | I7 | V7 | IV7 | I7 | V7. The final V7 is the turnaround. The original C turnaround is available as a preset. Charts play in 4/4 at 90 BPM. The app plays a metronome and fixed chord cues, captures on-screen piano, MIDI, or monophonic sax microphone notes, shows a live note guide and piano roll, and explains specific resolutions after a take. It does not generate music or score the player's overall “jazz correctness.”

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

Set **Changes passes** to 1–16 before starting playback or a new piano, MIDI, or sax take. One pass covers every bar of the selected ii–V–I, 12-bar blues, or turnaround; the default is one pass. The app shows the count-in beats and current pass, then stops at the end of the final bar and finishes the take automatically. Four audible clicks precede the first pass and are excluded from recorded notes and microphone audio. **Stop** and **Stop take** also work during the count-in. While the transport runs, the circle selector becomes a large reference for the current chord's root, third, fifth, seventh, and optional tensions in the selected sax key. Stop playback to select another key or form.

The colored piano keys play freely with mouse or touch, including multiple notes at once. Select **Activate computer keys** to play and hold notes from a computer keyboard; each piano key shows its assigned physical key. Most white notes use the home row, the three highest use `,` `.` `/`, and sharps use the row above. The mapping works only while activated and leaves text and form controls alone. You can also Tab to a piano key and hold Space or Enter. Click **Start piano take** to record on-screen notes. The take finishes after the selected passes, or you can use **Stop take** early; the piano roll and analysis then update. Piano recording needs no MIDI device or microphone.

For sax, use headphones so the metronome and chord cues do not leak into the microphone. Choose **Concert**, **Alto E♭**, or **Tenor B♭** in the saxophone key control. The circle selects a concert key; the chart and chord labels show written sax pitch. The live display shows both the heard concert note and its written sax equivalent, while the transcription and analysis remain in concert pitch. Click **Start sax take**, allow microphone access, and play one note at a time. The take and microphone audio finish after the selected passes, or you can use **Stop take** early. A longer analysis window and short pitch smoothing reduce low-note and one-frame errors, but room noise, accompaniment bleed, and attacks can still confuse transcription. Use **Correct the notes** below the piano roll to adjust pitch, start beat, or length, or to add and delete notes. Analysis updates after each edit.

Microphone takes keep their original audio in browser memory for replay, including full-take and passage replay. Use the **Sound** selector to switch between original audio and a synthesized preview of the editable note events. Original audio keeps the performance as played; correcting notes does not alter that recording. The microphone stream stops when the take ends, and no audio is uploaded. Clearing or replacing an unsaved take discards its recording.

For demo takes, record a sax phrase, stop, optionally correct its transcription, give it a name in **Take bank**, and click **Save current take**. Save each performance as a separate entry. The bank keeps the chord progression, sax key, note edits, and original microphone audio when available. **Load** restores a saved take for replay, even after a page reload. Takes are stored with IndexedDB for the same site address in this browser on this device. Record them on the site address you will use for the demo; they do not sync to another browser or survive clearing site data. **Delete** removes a bank entry. Nothing from the take bank is uploaded.

Use **Export** beside a saved take, or **Export all takes**, to download a portable `.resolve-labs-takes.json` file. Previously exported `.changes-takes.json` files remain importable. Version 1 contains each take's name, source, sax key, full progression snapshot, edited note events, note-edit history, save time, and original microphone audio when present. **Import take file** validates the file and locally decodes included audio before adding any entries. Imported takes receive new take and note IDs, so importing the same file twice creates separate entries and never replaces an existing take. A damaged file, an unsupported version or progression, and invalid note or audio data show an error. Files are limited to 256 MB, with at most 4,096 notes and 1,024 beats per take. The file stays on this device until you explicitly share it; import and export do not contact the server. Load an imported take to replay it and recalculate feedback from its notes and local audio.

**Solo feedback** shows separate measures for chord-change landings, time to resolve named tensions, rhythmic variety, space between phrases, and motif development. Sax takes also show intonation and articulation observations only when their original local recording passes the stated audio quality checks. Each card gives its sample size, calculation, confidence threshold, and clickable note or bar evidence. Sparse or noisy takes show limited evidence or unavailable measures. Intonation compares the audio with the editable equal-tempered transcription; articulation describes onset-level contrast and does not identify tonguing technique. There is no overall solo grade.

Click an evidence card or an arrow on the piano roll to inspect its passage. **Replay at 60% speed** plays the original recording for a sax take when available; other takes use a simple Web Audio tone. **Try with piano**, **Try with MIDI**, or **Try with mic** starts a new take at 75% tempo with a short lead-in to the target passage, aligned to a bar line. It finishes after the selected passes, or you can stop early to see fresh evidence.

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

The focused tests cover piano press/release and simultaneous inputs, computer-key activation and mapping, editor input shielding, key repeat and cleanup, sustained audio voices, recorded note timing, the 12 circle keys in both forms, pass limits for every form, count-in transition and final bar timing, sax written-pitch transposition and live chord-note spelling, take-bank summary metadata, recorded-audio replay timing, all solo measures on each progression form, sparse and noisy takes, one and whole-bank file round trips with and without audio, note edits and fresh IDs on duplicate imports, damaged and unsupported files, known guide-tone and ♭9 resolutions, chord spelling, loop boundaries, the C turnaround, chromatic approaches, neutral feedback for ambiguous passages, the three MIDI note-message forms, pitch estimation on synthetic tones including a low tenor note and noise, note segmentation through dropouts and pitch changes, and a mocked Gemini API response. Acoustic sax accuracy still needs a real instrument and microphone check in the demo room.
