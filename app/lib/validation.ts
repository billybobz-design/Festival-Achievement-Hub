import { z } from "zod";

const id = z.string().trim().min(1).max(80).regex(/^[a-z0-9_-]+$/i);
const shortText = z.string().trim().min(1).max(80);
const icon = z.string().max(350_000).refine(
  (value) => value.length <= 32 || /^data:image\/(png|jpeg|webp);base64,/i.test(value) || /^https:\/\//i.test(value),
  "invalid achievement icon",
);

export const festivalCategorySchema = z.object({
  id,
  name: shortText,
  description: z.string().max(240),
  sortOrder: z.number().int().min(0).max(1_000_000),
}).strict();

export const festivalAchievementSchema = z.object({
  id,
  claimCode: z.string().trim().min(3).max(120).regex(/^[a-z0-9_-]+$/i),
  name: shortText,
  description: z.string().trim().min(1).max(500),
  icon,
  categoryId: id.or(z.literal("")),
  enabled: z.boolean(),
  sortOrder: z.number().int().min(0).max(1_000_000),
  claimLimit: z.number().int().min(1).max(100_000),
  hidden: z.boolean().optional(),
  hintEnabled: z.boolean().optional(),
  hintText: z.string().max(1000).optional(),
  hintImage: z.string().max(350_000).refine(value => !value || /^https:\/\//i.test(value) || /^data:image\/(png|jpeg|webp);base64,/i.test(value), "invalid hint image").optional(),
}).strict();

export const festivalConfigSchema = z.object({
  eventId: z.string().trim().min(3).max(64).regex(/^[a-z0-9][a-z0-9-]{2,63}$/),
  name: shortText,
  eyebrow: shortText,
  subtitle: z.string().trim().min(1).max(240),
  dateLabel: shortText,
  status: z.enum(["active", "closed"]),
  webScannerEnabled: z.boolean().default(false),
  categories: z.array(festivalCategorySchema).max(100),
  achievements: z.array(festivalAchievementSchema).max(500),
  taskLine: z.array(id).max(500).default([]),
}).strict().superRefine((config, context) => {
  const categoryIds = new Set(config.categories.map((item) => item.id));
  const achievementIds = new Set<string>();
  const claimCodes = new Set<string>();
  for (const achievement of config.achievements) {
    if (achievement.categoryId && !categoryIds.has(achievement.categoryId)) {
      context.addIssue({ code: "custom", path: ["achievements"], message: `unknown category: ${achievement.categoryId}` });
    }
    if (achievementIds.has(achievement.id)) {
      context.addIssue({ code: "custom", path: ["achievements"], message: `duplicate achievement id: ${achievement.id}` });
    }
    if (claimCodes.has(achievement.claimCode)) {
      context.addIssue({ code: "custom", path: ["achievements"], message: `duplicate claim code: ${achievement.claimCode}` });
    }
    achievementIds.add(achievement.id);
    claimCodes.add(achievement.claimCode);
  }
  if (new Set(config.taskLine).size !== config.taskLine.length || config.taskLine.some(id => !achievementIds.has(id))) {
    context.addIssue({ code: "custom", path: ["taskLine"], message: "任务线不能包含重复或不存在的成就" });
  }
});

export const newFestivalSchema = z.object({
  eventId: z.string().trim().min(3).max(64).regex(/^[a-z0-9][a-z0-9-]{2,63}$/),
  name: shortText,
  eyebrow: shortText,
  subtitle: z.string().trim().min(1).max(240),
  dateLabel: shortText,
}).strict();

export const adminActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("sync"), config: festivalConfigSchema }).strict(),
  z.object({ action: z.literal("reset"), eventId: id, achievementId: id }).strict(),
]);

export const claimRequestSchema = z.object({
  eventId: id,
  claimCode: z.string().trim().min(3).max(120).regex(/^[a-z0-9_-]+$/i),
}).strict();
