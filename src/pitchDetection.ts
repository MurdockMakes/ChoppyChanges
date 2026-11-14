/** A lightweight YIN-style fundamental-frequency estimate for one acoustic note. */
export interface PitchEstimate {
  frequencyHz: number;
  confidence: number;
  rms: number;
}

/**
 * Estimates a single, sustained pitch from a mono PCM window.
 *
 * The cumulative mean normalized difference follows de Cheveigné and
 * Kawahara's YIN method. Downsampling by two keeps an 8192-sample mic frame
 * practical to analyze about 30 times a second on a demo laptop.
 */
export function detectPitch(
  samples: Float32Array,
  sampleRate: number,
  minHz = 90,
  maxHz = 1200,
): PitchEstimate | null {
  if (
    samples.length < 1024 || !Number.isFinite(sampleRate) || sampleRate <= 0 ||
    !Number.isFinite(minHz) || !Number.isFinite(maxHz) || minHz <= 0 || maxHz <= minHz
  ) return null;

  const reducedSize = Math.floor(samples.length / 2);
  const reducedRate = sampleRate / 2;
  const signal = new Float32Array(reducedSize);
  let mean = 0;
  for (let i = 0; i < reducedSize; i += 1) {
    const value = (samples[2 * i] + samples[2 * i + 1]) / 2;
    signal[i] = value;
    mean += value;
  }
  mean /= reducedSize;

  let power = 0;
  for (let i = 0; i < reducedSize; i += 1) {
    signal[i] -= mean;
    power += signal[i] * signal[i];
  }
  const rms = Math.sqrt(power / reducedSize);
  if (rms < 0.008) return null;

  const minLag = Math.max(2, Math.floor(reducedRate / maxHz));
  const maxLag = Math.min(Math.ceil(reducedRate / minHz), Math.floor(reducedSize / 2));
  if (maxLag <= minLag + 2) return null;

  // Use the same comparison length for every lag so the difference values
  // remain comparable as lag increases.
  const comparisonLength = reducedSize - maxLag;
  const difference = new Float32Array(maxLag + 1);
  for (let lag = 1; lag <= maxLag; lag += 1) {
    let sum = 0;
    for (let i = 0; i < comparisonLength; i += 1) {
      const delta = signal[i] - signal[i + lag];
      sum += delta * delta;
    }
    difference[lag] = sum;
  }

  const normalized = new Float32Array(maxLag + 1);
  normalized[0] = 1;
  let runningSum = 0;
  for (let lag = 1; lag <= maxLag; lag += 1) {
    runningSum += difference[lag];
    normalized[lag] = runningSum > 0 ? (difference[lag] * lag) / runningSum : 1;
  }

  // YIN takes the first sufficiently deep local valley, which helps avoid
  // choosing a multiple of the fundamental period.
  const threshold = 0.22;
  let chosenLag = -1;
  for (let lag = minLag; lag < maxLag; lag += 1) {
    if (normalized[lag] >= threshold) continue;
    while (lag + 1 <= maxLag && normalized[lag + 1] < normalized[lag]) lag += 1;
    chosenLag = lag;
    break;
  }
  if (chosenLag < 0) {
    let best = 1;
    for (let lag = minLag; lag <= maxLag; lag += 1) {
      if (normalized[lag] < best) {
        best = normalized[lag];
        chosenLag = lag;
      }
    }
    if (chosenLag < 0 || best > 0.28) return null;
  }

  let refinedLag = chosenLag;
  if (chosenLag > 1 && chosenLag < maxLag) {
    const left = normalized[chosenLag - 1];
    const center = normalized[chosenLag];
    const right = normalized[chosenLag + 1];
    const denominator = left - 2 * center + right;
    if (Math.abs(denominator) > 1e-8) {
      refinedLag += Math.max(-1, Math.min(1, 0.5 * (left - right) / denominator));
    }
  }

  const frequencyHz = reducedRate / refinedLag;
  const confidence = Math.max(0, Math.min(1, 1 - normalized[chosenLag]));
  if (frequencyHz < minHz || frequencyHz > maxHz || confidence < 0.72) return null;
  return { frequencyHz, confidence, rms };
}
