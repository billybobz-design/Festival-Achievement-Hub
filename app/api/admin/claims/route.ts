import { apiError, noStoreJson, readJson, requireSameOrigin } from "../../../lib/server-http";
import { adminActionSchema } from "../../../lib/validation";
import { getClaimStats, loadFestivalConfigFromServer, resetClaimCount, syncFestivalConfig } from "../../../../db/claims";
import { requireAdminSession } from "../../../lib/admin-auth";

export async function GET(request: Request) {
  try {
    await requireAdminSession(request);
    const eventId = new URL(request.url).searchParams.get("eventId")?.trim() ?? "";
    if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(eventId)) {
      return noStoreJson({ code: "EVENT_ID_INVALID", error: "invalid eventId" }, { status: 400 });
    }
    const config = await loadFestivalConfigFromServer(eventId);
    if (!config) return noStoreJson({ code: "EVENT_NOT_FOUND", error: "event not found" }, { status: 404 });
    return noStoreJson({ config, stats: await getClaimStats(eventId) });
  } catch (error) {
    return apiError(error, "admin state lookup failed");
  }
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    await requireAdminSession(request, { csrf: true });
    const payload = adminActionSchema.parse(await readJson(request, 8 * 1024 * 1024));
    if (payload.action === "sync") {
      const config = await syncFestivalConfig(payload.config);
      return noStoreJson({ config, stats: await getClaimStats(config.eventId) });
    }
    await resetClaimCount(payload.eventId, payload.achievementId);
    return noStoreJson({ stats: await getClaimStats(payload.eventId) });
  } catch (error) {
    return apiError(error, "admin claim action failed");
  }
}
