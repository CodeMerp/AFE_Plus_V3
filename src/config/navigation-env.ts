import { z } from "zod";

const navigationEnvSchema = z.object({
  MAPBOX_ACCESS_TOKEN: z.string().min(1),
  MAPBOX_PROFILE: z
    .enum(["driving", "driving-traffic", "walking", "cycling"])
    .default("driving"),

  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),

  AUTH_SECRET: z.string().min(1).optional(),
  CORS_ORIGINS: z.string().default("*"),

  LOG_LEVEL: z
    .enum(["debug", "info", "warn", "error"])
    .default("info"),

  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
});

const runtimeEnv = {
  MAPBOX_ACCESS_TOKEN: process.env.MAPBOX_ACCESS_TOKEN ?? "",
  MAPBOX_PROFILE: process.env.MAPBOX_PROFILE ?? "driving",

  UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
  UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,

  AUTH_SECRET: process.env.AUTH_SECRET,
  CORS_ORIGINS: process.env.CORS_ORIGINS ?? "*",

  LOG_LEVEL: process.env.LOG_LEVEL ?? "info",
  NODE_ENV: process.env.NODE_ENV ?? "development",
};

export const env = process.env.SKIP_ENV_VALIDATION
  ? (runtimeEnv as z.infer<typeof navigationEnvSchema>)
  : navigationEnvSchema.parse(runtimeEnv);
