import { apiError, HttpError, noStoreJson, readJson, requireSameOrigin } from "../../../lib/server-http";
import { MAX_PACKAGE_BYTES, parseActivityPackage } from "../../../lib/activity-package";
import { importActivityPackage } from "../../../../db/activity-packages";
import { newFestivalSchema } from "../../../lib/validation";
import { createFestival, deleteFestival, FestivalAlreadyExistsError, FestivalNotFoundError, listFestivals } from "../../../../db/claims";
import { logAdminAudit, requireAdminSession, requireCurrentAdminPassword } from "../../../lib/admin-auth";
import { appendAdminOperationLog } from "../../../lib/admin-operation-log";
import { z } from "zod";

const deleteFestivalSchema = z.object({
  eventId: z.string().trim().min(3).max(64).regex(/^[a-z0-9][a-z0-9-]{2,63}$/),
  password: z.string().min(1).max(128),
}).strict();

async function writeCompletion(entry: Parameters<typeof appendAdminOperationLog>[0]) {
  try {
    await appendAdminOperationLog(entry);
  } catch (error) {
    console.error(JSON.stringify({ level: "error", message: "failed to write completed admin operation log", error: error instanceof Error ? error.message : String(error) }));
  }
}

async function writeDatabaseAudit(actor: string, action: string, target: string, detail: Record<string, unknown>) {
  try {
    await logAdminAudit(actor, action, target, detail);
  } catch (error) {
    console.error(JSON.stringify({ level: "error", message: "failed to write database audit log", error: error instanceof Error ? error.message : String(error) }));
  }
}

export async function GET(request: Request) {
  try {
    await requireAdminSession(request);
    return noStoreJson({ festivals: await listFestivals() });
  } catch (error) {
    return apiError(error, "festival list lookup failed");
  }
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const session = await requireAdminSession(request, { csrf: true });
    const actor = session.principal.username;
    if (request.headers.get("content-type")?.startsWith("multipart/form-data")) {
      if (Number(request.headers.get("content-length") ?? 0) > MAX_PACKAGE_BYTES + 1024 * 1024) {
        throw new HttpError(413, "activity package is too large", "PAYLOAD_TOO_LARGE");
      }
      const form = await request.formData();
      const file = form.get("package");
      if (!file || typeof file === "string") throw new HttpError(400, "missing ZIP activity package", "PACKAGE_MISSING");
      if (!file.name.toLowerCase().endsWith(".zip")) throw new HttpError(400, "activity package must be a ZIP file", "PACKAGE_INVALID");
      if (file.size > MAX_PACKAGE_BYTES) throw new HttpError(413, "activity package is too large", "PAYLOAD_TOO_LARGE");
      const parsed = await parseActivityPackage(new Uint8Array(await file.arrayBuffer()));
      await appendAdminOperationLog({ action: "activity.create", status: "authorized", actor, eventId: parsed.config.eventId, eventName: parsed.config.name, source: "activity-package" });
      const result = await importActivityPackage(parsed.config.eventId, parsed.manifest, parsed.config, parsed.files, true);
      await writeCompletion({ action: "activity.create", status: "completed", actor, eventId: parsed.config.eventId, eventName: parsed.config.name, source: "activity-package" });
      await writeDatabaseAudit(actor, "activity.create", parsed.config.eventId, { name: parsed.config.name, source: "activity-package" });
      return noStoreJson(result, { status: 201 });
    }
    const input = newFestivalSchema.parse(await readJson(request, 16 * 1024));
    await appendAdminOperationLog({ action: "activity.create", status: "authorized", actor, eventId: input.eventId, eventName: input.name, source: "manual" });
    const config = await createFestival(input);
    await writeCompletion({ action: "activity.create", status: "completed", actor, eventId: config.eventId, eventName: config.name, source: "manual" });
    await writeDatabaseAudit(actor, "activity.create", config.eventId, { name: config.name, source: "manual" });
    return noStoreJson({ config }, { status: 201 });
  } catch (error) {
    if (error instanceof FestivalAlreadyExistsError) {
      return noStoreJson({ code: "EVENT_ALREADY_EXISTS", error: error.message }, { status: 409 });
    }
    return apiError(error, "festival creation failed");
  }
}

export async function DELETE(request: Request) {
  try {
    requireSameOrigin(request);
    const session = await requireAdminSession(request, { csrf: true });
    const input = deleteFestivalSchema.parse(await readJson(request, 16 * 1024));
    await requireCurrentAdminPassword(session.principal, input.password);
    const existing = (await listFestivals()).find((festival) => festival.eventId === input.eventId);
    if (!existing) throw new FestivalNotFoundError("活动不存在或已经被删除");
    const actor = session.principal.username;
    await appendAdminOperationLog({ action: "activity.delete", status: "authorized", actor, eventId: existing.eventId, eventName: existing.name });
    const deleted = await deleteFestival(input.eventId);
    await writeCompletion({ action: "activity.delete", status: "completed", actor, eventId: deleted.eventId, eventName: deleted.name });
    await writeDatabaseAudit(actor, "activity.delete", deleted.eventId, { name: deleted.name });
    return noStoreJson({ removed: true, eventId: deleted.eventId });
  } catch (error) {
    if (error instanceof FestivalNotFoundError) {
      return noStoreJson({ code: "EVENT_NOT_FOUND", error: error.message }, { status: 404 });
    }
    return apiError(error, "festival deletion failed");
  }
}
