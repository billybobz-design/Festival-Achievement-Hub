import { randomInt } from "node:crypto";
import { getSql } from "./index";
import { hashClaimDeviceId } from "./claims";
import { HttpError } from "../app/lib/server-http";

export type LotterySummary = {
  id: number; eventId: string; name: string; description: string;
  requirementCount: number; prizeCount: number; eligibleCount: number; winnerCount: number;
  createdAt: string; updatedAt: string;
};
export type LotteryPrize = {
  id: number; lotteryId: number; name: string; description: string; icon: string;
  probabilityBps: number; quantity: number; awardedCount: number; sortOrder: number;
};
export type LotteryDraw = {
  id: number; prizeId: number; prizeName: string; prizeIcon: string;
  participantCode: string; drawnBy: string; drawnAt: string;
};
export type LotteryDetail = LotterySummary & {
  requirements: string[]; prizes: LotteryPrize[]; draws: LotteryDraw[]; totalProbabilityBps: number;
};
export type ParticipantLotteryPrize = {
  id: number; name: string; description: string; icon: string; remaining: number;
};
export type ParticipantLottery = {
  id: number; name: string; description: string; eligible: boolean; prizes: ParticipantLotteryPrize[];
};
type PrizeForRoll = Pick<LotteryPrize, "id" | "probabilityBps" | "quantity" | "awardedCount">;

export function selectPrizeByRoll<T extends PrizeForRoll>(prizes: T[], roll: number): T | null {
  let cursor = 0;
  for (const prize of prizes) {
    cursor += prize.probabilityBps;
    if (roll < cursor) return prize.awardedCount < prize.quantity ? prize : null;
  }
  return null;
}

const participantCode = (deviceHash: string) => `P-${deviceHash.slice(0, 12).toUpperCase()}`;
const toIso = (value: string | Date) => new Date(value).toISOString();

async function ensureLottery(lotteryId: number) {
  const rows = await getSql()<Array<{ id: number; event_id: string }>>`SELECT id, event_id FROM lotteries WHERE id = ${lotteryId} LIMIT 1`;
  if (!rows[0]) throw new HttpError(404, "lottery not found", "LOTTERY_NOT_FOUND");
  return rows[0];
}

export async function listLotteries(eventId: string): Promise<LotterySummary[]> {
  const rows = await getSql()<Array<{
    id: number; event_id: string; name: string; description: string; requirement_count: number;
    prize_count: number; eligible_count: number; winner_count: number; created_at: string | Date; updated_at: string | Date;
  }>>`
    SELECT l.id, l.event_id, l.name, l.description, l.created_at, l.updated_at,
      (SELECT count(*)::integer FROM lottery_requirements r WHERE r.lottery_id = l.id) AS requirement_count,
      (SELECT count(*)::integer FROM lottery_prizes p WHERE p.lottery_id = l.id) AS prize_count,
      (SELECT count(*)::integer FROM lottery_draws d WHERE d.lottery_id = l.id AND d.prize_id IS NOT NULL) AS winner_count,
      CASE WHEN (SELECT count(*) FROM lottery_requirements r WHERE r.lottery_id = l.id) = 0 THEN 0 ELSE (
        SELECT count(*)::integer FROM (
          SELECT cr.device_hash FROM claim_records cr
          JOIN lottery_requirements r ON r.lottery_id = l.id AND r.event_id = cr.event_id AND r.achievement_id = cr.achievement_id
          WHERE cr.event_id = l.event_id
            AND NOT EXISTS (SELECT 1 FROM lottery_draws d WHERE d.lottery_id = l.id AND d.device_hash = cr.device_hash)
          GROUP BY cr.device_hash
          HAVING count(DISTINCT cr.achievement_id) = (SELECT count(*) FROM lottery_requirements r2 WHERE r2.lottery_id = l.id)
        ) eligible
      ) END AS eligible_count
    FROM lotteries l WHERE l.event_id = ${eventId} ORDER BY l.updated_at DESC, l.id DESC`;
  return rows.map((row) => ({
    id: row.id, eventId: row.event_id, name: row.name, description: row.description,
    requirementCount: row.requirement_count, prizeCount: row.prize_count, eligibleCount: row.eligible_count,
    winnerCount: row.winner_count, createdAt: toIso(row.created_at), updatedAt: toIso(row.updated_at),
  }));
}

export async function getLotteryDetail(lotteryId: number): Promise<LotteryDetail> {
  const lottery = await ensureLottery(lotteryId);
  const summary = (await listLotteries(lottery.event_id)).find((item) => item.id === lotteryId);
  if (!summary) throw new HttpError(404, "lottery not found", "LOTTERY_NOT_FOUND");
  const sql = getSql();
  const [requirementRows, prizeRows, drawRows] = await Promise.all([
    sql<Array<{ achievement_id: string }>>`SELECT achievement_id FROM lottery_requirements WHERE lottery_id = ${lotteryId} ORDER BY achievement_id`,
    sql<Array<{ id: number; lottery_id: number; name: string; description: string; icon: string; probability_bps: number; quantity: number; awarded_count: number; sort_order: number }>>`
      SELECT id, lottery_id, name, description, icon, probability_bps, quantity, awarded_count, sort_order
      FROM lottery_prizes WHERE lottery_id = ${lotteryId} ORDER BY sort_order, id`,
    sql<Array<{ id: number; prize_id: number; prize_name: string; prize_icon: string; device_hash: string; drawn_by: string; drawn_at: string | Date }>>`
      SELECT d.id, d.prize_id, p.name AS prize_name, p.icon AS prize_icon, d.device_hash, d.drawn_by, d.drawn_at
      FROM lottery_draws d JOIN lottery_prizes p ON p.id = d.prize_id
      WHERE d.lottery_id = ${lotteryId} ORDER BY d.drawn_at DESC, d.id DESC LIMIT 200`,
  ]);
  const prizes = prizeRows.map((row) => ({ id: row.id, lotteryId: row.lottery_id, name: row.name,
    description: row.description, icon: row.icon, probabilityBps: row.probability_bps,
    quantity: row.quantity, awardedCount: row.awarded_count, sortOrder: row.sort_order }));
  return { ...summary, requirements: requirementRows.map((row) => row.achievement_id), prizes,
    draws: drawRows.map((row) => ({ id: row.id, prizeId: row.prize_id, prizeName: row.prize_name,
      prizeIcon: row.prize_icon, participantCode: participantCode(row.device_hash), drawnBy: row.drawn_by,
      drawnAt: toIso(row.drawn_at) })),
    totalProbabilityBps: prizes.reduce((total, prize) => total + prize.probabilityBps, 0) };
}

export async function createLottery(eventId: string, name: string, description: string, createdBy: string) {
  const rows = await getSql()<Array<{ id: number }>>`
    INSERT INTO lotteries (event_id, name, description, created_by)
    SELECT event_id, ${name}, ${description}, ${createdBy} FROM claim_events WHERE event_id = ${eventId} RETURNING id`;
  if (!rows[0]) throw new HttpError(404, "event not found", "EVENT_NOT_FOUND");
  return getLotteryDetail(rows[0].id);
}

export async function updateLottery(lotteryId: number, name: string, description: string) {
  const rows = await getSql()`UPDATE lotteries SET name = ${name}, description = ${description}, updated_at = CURRENT_TIMESTAMP WHERE id = ${lotteryId} RETURNING id`;
  if (!rows.length) throw new HttpError(404, "lottery not found", "LOTTERY_NOT_FOUND");
  return getLotteryDetail(lotteryId);
}

export async function deleteLottery(lotteryId: number) {
  const rows = await getSql()`DELETE FROM lotteries WHERE id = ${lotteryId} RETURNING id`;
  if (!rows.length) throw new HttpError(404, "lottery not found", "LOTTERY_NOT_FOUND");
}

export async function setLotteryRequirements(lotteryId: number, achievementIds: string[]) {
  const lottery = await ensureLottery(lotteryId);
  const uniqueIds = [...new Set(achievementIds)];
  if (uniqueIds.length) {
    const rows = await getSql()<Array<{ achievement_id: string }>>`
      SELECT achievement_id FROM claim_rules WHERE event_id = ${lottery.event_id} AND achievement_id IN ${getSql()(uniqueIds)}`;
    if (rows.length !== uniqueIds.length) throw new HttpError(400, "unknown achievement requirement", "LOTTERY_REQUIREMENT_INVALID");
  }
  await getSql().begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${lotteryId})`;
    await tx`DELETE FROM lottery_requirements WHERE lottery_id = ${lotteryId}`;
    for (const achievementId of uniqueIds) {
      await tx`INSERT INTO lottery_requirements (lottery_id, event_id, achievement_id) VALUES (${lotteryId}, ${lottery.event_id}, ${achievementId})`;
    }
    await tx`UPDATE lotteries SET updated_at = CURRENT_TIMESTAMP WHERE id = ${lotteryId}`;
  });
  return getLotteryDetail(lotteryId);
}

type PrizeInput = { name: string; description: string; icon: string; probabilityBps: number; quantity: number; sortOrder: number };

export async function createLotteryPrize(lotteryId: number, input: PrizeInput) {
  await ensureLottery(lotteryId);
  await getSql().begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${lotteryId})`;
    const totals = await tx<Array<{ total: number }>>`SELECT COALESCE(sum(probability_bps), 0)::integer AS total FROM lottery_prizes WHERE lottery_id = ${lotteryId}`;
    if ((totals[0]?.total ?? 0) + input.probabilityBps > 10_000) {
      throw new HttpError(409, "prize probabilities exceed 100 percent", "LOTTERY_PROBABILITY_EXCEEDED");
    }
    await tx`INSERT INTO lottery_prizes (lottery_id, name, description, icon, probability_bps, quantity, sort_order)
      VALUES (${lotteryId}, ${input.name}, ${input.description}, ${input.icon}, ${input.probabilityBps}, ${input.quantity}, ${input.sortOrder})`;
    await tx`UPDATE lotteries SET updated_at = CURRENT_TIMESTAMP WHERE id = ${lotteryId}`;
  });
  return getLotteryDetail(lotteryId);
}

export async function updateLotteryPrize(prizeId: number, input: PrizeInput) {
  const rows = await getSql()<Array<{ lottery_id: number; awarded_count: number }>>`SELECT lottery_id, awarded_count FROM lottery_prizes WHERE id = ${prizeId} LIMIT 1`;
  const prize = rows[0];
  if (!prize) throw new HttpError(404, "prize not found", "LOTTERY_PRIZE_NOT_FOUND");
  await getSql().begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${prize.lottery_id})`;
    const current = await tx<Array<{ awarded_count: number }>>`SELECT awarded_count FROM lottery_prizes WHERE id = ${prizeId} FOR UPDATE`;
    if (!current[0]) throw new HttpError(404, "prize not found", "LOTTERY_PRIZE_NOT_FOUND");
    if (input.quantity < current[0].awarded_count) throw new HttpError(409, "quantity is below awarded count", "LOTTERY_QUANTITY_BELOW_AWARDED");
    const totals = await tx<Array<{ total: number }>>`
      SELECT COALESCE(sum(probability_bps), 0)::integer AS total FROM lottery_prizes WHERE lottery_id = ${prize.lottery_id} AND id <> ${prizeId}`;
    if ((totals[0]?.total ?? 0) + input.probabilityBps > 10_000) {
      throw new HttpError(409, "prize probabilities exceed 100 percent", "LOTTERY_PROBABILITY_EXCEEDED");
    }
    await tx`UPDATE lottery_prizes SET name = ${input.name}, description = ${input.description}, icon = ${input.icon},
      probability_bps = ${input.probabilityBps}, quantity = ${input.quantity}, sort_order = ${input.sortOrder}, updated_at = CURRENT_TIMESTAMP WHERE id = ${prizeId}`;
    await tx`UPDATE lotteries SET updated_at = CURRENT_TIMESTAMP WHERE id = ${prize.lottery_id}`;
  });
  return getLotteryDetail(prize.lottery_id);
}

export async function setLotteryProbabilities(lotteryId: number, entries: Array<{ prizeId: number; probabilityBps: number }>) {
  const unique = new Map(entries.map((entry) => [entry.prizeId, entry.probabilityBps]));
  if (unique.size !== entries.length) throw new HttpError(400, "duplicate prize probability", "BAD_REQUEST");
  const total = entries.reduce((sum, entry) => sum + entry.probabilityBps, 0);
  if (total > 10_000) throw new HttpError(409, "prize probabilities exceed 100 percent", "LOTTERY_PROBABILITY_EXCEEDED");
  await getSql().begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${lotteryId})`;
    const prizes = await tx<Array<{ id: number }>>`SELECT id FROM lottery_prizes WHERE lottery_id = ${lotteryId} FOR UPDATE`;
    if (prizes.length !== entries.length || prizes.some((prize) => !unique.has(prize.id))) {
      throw new HttpError(409, "lottery prizes changed", "LOTTERY_PRIZES_CHANGED");
    }
    for (const entry of entries) {
      await tx`UPDATE lottery_prizes SET probability_bps = ${entry.probabilityBps}, updated_at = CURRENT_TIMESTAMP WHERE id = ${entry.prizeId}`;
    }
    await tx`UPDATE lotteries SET updated_at = CURRENT_TIMESTAMP WHERE id = ${lotteryId}`;
  });
  return getLotteryDetail(lotteryId);
}

export async function deleteLotteryPrize(prizeId: number) {
  const existingDraws = await getSql()<Array<{ count: number }>>`SELECT count(*)::integer AS count FROM lottery_draws WHERE prize_id = ${prizeId}`;
  if ((existingDraws[0]?.count ?? 0) > 0) {
    throw new HttpError(409, "prize already has winners", "LOTTERY_PRIZE_HAS_WINNERS");
  }
  const rows = await getSql()<Array<{ lottery_id: number }>>`DELETE FROM lottery_prizes WHERE id = ${prizeId} RETURNING lottery_id`;
  if (!rows[0]) throw new HttpError(404, "prize not found", "LOTTERY_PRIZE_NOT_FOUND");
  return getLotteryDetail(rows[0].lottery_id);
}

export async function listParticipantLotteries(eventId: string, deviceId: string): Promise<ParticipantLottery[]> {
  const deviceHash = await hashClaimDeviceId(eventId, deviceId);
  const sql = getSql();
  const lotteries = await sql<Array<{ id: number; name: string; description: string; eligible: boolean }>>`
    SELECT l.id, l.name, l.description,
      ((SELECT count(DISTINCT cr.achievement_id)::integer
        FROM claim_records cr
        JOIN lottery_requirements r ON r.lottery_id = l.id AND r.event_id = cr.event_id AND r.achievement_id = cr.achievement_id
        WHERE cr.event_id = l.event_id AND cr.device_hash = ${deviceHash}) =
       (SELECT count(*)::integer FROM lottery_requirements required WHERE required.lottery_id = l.id)) AS eligible
    FROM lotteries l
    JOIN claim_events event ON event.event_id = l.event_id AND event.status = 'active'
    WHERE l.event_id = ${eventId}
      AND EXISTS (SELECT 1 FROM lottery_requirements requirement WHERE requirement.lottery_id = l.id)
      AND EXISTS (SELECT 1 FROM lottery_prizes prize WHERE prize.lottery_id = l.id AND prize.awarded_count < prize.quantity)
      AND NOT EXISTS (SELECT 1 FROM lottery_draws draw WHERE draw.lottery_id = l.id AND draw.device_hash = ${deviceHash})
    ORDER BY l.updated_at DESC, l.id DESC`;
  if (!lotteries.length) return [];
  const lotteryIds = lotteries.map((lottery) => lottery.id);
  const prizes = await sql<Array<{ id: number; lottery_id: number; name: string; description: string; icon: string; remaining: number }>>`
    SELECT id, lottery_id, name, description, icon, (quantity - awarded_count)::integer AS remaining
    FROM lottery_prizes
    WHERE lottery_id IN ${sql(lotteryIds)} AND awarded_count < quantity
    ORDER BY sort_order, id`;
  return lotteries.map((lottery) => ({
    ...lottery,
    eligible: Boolean(lottery.eligible),
    prizes: prizes.filter((prize) => prize.lottery_id === lottery.id).map((prize) => ({
      id: prize.id, name: prize.name, description: prize.description, icon: prize.icon, remaining: prize.remaining,
    })),
  }));
}

export async function drawParticipantLottery(eventId: string, lotteryId: number, deviceId: string) {
  const deviceHash = await hashClaimDeviceId(eventId, deviceId);
  return getSql().begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${lotteryId})`;
    const lotteryRows = await tx<Array<{ event_id: string }>>`
      SELECT lottery.event_id FROM lotteries lottery
      JOIN claim_events event ON event.event_id = lottery.event_id AND event.status = 'active'
      WHERE lottery.id = ${lotteryId} AND lottery.event_id = ${eventId} LIMIT 1`;
    const lottery = lotteryRows[0];
    if (!lottery) throw new HttpError(404, "lottery not found", "LOTTERY_NOT_FOUND");
    const previous = await tx<Array<{ id: number; prize_id: number | null; name: string | null; description: string | null; icon: string | null; drawn_at: string | Date }>>`
      SELECT draw.id, draw.prize_id, prize.name, prize.description, prize.icon, draw.drawn_at
      FROM lottery_draws draw LEFT JOIN lottery_prizes prize ON prize.id = draw.prize_id
      WHERE draw.lottery_id = ${lotteryId} AND draw.device_hash = ${deviceHash} LIMIT 1`;
    if (previous[0]) {
      const item = previous[0];
      return { status: "already" as const, ...(item.prize_id ? { draw: { id: item.id, prizeId: item.prize_id,
        prizeName: item.name!, prizeDescription: item.description!, prizeIcon: item.icon!,
        participantCode: participantCode(deviceHash), drawnAt: toIso(item.drawn_at) } } : {}) };
    }
    const requirements = await tx<Array<{ count: number }>>`SELECT count(*)::integer AS count FROM lottery_requirements WHERE lottery_id = ${lotteryId}`;
    if (!requirements[0]?.count) throw new HttpError(409, "lottery has no requirements", "LOTTERY_REQUIREMENTS_EMPTY");
    const eligible = await tx<Array<{ count: number }>>`
      SELECT count(DISTINCT cr.achievement_id)::integer AS count FROM claim_records cr
      JOIN lottery_requirements r ON r.lottery_id = ${lotteryId} AND r.event_id = cr.event_id AND r.achievement_id = cr.achievement_id
      WHERE cr.event_id = ${eventId} AND cr.device_hash = ${deviceHash}`;
    if ((eligible[0]?.count ?? 0) !== requirements[0].count) return { status: "not_eligible" as const };
    const prizes = await tx<Array<PrizeForRoll & { name: string; description: string; icon: string }>>`
      SELECT id, probability_bps AS "probabilityBps", quantity, awarded_count AS "awardedCount", name, description, icon
      FROM lottery_prizes WHERE lottery_id = ${lotteryId} ORDER BY sort_order, id FOR UPDATE`;
    if (!prizes.length) throw new HttpError(409, "lottery has no prizes", "LOTTERY_PRIZES_EMPTY");
    if (!prizes.some((prize) => prize.awardedCount < prize.quantity)) return { status: "sold_out" as const };
    const roll = randomInt(10_000);
    const selected = selectPrizeByRoll(prizes, roll);
    const drawRows = await tx<Array<{ id: number; drawn_at: string | Date }>>`
      INSERT INTO lottery_draws (lottery_id, prize_id, device_hash, probability_roll, drawn_by)
      VALUES (${lotteryId}, ${selected?.id ?? null}, ${deviceHash}, ${roll}, 'participant') RETURNING id, drawn_at`;
    if (!selected) return { status: "no_prize" as const, roll };
    await tx`UPDATE lottery_prizes SET awarded_count = awarded_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ${selected.id}`;
    return { status: "winner" as const, roll, draw: { id: drawRows[0]!.id, prizeId: selected.id,
      prizeName: selected.name, prizeIcon: selected.icon, prizeDescription: selected.description,
      participantCode: participantCode(deviceHash), drawnAt: toIso(drawRows[0]!.drawn_at) } };
  });
}

export async function listDeviceLotteryWins(eventId: string, deviceId: string) {
  const deviceHash = await hashClaimDeviceId(eventId, deviceId);
  const rows = await getSql()<Array<{ id: number; lottery_id: number; lottery_name: string; prize_id: number; prize_name: string; prize_description: string; prize_icon: string; drawn_at: string | Date }>>`
    SELECT d.id, d.lottery_id, l.name AS lottery_name, d.prize_id, p.name AS prize_name,
      p.description AS prize_description, p.icon AS prize_icon, d.drawn_at
    FROM lottery_draws d JOIN lotteries l ON l.id = d.lottery_id JOIN lottery_prizes p ON p.id = d.prize_id
    WHERE l.event_id = ${eventId} AND d.device_hash = ${deviceHash} ORDER BY d.drawn_at DESC, d.id DESC`;
  return rows.map((row) => ({ drawId: row.id, lotteryId: row.lottery_id, lotteryName: row.lottery_name,
    prizeId: row.prize_id, prizeName: row.prize_name, prizeDescription: row.prize_description,
    prizeIcon: row.prize_icon, participantCode: participantCode(deviceHash), drawnAt: toIso(row.drawn_at) }));
}
