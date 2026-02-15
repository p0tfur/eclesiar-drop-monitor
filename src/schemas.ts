import { z } from "zod";

const optionalNumber = z
  .union([z.number(), z.string(), z.null()])
  .transform((value) => {
    if (value === null) {
      return undefined;
    }
    if (typeof value === "number") {
      return Number.isNaN(value) ? undefined : value;
    }
    const sanitized = value.trim();
    if (!sanitized) return undefined;
    const parsed = Number(sanitized);
    return Number.isNaN(parsed) ? undefined : parsed;
  })
  .optional();

const optionalInteger = optionalNumber.transform((value) => {
  if (typeof value === "undefined") return undefined;
  return Number.isInteger(value) ? value : Math.trunc(value);
});

const optionalString = z
  .union([z.string(), z.number(), z.null()])
  .transform((value) => {
    if (value === null) {
      return undefined;
    }
    return String(value).trim();
  })
  .optional();

const optionalBoolean = z
  .union([z.boolean(), z.string(), z.number(), z.null()])
  .transform((value) => {
    if (value === null || typeof value === "undefined") {
      return undefined;
    }
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "number") {
      return value !== 0;
    }
    const normalized = value.trim().toLowerCase();
    if (!normalized) return undefined;
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
    return undefined;
  })
  .optional();

export const hitPayloadSchema = z.object({
  hitId: z.string().min(1),
  triggeredAt: optionalString,
  buttonLabel: optionalString,
  isDrop: z.boolean().default(false),
  source: z.string().min(1).default("drop-monitor"),
  pageUrl: z.string().url().optional(),
  war: z
    .object({
      id: optionalInteger,
      url: z.string().url().optional(),
      battleId: optionalString,
      region: z
        .object({
          id: optionalInteger,
          name: optionalString,
        })
        .optional(),
      attacker: z
        .object({
          id: optionalInteger,
          name: optionalString,
        })
        .optional(),
      defender: z
        .object({
          id: optionalInteger,
          name: optionalString,
        })
        .optional(),
      effects: optionalString,
    })
    .optional(),
  round: z
    .object({
      number: optionalInteger,
      label: optionalString,
      timerSeconds: optionalInteger,
    })
    .optional(),
  player: z.object({
    name: z.string().min(1),
    location: optionalString,
    energy: z
      .object({
        current: optionalInteger,
        max: optionalInteger,
      })
      .optional(),
    food: z
      .object({
        current: optionalInteger,
        max: optionalInteger,
      })
      .optional(),
    consumables: z
      .object({
        current: optionalInteger,
        max: optionalInteger,
      })
      .optional(),
  }),
  currencies: z
    .object({
      gold: optionalNumber,
      pln: optionalNumber,
      details: optionalString,
    })
    .optional(),
  dropChance: optionalNumber,
  drop: z
    .object({
      messageId: optionalString,
      heading: optionalString,
      description: optionalString,
    })
    .optional(),
  fightDrop: z
    .object({
      seed: optionalInteger,
      chance: optionalNumber,
      debug: z.record(z.any()).optional(),
    })
    .optional(),
  fightDamage: z
    .object({
      damage: optionalNumber,
      min_damage: optionalNumber,
      max_damage: optionalNumber,
      min_damage_without_bonus: optionalNumber,
      max_damage_without_bonus: optionalNumber,
    })
    .optional(),
  extra: z.record(z.any()).optional(),
  metadata: z.record(z.any()).optional(),
});

export type HitPayload = z.infer<typeof hitPayloadSchema>;

export const listQuerySchema = z.object({
  warId: optionalInteger,
  playerName: optionalString,
  afterId: optionalInteger,
  limit: optionalInteger,
  includeAll: optionalBoolean,
});

export type ListQuery = z.infer<typeof listQuerySchema>;

export const analysisQuerySchema = z.object({
  warId: optionalInteger,
  playerName: optionalString,
  days: optionalInteger,
  limit: optionalInteger,
});

export type AnalysisQuery = z.infer<typeof analysisQuerySchema>;
