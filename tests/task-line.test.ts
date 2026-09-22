import assert from "node:assert/strict";
import test from "node:test";
import { festivalConfigSchema } from "../app/lib/validation";
import { defaultFestivalConfig } from "../app/lib/demo-store";

test("legacy activities start with an empty task line", () => {
  assert.deepEqual(festivalConfigSchema.parse(defaultFestivalConfig).taskLine, []);
});

test("achievement descriptions may be empty", () => {
  const config = structuredClone(defaultFestivalConfig);
  config.achievements[0].description = "";
  assert.equal(festivalConfigSchema.safeParse(config).success, true);
});

test("task lines reject duplicates and unknown achievements", () => {
  assert.equal(festivalConfigSchema.safeParse({ ...defaultFestivalConfig, taskLine: ["ach_demo_1", "ach_demo_1"] }).success, false);
  assert.equal(festivalConfigSchema.safeParse({ ...defaultFestivalConfig, taskLine: ["missing"] }).success, false);
  assert.deepEqual(festivalConfigSchema.parse({ ...defaultFestivalConfig, taskLine: ["ach_demo_2", "ach_demo_1"] }).taskLine, ["ach_demo_2", "ach_demo_1"]);
});

test("hint images reject executable URLs and SVG uploads", () => {
  for (const hintImage of ["javascript:alert(1)", "data:image/svg+xml;base64,PHN2Zz4="]) {
    const config = structuredClone(defaultFestivalConfig);
    config.achievements[0].hintImage = hintImage;
    assert.equal(festivalConfigSchema.safeParse(config).success, false);
  }
});
