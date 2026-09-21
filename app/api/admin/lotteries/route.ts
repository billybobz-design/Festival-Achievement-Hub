import { z } from "zod";
import {
  createLottery, createLotteryPrize, deleteLottery, deleteLotteryPrize, drawLottery,
  getLotteryDetail, listLotteries, setLotteryRequirements, updateLottery, updateLotteryPrize,
} from "../../../../db/lotteries";
import { logAdminAudit, requireAdminSession } from "../../../lib/admin-auth";
import { apiError, HttpError, noStoreJson, readJson, requireSameOrigin } from "../../../lib/server-http";

const eventId = z.string().trim().min(3).max(64).regex(/^[a-z0-9][a-z0-9-]{2,63}$/);
const text = z.string().trim().min(1).max(80);
const icon = z.string().max(350_000).refine(
  (value) => value.length <= 32 || /^data:image\/(png|jpeg|webp);base64,/i.test(value) || /^https:\/\//i.test(value),
  "invalid prize icon",
);
const lotteryId = z.number().int().positive();
const prizeFields = {
  name: text,
  description: z.string().trim().max(500),
  icon,
  probabilityBps: z.number().int().min(0).max(10_000),
  quantity: z.number().int().min(1).max(100_000),
  sortOrder: z.number().int().min(0).max(1_000_000),
};
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("createLottery"), eventId, name: text, description: z.string().trim().max(500) }).strict(),
  z.object({ action: z.literal("updateLottery"), lotteryId, name: text, description: z.string().trim().max(500) }).strict(),
  z.object({ action: z.literal("deleteLottery"), lotteryId }).strict(),
  z.object({ action: z.literal("setRequirements"), lotteryId, achievementIds: z.array(z.string().min(1).max(80)).max(500) }).strict(),
  z.object({ action: z.literal("createPrize"), lotteryId, ...prizeFields }).strict(),
  z.object({ action: z.literal("updatePrize"), prizeId: z.number().int().positive(), ...prizeFields }).strict(),
  z.object({ action: z.literal("deletePrize"), prizeId: z.number().int().positive() }).strict(),
  z.object({ action: z.literal("draw"), lotteryId }).strict(),
]);

export async function GET(request: Request) {
  try {
    await requireAdminSession(request);
    const params = new URL(request.url).searchParams;
    const rawLotteryId = params.get("lotteryId");
    if (rawLotteryId) {
      const parsedId = Number.parseInt(rawLotteryId, 10);
      if (!Number.isInteger(parsedId) || parsedId < 1) throw new HttpError(400, "invalid lotteryId", "BAD_REQUEST");
      return noStoreJson({ lottery: await getLotteryDetail(parsedId) });
    }
    const parsedEventId = eventId.safeParse(params.get("eventId") ?? "");
    if (!parsedEventId.success) throw new HttpError(400, "invalid eventId", "EVENT_ID_INVALID");
    return noStoreJson({ lotteries: await listLotteries(parsedEventId.data) });
  } catch (error) {
    return apiError(error, "lottery lookup failed");
  }
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const session = await requireAdminSession(request, { csrf: true });
    const input = actionSchema.parse(await readJson(request));
    const actor = session.principal.username;
    if (input.action === "createLottery") {
      const lottery = await createLottery(input.eventId, input.name, input.description, actor);
      await logAdminAudit(actor, "lottery.create", String(lottery.id), { eventId: input.eventId, name: input.name });
      return noStoreJson({ lottery });
    }
    if (input.action === "updateLottery") {
      const lottery = await updateLottery(input.lotteryId, input.name, input.description);
      await logAdminAudit(actor, "lottery.update", String(input.lotteryId), { name: input.name });
      return noStoreJson({ lottery });
    }
    if (input.action === "deleteLottery") {
      await deleteLottery(input.lotteryId);
      await logAdminAudit(actor, "lottery.delete", String(input.lotteryId), {});
      return noStoreJson({ removed: true });
    }
    if (input.action === "setRequirements") {
      const lottery = await setLotteryRequirements(input.lotteryId, input.achievementIds);
      await logAdminAudit(actor, "lottery.requirements", String(input.lotteryId), { achievementIds: input.achievementIds });
      return noStoreJson({ lottery });
    }
    if (input.action === "createPrize") {
      const lottery = await createLotteryPrize(input.lotteryId, input);
      await logAdminAudit(actor, "lottery.prize_create", String(input.lotteryId), { name: input.name, probabilityBps: input.probabilityBps });
      return noStoreJson({ lottery });
    }
    if (input.action === "updatePrize") {
      const lottery = await updateLotteryPrize(input.prizeId, input);
      await logAdminAudit(actor, "lottery.prize_update", String(input.prizeId), { name: input.name, probabilityBps: input.probabilityBps });
      return noStoreJson({ lottery });
    }
    if (input.action === "deletePrize") {
      const lottery = await deleteLotteryPrize(input.prizeId);
      await logAdminAudit(actor, "lottery.prize_delete", String(input.prizeId), {});
      return noStoreJson({ lottery });
    }
    const result = await drawLottery(input.lotteryId, actor);
    await logAdminAudit(actor, "lottery.draw", String(input.lotteryId), { status: result.status, roll: result.roll });
    return noStoreJson({ result, lottery: await getLotteryDetail(input.lotteryId) });
  } catch (error) {
    return apiError(error, "lottery operation failed");
  }
}
