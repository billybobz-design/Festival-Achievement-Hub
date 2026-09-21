import { sql } from "drizzle-orm";
import { boolean, check, customType, foreignKey, index, integer, pgTable, primaryKey, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

const bytea = customType<{ data: Uint8Array }>({
  dataType() {
    return "bytea";
  },
});

export const claimEvents = pgTable("claim_events", {
  eventId: text("event_id").primaryKey(),
  status: text("status").notNull().default("closed"),
  configJson: text("config_json").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [check("claim_events_status_check", sql`${table.status} IN ('active', 'closed')`)]);

export const claimRules = pgTable("claim_rules", {
  eventId: text("event_id").notNull().references(() => claimEvents.eventId, { onDelete: "cascade" }),
  achievementId: text("achievement_id").notNull(),
  claimCode: text("claim_code").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  icon: text("icon").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  maxClaims: integer("max_claims").notNull().default(100),
  claimedCount: integer("claimed_count").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.eventId, table.achievementId] }),
  uniqueIndex("idx_claim_rules_event_code").on(table.eventId, table.claimCode),
  check("claim_rules_max_claims_check", sql`${table.maxClaims} BETWEEN 1 AND 100000`),
  check("claim_rules_claimed_count_check", sql`${table.claimedCount} BETWEEN 0 AND ${table.maxClaims}`),
]);

export const claimRecords = pgTable("claim_records", {
  id: serial("id").primaryKey(),
  eventId: text("event_id").notNull(),
  achievementId: text("achievement_id").notNull(),
  deviceHash: text("device_hash").notNull(),
  claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ columns: [table.eventId, table.achievementId], foreignColumns: [claimRules.eventId, claimRules.achievementId] }).onDelete("cascade"),
  uniqueIndex("idx_claim_records_unique_device").on(table.eventId, table.achievementId, table.deviceHash),
  index("idx_claim_records_achievement").on(table.eventId, table.achievementId),
]);

export const claimRateLimits = pgTable("claim_rate_limits", {
  rateKey: text("rate_key").primaryKey(),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull().defaultNow(),
  attemptCount: integer("attempt_count").notNull().default(1),
}, (table) => [check("claim_rate_limits_count_check", sql`${table.attemptCount} > 0`)]);

export const activityPackages = pgTable("activity_packages", {
  eventId: text("event_id").primaryKey().references(() => claimEvents.eventId, { onDelete: "cascade" }),
  name: text("name").notNull(),
  version: text("version").notNull(),
  entryPath: text("entry_path").notNull(),
  manifestJson: text("manifest_json").notNull(),
  fileCount: integer("file_count").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [check("activity_packages_file_count_check", sql`${table.fileCount} BETWEEN 1 AND 128`)]);

export const activityPackageFiles = pgTable("activity_package_files", {
  eventId: text("event_id").notNull().references(() => activityPackages.eventId, { onDelete: "cascade" }),
  path: text("path").notNull(),
  mimeType: text("mime_type").notNull(),
  content: bytea("content").notNull(),
}, (table) => [primaryKey({ columns: [table.eventId, table.path] })]);

export const admins = pgTable("admins", {
  id: serial("id").primaryKey(),
  username: text("username").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("admin"),
  enabled: boolean("enabled").notNull().default(true),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("idx_admins_username").on(table.username),
  check("admins_role_check", sql`${table.role} IN ('superadmin', 'admin')`),
]);

export const adminSessions = pgTable("admin_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  csrfTokenHash: text("csrf_token_hash").notNull(),
  adminId: integer("admin_id").notNull().references(() => admins.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("idx_admin_sessions_expires_at").on(table.expiresAt)]);

export const adminLoginAttempts = pgTable("admin_login_attempts", {
  rateKey: text("rate_key").primaryKey(),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull().defaultNow(),
  attemptCount: integer("attempt_count").notNull().default(1),
}, (table) => [check("admin_login_attempts_count_check", sql`${table.attemptCount} > 0`)]);

export const adminAuditLogs = pgTable("admin_audit_logs", {
  id: serial("id").primaryKey(),
  actorUsername: text("actor_username"),
  action: text("action").notNull(),
  target: text("target"),
  detailJson: text("detail_json").notNull().default("{}"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("idx_admin_audit_logs_created_at").on(table.createdAt)]);

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  valueJson: text("value_json").notNull(),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const lotteries = pgTable("lotteries", {
  id: serial("id").primaryKey(),
  eventId: text("event_id").notNull().references(() => claimEvents.eventId, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("idx_lotteries_event_id").on(table.eventId)]);

export const lotteryRequirements = pgTable("lottery_requirements", {
  lotteryId: integer("lottery_id").notNull().references(() => lotteries.id, { onDelete: "cascade" }),
  eventId: text("event_id").notNull(),
  achievementId: text("achievement_id").notNull(),
}, (table) => [
  primaryKey({ columns: [table.lotteryId, table.achievementId] }),
  foreignKey({ columns: [table.eventId, table.achievementId], foreignColumns: [claimRules.eventId, claimRules.achievementId] }).onDelete("cascade"),
]);

export const lotteryPrizes = pgTable("lottery_prizes", {
  id: serial("id").primaryKey(),
  lotteryId: integer("lottery_id").notNull().references(() => lotteries.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  icon: text("icon").notNull(),
  probabilityBps: integer("probability_bps").notNull(),
  quantity: integer("quantity").notNull().default(1),
  awardedCount: integer("awarded_count").notNull().default(0),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_lottery_prizes_lottery_id").on(table.lotteryId),
  check("lottery_prizes_probability_check", sql`${table.probabilityBps} BETWEEN 0 AND 10000`),
  check("lottery_prizes_quantity_check", sql`${table.quantity} BETWEEN 1 AND 100000`),
  check("lottery_prizes_awarded_count_check", sql`${table.awardedCount} BETWEEN 0 AND ${table.quantity}`),
]);

export const lotteryDraws = pgTable("lottery_draws", {
  id: serial("id").primaryKey(),
  lotteryId: integer("lottery_id").notNull().references(() => lotteries.id, { onDelete: "cascade" }),
  prizeId: integer("prize_id").references(() => lotteryPrizes.id, { onDelete: "restrict" }),
  deviceHash: text("device_hash").notNull(),
  probabilityRoll: integer("probability_roll").notNull(),
  drawnBy: text("drawn_by").notNull(),
  drawnAt: timestamp("drawn_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("idx_lottery_draws_unique_winner").on(table.lotteryId, table.deviceHash),
  index("idx_lottery_draws_lottery_id").on(table.lotteryId),
  check("lottery_draws_probability_roll_check", sql`${table.probabilityRoll} BETWEEN 0 AND 9999`),
]);
