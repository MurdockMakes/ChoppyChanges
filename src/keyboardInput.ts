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

/** Physical computer keys, ordered from the lowest to highest displayed piano note. */
export const COMPUTER_PIANO_KEYS = [
  { offset: 0, code: 'KeyA', label: 'A' },
  { offset: 1, code: 'KeyW', label: 'W' },
  { offset: 2, code: 'KeyS', label: 'S' },
  { offset: 3, code: 'KeyE', label: 'E' },
  { offset: 4, code: 'KeyD', label: 'D' },
  { offset: 5, code: 'KeyF', label: 'F' },
  { offset: 6, code: 'KeyT', label: 'T' },
  { offset: 7, code: 'KeyG', label: 'G' },
  { offset: 8, code: 'KeyY', label: 'Y' },
  { offset: 9, code: 'KeyH', label: 'H' },
  { offset: 10, code: 'KeyU', label: 'U' },
  { offset: 11, code: 'KeyJ', label: 'J' },
  { offset: 12, code: 'KeyK', label: 'K' },
  { offset: 13, code: 'KeyO', label: 'O' },
  { offset: 14, code: 'KeyL', label: 'L' },
  { offset: 15, code: 'KeyP', label: 'P' },
  { offset: 16, code: 'Semicolon', label: ';' },
  { offset: 17, code: 'Quote', label: "'" },
  { offset: 18, code: 'BracketLeft', label: '[' },
  { offset: 19, code: 'Comma', label: ',' },
  { offset: 20, code: 'BracketRight', label: ']' },
  { offset: 21, code: 'Period', label: '.' },
  { offset: 22, code: 'Backslash', label: '\\' },
  { offset: 23, code: 'Slash', label: '/' },
] as const;

const computerKeyByCode = new Map<string, (typeof COMPUTER_PIANO_KEYS)[number]>(
  COMPUTER_PIANO_KEYS.map((key) => [key.code, key]),
);

export interface ComputerKeyEvent {
  code: string;
  repeat: boolean;
  target: unknown;
  defaultPrevented?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  isComposing?: boolean;
  preventDefault: () => void;
}

/** Includes descendants of editors and custom textbox controls. */
export function isEditableKeyboardTarget(target: unknown): boolean {
  const visited = new Set<unknown>();
  let node = target;
  while (node && typeof node === 'object' && !visited.has(node)) {
    visited.add(node);
    const element = node as {
      tagName?: string;
      isContentEditable?: boolean;
      getAttribute?: (name: string) => string | null;
      parentElement?: unknown;
      parentNode?: unknown;
    };
    const tag = element.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (element.isContentEditable) return true;
    const editable = element.getAttribute?.('contenteditable');
    if (editable !== null && editable !== undefined && editable.toLowerCase() !== 'false') return true;
    const role = element.getAttribute?.('role')?.toLowerCase();
    if (role === 'textbox' || role === 'combobox' || role === 'searchbox' || role === 'spinbutton') return true;
    node = element.parentElement ?? element.parentNode;
  }
  return false;
}

/** Routes computer keys through the same ownership rules as pointer and focused-key input. */
export class ComputerPianoInput {
  private active = false;
  private heldCodes = new Set<string>();
  private readonly presses: KeyboardPressController;
  private readonly getStartPitch: () => number;

  constructor(
    presses: KeyboardPressController,
    getStartPitch: () => number,
  ) {
    this.presses = presses;
    this.getStartPitch = getStartPitch;
  }

  get isActive() { return this.active; }

  setActive(active: boolean) {
    if (this.active === active) return;
    this.active = active;
    if (!active) this.releaseHeld();
  }

  keyDown(event: ComputerKeyEvent) {
    if (!this.active) return;
    const key = computerKeyByCode.get(event.code);
    if (!key || event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return;
    if (isEditableKeyboardTarget(event.target)) return;
    if (typeof document !== 'undefined' && isEditableKeyboardTarget(document.activeElement)) return;
    event.preventDefault();
    if (event.repeat || this.heldCodes.has(event.code)) return;
    this.heldCodes.add(event.code);
    this.presses.press(`computer:${event.code}`, this.getStartPitch() + key.offset);
  }

  keyUp(event: ComputerKeyEvent) {
    if (!this.heldCodes.has(event.code)) return;
    if (!isEditableKeyboardTarget(event.target)
      && !(typeof document !== 'undefined' && isEditableKeyboardTarget(document.activeElement))) event.preventDefault();
    this.heldCodes.delete(event.code);
    this.presses.release(`computer:${event.code}`);
  }

  releaseHeld() {
    for (const code of this.heldCodes) this.presses.release(`computer:${code}`);
    this.heldCodes.clear();
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
