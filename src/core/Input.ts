/**
 * Input — keyboard state, edge-triggered presses and pointer-lock mouse look,
 * shared by every controller (player, free-fly camera). Controllers poll once
 * per frame: `held()` for continuous keys, `takePress()` for one-shot actions,
 * `takeLook()` for the mouse delta accumulated since the last call.
 */

// Browsers enforce a cooldown (~1.25 s in Chromium) after the user exits
// pointer lock with ESC — a requestPointerLock() inside it is REJECTED
// ("pointer lock cannot be acquired immediately after exiting"). Clicks in
// that window must be deferred, not dropped.
const LOCK_COOLDOWN_MS = 1300;
// a deferred/retried request is only honored while the authorizing click is
// recent (transient user activation lasts ~5 s — stay well inside it)
const LOCK_INTENT_MS = 3500;
const LOOK_RADIANS_PER_PX = 0.0022;

export class Input {
  /** false while tooling (flythrough) owns the camera: no lock, no look */
  enabled = true;
  locked = false;

  private readonly keys = new Set<string>();
  private readonly presses = new Set<string>();
  private lookX = 0;
  private lookY = 0;
  private wheelV = 0;

  constructor(dom: HTMLElement) {
    // ---- pointer lock, cooldown-aware ----------------------------------
    // A request inside the post-ESC cooldown is rejected and the click lost,
    // so clicks in the cooldown schedule the request for its end, and a
    // rejection/pointerlockerror retries while the click intent is fresh.
    let unlockAt = -1e9; // performance.now() of the last lock exit
    let lockIntentAt = -1e9; // last click asking for the lock
    let relockTimer: number | undefined;
    const clearRelock = (): void => {
      if (relockTimer !== undefined) {
        window.clearTimeout(relockTimer);
        relockTimer = undefined;
      }
    };
    const retryLock = (delayMs: number): void => {
      // bounded: never re-lock without a recent user gesture
      if (performance.now() - lockIntentAt > LOCK_INTENT_MS) return;
      if (relockTimer !== undefined) return;
      relockTimer = window.setTimeout(() => {
        relockTimer = undefined;
        acquireLock();
      }, delayMs);
    };
    const acquireLock = (): void => {
      if (!this.enabled || this.locked) return;
      clearRelock();
      const wait = unlockAt + LOCK_COOLDOWN_MS - performance.now();
      if (wait > 0) {
        // inside the browser cooldown — defer instead of burning the request
        relockTimer = window.setTimeout(() => {
          relockTimer = undefined;
          acquireLock();
        }, wait + 60);
        return;
      }
      let p: Promise<void> | undefined;
      try {
        // Safari returns undefined (no promise) — guard before .catch
        p = dom.requestPointerLock() as unknown as Promise<void> | undefined;
      } catch {
        retryLock(350);
        return;
      }
      if (p !== undefined && typeof p.catch === 'function') {
        p.catch(() => retryLock(350));
      }
    };
    dom.addEventListener('click', () => {
      if (!this.enabled || this.locked) return;
      lockIntentAt = performance.now();
      acquireLock();
    });
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === dom;
      if (was && !this.locked) unlockAt = performance.now();
      if (this.locked) clearRelock();
    });
    document.addEventListener('pointerlockerror', () => {
      // cooldown miss or focus race — re-request once the window passes
      retryLock(Math.max(unlockAt + LOCK_COOLDOWN_MS - performance.now() + 60, 300));
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.locked || !this.enabled) return;
      this.lookX += e.movementX;
      this.lookY += e.movementY;
    });
    // mouse buttons are presses like keys ('Mouse0' = left), and only while
    // locked: the click that takes the lock must not also fire
    dom.addEventListener('mousedown', (e) => {
      if (this.locked) this.presses.add(`Mouse${e.button}`);
    });
    window.addEventListener('keydown', (e) => {
      if (!e.repeat) this.presses.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.presses.clear();
    });
    dom.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.wheelV += Math.sign(e.deltaY);
      },
      { passive: false },
    );
  }

  held(code: string): boolean {
    return this.enabled && this.keys.has(code);
  }

  /** true once per keydown (repeats excluded) this frame — regardless of
   *  `enabled`, so tooling keys still work while a flythrough runs */
  takePress(code: string): boolean {
    return this.presses.delete(code);
  }

  /** drop presses and wheel nobody took this frame, so they can't fire later */
  endFrame(): void {
    this.presses.clear();
    this.wheelV = 0;
  }

  /** mouse-look delta in radians (yaw right +, pitch down +) since the last take */
  takeLook(): { yaw: number; pitch: number } {
    const look = { yaw: this.lookX * LOOK_RADIANS_PER_PX, pitch: this.lookY * LOOK_RADIANS_PER_PX };
    this.lookX = 0;
    this.lookY = 0;
    return look;
  }

  /** wheel notches since the last take (positive = scrolled down) */
  takeWheel(): number {
    const w = this.wheelV;
    this.wheelV = 0;
    return w;
  }
}
