/**
 * GPS Smoothing — 1D Kalman Filter per axis
 *
 * Kalman > Moving Average เพราะ:
 * - ไม่มี lag (MA ต้องรอ window เต็ม)
 * - ปรับ noise weight อัตโนมัติตาม measurement uncertainty
 * - serialize ได้ง่าย (แค่ x, p)
 */
import type { Coordinate, KalmanState, GPSFilterState } from '@/lib/navigation/types';

class Kalman1D {
  private state: KalmanState | null = null;
  private readonly Q: number; // process noise

  constructor(processNoise = 0.00001) {
    this.Q = processNoise;
  }

  update(measurement: number, R: number): number {
    if (!this.state) {
      this.state = { x: measurement, p: R };
      return measurement;
    }
    // Predict
    const pPred = this.state.p + this.Q;
    // Update
    const K = pPred / (pPred + R);
    this.state.x += K * (measurement - this.state.x);
    this.state.p = (1 - K) * pPred;
    return this.state.x;
  }

  reset(): void { this.state = null; }
  getState(): KalmanState | null { return this.state ? { ...this.state } : null; }
  setState(s: KalmanState | null): void { this.state = s ? { ...s } : null; }
}

// ─── 2D GPS Filter ────────────────────────────────────────────────────────────
export class GPSKalmanFilter {
  private latF: Kalman1D;
  private lngF: Kalman1D;
  private lastCoord: Coordinate | null = null;
  private lastTs = 0;
  private speed = 0; // m/s

  constructor(processNoise = 0.00001) {
    this.latF = new Kalman1D(processNoise);
    this.lngF = new Kalman1D(processNoise);
  }

  update(lat: number, lng: number, accuracyM = 10): Coordinate {
    // accuracy เมตร → degree² (1° lat ≈ 111320m)
    const accDeg = accuracyM / 111_320;
    const R = accDeg * accDeg;

    const sLat = this.latF.update(lat, R);
    const sLng = this.lngF.update(lng, R);

    // ประมาณความเร็วด้วย EMA
    const now = Date.now();
    if (this.lastCoord && this.lastTs > 0) {
      const dt = (now - this.lastTs) / 1000;
      if (dt > 0.5) {
        const dist = haversine(this.lastCoord.lat, this.lastCoord.lng, sLat, sLng);
        this.speed = this.speed * 0.7 + (dist / dt) * 0.3;
      }
    }
    this.lastCoord = { lat: sLat, lng: sLng };
    this.lastTs = now;

    return { lat: sLat, lng: sLng };
  }

  getSpeedEstimate(): number { return this.speed; }

  /** Dynamic poll interval ตามความเร็ว target */
  getSuggestedPollIntervalMs(): number {
    const kmh = this.speed * 3.6;
    if (kmh > 30) return 2000;
    if (kmh > 10) return 2500;
    if (kmh > 5) return 3000;
    if (kmh > 1) return 4000;
    return 5000;
  }

  reset(): void {
    this.latF.reset();
    this.lngF.reset();
    this.lastCoord = null;
    this.lastTs = 0;
    this.speed = 0;
  }

  serialize(): GPSFilterState {
    return {
      latState: this.latF.getState(),
      lngState: this.lngF.getState(),
      lastTimestamp: this.lastTs,
      speedEstimate: this.speed,
      lastCoord: this.lastCoord,
    };
  }

  static deserialize(d: GPSFilterState): GPSKalmanFilter {
    const f = new GPSKalmanFilter();
    f.latF.setState(d.latState);
    f.lngF.setState(d.lngState);
    f.lastTs = d.lastTimestamp;
    f.speed = d.speedEstimate;
    f.lastCoord = d.lastCoord ?? null;
    return f;
  }
}

// ─── Haversine (meters) ───────────────────────────────────────────────────────
export function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
