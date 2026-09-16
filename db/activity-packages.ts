import type { FestivalConfig } from "../app/lib/demo-store";
import type { ActivityPackageFile, ActivityPackageManifest } from "../app/lib/activity-package";
import { festivalConfigSchema } from "../app/lib/validation";
import { getSql } from "./index";
import { FestivalAlreadyExistsError } from "./claims";

export type ActivityPackageSummary = {
  eventId: string;
  sourceEventId: string;
  name: string;
  version: string;
  entry: string;
  fileCount: number;
  updatedAt: string;
};

export class ActivityPackageEventNotFoundError extends Error {}

type PackageRow = {
  event_id: string;
  name: string;
  version: string;
  entry_path: string;
  manifest_json: string;
  file_count: number;
  updated_at: string | Date;
};

function toSummary(row: PackageRow): ActivityPackageSummary {
  const manifest = JSON.parse(row.manifest_json) as ActivityPackageManifest;
  return {
    eventId: row.event_id,
    sourceEventId: manifest.eventId,
    name: row.name,
    version: row.version,
    entry: row.entry_path,
    fileCount: row.file_count,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function getActivityPackageSummary(eventId: string) {
  const rows = await getSql()`SELECT event_id, name, version, entry_path, manifest_json, file_count, updated_at
    FROM activity_packages WHERE event_id = ${eventId}` as PackageRow[];
  return rows[0] ? toSummary(rows[0]) : null;
}

export async function importActivityPackage(
  targetEventId: string,
  manifest: ActivityPackageManifest,
  importedConfig: FestivalConfig,
  files: ActivityPackageFile[],
  createNew = false,
) {
  const sql = getSql();
  let savedConfig: FestivalConfig | null = null;

  await sql.begin(async (tx) => {
    if (createNew) {
      const initial = festivalConfigSchema.parse({ ...importedConfig, eventId: targetEventId, status: "closed" });
      const inserted = await tx`INSERT INTO claim_events (event_id, status, config_json)
        VALUES (${targetEventId}, 'closed', ${JSON.stringify(initial)})
        ON CONFLICT (event_id) DO NOTHING RETURNING event_id`;
      if (!inserted.length) throw new FestivalAlreadyExistsError("这个活动编号已经存在");
    }
    const eventRows = await tx`SELECT status FROM claim_events WHERE event_id = ${targetEventId} FOR UPDATE` as { status: string }[];
    const eventRow = eventRows[0];
    if (!eventRow) throw new ActivityPackageEventNotFoundError("activity does not exist");

    const config = festivalConfigSchema.parse({
      ...importedConfig,
      eventId: targetEventId,
      status: eventRow.status === "active" ? "active" : "closed",
    }) as FestivalConfig;
    savedConfig = config;

    await tx`UPDATE claim_events SET status = ${config.status}, config_json = ${JSON.stringify(config)}, updated_at = CURRENT_TIMESTAMP
      WHERE event_id = ${targetEventId}`;
    await tx`UPDATE claim_rules SET enabled = false,
      claim_code = 'retired-' || md5(event_id || ':' || achievement_id),
      updated_at = CURRENT_TIMESTAMP WHERE event_id = ${targetEventId}`;
    for (const item of config.achievements) {
      await tx`INSERT INTO claim_rules
        (event_id, achievement_id, claim_code, name, description, icon, enabled, max_claims, updated_at)
        VALUES (${targetEventId}, ${item.id}, ${item.claimCode}, ${item.name}, ${item.description}, ${item.icon}, ${item.enabled}, ${item.claimLimit}, CURRENT_TIMESTAMP)
        ON CONFLICT (event_id, achievement_id) DO UPDATE SET claim_code = EXCLUDED.claim_code, name = EXCLUDED.name,
        description = EXCLUDED.description, icon = EXCLUDED.icon, enabled = EXCLUDED.enabled,
        max_claims = GREATEST(EXCLUDED.max_claims, claim_rules.claimed_count), updated_at = CURRENT_TIMESTAMP`;
    }

    await tx`INSERT INTO activity_packages
      (event_id, name, version, entry_path, manifest_json, file_count, updated_at)
      VALUES (${targetEventId}, ${manifest.name}, ${manifest.version}, ${manifest.entry}, ${JSON.stringify(manifest)}, ${files.length}, CURRENT_TIMESTAMP)
      ON CONFLICT (event_id) DO UPDATE SET name = EXCLUDED.name, version = EXCLUDED.version,
      entry_path = EXCLUDED.entry_path, manifest_json = EXCLUDED.manifest_json,
      file_count = EXCLUDED.file_count, updated_at = CURRENT_TIMESTAMP`;
    await tx`DELETE FROM activity_package_files WHERE event_id = ${targetEventId}`;
    for (const file of files) {
      await tx`INSERT INTO activity_package_files (event_id, path, mime_type, content)
        VALUES (${targetEventId}, ${file.path}, ${file.mimeType}, ${file.content})`;
    }
  });

  return { config: savedConfig!, summary: (await getActivityPackageSummary(targetEventId))! };
}

export async function deleteActivityPackage(eventId: string) {
  const rows = await getSql()`DELETE FROM activity_packages WHERE event_id = ${eventId} RETURNING event_id`;
  return rows.length > 0;
}

export async function getActivityPackageFile(eventId: string, requestedPath?: string) {
  const packageRows = await getSql()`SELECT entry_path FROM activity_packages WHERE event_id = ${eventId}` as { entry_path: string }[];
  const packageRow = packageRows[0];
  if (!packageRow) return null;
  const path = requestedPath || packageRow.entry_path;
  const rows = await getSql()`SELECT mime_type, content FROM activity_package_files
    WHERE event_id = ${eventId} AND path = ${path}` as { mime_type: string; content: Uint8Array }[];
  return rows[0] ? { path, mimeType: rows[0].mime_type, content: rows[0].content } : null;
}
