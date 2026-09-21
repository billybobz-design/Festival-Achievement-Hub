import assert from "node:assert/strict";
import test from "node:test";
import { selectPrizeByRoll } from "../db/lotteries";

const prizes = [
  { id: 1, probabilityBps: 2500, quantity: 2, awardedCount: 0 },
  { id: 2, probabilityBps: 1500, quantity: 1, awardedCount: 0 },
];

test("lottery probability segments select the expected prize", () => {
  assert.equal(selectPrizeByRoll(prizes, 0)?.id, 1);
  assert.equal(selectPrizeByRoll(prizes, 2499)?.id, 1);
  assert.equal(selectPrizeByRoll(prizes, 2500)?.id, 2);
  assert.equal(selectPrizeByRoll(prizes, 3999)?.id, 2);
  assert.equal(selectPrizeByRoll(prizes, 4000), null);
});

test("sold-out prize segment becomes no-prize instead of shifting probability", () => {
  const soldOut = [{ id: 1, probabilityBps: 5000, quantity: 1, awardedCount: 1 }, ...prizes.slice(1)];
  assert.equal(selectPrizeByRoll(soldOut, 100), null);
});
