export type FestivalStatus = "active" | "closed";

export type FestivalCategory = {
  id: string;
  name: string;
  description: string;
  sortOrder: number;
};

export const defaultAchievementCategory: FestivalCategory = {
  id: "",
  name: "默认分类",
  description: "未选择分类的成就会显示在这里。",
  sortOrder: 0,
};

export type FestivalAchievement = {
  id: string;
  claimCode: string;
  name: string;
  description: string;
  icon: string;
  categoryId: string;
  enabled: boolean;
  sortOrder: number;
  claimLimit: number;
  hidden?: boolean;
};

export type FestivalConfig = {
  eventId: string;
  name: string;
  eyebrow: string;
  subtitle: string;
  dateLabel: string;
  status: FestivalStatus;
  webScannerEnabled: boolean;
  categories: FestivalCategory[];
  achievements: FestivalAchievement[];
};

export type UnlockRecord = {
  unlockedAt: string;
  source: "qr" | "visit";
};

export type UnlockState = {
  version: 1;
  unlocked: Record<string, UnlockRecord>;
};

export const defaultFestivalConfig: FestivalConfig = {
  eventId: "123",
  name: "展示活动",
  eyebrow: "NCPA",
  subtitle: "用于测试二维码识别和本地成就解锁。",
  dateLabel: "测试模式",
  status: "closed",
  webScannerEnabled: false,
  categories: [
    {
      id: "demo-achievements",
      name: "测试成就",
      description: "",
      sortOrder: 10,
    },
  ],
  achievements: [
    {
      id: "ach_demo_1",
      claimCode: "demo-1",
      name: "1",
      description: "第 1 个扫码测试成就",
      icon: "1",
      categoryId: "demo-achievements",
      enabled: true,
      sortOrder: 10,
      claimLimit: 100,
    },
    {
      id: "ach_demo_2",
      claimCode: "demo-2",
      name: "2",
      description: "第 2 个扫码测试成就",
      icon: "2",
      categoryId: "demo-achievements",
      enabled: true,
      sortOrder: 20,
      claimLimit: 100,
    },
    {
      id: "ach_demo_3",
      claimCode: "demo-3",
      name: "3",
      description: "第 3 个扫码测试成就",
      icon: "3",
      categoryId: "demo-achievements",
      enabled: true,
      sortOrder: 30,
      claimLimit: 100,
    },
    {
      id: "ach_demo_4",
      claimCode: "demo-4",
      name: "4",
      description: "第 4 个扫码测试成就",
      icon: "4",
      categoryId: "demo-achievements",
      enabled: true,
      sortOrder: 40,
      claimLimit: 100,
    },
    {
      id: "ach_demo_5",
      claimCode: "demo-5",
      name: "5",
      description: "第 5 个扫码测试成就",
      icon: "5",
      categoryId: "demo-achievements",
      enabled: true,
      sortOrder: 50,
      claimLimit: 100,
    },
    {
      id: "ach_demo_6",
      claimCode: "demo-6",
      name: "6",
      description: "第 6 个扫码测试成就",
      icon: "6",
      categoryId: "demo-achievements",
      enabled: true,
      sortOrder: 60,
      claimLimit: 100,
    },
  ],
};

export function getUnlockStorageKey(eventId: string) {
  return `festivalAchievements:${eventId}`;
}

export function loadUnlockState(eventId: string): UnlockState {
  if (typeof window === "undefined") return { version: 1, unlocked: {} };

  try {
    const saved = window.localStorage.getItem(getUnlockStorageKey(eventId));
    if (!saved) return { version: 1, unlocked: {} };
    return JSON.parse(saved) as UnlockState;
  } catch {
    return { version: 1, unlocked: {} };
  }
}

export function saveUnlockState(eventId: string, state: UnlockState) {
  window.localStorage.setItem(getUnlockStorageKey(eventId), JSON.stringify(state));
}
