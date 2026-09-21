import { listDeviceLotteryWins } from "../../../../db/lotteries";
import { getClaimIdentity } from "../../../lib/claim-identity";
import { apiError, HttpError, noStoreJson } from "../../../lib/server-http";

const eventIdPattern = /^[a-z0-9][a-z0-9-]{2,63}$/;

export async function GET(request: Request) {
  try {
    const eventId = new URL(request.url).searchParams.get("eventId")?.trim() ?? "";
    if (!eventIdPattern.test(eventId)) throw new HttpError(400, "invalid eventId", "EVENT_ID_INVALID");
    const identity = await getClaimIdentity(request);
    return noStoreJson({ wins: await listDeviceLotteryWins(eventId, identity.deviceId) }, {
      headers: identity.setCookie ? { "Set-Cookie": identity.setCookie } : undefined,
    });
  } catch (error) {
    return apiError(error, "lottery wins lookup failed");
  }
}
