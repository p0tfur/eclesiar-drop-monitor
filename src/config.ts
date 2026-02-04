import path from "path";
import dotenv from "dotenv";

const ROOT_DIR = path.resolve(__dirname, "..");
dotenv.config({ path: path.resolve(ROOT_DIR, ".env") });

type ResolvedConfig = {
  port: number;
  dbPath: string;
  allowedOrigins: string[];
  apiKeys: string[];
  trustProxyHops: number;
  postRateLimitPerMinute: number;
};

function parseIntEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolvePath(inputPath: string | undefined, fallback: string): string {
  if (!inputPath) {
    return fallback;
  }
  return path.isAbsolute(inputPath) ? inputPath : path.resolve(ROOT_DIR, inputPath);
}

const DEFAULT_DB_PATH = path.resolve(ROOT_DIR, "data", "drop-monitor.db");

function splitEnvList(raw: string | undefined): string[] {
  return (raw || "")
    .split(",")
    .map((value: string) => value.trim())
    .filter((value: string) => Boolean(value));
}

export const config: ResolvedConfig = {
  port: parseIntEnv(process.env.DROP_PORT, 4110),
  dbPath: resolvePath(process.env.DROP_DB_PATH, DEFAULT_DB_PATH),
  allowedOrigins: splitEnvList(process.env.DROP_ALLOWED_ORIGINS),
  apiKeys: splitEnvList(process.env.DROP_API_KEYS),
  trustProxyHops: parseIntEnv(process.env.DROP_TRUST_PROXY_HOPS, 1),
  postRateLimitPerMinute: parseIntEnv(process.env.DROP_POST_RATE_LIMIT_PER_MINUTE, 1000),
};
