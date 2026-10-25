/** a damped spring pulled towards 0 */
export interface Spring {
  x: number;
  v: number;
}

/** the longest step the springs are integrated with (s); stiff springs
 *  stepped at a slow frame's dt overshoot further each step and blow up */
const MAX_STEP = 1 / 120;

/** advance `s` by `dt` with stiffness `k` and damping `c` */
export function stepSpring(s: Spring, k: number, c: number, dt: number): void {
  const n = Math.ceil(dt / MAX_STEP);
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    s.v += (-k * s.x - c * s.v) * h;
    s.x += s.v * h;
  }
}
