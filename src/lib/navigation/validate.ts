import { z } from 'zod';
import { ValidationError } from './logger';

// ─── Shared ───────────────────────────────────────────────────────────────────
export const CoordinateSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
}).refine(
  ({ lat, lng }) => !(lat === 0 && lng === 0),
  { message: 'Coordinates (0,0) indicate uninitialized GPS — wait for GPS fix before navigating' },
);

export const CostChangeSchema = z.object({
  u: z.string().min(1),
  v: z.string().min(1),
  oldCost: z.number().nonnegative(),
  newCost: z.number().nonnegative(),
});

// ─── POST /api/navigate/init ──────────────────────────────────────────────────
export const InitRequestSchema = z.object({
  agentPos: CoordinateSchema,
  targetPos: CoordinateSchema,
});

// ─── POST /api/navigate/update ────────────────────────────────────────────────
export const UpdateRequestSchema = z.object({
  sessionId: z.string().min(1),
  agentPos: CoordinateSchema,
  targetPos: CoordinateSchema,
  costChanges: z.array(CostChangeSchema).optional().default([]),
});

// ─── GET /api/navigate/stream ─────────────────────────────────────────────────
export const StreamQuerySchema = z.object({
  sessionId: z.string().min(1),
});

// ─── Helper ───────────────────────────────────────────────────────────────────
export function validateBody<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const msg = result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new ValidationError(`Invalid request: ${msg}`);
  }
  return result.data;
}
