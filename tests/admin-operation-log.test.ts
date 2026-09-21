import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { appendAdminOperationLog } from "../app/lib/admin-operation-log";

test("activity operation logs are JSONL files without passwords", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "festival-operation-log-"));
  const originalPath = process.env.ADMIN_OPERATION_LOG_PATH;
  const logPath = path.join(directory, "admin-operations.jsonl");
  process.env.ADMIN_OPERATION_LOG_PATH = logPath;
  try {
    await appendAdminOperationLog({
      action: "activity.delete",
      status: "completed",
      actor: "tester",
      eventId: "event-2026",
      eventName: "测试活动",
    });
    const line = (await readFile(logPath, "utf8")).trim();
    const entry = JSON.parse(line) as Record<string, unknown>;
    assert.equal(entry.action, "activity.delete");
    assert.equal(entry.actor, "tester");
    assert.equal("password" in entry, false);
    assert.equal((await stat(logPath)).mode & 0o077, 0);
  } finally {
    if (originalPath === undefined) delete process.env.ADMIN_OPERATION_LOG_PATH;
    else process.env.ADMIN_OPERATION_LOG_PATH = originalPath;
    await rm(directory, { recursive: true, force: true });
  }
});
