import { apiError, noStoreJson } from "../../lib/server-http";
import { loadActiveFestivalFromServer, loadFestivalConfigFromServer, toPublicFestivalConfig } from "../../../db/claims";
import { getMaintenanceState } from "../../lib/system-settings";
import { getClaimIdentity } from "../../lib/claim-identity";
import { hashClaimDeviceId } from "../../../db/claims";
import { getSql } from "../../../db";

export async function GET(request: Request) {
  try {
    const maintenance = await getMaintenanceState();
    if (maintenance.active) return noStoreJson({ config: null, maintenance });
    const eventId = new URL(request.url).searchParams.get("eventId")?.trim() ?? "";
    if (eventId && !/^[a-z0-9][a-z0-9-]{2,63}$/.test(eventId)) {
      return noStoreJson({ code: "EVENT_ID_INVALID", error: "invalid eventId" }, { status: 400 });
    }
    const config = eventId ? await loadFestivalConfigFromServer(eventId) : await loadActiveFestivalFromServer();
    if (!eventId && !config) return noStoreJson({ config: null, maintenance });
    if (!config) return noStoreJson({ code: "EVENT_NOT_FOUND", error: "event not found" }, { status: 404 });
    const identity = await getClaimIdentity(request);
    const hash = await hashClaimDeviceId(config.eventId, identity.deviceId);
    const records = await getSql()`SELECT achievement_id FROM claim_records WHERE event_id = ${config.eventId} AND device_hash = ${hash}`;
    return noStoreJson({ config: toPublicFestivalConfig(config), maintenance, unlockedIds: records.map(row => row.achievement_id) }, {
      headers: identity.setCookie ? { "Set-Cookie": identity.setCookie } : undefined,
    });
  } catch (error) {
    return apiError(error, "festival lookup failed");
  }
}
