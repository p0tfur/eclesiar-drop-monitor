import fs from "fs";
import path from "path";
import sqlite3 from "sqlite3";
import { open, Database } from "sqlite";
import { config } from "./config";

export type HitRecordInsert = {
  hitId: string;
  source: string;
  isDrop: boolean;
  buttonLabel?: string | null;
  hitTriggeredAt?: string | null;
  warId?: number | null;
  battleId?: string | null;
  warUrl?: string | null;
  regionId?: number | null;
  regionName?: string | null;
  attackerId?: number | null;
  attackerName?: string | null;
  defenderId?: number | null;
  defenderName?: string | null;
  warEffects?: string | null;
  roundNumber?: number | null;
  roundLabel?: string | null;
  roundTimerSeconds?: number | null;
  playerName: string;
  playerLocation?: string | null;
  playerEnergyCurrent?: number | null;
  playerEnergyMax?: number | null;
  playerFoodCurrent?: number | null;
  playerFoodMax?: number | null;
  playerConsumablesCurrent?: number | null;
  playerConsumablesMax?: number | null;
  currencyGold?: number | null;
  currencyPln?: number | null;
  currencyDetails?: string | null;
  dropChance?: number | null;
  fightDropSeed?: number | null;
  fightDropChance?: number | null;
  fightDropDebug?: string | null;
  damage?: number | null;
  minDamage?: number | null;
  maxDamage?: number | null;
  minDamageWithoutBonus?: number | null;
  maxDamageWithoutBonus?: number | null;
  dropMessageId?: string | null;
  dropHeading?: string | null;
  dropDescription?: string | null;
  extra?: string | null;
};

export type HitRecordRow = HitRecordInsert & {
  id: number;
  createdAt: string;
};

export type HitRecordListResult = {
  rows: HitRecordRow[];
  totalHits: number;
  totalDrops: number;
  lastDropAt: string | null;
};

export type HitAnalysisResult = {
  scope: {
    warId: number | null;
    playerName: string | null;
    days: number | null;
    rowCount: number;
  };
  roll: {
    denominator: number | null;
    minSeed: number | null;
    maxSeed: number | null;
    minChance: number | null;
    maxChance: number | null;
    avgChance: number | null;
  };
  totals: {
    hits: number;
    observedDrops: number;
    observedDropRate: number | null;
    expectedDrops: number | null;
    expectedDropRate: number | null;
    currentDryStreak: number | null;
    maxDryStreak: number | null;
  };
  debugAverages: Record<string, number>;
  daily: Array<{ date: string; hits: number; observedDrops: number; expectedDrops: number | null }>;
  seedHistogram: Array<{ from: number; to: number; count: number }>;
  damage: {
    samples: number;
    misses: number;
    missRate: number | null;
    hitSamples: number;
    avgDamage: number | null;
    minDamageObserved: number | null;
    maxDamageObserved: number | null;
    avgHitDamage: number | null;
    minHitDamageObserved: number | null;
    maxHitDamageObserved: number | null;
    avgMinDamage: number | null;
    avgMaxDamage: number | null;
    avgMinDamageWithoutBonus: number | null;
    avgMaxDamageWithoutBonus: number | null;
    rangeComparableSamples: number;
    rangeWithinSamples: number;
    rangeBelowMinSamples: number;
    rangeAboveMaxSamples: number;
    rangeWithinRate: number | null;
    avgDeclaredSpan: number | null;
    histogram: Array<{ from: number; to: number; count: number }>;
    hitHistogram: Array<{ from: number; to: number; count: number }>;
    declaredMinHistogram: Array<{ from: number; to: number; count: number }>;
    declaredMaxHistogram: Array<{ from: number; to: number; count: number }>;
  };
  dryStreakHistogram: Array<{ from: number; to: number; count: number }>;
};

let dbPromise: Promise<Database> | null = null;

function ensureDirectoryExists(targetPath: string) {
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function getDb(): Promise<Database> {
  if (!dbPromise) {
    ensureDirectoryExists(config.dbPath);
    sqlite3.verbose();
    dbPromise = open({
      filename: config.dbPath,
      driver: sqlite3.Database,
    }).then(async (db) => {
      await db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA cache_size = -64000;
        PRAGMA temp_store = MEMORY;
        PRAGMA mmap_size = 30000000000;

        CREATE TABLE IF NOT EXISTS war_hits (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          hit_id TEXT NOT NULL UNIQUE,
          source TEXT NOT NULL,
          is_drop INTEGER NOT NULL DEFAULT 0,
          button_label TEXT,
          hit_triggered_at TEXT,
          war_id INTEGER,
          battle_id TEXT,
          war_url TEXT,
          region_id INTEGER,
          region_name TEXT,
          attacker_id INTEGER,
          attacker_name TEXT,
          defender_id INTEGER,
          defender_name TEXT,
          war_effects TEXT,
          round_number INTEGER,
          round_label TEXT,
          round_timer_seconds INTEGER,
          player_name TEXT NOT NULL,
          player_location TEXT,
          player_energy_current INTEGER,
          player_energy_max INTEGER,
          player_food_current INTEGER,
          player_food_max INTEGER,
          player_consumables_current INTEGER,
          player_consumables_max INTEGER,
          currency_gold REAL,
          currency_pln REAL,
          currency_details TEXT,
          drop_chance REAL,
          fight_drop_seed INTEGER,
          fight_drop_chance REAL,
          fight_drop_debug TEXT,
          damage REAL,
          min_damage REAL,
          max_damage REAL,
          min_damage_without_bonus REAL,
          max_damage_without_bonus REAL,
          drop_message_id TEXT,
          drop_heading TEXT,
          drop_description TEXT,
          extra TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_war_hits_war_id ON war_hits(war_id);
        CREATE INDEX IF NOT EXISTS idx_war_hits_player ON war_hits(player_name);
        CREATE INDEX IF NOT EXISTS idx_war_hits_created ON war_hits(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_war_hits_is_drop ON war_hits(is_drop) WHERE is_drop = 1;
        CREATE INDEX IF NOT EXISTS idx_war_hits_composite ON war_hits(player_name, created_at DESC) WHERE is_drop = 1;
      `);
      await ensureColumnExists(db, "war_hits", "fight_drop_seed", "INTEGER");
      await ensureColumnExists(db, "war_hits", "fight_drop_chance", "REAL");
      await ensureColumnExists(db, "war_hits", "fight_drop_debug", "TEXT");
      await ensureColumnExists(db, "war_hits", "damage", "REAL");
      await ensureColumnExists(db, "war_hits", "min_damage", "REAL");
      await ensureColumnExists(db, "war_hits", "max_damage", "REAL");
      await ensureColumnExists(db, "war_hits", "min_damage_without_bonus", "REAL");
      await ensureColumnExists(db, "war_hits", "max_damage_without_bonus", "REAL");
      return db;
    });
  }

  return dbPromise;
}

export async function initDb(): Promise<Database> {
  return getDb();
}

async function ensureColumnExists(db: Database, tableName: string, columnName: string, columnTypeSql: string): Promise<void> {
  const columns = await db.all<{ name: string }[]>(`PRAGMA table_info(${tableName})`);
  if (Array.isArray(columns) && columns.some((column) => column.name === columnName)) {
    return;
  }
  await db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnTypeSql}`);
}

export async function insertHitRecord(record: HitRecordInsert): Promise<string> {
  const db = await getDb();
  await db.run("BEGIN IMMEDIATE");
  try {
    const params = [
      record.hitId,
      record.source,
      record.isDrop ? 1 : 0,
      record.buttonLabel ?? null,
      record.hitTriggeredAt ?? null,
      record.warId ?? null,
      record.battleId ?? null,
      record.warUrl ?? null,
      record.regionId ?? null,
      record.regionName ?? null,
      record.attackerId ?? null,
      record.attackerName ?? null,
      record.defenderId ?? null,
      record.defenderName ?? null,
      record.warEffects ?? null,
      record.roundNumber ?? null,
      record.roundLabel ?? null,
      record.roundTimerSeconds ?? null,
      record.playerName,
      record.playerLocation ?? null,
      record.playerEnergyCurrent ?? null,
      record.playerEnergyMax ?? null,
      record.playerFoodCurrent ?? null,
      record.playerFoodMax ?? null,
      record.playerConsumablesCurrent ?? null,
      record.playerConsumablesMax ?? null,
      record.currencyGold ?? null,
      record.currencyPln ?? null,
      record.currencyDetails ?? null,
      record.dropChance ?? null,
      record.fightDropSeed ?? null,
      record.fightDropChance ?? null,
      record.fightDropDebug ?? null,
      record.damage ?? null,
      record.minDamage ?? null,
      record.maxDamage ?? null,
      record.minDamageWithoutBonus ?? null,
      record.maxDamageWithoutBonus ?? null,
      record.dropMessageId ?? null,
      record.dropHeading ?? null,
      record.dropDescription ?? null,
      record.extra ?? null,
    ];

    await db.run(
      `
      INSERT INTO war_hits (
      hit_id,
      source,
      is_drop,
      button_label,
      hit_triggered_at,
      war_id,
      battle_id,
      war_url,
      region_id,
      region_name,
      attacker_id,
      attacker_name,
      defender_id,
      defender_name,
      war_effects,
      round_number,
      round_label,
      round_timer_seconds,
      player_name,
      player_location,
      player_energy_current,
      player_energy_max,
      player_food_current,
      player_food_max,
      player_consumables_current,
      player_consumables_max,
      currency_gold,
      currency_pln,
      currency_details,
      drop_chance,
      fight_drop_seed,
      fight_drop_chance,
      fight_drop_debug,
      damage,
      min_damage,
      max_damage,
      min_damage_without_bonus,
      max_damage_without_bonus,
      drop_message_id,
      drop_heading,
      drop_description,
      extra
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
    ON CONFLICT(hit_id) DO UPDATE SET
      source = excluded.source,
      is_drop = CASE WHEN war_hits.is_drop = 1 OR excluded.is_drop = 1 THEN 1 ELSE 0 END,
      button_label = COALESCE(excluded.button_label, war_hits.button_label),
      hit_triggered_at = COALESCE(excluded.hit_triggered_at, war_hits.hit_triggered_at),
      war_id = COALESCE(excluded.war_id, war_hits.war_id),
      battle_id = COALESCE(excluded.battle_id, war_hits.battle_id),
      war_url = COALESCE(excluded.war_url, war_hits.war_url),
      region_id = COALESCE(excluded.region_id, war_hits.region_id),
      region_name = COALESCE(excluded.region_name, war_hits.region_name),
      attacker_id = COALESCE(excluded.attacker_id, war_hits.attacker_id),
      attacker_name = COALESCE(excluded.attacker_name, war_hits.attacker_name),
      defender_id = COALESCE(excluded.defender_id, war_hits.defender_id),
      defender_name = COALESCE(excluded.defender_name, war_hits.defender_name),
      war_effects = COALESCE(excluded.war_effects, war_hits.war_effects),
      round_number = COALESCE(excluded.round_number, war_hits.round_number),
      round_label = COALESCE(excluded.round_label, war_hits.round_label),
      round_timer_seconds = COALESCE(excluded.round_timer_seconds, war_hits.round_timer_seconds),
      player_name = COALESCE(excluded.player_name, war_hits.player_name),
      player_location = COALESCE(excluded.player_location, war_hits.player_location),
      player_energy_current = COALESCE(excluded.player_energy_current, war_hits.player_energy_current),
      player_energy_max = COALESCE(excluded.player_energy_max, war_hits.player_energy_max),
      player_food_current = COALESCE(excluded.player_food_current, war_hits.player_food_current),
      player_food_max = COALESCE(excluded.player_food_max, war_hits.player_food_max),
      player_consumables_current = COALESCE(excluded.player_consumables_current, war_hits.player_consumables_current),
      player_consumables_max = COALESCE(excluded.player_consumables_max, war_hits.player_consumables_max),
      currency_gold = COALESCE(excluded.currency_gold, war_hits.currency_gold),
      currency_pln = COALESCE(excluded.currency_pln, war_hits.currency_pln),
      currency_details = COALESCE(excluded.currency_details, war_hits.currency_details),
      drop_chance = COALESCE(excluded.drop_chance, war_hits.drop_chance),
      fight_drop_seed = COALESCE(excluded.fight_drop_seed, war_hits.fight_drop_seed),
      fight_drop_chance = COALESCE(excluded.fight_drop_chance, war_hits.fight_drop_chance),
      fight_drop_debug = COALESCE(excluded.fight_drop_debug, war_hits.fight_drop_debug),
      damage = COALESCE(excluded.damage, war_hits.damage),
      min_damage = COALESCE(excluded.min_damage, war_hits.min_damage),
      max_damage = COALESCE(excluded.max_damage, war_hits.max_damage),
      min_damage_without_bonus = COALESCE(excluded.min_damage_without_bonus, war_hits.min_damage_without_bonus),
      max_damage_without_bonus = COALESCE(excluded.max_damage_without_bonus, war_hits.max_damage_without_bonus),
      drop_message_id = COALESCE(excluded.drop_message_id, war_hits.drop_message_id),
      drop_heading = COALESCE(excluded.drop_heading, war_hits.drop_heading),
      drop_description = COALESCE(excluded.drop_description, war_hits.drop_description),
      extra = COALESCE(excluded.extra, war_hits.extra)
    `,
      params,
    );
    await db.run("COMMIT");
    return record.hitId;
  } catch (error) {
    await db.run("ROLLBACK");
    throw error;
  }
}

export async function listHitRecords(filters: {
  warId?: number;
  playerName?: string;
  limit?: number;
  afterId?: number;
}): Promise<HitRecordListResult> {
  const db = await getDb();
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 500);
  const queryParams = {
    ":warId": filters.warId ?? null,
    ":playerName": filters.playerName ?? null,
    ":afterId": filters.afterId ?? null,
  };

  const totals = await db.get<{ totalHits: number; totalDrops: number; lastDropAt: string | null }>(
    `
    SELECT
      COUNT(*) as totalHits,
      SUM(CASE WHEN is_drop = 1 THEN 1 ELSE 0 END) as totalDrops,
      MAX(CASE WHEN is_drop = 1 THEN created_at ELSE NULL END) as lastDropAt
    FROM war_hits
    WHERE
      (:warId IS NULL OR war_id = :warId)
      AND (:playerName IS NULL OR player_name = :playerName)
      AND (:afterId IS NULL OR id > :afterId)
  `,
    queryParams,
  );

  const rows = await db.all<HitRecordRow[]>(
    `
    SELECT
      id,
      created_at as createdAt,
      hit_id as hitId,
      source,
      is_drop as isDrop,
      button_label as buttonLabel,
      hit_triggered_at as hitTriggeredAt,
      war_id as warId,
      battle_id as battleId,
      war_url as warUrl,
      region_id as regionId,
      region_name as regionName,
      attacker_id as attackerId,
      attacker_name as attackerName,
      defender_id as defenderId,
      defender_name as defenderName,
      war_effects as warEffects,
      round_number as roundNumber,
      round_label as roundLabel,
      round_timer_seconds as roundTimerSeconds,
      player_name as playerName,
      player_location as playerLocation,
      player_energy_current as playerEnergyCurrent,
      player_energy_max as playerEnergyMax,
      player_food_current as playerFoodCurrent,
      player_food_max as playerFoodMax,
      player_consumables_current as playerConsumablesCurrent,
      player_consumables_max as playerConsumablesMax,
      drop_chance as dropChance,
      fight_drop_seed as fightDropSeed,
      fight_drop_chance as fightDropChance,
      fight_drop_debug as fightDropDebug,
      damage as damage,
      min_damage as minDamage,
      max_damage as maxDamage,
      min_damage_without_bonus as minDamageWithoutBonus,
      max_damage_without_bonus as maxDamageWithoutBonus,
      drop_message_id as dropMessageId,
      drop_heading as dropHeading,
      drop_description as dropDescription,
      extra
    FROM war_hits
    WHERE
      (:warId IS NULL OR war_id = :warId)
      AND (:playerName IS NULL OR player_name = :playerName)
      AND (:afterId IS NULL OR id > :afterId)
    ORDER BY created_at DESC
    LIMIT :limit
  `,
    {
      ...queryParams,
      ":limit": limit,
    },
  );
  return {
    rows,
    totalHits: Number(totals?.totalHits ?? 0),
    totalDrops: Number(totals?.totalDrops ?? 0),
    lastDropAt: totals?.lastDropAt ?? null,
  };
}

function computeDenominator(maxSeed: number | null): number | null {
  if (maxSeed == null || !Number.isFinite(maxSeed) || maxSeed <= 0) {
    return null;
  }
  const digits = Math.max(1, String(Math.trunc(maxSeed)).length);
  return Math.pow(10, digits);
}

function safeJsonParse(text: string | null): any | null {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_err) {
    return null;
  }
}

export async function analyzeHitRecords(filters: {
  warId?: number;
  playerName?: string;
  days?: number;
  limit?: number;
}): Promise<HitAnalysisResult> {
  const db = await getDb();
  const queryParams: Record<string, unknown> = {
    ":warId": filters.warId ?? null,
    ":playerName": filters.playerName ?? null,
  };

  const days = typeof filters.days === "number" && Number.isFinite(filters.days) && filters.days > 0 ? filters.days : null;
  const sinceClause = days ? "AND created_at >= datetime('now', :sinceExpr)" : "";
  if (days) {
    queryParams[":sinceExpr"] = `-${Math.trunc(days)} days`;
  }

  const limit = Math.min(Math.max(filters.limit ?? 200000, 1), 500000);

  const rows = await db.all<
    Array<{
      createdAt: string;
      isDrop: number;
      fightDropSeed: number | null;
      fightDropChance: number | null;
      fightDropDebug: string | null;
      damage: number | null;
      minDamage: number | null;
      maxDamage: number | null;
      minDamageWithoutBonus: number | null;
      maxDamageWithoutBonus: number | null;
    }>
  >(
    `
    SELECT
      created_at as createdAt,
      is_drop as isDrop,
      fight_drop_seed as fightDropSeed,
      fight_drop_chance as fightDropChance,
      fight_drop_debug as fightDropDebug,
      damage as damage,
      min_damage as minDamage,
      max_damage as maxDamage,
      min_damage_without_bonus as minDamageWithoutBonus,
      max_damage_without_bonus as maxDamageWithoutBonus
    FROM war_hits
    WHERE
      (:warId IS NULL OR war_id = :warId)
      AND (:playerName IS NULL OR player_name = :playerName)
      ${sinceClause}
    ORDER BY created_at ASC
    LIMIT :limit
  `,
    {
      ...queryParams,
      ":limit": limit,
    },
  );

  let observedDrops = 0;
  let expectedDropsSum: number | null = 0;
  let chanceSum = 0;
  let chanceCount = 0;

  let minSeed: number | null = null;
  let maxSeed: number | null = null;
  let minChance: number | null = null;
  let maxChance: number | null = null;
  let damageCount = 0;
  let missCount = 0;
  let hitDamageCount = 0;
  let damageSum = 0;
  let minDamageObserved: number | null = null;
  let maxDamageObserved: number | null = null;
  let hitDamageSum = 0;
  let minHitDamageObserved: number | null = null;
  let maxHitDamageObserved: number | null = null;
  let minDamageSum = 0;
  let minDamageCount = 0;
  let maxDamageSum = 0;
  let maxDamageCount = 0;
  let minDamageWithoutBonusSum = 0;
  let minDamageWithoutBonusCount = 0;
  let maxDamageWithoutBonusSum = 0;
  let maxDamageWithoutBonusCount = 0;
  let rangeComparableCount = 0;
  let rangeWithinCount = 0;
  let rangeBelowMinCount = 0;
  let rangeAboveMaxCount = 0;
  let declaredSpanSum = 0;
  let declaredSpanCount = 0;

  const debugSum: Record<string, number> = {};
  const debugCount: Record<string, number> = {};

  const dailyMap = new Map<string, { hits: number; observedDrops: number; chanceSum: number; chanceCount: number }>();

  // Streaks
  let currentDry = 0;
  let maxDry = 0;
  const dryStreaks: number[] = [];

  for (const row of rows) {
    const seed = typeof row.fightDropSeed === "number" && Number.isFinite(row.fightDropSeed) ? row.fightDropSeed : null;
    const chance =
      typeof row.fightDropChance === "number" && Number.isFinite(row.fightDropChance) ? row.fightDropChance : null;
    const inferredDrop = Boolean(row.isDrop === 1) || (seed != null && chance != null && seed <= chance);

    if (inferredDrop) {
      observedDrops += 1;
      dryStreaks.push(currentDry);
      if (currentDry > maxDry) maxDry = currentDry;
      currentDry = 0;
    } else {
      currentDry += 1;
    }

    if (seed != null) {
      minSeed = minSeed == null ? seed : Math.min(minSeed, seed);
      maxSeed = maxSeed == null ? seed : Math.max(maxSeed, seed);
    }
    if (chance != null) {
      minChance = minChance == null ? chance : Math.min(minChance, chance);
      maxChance = maxChance == null ? chance : Math.max(maxChance, chance);
      chanceSum += chance;
      chanceCount += 1;
    }
    if (typeof row.damage === "number" && Number.isFinite(row.damage)) {
      damageCount += 1;
      damageSum += row.damage;
      minDamageObserved = minDamageObserved == null ? row.damage : Math.min(minDamageObserved, row.damage);
      maxDamageObserved = maxDamageObserved == null ? row.damage : Math.max(maxDamageObserved, row.damage);
      if (row.damage === 0) {
        missCount += 1;
      } else if (row.damage > 0) {
        hitDamageCount += 1;
        hitDamageSum += row.damage;
        minHitDamageObserved = minHitDamageObserved == null ? row.damage : Math.min(minHitDamageObserved, row.damage);
        maxHitDamageObserved = maxHitDamageObserved == null ? row.damage : Math.max(maxHitDamageObserved, row.damage);
      }
    }
    if (typeof row.minDamage === "number" && Number.isFinite(row.minDamage)) {
      minDamageSum += row.minDamage;
      minDamageCount += 1;
    }
    if (typeof row.maxDamage === "number" && Number.isFinite(row.maxDamage)) {
      maxDamageSum += row.maxDamage;
      maxDamageCount += 1;
    }
    if (typeof row.minDamageWithoutBonus === "number" && Number.isFinite(row.minDamageWithoutBonus)) {
      minDamageWithoutBonusSum += row.minDamageWithoutBonus;
      minDamageWithoutBonusCount += 1;
    }
    if (typeof row.maxDamageWithoutBonus === "number" && Number.isFinite(row.maxDamageWithoutBonus)) {
      maxDamageWithoutBonusSum += row.maxDamageWithoutBonus;
      maxDamageWithoutBonusCount += 1;
    }
    if (
      typeof row.damage === "number" &&
      Number.isFinite(row.damage) &&
      typeof row.minDamage === "number" &&
      Number.isFinite(row.minDamage) &&
      typeof row.maxDamage === "number" &&
      Number.isFinite(row.maxDamage)
    ) {
      rangeComparableCount += 1;
      if (row.damage < row.minDamage) {
        rangeBelowMinCount += 1;
      } else if (row.damage > row.maxDamage) {
        rangeAboveMaxCount += 1;
      } else {
        rangeWithinCount += 1;
      }
    }
    if (typeof row.minDamage === "number" && Number.isFinite(row.minDamage) && typeof row.maxDamage === "number" && Number.isFinite(row.maxDamage)) {
      const span = row.maxDamage - row.minDamage;
      if (Number.isFinite(span) && span >= 0) {
        declaredSpanSum += span;
        declaredSpanCount += 1;
      }
    }

    // Debug components
    const debugObj = safeJsonParse(row.fightDropDebug);
    if (debugObj && typeof debugObj === "object") {
      for (const [key, value] of Object.entries(debugObj)) {
        if (typeof value !== "number" || !Number.isFinite(value)) continue;
        debugSum[key] = (debugSum[key] || 0) + value;
        debugCount[key] = (debugCount[key] || 0) + 1;
      }
    }

    // Daily grouping (UTC date, based on stored created_at)
    const date = String(row.createdAt || "").slice(0, 10);
    if (date) {
      const day = dailyMap.get(date) || { hits: 0, observedDrops: 0, chanceSum: 0, chanceCount: 0 };
      day.hits += 1;
      if (inferredDrop) day.observedDrops += 1;
      if (chance != null) {
        day.chanceSum += chance;
        day.chanceCount += 1;
      }
      dailyMap.set(date, day);
    }
  }

  // If there was a trailing dry streak without a drop, include it in maxDry.
  if (currentDry > maxDry) maxDry = currentDry;

  const hits = rows.length;
  const denom = computeDenominator(maxSeed);
  if (!denom || chanceCount === 0) {
    expectedDropsSum = null;
  } else {
    // Interpret chance as threshold in [0..denom). Expected p ~= chance/denom.
    expectedDropsSum = chanceSum / denom;
  }

  const avgChance = chanceCount ? chanceSum / chanceCount : null;
  const observedDropRate = hits ? observedDrops / hits : null;
  const expectedDropRate = expectedDropsSum != null && hits ? expectedDropsSum / hits : null;

  const debugAverages: Record<string, number> = {};
  for (const key of Object.keys(debugSum)) {
    const cnt = debugCount[key] || 0;
    if (cnt) {
      debugAverages[key] = debugSum[key] / cnt;
    }
  }

  // Daily series (sorted)
  const daily: HitAnalysisResult["daily"] = Array.from(dailyMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, day]) => {
      const expectedDrops = denom && day.chanceCount ? day.chanceSum / denom : null;
      return { date, hits: day.hits, observedDrops: day.observedDrops, expectedDrops };
    });

  // Seed histogram (step = 100)
  const seedHistogram: HitAnalysisResult["seedHistogram"] = [];
  if (denom) {
    const binSize = 100;
    const bins = Math.max(1, Math.ceil(denom / binSize));
    const binCounts = new Array(bins).fill(0);
    for (const row of rows) {
      const seed = typeof row.fightDropSeed === "number" && Number.isFinite(row.fightDropSeed) ? row.fightDropSeed : null;
      if (seed == null) continue;
      const idx = Math.min(bins - 1, Math.max(0, Math.floor(seed / binSize)));
      binCounts[idx] += 1;
    }
    for (let i = 0; i < bins; i++) {
      const from = i * binSize;
      const to = Math.min(denom - 1, (i + 1) * binSize - 1);
      seedHistogram.push({ from, to, count: binCounts[i] });
    }
  }

  const buildHistogram = (values: Array<number | null | undefined>, step = 100): Array<{ from: number; to: number; count: number }> => {
    const nums = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0);
    if (!nums.length) return [];
    const maxValue = Math.max(...nums);
    const maxBucket = Math.max(step, Math.ceil((maxValue + 1) / step) * step);
    const bins = Math.max(1, Math.ceil(maxBucket / step));
    const counts = new Array(bins).fill(0);
    for (const num of nums) {
      const idx = Math.min(bins - 1, Math.max(0, Math.floor(num / step)));
      counts[idx] += 1;
    }
    const histogram: Array<{ from: number; to: number; count: number }> = [];
    for (let i = 0; i < bins; i++) {
      const from = i * step;
      const to = (i + 1) * step - 1;
      histogram.push({ from, to, count: counts[i] });
    }
    return histogram;
  };

  const damageHistogram = buildHistogram(rows.map((row) => row.damage), 100);
  const hitHistogram = buildHistogram(
    rows.map((row) => (typeof row.damage === "number" && Number.isFinite(row.damage) && row.damage > 0 ? row.damage : null)),
    100,
  );
  const declaredMinHistogram = buildHistogram(rows.map((row) => row.minDamage), 100);
  const declaredMaxHistogram = buildHistogram(rows.map((row) => row.maxDamage), 100);

  // Dry streak histogram (0-9, 10-19, ..., 100+)
  const dryStreakHistogram: HitAnalysisResult["dryStreakHistogram"] = [];
  const buckets = [0, 10, 20, 30, 40, 50, 75, 100];
  const bucketCounts = new Array(buckets.length + 1).fill(0);
  const allDry = dryStreaks.length ? dryStreaks : [];
  for (const len of allDry) {
    let placed = false;
    for (let i = 0; i < buckets.length; i++) {
      const from = buckets[i];
      const to = (buckets[i + 1] ?? Infinity) - 1;
      if (len >= from && len <= to) {
        bucketCounts[i] += 1;
        placed = true;
        break;
      }
    }
    if (!placed) {
      bucketCounts[buckets.length] += 1;
    }
  }
  for (let i = 0; i < buckets.length; i++) {
    const from = buckets[i];
    const to = (buckets[i + 1] ?? 101) - 1;
    dryStreakHistogram.push({ from, to, count: bucketCounts[i] });
  }
  dryStreakHistogram.push({ from: 100, to: 1000000, count: bucketCounts[buckets.length] });

  return {
    scope: {
      warId: filters.warId ?? null,
      playerName: filters.playerName ?? null,
      days,
      rowCount: hits,
    },
    roll: {
      denominator: denom,
      minSeed,
      maxSeed,
      minChance,
      maxChance,
      avgChance,
    },
    totals: {
      hits,
      observedDrops,
      observedDropRate,
      expectedDrops: expectedDropsSum,
      expectedDropRate,
      currentDryStreak: hits ? currentDry : null,
      maxDryStreak: hits ? maxDry : null,
    },
    debugAverages,
    daily,
    seedHistogram,
    damage: {
      samples: damageCount,
      misses: missCount,
      missRate: damageCount ? missCount / damageCount : null,
      hitSamples: hitDamageCount,
      avgDamage: damageCount ? damageSum / damageCount : null,
      minDamageObserved,
      maxDamageObserved,
      avgHitDamage: hitDamageCount ? hitDamageSum / hitDamageCount : null,
      minHitDamageObserved,
      maxHitDamageObserved,
      avgMinDamage: minDamageCount ? minDamageSum / minDamageCount : null,
      avgMaxDamage: maxDamageCount ? maxDamageSum / maxDamageCount : null,
      avgMinDamageWithoutBonus: minDamageWithoutBonusCount ? minDamageWithoutBonusSum / minDamageWithoutBonusCount : null,
      avgMaxDamageWithoutBonus: maxDamageWithoutBonusCount ? maxDamageWithoutBonusSum / maxDamageWithoutBonusCount : null,
      rangeComparableSamples: rangeComparableCount,
      rangeWithinSamples: rangeWithinCount,
      rangeBelowMinSamples: rangeBelowMinCount,
      rangeAboveMaxSamples: rangeAboveMaxCount,
      rangeWithinRate: rangeComparableCount ? rangeWithinCount / rangeComparableCount : null,
      avgDeclaredSpan: declaredSpanCount ? declaredSpanSum / declaredSpanCount : null,
      histogram: damageHistogram,
      hitHistogram,
      declaredMinHistogram,
      declaredMaxHistogram,
    },
    dryStreakHistogram,
  };
}
