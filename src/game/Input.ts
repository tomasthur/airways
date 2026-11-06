export type HoldAction = 'pitchUp' | 'pitchDown' | 'powerDown' | 'powerUp';
export type PressAction = 'flaps' | 'gear' | 'pause' | 'restart' | 'mute' | 'start' | 'quality';

const HOLD_KEYS: Record<string, HoldAction> = {
  KeyW: 'pitchUp',
  ArrowUp: 'pitchUp',
  KeyS: 'pitchDown',
  ArrowDown: 'pitchDown',
  KeyA: 'powerDown',
  ArrowLeft: 'powerDown',
  KeyD: 'powerUp',
  ArrowRight: 'powerUp',
};

const PRESS_KEYS: Record<string, PressAction> = {
  KeyF: 'flaps',
  KeyG: 'gear',
  KeyP: 'pause',
  Escape: 'pause',
  KeyR: 'restart',
  KeyM: 'mute',
  Enter: 'start',
  Space: 'start',
  KeyQ: 'quality',
};

/** Keyboard plus on-screen (pointer) controls mapped to the same actions. */
export class Input {
  private readonly codes = new Set<string>();
  private readonly pointer = new Set<HoldAction>();
  private readonly listeners: ((a: PressAction) => void)[] = [];

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (HOLD_KEYS[e.code]) {
        this.codes.add(e.code);
        e.preventDefault();
        return;
      }
      const press = PRESS_KEYS[e.code];
      if (press) {
        e.preventDefault();
        if (!e.repeat) this.emit(press);
      }
    });
    window.addEventListener('keyup', (e) => this.codes.delete(e.code));
    window.addEventListener('blur', () => {
      this.codes.clear();
      this.pointer.clear();
    });
  }

  onPress(fn: (a: PressAction) => void): void {
    this.listeners.push(fn);
  }

  emit(a: PressAction): void {
    for (const fn of this.listeners) fn(a);
  }

  setPointer(action: HoldAction, down: boolean): void {
    if (down) this.pointer.add(action);
    else this.pointer.delete(action);
  }

  isHeld(a: HoldAction): boolean {
    if (this.pointer.has(a)) return true;
    for (const code of this.codes) if (HOLD_KEYS[code] === a) return true;
    return false;
  }

  get pitch(): number {
    return (this.isHeld('pitchUp') ? 1 : 0) - (this.isHeld('pitchDown') ? 1 : 0);
  }

  get throttle(): number {
    return (this.isHeld('powerUp') ? 1 : 0) - (this.isHeld('powerDown') ? 1 : 0);
  }
}
