/**
 * FrameRate — a smoothed frames-per-second readout. It smooths the frame
 * time and inverts that, rather than smoothing 1/dt: with uneven pacing a
 * few quick frames between slow ones send 1/dt soaring, so its mean can
 * read several times the frames actually shown.
 */

/** weight of the newest frame; ~20 frames of memory */
const BLEND = 0.05;

export class FrameRate {
  private meanDt = 0;

  /** the readout after a frame of `dt` seconds */
  update(dt: number): number {
    if (dt <= 0) return this.fps;
    this.meanDt = this.meanDt === 0 ? dt : this.meanDt + (dt - this.meanDt) * BLEND;
    return this.fps;
  }

  get fps(): number {
    return this.meanDt > 0 ? 1 / this.meanDt : 0;
  }
}
