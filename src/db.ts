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
      drop_message_id,
      drop_heading,
      drop_description,
      extra
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
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
      currency_gold as currencyGold,
      currency_pln as currencyPln,
      currency_details as currencyDetails,
      drop_chance as dropChance,
      fight_drop_seed as fightDropSeed,
      fight_drop_chance as fightDropChance,
      fight_drop_debug as fightDropDebug,
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
