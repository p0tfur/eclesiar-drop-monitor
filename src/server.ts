import path from "path";
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import { config } from "./config";
import { initDb, insertHitRecord, listHitRecords } from "./db";
import { hitPayloadSchema, listQuerySchema } from "./schemas";

void initDb().catch((err) => {
  console.error("[DropMonitor] Failed to initialize database", err);
  process.exit(1);
});

const app = express();
const port = config.port;

const corsMiddleware = cors({
  origin: (origin, callback) => {
    if (!origin || config.allowedOrigins.length === 0) {
      return callback(null, true);
    }
    if (config.allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error("Origin not allowed"));
  },
});

app.use(corsMiddleware);
app.use(helmet());
app.use(express.json({ limit: "1mb" }));

const staticDir = path.resolve(__dirname, "../public");
app.use("/scripts", express.static(staticDir));

function ensureAuthorized(req: Request): boolean {
  if (!config.apiKeys.length) {
    return true;
  }
  const provided = String(req.header("x-drop-api-key") || "").trim();
  return !!provided && config.apiKeys.includes(provided);
}

function serializeExtra(payload: unknown): string | null {
  if (!payload) {
    return null;
  }
  try {
    return JSON.stringify(payload);
  } catch (error) {
    console.warn("[DropMonitor] Failed to serialize extra payload", error);
    return null;
  }
}

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

app.post("/api/hits", async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!ensureAuthorized(req)) {
      return res.status(401).json({ status: "error", message: "Invalid API key" });
    }

    const parsed = hitPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ status: "error", message: "Invalid payload", issues: parsed.error.issues });
    }

    const payload = parsed.data;
    const record = {
      hitId: payload.hitId,
      source: payload.source,
      isDrop: payload.isDrop,
      buttonLabel: payload.buttonLabel ?? null,
      hitTriggeredAt: payload.triggeredAt ?? null,
      warId: payload.war?.id ?? null,
      battleId: payload.war?.battleId ?? null,
      warUrl: payload.war?.url ?? payload.pageUrl ?? null,
      regionId: payload.war?.region?.id ?? null,
      regionName: payload.war?.region?.name ?? null,
      attackerId: payload.war?.attacker?.id ?? null,
      attackerName: payload.war?.attacker?.name ?? null,
      defenderId: payload.war?.defender?.id ?? null,
      defenderName: payload.war?.defender?.name ?? null,
      warEffects: payload.war?.effects ?? null,
      roundNumber: payload.round?.number ?? null,
      roundLabel: payload.round?.label ?? null,
      roundTimerSeconds: payload.round?.timerSeconds ?? null,
      playerName: payload.player.name,
      playerLocation: payload.player.location ?? null,
      playerEnergyCurrent: payload.player.energy?.current ?? null,
      playerEnergyMax: payload.player.energy?.max ?? null,
      playerFoodCurrent: payload.player.food?.current ?? null,
      playerFoodMax: payload.player.food?.max ?? null,
      playerConsumablesCurrent: payload.player.consumables?.current ?? null,
      playerConsumablesMax: payload.player.consumables?.max ?? null,
      currencyGold: payload.currencies?.gold ?? null,
      currencyPln: payload.currencies?.pln ?? null,
      currencyDetails: payload.currencies?.details ?? null,
      dropChance: payload.dropChance ?? null,
      dropMessageId: payload.drop?.messageId ?? null,
      dropHeading: payload.drop?.heading ?? null,
      dropDescription: payload.drop?.description ?? null,
      extra: serializeExtra({
        pageUrl: payload.pageUrl ?? null,
        extra: payload.extra ?? null,
        metadata: payload.metadata ?? null,
      }),
    } as const;

    const hitId = await insertHitRecord(record);
    return res.json({ status: "ok", id: hitId });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/hits", async (req: Request, res: Response) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ status: "error", message: "Invalid query", issues: parsed.error.issues });
  }

  const rows = await listHitRecords(parsed.data);
  return res.json({ status: "ok", data: rows });
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[DropMonitor] Unhandled error", err);
  res.status(500).json({ status: "error", message: "Internal server error" });
});

app.listen(port, () => {
  console.log(`[DropMonitor] API listening on port ${port}`);
});
