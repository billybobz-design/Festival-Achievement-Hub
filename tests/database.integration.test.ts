import assert from "node:assert/strict";
import test from "node:test";

const databaseUrl = process.env.TEST_DATABASE_URL;

test("database enforces concurrent, duplicate, and configured reset limits", { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl;
  const { claimOnline, createFestival, getClaimStats, resetClaimCount, syncFestivalConfig } = await import("../db/claims");
  const { getSql } = await import("../db");
  const eventId = `test-${crypto.randomUUID().slice(0, 8)}`;
  try {
    await createFestival({ eventId, name: "Integration test", eyebrow: "TEST", subtitle: "Database integration test", dateLabel: "Now" });
    await syncFestivalConfig({
      eventId,
      name: "Integration test",
      eyebrow: "TEST",
      subtitle: "Database integration test",
      dateLabel: "Now",
      status: "active",
      webScannerEnabled: false,
      categories: [{ id: "category", name: "Category", description: "", sortOrder: 1 }],
      achievements: [{ id: "achievement", claimCode: "integration-code", name: "Achievement", description: "Test achievement", icon: "🏆", categoryId: "category", enabled: true, sortOrder: 1, claimLimit: 3 }],
    });

    const results = await Promise.all(Array.from({ length: 10 }, (_, index) => claimOnline(eventId, "integration-code", `device-${index}`)));
    assert.equal(results.filter((result) => result.status === "claimed").length, 3);
    assert.equal(results.filter((result) => result.status === "limit_reached").length, 7);
    const claimedDeviceIndex = results.findIndex((result) => result.status === "claimed");
    assert.notEqual(claimedDeviceIndex, -1);
    assert.equal((await claimOnline(eventId, "integration-code", `device-${claimedDeviceIndex}`)).status, "already");

    await syncFestivalConfig({
      eventId,
      name: "Integration test",
      eyebrow: "TEST",
      subtitle: "Database integration test",
      dateLabel: "Now",
      status: "active",
      webScannerEnabled: false,
      categories: [{ id: "category", name: "Category", description: "", sortOrder: 1 }],
      achievements: [{ id: "achievement", claimCode: "integration-code", name: "Achievement", description: "Test achievement", icon: "🏆", categoryId: "category", enabled: true, sortOrder: 1, claimLimit: 1 }],
    });
    assert.deepEqual((await getClaimStats(eventId))[0], {
      achievementId: "achievement",
      claimCode: "integration-code",
      claimedCount: 3,
      maxClaims: 3,
      enabled: true,
    });

    await resetClaimCount(eventId, "achievement");
    assert.deepEqual((await getClaimStats(eventId))[0], {
      achievementId: "achievement",
      claimCode: "integration-code",
      claimedCount: 0,
      maxClaims: 1,
      enabled: true,
    });
    assert.equal((await claimOnline(eventId, "integration-code", "device-after-reset-1")).status, "claimed");
    assert.equal((await claimOnline(eventId, "integration-code", "device-after-reset-2")).status, "limit_reached");
    const { loadFestivalConfigFromServer } = await import("../db/claims");
    const configured = (await loadFestivalConfigFromServer(eventId))!;
    await syncFestivalConfig({
      ...configured,
      taskLine: ["first", "second"],
      achievements: ["first", "second", "independent"].map((id, index) => ({
        id, claimCode: "task-" + id, name: id, description: "Task", icon: "🕯️",
        categoryId: "category", enabled: true, sortOrder: index, claimLimit: 10,
      })),
    });
    await assert.rejects(claimOnline(eventId, "task-second", "task-device"), /前置成就/);
    assert.equal((await claimOnline(eventId, "task-independent", "task-device")).status, "claimed");
    assert.equal((await claimOnline(eventId, "task-first", "task-device")).status, "claimed");
    assert.equal((await claimOnline(eventId, "task-second", "task-device")).status, "claimed");
    await assert.rejects(claimOnline(eventId, "task-second", "other-device"), /前置成就/);
  } finally {
    if (databaseUrl) {
      const sql = getSql();
      await sql`DELETE FROM claim_events WHERE event_id = ${eventId}`;
      await sql.end();
    }
  }
});
