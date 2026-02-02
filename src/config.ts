<<<<<<< G:/_programowanie/_projekty/Eclesiar/skrypty/drop-monitor-backend/src/config.ts
import path from "path";
import dotenv from "dotenv";

const ROOT_DIR = path.resolve(__dirname, "..", "..");
dotenv.config({ path: path.resolve(ROOT_DIR, ".env") });

type ResolvedConfig = {
  port: number;
  dbPath: string;
  allowedOrigins: string[];
  apiKeys: string[];
};

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
  port: Number.parseInt(process.env.DROP_PORT || "4110", 10),
  dbPath: resolvePath(process.env.DROP_DB_PATH, DEFAULT_DB_PATH),
  allowedOrigins: splitEnvList(process.env.DROP_ALLOWED_ORIGINS),
  apiKeys: splitEnvList(process.env.DROP_API_KEYS),
};
=======
import path from "path";
import dotenv from "dotenv";

const ROOT_DIR = path.resolve(__dirname, "..");
dotenv.config({ path: path.resolve(ROOT_DIR, ".env") });

type ResolvedConfig = {
  port: number;
  dbPath: string;
  allowedOrigins: string[];
  apiKeys: string[];
};

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
  port: Number.parseInt(process.env.DROP_PORT || "4110", 10),
  dbPath: resolvePath(process.env.DROP_DB_PATH, DEFAULT_DB_PATH),
  allowedOrigins: splitEnvList(process.env.DROP_ALLOWED_ORIGINS),
  apiKeys: splitEnvList(process.env.DROP_API_KEYS),
};
>>>>>>> C:/Users/shogun/.windsurf/worktrees/drop-monitor-backend/drop-monitor-backend-78729ded/src/config.ts
