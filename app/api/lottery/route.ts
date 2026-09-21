import { z } from "zod";
import { consumeClaimRateLimit } from "../../../db/claims";
import { drawParticipantLottery, listParticipantLotteries } from "../../../db/lotteries";
import { getClaimIdentity } from "../../lib/claim-identity";
import { apiError, HttpError, noStoreJson, readJson, requireSameOrigin } from "../../lib/server-http";
import { getMaintenanceState } from "../../lib/system-settings";

const eventId = z.string().trim().min(3).max(64).regex(/^[a-z0-9][a-z0-9-]{2,63}$/);
const drawSchema = z.object({ eventId, lotteryId: z.number().int().positive() }).strict();

export async function GET(request: Request) {
  try {
    const parsedEventId = eventId.safeParse(new URL(request.url).searchParams.get("eventId") ?? "");
    if (!parsedEventId.success) throw new HttpError(400, "invalid eventId", "EVENT_ID_INVALID");
    const identity = await getClaimIdentity(request);
    return noStoreJson({ lotteries: await listParticipantLotteries(parsedEventId.data, identity.deviceId) }, {
      headers: identity.setCookie ? { "Set-Cookie": identity.setCookie } : undefined,
    });
  } catch (error) {
    return apiError(error, "participant lottery lookup failed");
  }
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const maintenance = await getMaintenanceState();
    if (maintenance.active) return noStoreJson({ code: "MAINTENANCE_ACTIVE", error: maintenance.message }, { status: 503 });
    const input = drawSchema.parse(await readJson(request, 8 * 1024));
    const identity = await getClaimIdentity(request);
    const allowed = await consumeClaimRateLimit(`lottery:${identity.deviceRateKey}`, 6, 60);
    if (!allowed) {
      return noStoreJson({ code: "RATE_LIMITED", error: "too many lottery attempts" }, {
        status: 429,
        headers: { "Retry-After": "60", ...(identity.setCookie ? { "Set-Cookie": identity.setCookie } : {}) },
      });
    }
    return noStoreJson(await drawParticipantLottery(input.eventId, input.lotteryId, identity.deviceId), {
      headers: identity.setCookie ? { "Set-Cookie": identity.setCookie } : undefined,
    });
  } catch (error) {
    return apiError(error, "participant lottery draw failed");
  }
}
