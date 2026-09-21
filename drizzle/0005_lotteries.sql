CREATE TABLE IF NOT EXISTS "lotteries" (
  "id" serial PRIMARY KEY NOT NULL,
  "event_id" text NOT NULL REFERENCES "claim_events"("event_id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lotteries_event_id" ON "lotteries" ("event_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lottery_requirements" (
  "lottery_id" integer NOT NULL REFERENCES "lotteries"("id") ON DELETE CASCADE,
  "event_id" text NOT NULL,
  "achievement_id" text NOT NULL,
  PRIMARY KEY ("lottery_id", "achievement_id"),
  CONSTRAINT "lottery_requirements_event_achievement_fk"
    FOREIGN KEY ("event_id", "achievement_id") REFERENCES "claim_rules"("event_id", "achievement_id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lottery_prizes" (
  "id" serial PRIMARY KEY NOT NULL,
  "lottery_id" integer NOT NULL REFERENCES "lotteries"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "icon" text NOT NULL,
  "probability_bps" integer NOT NULL,
  "quantity" integer DEFAULT 1 NOT NULL,
  "awarded_count" integer DEFAULT 0 NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "lottery_prizes_probability_check" CHECK ("probability_bps" BETWEEN 0 AND 10000),
  CONSTRAINT "lottery_prizes_quantity_check" CHECK ("quantity" BETWEEN 1 AND 100000),
  CONSTRAINT "lottery_prizes_awarded_count_check" CHECK ("awarded_count" BETWEEN 0 AND "quantity")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lottery_prizes_lottery_id" ON "lottery_prizes" ("lottery_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lottery_draws" (
  "id" serial PRIMARY KEY NOT NULL,
  "lottery_id" integer NOT NULL REFERENCES "lotteries"("id") ON DELETE CASCADE,
  "prize_id" integer NOT NULL REFERENCES "lottery_prizes"("id") ON DELETE RESTRICT,
  "device_hash" text NOT NULL,
  "probability_roll" integer NOT NULL,
  "drawn_by" text NOT NULL,
  "drawn_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "lottery_draws_probability_roll_check" CHECK ("probability_roll" BETWEEN 0 AND 9999)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_lottery_draws_unique_winner" ON "lottery_draws" ("lottery_id", "device_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lottery_draws_lottery_id" ON "lottery_draws" ("lottery_id");
