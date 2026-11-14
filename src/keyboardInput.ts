/** Tracks independent pointers and keyboard keys while sounding each pitch once. */
export class KeyboardPressController {
  private owners = new Map<string, number>();
  private counts = new Map<number, number>();
  private onPress: (pitch: number) => void;
  private onRelease: (pitch: number) => void;
  private onChange: (pitches: number[]) => void;

  constructor(
    onPress: (pitch: number) => void,
    onRelease: (pitch: number) => void,
    onChange: (pitches: number[]) => void,
  ) {
    this.onPress = onPress;
    this.onRelease = onRelease;
    this.onChange = onChange;
  }

  press(owner: string, pitch: number) {
    if (this.owners.get(owner) === pitch) return;
    if (this.owners.has(owner)) this.release(owner);
    this.owners.set(owner, pitch);
    const count = this.counts.get(pitch) ?? 0;
    this.counts.set(pitch, count + 1);
    if (count === 0) this.onPress(pitch);
    this.onChange(this.pressedPitches());
  }

  release(owner: string) {
    const pitch = this.owners.get(owner);
    if (pitch === undefined) return;
    this.owners.delete(owner);
    const count = (this.counts.get(pitch) ?? 1) - 1;
    if (count === 0) {
      this.counts.delete(pitch);
      this.onRelease(pitch);
    } else {
      this.counts.set(pitch, count);
    }
    this.onChange(this.pressedPitches());
  }

  releaseAll() {
    for (const owner of [...this.owners.keys()]) this.release(owner);
  }

  pressedPitches() {
    return [...this.counts.keys()].sort((a, b) => a - b);
  }
}

/** Detects capture loss even before the browser delivers lostpointercapture. */
export function releaseLostPointerCaptures<T extends { hasPointerCapture(pointerId: number): boolean }>(
  targets: Map<number, T>,
  release: (pointerId: number) => void,
) {
  for (const [pointerId, target] of targets) {
    if (!target.hasPointerCapture(pointerId)) {
      targets.delete(pointerId);
      release(pointerId);
    }
  }
}
