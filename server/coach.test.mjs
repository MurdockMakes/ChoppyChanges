import assert from "node:assert/strict";
import test from "node:test";
import { CoachError, generateCoachPlan, validateCoachRequest } from "./coach.mjs";

const payload = {
  summary: {
    key: "C", form: "ii-v-i",
    notes: [{ id: "n1", name: "C", chordName: "Dm7", bar: 1, beat: 4.5 }],
    evidence: [{ id: "e1", noteIds: ["n1"] }],
    needs: [{ id: "guide-tone-landing", evidenceIds: ["e1"] }],
  },
  catalog: [
    { id: "arpeggio-dm7", chordName: "Dm7", notes: ["D", "F", "A", "C"] },
    { id: "guide-dm7", chordName: "Dm7", notes: ["F", "C"] },
  ],
};

test("coach request sends symbolic data and asks Gemini for structured JSON", async () => {
  const plan = {
    priorityNeedId: "guide-tone-landing",
    priorityEvidenceIds: ["e1"],
    exercises: [
      { catalogId: "arpeggio-dm7", evidenceId: "e1", reference: { noteId: "n1", chordName: "Dm7", bar: 1, beat: 4.5 }, instruction: "Keep the pulse steady as you move." },
      { catalogId: "guide-dm7", evidenceId: "e1", reference: { noteId: "n1", chordName: "Dm7", bar: 1, beat: 4.5 }, instruction: "Listen for the arrival." },
    ],
  };
  let upstreamCall;
  const fetchImpl = async (url, init) => {
    upstreamCall = { url, init };
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(plan) }] } }] });
  };
  assert.deepEqual(await generateCoachPlan(payload, { apiKey: "server-only-secret", fetchImpl }), plan);
  assert.match(upstreamCall.url, /gemini-3\.8-flash:generateContent$/);
  assert.equal(upstreamCall.init.headers["x-goog-api-key"], "server-only-secret");
  const request = JSON.parse(upstreamCall.init.body);
  assert.equal(request.generationConfig.responseMimeType, "application/json");
  assert.equal(request.generationConfig.responseJsonSchema.properties.exercises.minItems, 2);
  assert.equal(request.generationConfig.responseJsonSchema.properties.exercises.maxItems, 3);
  assert.match(request.contents[0].parts[0].text, /"form":"ii-v-i"/);
  assert.match(request.contents[0].parts[0].text, /Do not include note or chord names, bar\/beat numbers/);
  assert.doesNotMatch(upstreamCall.init.body, /server-only-secret/);
});

test("coach request rejects raw media and works without a key", async () => {
  assert.throws(() => validateCoachRequest({ ...payload, audio: "raw microphone bytes" }),
    (error) => error instanceof CoachError && error.status === 400);
  assert.throws(() => validateCoachRequest({ ...payload, summary: { ...payload.summary, microphone: { samples: [1, 2] } } }),
    (error) => error instanceof CoachError && error.status === 400);
  for (const key of ["rawAudio", "micAudio", "audioBlob", "binaryData"]) {
    assert.throws(() => validateCoachRequest({ ...payload, summary: { ...payload.summary, [key]: "data:audio/wav;base64,AAAA" } }),
      (error) => error instanceof CoachError && error.status === 400);
  }
  await assert.rejects(generateCoachPlan(payload, { apiKey: "" }),
    (error) => error instanceof CoachError && error.status === 503);
});

test("coach request treats an unreadable Gemini response as an error", async () => {
  await assert.rejects(
    generateCoachPlan(payload, { apiKey: "test", fetchImpl: async () => Response.json({ candidates: [] }) }),
    (error) => error instanceof CoachError && error.status === 502,
  );
});
