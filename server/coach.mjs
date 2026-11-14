const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL = "gemini-3.8-flash";

export const coachResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["priorityNeedId", "priorityEvidenceIds", "exercises"],
  properties: {
    priorityNeedId: { type: "string" },
    priorityEvidenceIds: { type: "array", minItems: 1, maxItems: 3, items: { type: "string" } },
    exercises: {
      type: "array",
      minItems: 2,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["catalogId", "evidenceId", "reference", "instruction"],
        properties: {
          catalogId: { type: "string" },
          evidenceId: { type: "string" },
          reference: {
            type: "object",
            additionalProperties: false,
            required: ["noteId", "chordName", "bar", "beat"],
            properties: {
              noteId: { type: "string" },
              chordName: { type: "string" },
              bar: { type: "integer" },
              beat: { type: "number" },
            },
          },
          instruction: { type: "string" },
        },
      },
    },
  },
};

export class CoachError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const forbiddenKeyPart = /audio|waveform|pcm|sample|microphone|mic|media|blob|base64|dataurl|file|recording|raw|buffer|bytes|binary/i;

function hasMedia(value, depth = 0) {
  if (depth > 12) return true;
  if (typeof value === "string") return value.length > 2000 || /^data:/i.test(value);
  if (Array.isArray(value)) {
    if (value.length > 32 && value.every((item) => typeof item === "number")) return true;
    return value.some((item) => hasMedia(item, depth + 1));
  }
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, item]) =>
    forbiddenKeyPart.test(key.replace(/[^a-z0-9]/gi, "")) || hasMedia(item, depth + 1));
}

export function validateCoachRequest(payload) {
  if (!isRecord(payload) || !isRecord(payload.summary) || !Array.isArray(payload.catalog) || payload.catalog.length === 0) {
    throw new CoachError(400, "Expected a symbolic summary and a nonempty exercise catalog.");
  }
  if (Object.keys(payload).some((key) => key !== "summary" && key !== "catalog") || hasMedia(payload)) {
    throw new CoachError(400, "Only symbolic performance data is accepted.");
  }
  return { summary: payload.summary, catalog: payload.catalog };
}

export async function generateCoachPlan(payload, {
  apiKey = process.env.GEMINI_API_KEY,
  model = process.env.GEMINI_MODEL || DEFAULT_MODEL,
  fetchImpl = fetch,
} = {}) {
  const { summary, catalog } = validateCoachRequest(payload);
  if (!apiKey) throw new CoachError(503, "Gemini coaching is not configured.");
  if (!/^[a-zA-Z0-9._-]+$/.test(model)) throw new CoachError(500, "Invalid Gemini model configuration.");

  const prompt = [
    "You are a concise, encouraging practice coach for jazz chord changes.",
    "Use only the symbolic performance summary and reviewed exercise catalog below.",
    "Choose exactly one priorityNeedId from summary.needs, 1 to 3 of its evidenceIds for priorityEvidenceIds, and 2 or 3 different catalog exercises.",
    "For each exercise, choose an evidenceId from the selected need and a noteId in that evidence's noteIds whose chordName matches the catalog exercise's chordName. Copy that note's chordName, bar, and beat exactly into reference.",
    "Copy all IDs, note references, chord names, and positions exactly. Never invent a performed note, chord, position, or resolution.",
    "A named tension without a nearby resolution is ambiguous, not automatically a mistake. Do not assign a score or make sweeping judgments from one note.",
    "The catalog already supplies each exercise's purpose, 5–10 minute action, starting tempo, and improvement check. Do not repeat those in instruction.",
    "Write instruction as one brief, encouraging imperative playing cue starting with Try, Keep, Start, Listen, Aim, Play, Repeat, Slow, Let, Focus, Use, Breathe, Leave, or Take. Use 8–160 characters. Do not include note or chord names, bar/beat numbers, or claims about what the player performed.",
    "Do not create solos, MIDI, backing tracks, or audio.",
    JSON.stringify({ summary, catalog }),
  ].join("\n\n");

  let response;
  try {
    response = await fetchImpl(`${GEMINI_URL}/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseJsonSchema: coachResponseSchema,
          temperature: 0.2,
          maxOutputTokens: 1200,
        },
      }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new CoachError(502, "Gemini is unavailable. Use the local practice plan.");
  }
  if (!response.ok) throw new CoachError(502, "Gemini is unavailable. Use the local practice plan.");

  let result;
  try {
    result = await response.json();
    const text = result?.candidates?.[0]?.content?.parts
      ?.filter((part) => typeof part?.text === "string")
      .map((part) => part.text).join("");
    if (!text) throw new Error("Missing text");
    return JSON.parse(text);
  } catch {
    throw new CoachError(502, "Gemini returned an unreadable plan. Use the local practice plan.");
  }
}
