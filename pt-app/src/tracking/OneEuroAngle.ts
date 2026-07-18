/**
 * One-Euro filter on a scalar (joint angle deg).
 * Light smoothing — Perception already EMA-smooths landmarks.
 */

export class OneEuroAngle {
  private initialized = false;
  private xPrev = 0;
  private dxPrev = 0;
  private tPrev = 0;

  constructor(
    private readonly minCutoff = 1.2,
    private readonly beta = 0.02,
    private readonly dCutoff = 1.0,
  ) {}

  reset(): void {
    this.initialized = false;
  }

  filter(x: number, tMs: number): number {
    if (!this.initialized) {
      this.initialized = true;
      this.xPrev = x;
      this.dxPrev = 0;
      this.tPrev = tMs;
      return x;
    }
    const dt = Math.max(1e-3, (tMs - this.tPrev) / 1000);
    const dx = (x - this.xPrev) / dt;
    const edx = expSmooth(dx, this.dxPrev, alpha(dt, this.dCutoff));
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    const xHat = expSmooth(x, this.xPrev, alpha(dt, cutoff));
    this.xPrev = xHat;
    this.dxPrev = edx;
    this.tPrev = tMs;
    return xHat;
  }
}

function alpha(dt: number, cutoff: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

function expSmooth(x: number, xPrev: number, a: number): number {
  return a * x + (1 - a) * xPrev;
}
