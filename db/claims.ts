import { getSql } from "./index";
import type { FestivalConfig } from "../app/lib/demo-store";
import { festivalConfigSchema, newFestivalSchema } from "../app/lib/validation";

export type ClaimRuleStat = { achievementId: string; claimCode: string; claimedCount: number; maxClaims: number; enabled: boolean };
export type FestivalSummary = { eventId: string; name: string; eyebrow: string; subtitle: string; dateLabel: string; status: FestivalConfig["status"]; updatedAt: string };
export type NewFestivalInput = { eventId: string; name: string; eyebrow: string; subtitle: string; dateLabel: string };
export class FestivalAlreadyExistsError extends Error {}
export type OnlineClaimResult = {
  status: "claimed" | "already" | "event_closed" | "achievement_disabled" | "limit_reached" | "not_found";
  achievement?: { id: string; name: string; description: string; icon: string };
  claimedCount?: number; maxClaims?: number;
};

type EventRow = { event_id: string; status: string; config_json: string; updated_at: string | Date };
type RuleRow = { achievement_id: string; claim_code: string; claimed_count: number; max_claims: number; enabled: boolean };

function normalizeConfig(config: FestivalConfig): FestivalConfig {
  return festivalConfigSchema.parse(config) as FestivalConfig;
}

export function toPublicFestivalConfig(config: FestivalConfig): FestivalConfig {
  return {
    ...config,
    achievements: config.achievements.map((achievement) => ({ ...achievement, claimCode: "" })),
  };
}

export async function syncFestivalConfig(input: FestivalConfig) {
  const sql = getSql();
  const config = normalizeConfig(input);
  await sql.begin(async (tx) => {
    await tx`INSERT INTO claim_events (event_id, status, config_json, updated_at)
       VALUES (${config.eventId}, ${config.status}, ${JSON.stringify(config)}, CURRENT_TIMESTAMP)
       ON CONFLICT (event_id) DO UPDATE SET status = EXCLUDED.status, config_json = EXCLUDED.config_json, updated_at = CURRENT_TIMESTAMP`;
    await tx`UPDATE claim_rules SET enabled = false, updated_at = CURRENT_TIMESTAMP WHERE event_id = ${config.eventId}`;
    for (const item of config.achievements) {
      await tx`INSERT INTO claim_rules
        (event_id, achievement_id, claim_code, name, description, icon, enabled, max_claims, updated_at)
        VALUES (${config.eventId}, ${item.id}, ${item.claimCode}, ${item.name}, ${item.description}, ${item.icon}, ${item.enabled}, ${item.claimLimit}, CURRENT_TIMESTAMP)
        ON CONFLICT (event_id, achievement_id) DO UPDATE SET claim_code = EXCLUDED.claim_code, name = EXCLUDED.name,
        description = EXCLUDED.description, icon = EXCLUDED.icon, enabled = EXCLUDED.enabled,
        max_claims = GREATEST(EXCLUDED.max_claims, claim_rules.claimed_count), updated_at = CURRENT_TIMESTAMP`;
    }
  });
  return config;
}

export async function loadFestivalConfigFromServer(eventId: string) {
  const rows = await getSql()`SELECT config_json FROM claim_events WHERE event_id = ${eventId}` as { config_json: string }[];
  return rows[0] ? normalizeConfig(JSON.parse(rows[0].config_json) as FestivalConfig) : null;
}

export async function loadActiveFestivalFromServer() {
  const rows = await getSql()`SELECT config_json FROM claim_events WHERE status = 'active' ORDER BY updated_at DESC, event_id LIMIT 1` as { config_json: string }[];
  return rows[0] ? normalizeConfig(JSON.parse(rows[0].config_json) as FestivalConfig) : null;
}

export async function listFestivals(): Promise<FestivalSummary[]> {
  const rows = await getSql()`SELECT event_id, status, config_json, updated_at FROM claim_events ORDER BY updated_at DESC, event_id` as EventRow[];
  return rows.flatMap((row) => {
    try {
      const config = normalizeConfig(JSON.parse(row.config_json) as FestivalConfig);
      return [{ eventId: row.event_id, name: config.name, eyebrow: config.eyebrow, subtitle: config.subtitle,
        dateLabel: config.dateLabel, status: row.status === "active" ? "active" as const : "closed" as const,
        updatedAt: new Date(row.updated_at).toISOString() }];
    } catch { return []; }
  });
}

export async function createFestival(input: NewFestivalInput): Promise<FestivalConfig> {
  const parsed = newFestivalSchema.parse(input);
  const eventId = parsed.eventId.toLowerCase();
  const { name, eyebrow, subtitle, dateLabel } = parsed;
  const config: FestivalConfig = { eventId, name, eyebrow, subtitle, dateLabel, status: "closed", categories: [], achievements: [] };
  const rows = await getSql()`INSERT INTO claim_events (event_id, status, config_json)
    VALUES (${eventId}, 'closed', ${JSON.stringify(config)}) ON CONFLICT (event_id) DO NOTHING RETURNING event_id`;
  if (rows.length === 0) throw new FestivalAlreadyExistsError("这个活动编号已经存在");
  return config;
}

export async function getClaimStats(eventId: string): Promise<ClaimRuleStat[]> {
  const rows = await getSql()`SELECT achievement_id, claim_code, claimed_count, max_claims, enabled
    FROM claim_rules WHERE event_id = ${eventId} ORDER BY achievement_id` as RuleRow[];
  return rows.map((row) => ({ achievementId: row.achievement_id, claimCode: row.claim_code,
    claimedCount: row.claimed_count, maxClaims: row.max_claims, enabled: row.enabled }));
}

export async function hashClaimDeviceId(eventId: string, deviceId: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${eventId}:${deviceId}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function claimOnline(eventId: string, claimCode: string, deviceId: string): Promise<OnlineClaimResult> {
  const deviceHash = await hashClaimDeviceId(eventId, deviceId);
  const rows = await getSql()`SELECT * FROM claim_achievement(${eventId}, ${claimCode}, ${deviceHash})` as Array<{
    result_status: OnlineClaimResult["status"]; achievement_id: string | null; achievement_name: string | null;
    achievement_description: string | null; achievement_icon: string | null;
    result_claimed_count: number | null; result_max_claims: number | null;
  }>;
  const row = rows[0];
  if (!row || row.result_status === "not_found") return { status: "not_found" };
  return { status: row.result_status, achievement: { id: row.achievement_id!, name: row.achievement_name!,
    description: row.achievement_description!, icon: row.achievement_icon! },
    ...(row.result_claimed_count == null ? {} : { claimedCount: row.result_claimed_count }),
    ...(row.result_max_claims == null ? {} : { maxClaims: row.result_max_claims }) };
}

export async function consumeClaimRateLimit(rateKey: string, maximum: number, windowSeconds: number) {
  const rows = await getSql()`INSERT INTO claim_rate_limits (rate_key, window_started_at, attempt_count)
    VALUES (${rateKey}, CURRENT_TIMESTAMP, 1)
    ON CONFLICT (rate_key) DO UPDATE SET
      window_started_at = CASE
        WHEN claim_rate_limits.window_started_at <= CURRENT_TIMESTAMP - make_interval(secs => ${windowSeconds}) THEN CURRENT_TIMESTAMP
        ELSE claim_rate_limits.window_started_at END,
      attempt_count = CASE
        WHEN claim_rate_limits.window_started_at <= CURRENT_TIMESTAMP - make_interval(secs => ${windowSeconds}) THEN 1
        ELSE claim_rate_limits.attempt_count + 1 END
    RETURNING attempt_count` as { attempt_count: number }[];
  return (rows[0]?.attempt_count ?? maximum + 1) <= maximum;
}

export async function resetClaimCount(eventId: string, achievementId: string) {
  const sql = getSql();
  await sql.begin(async (tx) => {
    await tx`DELETE FROM claim_records WHERE event_id = ${eventId} AND achievement_id = ${achievementId}`;
    await tx`UPDATE claim_rules AS rule SET
      claimed_count = 0,
      max_claims = COALESCE((
        SELECT (achievement.value->>'claimLimit')::integer
        FROM claim_events AS event
        CROSS JOIN LATERAL jsonb_array_elements(event.config_json::jsonb->'achievements') AS achievement(value)
        WHERE event.event_id = ${eventId} AND achievement.value->>'id' = ${achievementId}
      ), rule.max_claims),
      updated_at = CURRENT_TIMESTAMP
      WHERE rule.event_id = ${eventId} AND rule.achievement_id = ${achievementId}`;
  });
}
