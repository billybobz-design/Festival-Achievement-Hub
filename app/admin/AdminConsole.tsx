"use client";

import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  Boxes,
  CalendarDays,
  Check,
  ChevronRight,
  CirclePlus,
  Download,
  Eye,
  ExternalLink,
  FolderArchive,
  GitBranch,
  LayoutDashboard,
  LogOut,
  PackageCheck,
  QrCode,
  RefreshCw,
  Save,
  Settings2,
  ShieldCheck,
  SmilePlus,
  Sparkles,
  Trash2,
  Trophy,
  UploadCloud,
  UserPlus,
  Users,
  Wrench,
  X,
} from "lucide-react";
import Link from "next/link";
import QRCode from "qrcode";
import { ChangeEvent, FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { AchievementIconGraphic } from "../components/AchievementIconGraphic";
import {
  FestivalAchievement,
  FestivalConfig,
  defaultAchievementCategory,
  defaultFestivalConfig,
} from "../lib/demo-store";
import { createClientId } from "../lib/client-id";
import { AdminApiError, describeAdminError, readAdminJson } from "../lib/admin-api";
import { LotteryManager } from "./LotteryManager";

type AdminSection = "administrators" | "overview" | "new-activity" | "activity" | "achievements" | "categories" | "lotteries" | "packages";

export type AdminUiSession = {
  user: { id: number; username: string; role: "superadmin" | "admin" };
  csrfToken: string;
};

type AdminListItem = AdminUiSession["user"] & {
  enabled: boolean;
  createdBy: string | null;
  createdAt: string;
  lastLoginAt: string | null;
};

type MaintenanceState = {
  active: boolean;
  message: string;
  startedAt: string | null;
  startedBy: string | null;
};

type FestivalSummary = {
  eventId: string;
  name: string;
  eyebrow: string;
  subtitle: string;
  dateLabel: string;
  status: FestivalConfig["status"];
  updatedAt: string;
};

type ClaimStat = {
  achievementId: string;
  claimCode: string;
  claimedCount: number;
  maxClaims: number;
  enabled: boolean;
};

type NewFestivalDraft = {
  eventId: string;
  name: string;
  eyebrow: string;
  subtitle: string;
  dateLabel: string;
};

type AchievementQrPreview = {
  achievement: FestivalAchievement;
  claimUrl: string;
  dataUrl: string;
  localOnly: boolean;
};

type EmojiTarget =
  | { kind: "draft" }
  | { kind: "achievement"; achievementId: string };

type PendingSave = {
  config: FestivalConfig;
  successMessage: string;
};

type ActivityPackageSummary = {
  eventId: string;
  sourceEventId: string;
  name: string;
  version: string;
  entry: string;
  fileCount: number;
  updatedAt: string;
};

const emptyAchievement: Omit<FestivalAchievement, "id"> = {
  claimCode: "",
  name: "",
  description: "",
  icon: "✦",
  categoryId: "",
  enabled: true,
  sortOrder: 10,
  claimLimit: 100,
};

const emptyFestivalDraft: NewFestivalDraft = {
  eventId: "",
  name: "",
  eyebrow: "NCPA · 校园活动",
  subtitle: "",
  dateLabel: "",
};

export function AdminConsole({ session, onSessionExpired }: { session: AdminUiSession; onSessionExpired: () => void }) {
  const [config, setConfig] = useState<FestivalConfig>(defaultFestivalConfig);
  const [section, setSection] = useState<AdminSection>("overview");
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [festivals, setFestivals] = useState<FestivalSummary[]>([]);
  const [festivalDraft, setFestivalDraft] = useState<NewFestivalDraft>(emptyFestivalDraft);
  const [creatingFestival, setCreatingFestival] = useState(false);
  const [newActivityPackage, setNewActivityPackage] = useState<File | null>(null);
  const [categoryName, setCategoryName] = useState("");
  const [draft, setDraft] = useState(emptyAchievement);
  const [notice, setNotice] = useState("");
  const [claimStats, setClaimStats] = useState<ClaimStat[]>([]);
  const [limitDrafts, setLimitDrafts] = useState<Record<string, string>>({});
  const [qrPreview, setQrPreview] = useState<AchievementQrPreview | null>(null);
  const [qrBusyId, setQrBusyId] = useState<string | null>(null);
  const [emojiTarget, setEmojiTarget] = useState<EmojiTarget | null>(null);
  const [emojiInput, setEmojiInput] = useState("");
  const [pendingSave, setPendingSave] = useState<PendingSave | null>(null);
  const [activityPackage, setActivityPackage] = useState<ActivityPackageSummary | null>(null);
  const [packageLoading, setPackageLoading] = useState(false);
  const [packageUploading, setPackageUploading] = useState(false);
  const [onlineStatus, setOnlineStatus] = useState<"connecting" | "online" | "error">("connecting");
  const [admins, setAdmins] = useState<AdminListItem[]>([]);
  const [adminUsername, setAdminUsername] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [adminBusy, setAdminBusy] = useState(false);
  const [maintenance, setMaintenance] = useState<MaintenanceState>({ active: false, message: "系统正在维护，请稍后再试。", startedAt: null, startedBy: null });
  const [updateConfigured, setUpdateConfigured] = useState(false);
  const [currentVersion, setCurrentVersion] = useState("development");
  const [updateBusy, setUpdateBusy] = useState(false);

  const adminFetch = useCallback(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    const method = (init.method ?? "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD") headers.set("x-csrf-token", session.csrfToken);
    const response = await fetch(input, { ...init, headers });
    if (response.status === 401) onSessionExpired();
    return response;
  }, [onSessionExpired, session.csrfToken]);

  const activeAchievements = useMemo(
    () => config.achievements.filter((achievement) => achievement.enabled).length,
    [config.achievements],
  );
  const totalOnlineClaims = useMemo(
    () => claimStats.reduce((total, stat) => total + stat.claimedCount, 0),
    [claimStats],
  );
  const claimStatsById = useMemo(
    () => Object.fromEntries(claimStats.map((stat) => [stat.achievementId, stat])),
    [claimStats],
  );

  async function loadOnlineState(eventId: string) {
    setOnlineStatus("connecting");
    try {
      const response = await adminFetch(`/api/admin/claims?eventId=${encodeURIComponent(eventId)}`, { cache: "no-store" });
      const payload = await readAdminJson<{ config: FestivalConfig; stats: ClaimStat[] }>(response);
      setConfig(payload.config);
      setPendingSave(null);
      setDraft((current) => ({ ...current, categoryId: "" }));
      setClaimStats(payload.stats);
      setLimitDrafts(Object.fromEntries(payload.config.achievements.map((item) => [item.id, String(item.claimLimit || 100)])));
      setOnlineStatus("online");
      return true;
    } catch (error) {
      setOnlineStatus("error");
      setNotice(describeAdminError(error, "读取活动"));
      return false;
    }
  }

  const loadFestivalList = useCallback(async () => {
    try {
      const [response, systemResponse] = await Promise.all([
        adminFetch("/api/admin/festivals", { cache: "no-store" }),
        adminFetch("/api/admin/system", { cache: "no-store" }),
      ]);
      const payload = await readAdminJson<{ festivals: FestivalSummary[] }>(response);
      const systemPayload = await readAdminJson<{ maintenance: MaintenanceState; updateConfigured: boolean }>(systemResponse);
      setFestivals(payload.festivals);
      setMaintenance(systemPayload.maintenance);
      setUpdateConfigured(systemPayload.updateConfigured);
      setOnlineStatus("online");
    } catch (error) {
      setOnlineStatus("error");
      setNotice(describeAdminError(error, "读取活动列表"));
    }
  }, [adminFetch]);

  useEffect(() => {
    const hydrationTimer = window.setTimeout(() => {
      void loadFestivalList();
    }, 0);
    return () => window.clearTimeout(hydrationTimer);
  }, [loadFestivalList]);

  async function syncConfigOnline(nextConfig: FestivalConfig, successMessage: string) {
    setOnlineStatus("connecting");
    setPendingSave(null);
    try {
      const response = await adminFetch("/api/admin/claims", {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "sync", config: nextConfig }),
      });
      const payload = await readAdminJson<{ config: FestivalConfig; stats: ClaimStat[] }>(response);
      setConfig(payload.config);
      setClaimStats(payload.stats);
      setFestivals((current) => upsertFestivalSummary(current, summaryFromConfig(payload.config)));
      setPendingSave(null);
      setOnlineStatus("online");
      setNotice(successMessage);
      window.setTimeout(() => setNotice((current) => current === successMessage ? "" : current), 2400);
    } catch (error) {
      setOnlineStatus("error");
      setPendingSave({ config: nextConfig, successMessage });
      setNotice(`${describeAdminError(error, "保存")}；当前修改仍保留在页面中`);
    }
  }

  function retryPendingSave() {
    if (!pendingSave || onlineStatus === "connecting") return;
    void syncConfigOnline(pendingSave.config, pendingSave.successMessage);
  }

  async function openActivity(eventId: string) {
    const loaded = await loadOnlineState(eventId);
    if (!loaded) return;
    setQrPreview(null);
    setEmojiTarget(null);
    setActivityPackage(null);
    setSelectedEventId(eventId);
    setSection("activity");
  }

  function returnToOverview() {
    setSelectedEventId(null);
    setSection("overview");
    void loadFestivalList();
  }

  function showNewActivity() {
    setSelectedEventId(null);
    setSection("new-activity");
  }

  async function createNewActivity(event: FormEvent) {
    event.preventDefault();
    if (creatingFestival) return;
    setCreatingFestival(true);
    setOnlineStatus("connecting");
    try {
      const packageForm = new FormData();
      if (newActivityPackage) packageForm.append("package", newActivityPackage);
      const response = await adminFetch("/api/admin/festivals", {
        method: "POST",
        cache: "no-store",
        headers: newActivityPackage ? undefined : { "content-type": "application/json" },
        body: newActivityPackage ? packageForm : JSON.stringify(festivalDraft),
      });
      const payload = await readAdminJson<{ config?: FestivalConfig }>(response);
      if (!payload.config) throw new AdminApiError(502, "INVALID_SERVER_RESPONSE", "missing festival config");

      const newConfig = payload.config;
      setConfig(newConfig);
      setPendingSave(null);
      setClaimStats([]);
      setLimitDrafts(Object.fromEntries(newConfig.achievements.map((item) => [item.id, String(item.claimLimit || 100)])));
      setActivityPackage(null);
      setDraft({ ...emptyAchievement, categoryId: "" });
      setFestivals((current) => upsertFestivalSummary(current, summaryFromConfig(newConfig)));
      setFestivalDraft(emptyFestivalDraft);
      setNewActivityPackage(null);
      setSelectedEventId(newConfig.eventId);
      setSection("activity");
      setOnlineStatus("online");
      setNotice("活动已创建，默认处于未开放状态");
    } catch (error) {
      setOnlineStatus("error");
      setNotice(describeAdminError(error, "创建活动"));
    } finally {
      setCreatingFestival(false);
    }
  }

  function persist(nextConfig: FestivalConfig, message = "更改已保存") {
    if (onlineStatus === "connecting") {
      setNotice("[SAVE_IN_PROGRESS] 上一次操作仍在保存，请稍候");
      return false;
    }
    setConfig(nextConfig);
    setNotice("正在保存…");
    void syncConfigOnline(nextConfig, message);
    return true;
  }

  function toggleEventStatus() {
    persist(
      { ...config, status: config.status === "active" ? "closed" : "active" },
      config.status === "active" ? "活动已关闭" : "活动已开启",
    );
  }

  function addCategory(event: FormEvent) {
    event.preventDefault();
    const name = categoryName.trim();
    if (!name) {
      setNotice("[CATEGORY_NAME_REQUIRED] 请输入分类名称");
      return;
    }
    const id = createClientId("category-");
    const started = persist({
      ...config,
      categories: [
        ...config.categories,
        {
          id,
          name,
          description: "等待补充分类说明",
          sortOrder: (config.categories.length + 1) * 10,
        },
      ],
    }, "新分类已加入");
    if (started) setCategoryName("");
  }

  function removeCategory(categoryId: string) {
    if (config.achievements.some((achievement) => achievement.categoryId === categoryId)) {
      setNotice("[CATEGORY_IN_USE] 这个分类仍有成就，请先移动成就");
      return;
    }
    persist({
      ...config,
      categories: config.categories.filter((category) => category.id !== categoryId),
    }, "空分类已移除");
  }

  function addAchievement(event: FormEvent) {
    event.preventDefault();
    if (!draft.name.trim() || !draft.claimCode.trim()) {
      setNotice("[ACHIEVEMENT_REQUIRED_FIELDS] 请填写名称和识别码");
      return;
    }
    if (config.achievements.some((item) => item.claimCode === draft.claimCode.trim())) {
      setNotice("[CLAIM_CODE_DUPLICATE] 识别码不能重复");
      return;
    }
    const nextAchievement: FestivalAchievement = {
      ...draft,
      id: createClientId("ach_"),
      name: draft.name.trim(),
      claimCode: draft.claimCode.trim(),
      description: draft.description.trim() || "等待补充成就说明",
      sortOrder: config.achievements.length * 10 + 10,
    };
    const started = persist({ ...config, achievements: [...config.achievements, nextAchievement] }, "新成就已加入");
    if (started) setDraft({ ...emptyAchievement, categoryId: "" });
  }

  function toggleAchievement(achievementId: string) {
    persist({
      ...config,
      achievements: config.achievements.map((achievement) =>
        achievement.id === achievementId
          ? { ...achievement, enabled: !achievement.enabled }
          : achievement,
      ),
    }, "成就状态已更新");
  }

  function saveClaimLimit(achievementId: string) {
    const parsed = Number.parseInt(limitDrafts[achievementId] ?? "", 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 100000) {
      setNotice("[CLAIM_LIMIT_INVALID] 领取上限必须是 1 到 100000 的整数");
      return;
    }
    const nextConfig = {
      ...config,
      achievements: config.achievements.map((achievement) =>
        achievement.id === achievementId ? { ...achievement, claimLimit: parsed } : achievement,
      ),
    };
    persist(nextConfig, "领取上限已同步");
  }

  async function resetOnlineCount(achievementId: string) {
    try {
      const response = await adminFetch("/api/admin/claims", {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "reset", eventId: config.eventId, achievementId }),
      });
      const payload = await readAdminJson<{ stats: ClaimStat[] }>(response);
      setClaimStats(payload.stats);
      setNotice("该成就的在线领取计数已清零");
      setOnlineStatus("online");
    } catch (error) {
      setNotice(describeAdminError(error, "重置领取计数"));
      setOnlineStatus("error");
    }
  }

  async function createAchievementQr(achievement: FestivalAchievement) {
    const claimUrl = new URL("/", window.location.origin);
    claimUrl.searchParams.set("event", config.eventId);
    claimUrl.searchParams.set("unlock", achievement.claimCode);
    const dataUrl = await QRCode.toDataURL(claimUrl.toString(), {
      width: 900,
      margin: 3,
      errorCorrectionLevel: "M",
      color: { dark: "#111111", light: "#ffffff" },
    });
    return {
      achievement,
      claimUrl: claimUrl.toString(),
      dataUrl,
      localOnly: claimUrl.hostname === "localhost" || claimUrl.hostname === "127.0.0.1",
    } satisfies AchievementQrPreview;
  }

  async function showAchievementQr(achievement: FestivalAchievement) {
    setQrBusyId(achievement.id);
    try {
      setQrPreview(await createAchievementQr(achievement));
    } catch {
      setNotice("[QR_GENERATION_FAILED] 二维码生成失败，请稍后重试");
    } finally {
      setQrBusyId(null);
    }
  }

  function downloadQr(preview: AchievementQrPreview) {
    const safeEventId = config.eventId.replace(/[^a-z0-9_-]+/gi, "-");
    const safeClaimCode = preview.achievement.claimCode.replace(/[^a-z0-9_-]+/gi, "-");
    const anchor = document.createElement("a");
    anchor.href = preview.dataUrl;
    anchor.download = `${safeEventId}-${safeClaimCode}.png`;
    anchor.click();
  }

  async function downloadAchievementQr(achievement: FestivalAchievement) {
    setQrBusyId(achievement.id);
    try {
      downloadQr(await createAchievementQr(achievement));
    } catch {
      setNotice("[QR_DOWNLOAD_FAILED] 二维码下载失败，请稍后重试");
    } finally {
      setQrBusyId(null);
    }
  }

  function openEmojiPicker(target: EmojiTarget) {
    const currentIcon = target.kind === "draft"
      ? draft.icon
      : config.achievements.find((achievement) => achievement.id === target.achievementId)?.icon ?? "";
    setEmojiInput(currentIcon.length <= 32 ? currentIcon : "");
    setEmojiTarget(target);
  }

  function closeEmojiPicker() {
    setEmojiTarget(null);
    setEmojiInput("");
  }

  function chooseEmoji(emoji: string) {
    if (!emojiTarget) return;
    const nextIcon = emoji.trim();
    if (!nextIcon) {
      setNotice("[EMOJI_REQUIRED] 请输入或选择一个 Emoji");
      return;
    }
    if (emojiTarget.kind === "draft") {
      setDraft((current) => ({ ...current, icon: nextIcon }));
      setNotice("已设置 Emoji 图案");
    } else {
      persist({
        ...config,
        achievements: config.achievements.map((achievement) =>
          achievement.id === emojiTarget.achievementId ? { ...achievement, icon: nextIcon } : achievement,
        ),
      }, "成就图案已更新");
    }
    closeEmojiPicker();
  }

  async function loadActivityPackage(eventId: string) {
    setPackageLoading(true);
    try {
      const response = await adminFetch(`/api/admin/activity-package?eventId=${encodeURIComponent(eventId)}`, { cache: "no-store" });
      const payload = await readAdminJson<{ package: ActivityPackageSummary | null }>(response);
      setActivityPackage(payload.package);
      setOnlineStatus("online");
    } catch (error) {
      setOnlineStatus("error");
      setNotice(describeAdminError(error, "读取活动包"));
    } finally {
      setPackageLoading(false);
    }
  }

  function openPackageManager() {
    if (!selectedEventId) return;
    setSection("packages");
    void loadActivityPackage(selectedEventId);
  }

  async function uploadActivityPackage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !selectedEventId || packageUploading) return;
    if (!file.name.toLowerCase().endsWith(".zip")) {
      setNotice("[PACKAGE_INVALID] 活动包必须是 ZIP 文件");
      return;
    }

    setPackageUploading(true);
    setOnlineStatus("connecting");
    setNotice("正在检查并导入活动包…");
    try {
      const form = new FormData();
      form.set("eventId", selectedEventId);
      form.set("package", file);
      const response = await adminFetch("/api/admin/activity-package", {
        method: "POST",
        cache: "no-store",
        body: form,
      });
      const payload = await readAdminJson<{ config: FestivalConfig; stats: ClaimStat[]; summary: ActivityPackageSummary }>(response);
      setConfig(payload.config);
      setClaimStats(payload.stats);
      setLimitDrafts(Object.fromEntries(payload.config.achievements.map((item) => [item.id, String(item.claimLimit || 100)])));
      setActivityPackage(payload.summary);
      setFestivals((current) => upsertFestivalSummary(current, summaryFromConfig(payload.config)));
      setPendingSave(null);
      setOnlineStatus("online");
      setNotice(`活动包 ${payload.summary.version} 已导入并启用`);
    } catch (error) {
      setOnlineStatus("error");
      setNotice(describeAdminError(error, "导入活动包"));
    } finally {
      setPackageUploading(false);
    }
  }

  async function removeActivityPackage() {
    if (!selectedEventId || !activityPackage || packageUploading) return;
    if (!window.confirm("移除自定义活动包并恢复平台默认活动页面？成就和分类数据会保留。")) return;
    setPackageUploading(true);
    setOnlineStatus("connecting");
    try {
      const response = await adminFetch(`/api/admin/activity-package?eventId=${encodeURIComponent(selectedEventId)}`, {
        method: "DELETE",
        cache: "no-store",
      });
      await readAdminJson<{ removed: true }>(response);
      setActivityPackage(null);
      setOnlineStatus("online");
      setNotice("自定义活动包已移除，访客页面已恢复默认界面");
    } catch (error) {
      setOnlineStatus("error");
      setNotice(describeAdminError(error, "移除活动包"));
    } finally {
      setPackageUploading(false);
    }
  }

  async function loadAdministratorPanel() {
    setOnlineStatus("connecting");
    try {
      const [adminsResponse, systemResponse] = await Promise.all([
        adminFetch("/api/admin/admins", { cache: "no-store" }),
        adminFetch("/api/admin/system", { cache: "no-store" }),
      ]);
      const adminPayload = await readAdminJson<{ admins: AdminListItem[] }>(adminsResponse);
      const systemPayload = await readAdminJson<{ maintenance: MaintenanceState; updateConfigured: boolean; currentVersion: string }>(systemResponse);
      setAdmins(adminPayload.admins);
      setMaintenance(systemPayload.maintenance);
      setUpdateConfigured(systemPayload.updateConfigured);
      setCurrentVersion(systemPayload.currentVersion);
      setOnlineStatus("online");
    } catch (error) {
      setOnlineStatus("error");
      setNotice(describeAdminError(error, "读取管理员面板"));
    }
  }

  function openAdministratorPanel() {
    setSelectedEventId(null);
    setSection("administrators");
    void loadAdministratorPanel();
  }

  async function addAdministrator(event: FormEvent) {
    event.preventDefault();
    if (adminBusy) return;
    setAdminBusy(true);
    try {
      const response = await adminFetch("/api/admin/admins", {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: adminUsername, password: adminPassword }),
      });
      await readAdminJson<{ admin: AdminListItem }>(response);
      setAdminUsername("");
      setAdminPassword("");
      setNotice("普通管理员账号已创建");
      await loadAdministratorPanel();
    } catch (error) {
      setNotice(describeAdminError(error, "新增管理员"));
    } finally {
      setAdminBusy(false);
    }
  }

  async function removeAdministrator(username: string) {
    if (adminBusy || session.user.role !== "superadmin") return;
    if (!window.confirm(`删除管理员 ${username}？该账号的现有登录会话会立即失效。`)) return;
    setAdminBusy(true);
    try {
      const response = await adminFetch(`/api/admin/admins?username=${encodeURIComponent(username)}`, {
        method: "DELETE",
        cache: "no-store",
      });
      await readAdminJson<{ removed: true }>(response);
      setNotice(`管理员 ${username} 已删除`);
      await loadAdministratorPanel();
    } catch (error) {
      setNotice(describeAdminError(error, "删除管理员"));
    } finally {
      setAdminBusy(false);
    }
  }

  async function changeMaintenance(active: boolean) {
    if (updateBusy) return;
    setUpdateBusy(true);
    try {
      const response = await adminFetch("/api/admin/system", {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "setMaintenance", active }),
      });
      const payload = await readAdminJson<{ maintenance: MaintenanceState; updateConfigured: boolean }>(response);
      setMaintenance(payload.maintenance);
      setUpdateConfigured(payload.updateConfigured);
      setNotice(active ? "维护提示已开启" : "维护提示已关闭");
    } catch (error) {
      setNotice(describeAdminError(error, active ? "开启维护模式" : "结束维护模式"));
    } finally {
      setUpdateBusy(false);
    }
  }

  async function dispatchUpdate() {
    if (updateBusy || !updateConfigured || session.user.role !== "superadmin") return;
    if (!window.confirm("从 GitHub 发起部署更新？用户端和管理台将显示维护提示，更新完成后需要由部署流程或管理员关闭。")) return;
    setUpdateBusy(true);
    try {
      const response = await adminFetch("/api/admin/system", {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "dispatchUpdate" }),
      });
      const payload = await readAdminJson<{ maintenance: MaintenanceState; dispatched: true }>(response);
      setMaintenance(payload.maintenance);
      setNotice("GitHub 更新任务已发出，系统进入维护状态");
    } catch (error) {
      setNotice(describeAdminError(error, "发起 GitHub 更新"));
    } finally {
      setUpdateBusy(false);
    }
  }

  async function signOut() {
    try {
      const response = await adminFetch("/api/admin/auth/logout", { method: "POST", cache: "no-store" });
      await readAdminJson<{ loggedOut: true }>(response);
    } catch {
      // Clear the local authenticated view even if the server is temporarily unavailable.
    } finally {
      onSessionExpired();
    }
  }

  return (
    <main className="admin-shell">
      <div className="admin-mobile-guard">
        <Settings2 size={28} />
        <h1>请在电脑上打开管理台</h1>
        <p>管理员页面按照电脑比例设计，手机端只提供活动体验。</p>
        <Link href="/"><ArrowLeft size={15} />返回活动页</Link>
      </div>

      <aside className="admin-sidebar">
        <Link className="admin-brand" href="/">
          <span>N</span>
          <div><strong>NCPA</strong><small>FESTIVAL ACHIEVEMENT HUB</small></div>
        </Link>
        <nav>
          <AdminNav active={section === "administrators"} onClick={openAdministratorPanel} icon={<Users size={18} />} label="管理员面板" />
          <AdminNav active={section === "overview"} onClick={returnToOverview} icon={<LayoutDashboard size={18} />} label="活动总览" />
          {!selectedEventId ? <AdminNav active={section === "new-activity"} onClick={showNewActivity} icon={<CirclePlus size={18} />} label="新建活动" /> : null}
          {selectedEventId ? (
            <>
              <div className="admin-nav-context"><span>当前活动</span><strong>{config.name}</strong><small>{config.eventId}</small></div>
              <AdminNav active={section === "activity"} onClick={() => setSection("activity")} icon={<CalendarDays size={18} />} label="活动设置" />
              <AdminNav active={section === "achievements"} onClick={() => setSection("achievements")} icon={<Sparkles size={18} />} label="成就管理" count={config.achievements.length} />
              <AdminNav active={section === "categories"} onClick={() => setSection("categories")} icon={<Boxes size={18} />} label="分类管理" count={config.categories.length} />
              <AdminNav active={section === "lotteries"} onClick={() => setSection("lotteries")} icon={<Trophy size={18} />} label="抽奖管理" />
              <AdminNav active={section === "packages"} onClick={openPackageManager} icon={<FolderArchive size={18} />} label="活动包管理" />
            </>
          ) : null}
        </nav>
        <div className="admin-sidebar-footer">
          <span>{session.user.role === "superadmin" ? "超级管理员" : "普通管理员"} · {session.user.username}</span>
          <p>配置、账号与领取计数由数据库持久化</p>
          <button type="button" onClick={() => void signOut()}><LogOut size={14} />安全退出</button>
          <Link href="/"><ArrowLeft size={14} />查看手机页面</Link>
        </div>
      </aside>

      <section className="admin-main">
        <header className="admin-topbar">
          <div><span>{section === "overview" || section === "new-activity" || section === "administrators" ? "NCPA FESTIVAL ACHIEVEMENT HUB" : config.name}</span><h1>{sectionTitle(section)}</h1></div>
          <div className="admin-topbar-statuses">
            {maintenance.active ? <div className="admin-maintenance-badge"><Wrench size={13} />维护中</div> : null}
            <div className="admin-status"><span className={onlineStatus === "online" ? "active" : ""} />{onlineStatus === "online" ? "校验服务器在线" : onlineStatus === "connecting" ? "正在同步" : "服务器连接失败"}</div>
          </div>
        </header>

        {section === "administrators" ? (
          <div className="admin-content administrator-layout">
            <section className="admin-panel administrator-intro">
              <div><span className="panel-kicker">ADMINISTRATORS</span><h2>管理员账号</h2><p>每位管理员使用自己的用户名和密码登录。所有管理员都可以创建普通管理员；删除管理员和拉取 GitHub 更新仍仅限超级管理员。</p></div>
              <div className="administrator-contact"><ShieldCheck size={18} /><span>新增账号默认拥有普通管理员权限</span></div>
            </section>

            <div className="administrator-grid">
              <section className="admin-panel administrator-list">
                <div className="panel-heading"><div><span className="panel-kicker">ACCOUNTS</span><h2>账号列表</h2></div><Users size={20} /></div>
                {admins.map((admin) => (
                  <article key={admin.id}>
                    <div className="administrator-avatar">{admin.username.slice(0, 1).toUpperCase()}</div>
                    <div><strong>{admin.username}</strong><span>{admin.role === "superadmin" ? "超级管理员" : "普通管理员"}</span><small>{admin.lastLoginAt ? `最近登录 ${new Date(admin.lastLoginAt).toLocaleString("zh-CN")}` : "尚未登录"}</small></div>
                    {session.user.role === "superadmin" && admin.role !== "superadmin" ? <button type="button" disabled={adminBusy} onClick={() => void removeAdministrator(admin.username)}><Trash2 size={14} />删除</button> : null}
                  </article>
                ))}
              </section>

              <form className="admin-panel create-form administrator-create" onSubmit={addAdministrator}>
                <div className="panel-heading"><div><span className="panel-kicker">NEW ADMIN</span><h2>新增普通管理员</h2></div><UserPlus size={20} /></div>
                <label>用户名<input required minLength={3} maxLength={32} pattern="[a-z0-9][a-z0-9._-]{2,31}" value={adminUsername} onChange={(event) => setAdminUsername(event.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ""))} placeholder="例如 festival-editor" /><small>允许小写字母、数字、点、下划线和连字符。</small></label>
                <label>初始密码<input required type="password" autoComplete="new-password" maxLength={128} value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} /><small>密码不能为空，请通过安全渠道交给该管理员。</small></label>
                <button className="primary-admin-button" type="submit" disabled={adminBusy}><UserPlus size={16} />{adminBusy ? "正在创建" : "创建管理员"}</button>
              </form>
            </div>

            <section className={maintenance.active ? "admin-panel deployment-panel is-maintaining" : "admin-panel deployment-panel"}>
              <div><span className="deployment-icon"><GitBranch size={22} /></span><div><span className="panel-kicker">GITHUB UPDATE</span><h2>从 GitHub 部署更新</h2><p>{session.user.role !== "superadmin" ? "拉取 GitHub 更新仅限超级管理员，普通管理员仍可开启或结束维护提示。" : updateConfigured ? "按钮会请求受限的 GitHub Actions 工作流更新服务器，不会向网页暴露 Docker 控制权限。" : "尚未配置 GitHub 更新令牌和部署工作流，按钮暂不可用。"}</p></div></div>
              <div className="deployment-state"><span>{maintenance.active ? "维护提示已开启" : "系统正常开放"}</span><small>当前版本 {currentVersion}</small>{maintenance.startedBy ? <small>由 {maintenance.startedBy} 开启</small> : null}</div>
              <div className="deployment-actions">
                {maintenance.active ? <button className="text-admin-button" type="button" disabled={updateBusy} onClick={() => void changeMaintenance(false)}><Check size={15} />结束维护</button> : <button className="text-admin-button" type="button" disabled={updateBusy} onClick={() => void changeMaintenance(true)}><Wrench size={15} />仅开启维护提示</button>}
                <button className="primary-admin-button" type="button" disabled={updateBusy || !updateConfigured || session.user.role !== "superadmin"} onClick={() => void dispatchUpdate()}><RefreshCw size={15} />{session.user.role !== "superadmin" ? "仅超级管理员可更新" : updateBusy ? "正在处理" : "拉取 GitHub 更新"}</button>
              </div>
            </section>
          </div>
        ) : null}

        {section === "overview" ? (
          <div className="admin-content">
            <div className="activity-list-heading">
              <div><span className="panel-kicker">ACTIVITIES</span><h2>活动列表</h2><p>选择一个活动后，再管理它自己的页面、分类和成就。</p></div>
              <div className="activity-list-actions"><span>{festivals.length} 个活动</span><button className="primary-admin-button" onClick={showNewActivity}><CirclePlus size={16} />新建活动</button></div>
            </div>
            <div className="activity-catalog">
              {festivals.map((festival) => (
                <button className="admin-panel activity-card" key={festival.eventId} onClick={() => void openActivity(festival.eventId)}>
                  <div className="activity-card-top"><span className={festival.status === "active" ? "activity-state is-active" : "activity-state"}>{festival.status === "active" ? "开放中" : "未开放"}</span><small>{festival.dateLabel}</small></div>
                  <div><span className="panel-kicker">{festival.eyebrow}</span><h3>{festival.name}</h3><p>{festival.subtitle}</p></div>
                  <footer><code>{festival.eventId}</code><span>进入活动<ChevronRight size={16} /></span></footer>
                </button>
              ))}
              {!festivals.length ? <div className="admin-panel activity-empty"><CalendarDays size={28} /><h3>暂无活动</h3><p>创建第一个活动后，它会显示在这里。</p></div> : null}
            </div>
          </div>
        ) : null}

        {section === "new-activity" ? (
          <div className="admin-content new-activity-layout">
            <form className="admin-panel create-form new-activity-form" onSubmit={createNewActivity}>
              <div className="panel-heading">
                <div><span className="panel-kicker">NEW ACTIVITY</span><h2>创建新活动</h2></div>
                <CalendarDays size={21} />
              </div>
              <label>导入活动包（可选）<input key={newActivityPackage ? "selected" : "empty"} type="file" accept=".zip" disabled={creatingFestival} onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                if (!file.name.toLowerCase().endsWith(".zip") || file.size > 8 * 1024 * 1024) {
                  setNotice("请选择不超过 8 MB 的 ZIP 活动包");
                  event.target.value = "";
                  return;
                }
                setNewActivityPackage(file);
              }} /><small>选择后使用包内名称、编号、说明、时间、分类、成就和页面；创建时校验活动包。</small></label>
              {newActivityPackage ? <div role="status"><p>已选择：{newActivityPackage.name}。下面的手填内容不参与创建。</p><button className="text-admin-button" type="button" disabled={creatingFestival} onClick={() => setNewActivityPackage(null)}>移除活动包，恢复手动填写</button></div> : null}
              <fieldset disabled={creatingFestival || Boolean(newActivityPackage)} className={newActivityPackage ? "new-activity-fields is-overridden" : "new-activity-fields"}>
              <label>活动名称<input required maxLength={80} value={festivalDraft.name} onChange={(event) => setFestivalDraft({ ...festivalDraft, name: event.target.value })} placeholder="例如：冬日游园会" /></label>
              <label>活动编号<input required minLength={3} maxLength={64} pattern="[a-z0-9][a-z0-9-]{2,63}" value={festivalDraft.eventId} onChange={(event) => setFestivalDraft({ ...festivalDraft, eventId: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })} placeholder="winter-festival-2026" /><small>只允许小写字母、数字和连字符；打印二维码后不要修改。</small></label>
              <label>活动标记<input required maxLength={80} value={festivalDraft.eyebrow} onChange={(event) => setFestivalDraft({ ...festivalDraft, eyebrow: event.target.value })} placeholder="NCPA · 2026" /></label>
              <label>活动说明<textarea required maxLength={240} value={festivalDraft.subtitle} onChange={(event) => setFestivalDraft({ ...festivalDraft, subtitle: event.target.value })} placeholder="简要说明活动主题和参与方式" /></label>
              <label>活动时间<input required maxLength={80} value={festivalDraft.dateLabel} onChange={(event) => setFestivalDraft({ ...festivalDraft, dateLabel: event.target.value })} placeholder="12.20 / 16:00—20:00" /></label>
              </fieldset>
              <div className="new-activity-form-actions">
                <button className="text-admin-button" type="button" onClick={returnToOverview}><ArrowLeft size={15} />返回总览</button>
                <button className="primary-admin-button" type="submit" disabled={creatingFestival}><Save size={16} />{creatingFestival ? "正在创建" : "创建活动"}</button>
              </div>
            </form>
            <aside className="admin-panel new-activity-notes">
              <span className="panel-kicker">ACTIVITY WORKSPACE</span>
              <h2>创建后再完善内容</h2>
              <p>新活动默认不会立即开放，避免尚未配置完成时被学生扫码访问。</p>
              <ol>
                <li><span>01</span><div><strong>创建活动</strong><small>保存名称、编号、说明和时间。</small></div></li>
                <li><span>02</span><div><strong>配置分类与成就</strong><small>数据只属于这个活动，不与其他活动共用。</small></div></li>
                <li><span>03</span><div><strong>生成二维码</strong><small>下载并测试每个成就的二维码。</small></div></li>
                <li><span>04</span><div><strong>检查后开放</strong><small>确认二维码和页面无误后再开启活动。</small></div></li>
              </ol>
            </aside>
          </div>
        ) : null}

        {section === "activity" ? (
          <div className="admin-content">
            <div className="prototype-banner"><Sparkles size={18} /><div><strong>正在管理：{config.name}</strong><p>下面的分类、成就和领取数量都只属于该活动；管理请求由服务器认证并执行运行时校验。</p></div></div>
            <div className="admin-panel event-control">
              <div><span className="panel-kicker">CURRENT EVENT</span><h2>{config.name}</h2><p>{config.subtitle}</p></div>
              <button className={config.status === "active" ? "danger-button" : "primary-admin-button"} onClick={toggleEventStatus}>
                {config.status === "active" ? "关闭活动" : "开启活动"}
              </button>
            </div>
            <div className="metric-grid activity-metrics">
              <Metric label="成就总数" value={String(config.achievements.length)} detail={`${activeAchievements} 个正在启用`} />
              <Metric label="成就分类" value={String(config.categories.length)} detail="仅用于当前活动" />
              <Metric label="在线领取" value={String(totalOnlineClaims)} detail="已通过服务器校验" />
            </div>
          </div>
        ) : null}

        {section === "achievements" ? (
          <div className="admin-content split-content">
            <section className="admin-panel achievement-list-panel">
              <div className="panel-heading"><div><span className="panel-kicker">ACHIEVEMENTS</span><h2>当前成就</h2></div><span>{config.achievements.length}项</span></div>
              <div className="admin-achievement-list">
                {config.achievements.map((achievement) => {
                  const stat = claimStatsById[achievement.id];
                  return (
                    <article key={achievement.id} className={!achievement.enabled ? "is-disabled" : ""}>
                      <span className="admin-achievement-icon"><AchievementIconGraphic icon={achievement.icon} /></span>
                      <div className="admin-achievement-copy">
                        <strong>{achievement.name}</strong>
                        <small>{achievement.claimCode} · {config.categories.find((category) => category.id === achievement.categoryId)?.name ?? defaultAchievementCategory.name}</small>
                        <div className="admin-icon-controls">
                          <button onClick={() => openEmojiPicker({ kind: "achievement", achievementId: achievement.id })}><SmilePlus size={11} />输入 Emoji</button>
                        </div>
                      </div>
                      <div className="claim-limit-editor">
                        <span>已领 {stat?.claimedCount ?? 0}/{stat?.maxClaims ?? achievement.claimLimit ?? 100}</span>
                        <div><input aria-label={`${achievement.name}领取上限`} type="number" min="1" max="100000" value={limitDrafts[achievement.id] ?? String(achievement.claimLimit || 100)} onChange={(event) => setLimitDrafts({ ...limitDrafts, [achievement.id]: event.target.value })} /><button onClick={() => saveClaimLimit(achievement.id)}>保存</button></div>
                      </div>
                      <div className="claim-row-actions">
                        <button disabled={qrBusyId === achievement.id} onClick={() => void showAchievementQr(achievement)}><Eye size={12} />查看二维码</button>
                        <button disabled={qrBusyId === achievement.id} onClick={() => void downloadAchievementQr(achievement)}><Download size={12} />下载二维码</button>
                        <button onClick={() => void resetOnlineCount(achievement.id)}>清零计数</button>
                        <button onClick={() => toggleAchievement(achievement.id)}>{achievement.enabled ? "停用成就" : "启用成就"}</button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
            <form className="admin-panel create-form" onSubmit={addAchievement}>
              <div className="panel-heading"><div><span className="panel-kicker">NEW RECORD</span><h2>新增成就</h2></div><CirclePlus size={20} /></div>
              <label>成就名称<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="例如：钟楼见证人" /></label>
              <label>二维码识别码<input value={draft.claimCode} onChange={(event) => setDraft({ ...draft, claimCode: event.target.value })} placeholder="bell-tower-01" /></label>
              <label>成就说明<textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="写下解锁条件或发现内容" /></label>
              <div className="new-achievement-icon-field">
                <span className="new-achievement-icon-preview"><AchievementIconGraphic icon={draft.icon} /></span>
                <div>
                  <strong>成就图案</strong>
                  <small>使用内置 Emoji，避免将大型二进制内容写入数据库。</small>
                  <div className="new-achievement-icon-actions">
                    <button type="button" onClick={() => openEmojiPicker({ kind: "draft" })}><SmilePlus size={13} />输入 Emoji</button>
                  </div>
                </div>
              </div>
              <label>
                所属分类（可选）
                <select value={draft.categoryId} onChange={(event) => setDraft({ ...draft, categoryId: event.target.value })}>
                  <option value="">{defaultAchievementCategory.name}（不选择分类）</option>
                  {config.categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}
                </select>
                <small>不选择时，成就会自动显示在默认分类中。</small>
              </label>
              <label>领取上限<input type="number" min="1" max="100000" value={draft.claimLimit} onChange={(event) => setDraft({ ...draft, claimLimit: Number.parseInt(event.target.value || "1", 10) })} /></label>
              <button className="primary-admin-button" type="submit"><Save size={16} />保存成就</button>
            </form>
          </div>
        ) : null}

        {section === "categories" ? (
          <div className="admin-content">
            <form className="admin-panel category-create" onSubmit={addCategory}>
              <div><span className="panel-kicker">NEW GROUP</span><h2>创建成就分类</h2></div>
              <input value={categoryName} onChange={(event) => setCategoryName(event.target.value)} placeholder="输入分类名称" />
              <button className="primary-admin-button" type="submit"><CirclePlus size={16} />新增分类</button>
            </form>
            <div className="category-admin-grid">
              <article className="admin-panel default-category-card">
                <span className="category-index">默认</span>
                <h3>{defaultAchievementCategory.name}</h3>
                <p>{defaultAchievementCategory.description}</p>
                <div><span>{config.achievements.filter((achievement) => !achievement.categoryId).length} 个成就</span><small>系统分组</small></div>
              </article>
              {config.categories.map((category) => {
                const count = config.achievements.filter((achievement) => achievement.categoryId === category.id).length;
                return <article className="admin-panel" key={category.id}><span className="category-index">{String(category.sortOrder).padStart(2, "0")}</span><h3>{category.name}</h3><p>{category.description}</p><div><span>{count} 个成就</span><button onClick={() => removeCategory(category.id)}><Archive size={14} />移除</button></div></article>;
              })}
            </div>
          </div>
        ) : null}

        {section === "packages" ? (
          <div className="admin-content package-layout">
            <section className="admin-panel package-upload-panel">
              <span className="panel-kicker">ACTIVITY PACKAGE</span>
              <h2>导入活动包</h2>
              <p>选择 ZIP 后，服务器会检查 <code>manifest.json</code>、<code>festival-config.json</code> 和入口页面，再保存到数据库。</p>
              <label className="package-dropzone" aria-disabled={packageUploading}>
                <input type="file" accept="application/zip,.zip" disabled={packageUploading} onChange={(event) => void uploadActivityPackage(event)} />
                {packageUploading ? <span className="spinner" /> : <UploadCloud size={30} />}
                <strong>{packageUploading ? "正在导入，请稍候" : activityPackage ? "选择新 ZIP 替换当前活动包" : "选择 ZIP 活动包"}</strong>
                <small>最大 8 MB；导入会同步包内的分类与成就</small>
              </label>
              <div className="package-guidance">
                <strong>导入规则</strong>
                <p>当前活动编号和开放状态不会被覆盖。包内网页会在隔离环境运行，扫码仍由平台统一校验。</p>
              </div>
            </section>

            <section className="admin-panel package-result-panel">
              {packageLoading ? (
                <div className="package-empty"><span className="spinner" /><h3>正在读取活动包</h3></div>
              ) : activityPackage ? (
                <>
                  <div className="package-check"><PackageCheck size={28} /><span>当前活动包已启用</span></div>
                  <dl>
                    <div><dt>包内活动名称</dt><dd>{activityPackage.name}</dd></div>
                    <div><dt>来源活动编号</dt><dd>{activityPackage.sourceEventId}</dd></div>
                    <div><dt>版本</dt><dd>{activityPackage.version}</dd></div>
                    <div><dt>入口页面</dt><dd>{activityPackage.entry}</dd></div>
                    <div><dt>文件数量</dt><dd>{activityPackage.fileCount}</dd></div>
                    <div><dt>最后导入</dt><dd>{new Date(activityPackage.updatedAt).toLocaleString("zh-CN")}</dd></div>
                  </dl>
                  <div className="package-actions">
                    <Link className="primary-admin-button" href={`/?event=${encodeURIComponent(config.eventId)}`} target="_blank"><ExternalLink size={15} />打开活动页面</Link>
                    <button className="text-admin-button package-remove-button" type="button" disabled={packageUploading} onClick={() => void removeActivityPackage()}><Trash2 size={15} />移除活动包</button>
                  </div>
                </>
              ) : (
                <div className="package-empty"><FolderArchive size={34} /><h3>尚未导入活动包</h3><p>当前访客看到的是平台默认活动页面。</p></div>
              )}
            </section>
          </div>
        ) : null}

        {section === "lotteries" ? <LotteryManager config={config} adminFetch={adminFetch} setNotice={setNotice} /> : null}

      </section>

      {qrPreview ? (
        <div className="admin-qr-overlay" role="dialog" aria-modal="true" aria-label={`${qrPreview.achievement.name}的二维码`}>
          <div className="admin-qr-dialog">
            <button className="admin-qr-close" onClick={() => setQrPreview(null)} aria-label="关闭二维码"><X size={19} /></button>
            <span className="admin-qr-icon"><QrCode size={20} /></span>
            <p className="panel-kicker">ACHIEVEMENT QR CODE</p>
            <h2>{qrPreview.achievement.name}</h2>
            <small>{config.name} · {qrPreview.achievement.claimCode}</small>
            {/* QR codes are generated in the browser as data URLs, so image optimization does not apply. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrPreview.dataUrl} alt={`${qrPreview.achievement.name}成就二维码`} />
            <code>{qrPreview.claimUrl}</code>
            {qrPreview.localOnly ? <div className="admin-qr-warning">当前二维码包含本机地址，手机无法访问。请使用校园服务器域名或手机能访问的局域网地址打开管理台后，再下载打印。</div> : null}
            <div className="admin-qr-actions">
              <button className="text-admin-button" onClick={() => setQrPreview(null)}>关闭</button>
              <button className="primary-admin-button" onClick={() => downloadQr(qrPreview)}><Download size={15} />下载 PNG</button>
            </div>
          </div>
        </div>
      ) : null}

      {emojiTarget ? (
        <div className="admin-qr-overlay" role="dialog" aria-modal="true" aria-label="输入成就 Emoji 图案">
          <div className="admin-emoji-dialog">
            <button className="admin-qr-close" onClick={closeEmojiPicker} aria-label="关闭 Emoji 输入"><X size={19} /></button>
            <span className="admin-qr-icon"><SmilePlus size={20} /></span>
            <p className="panel-kicker">EMOJI ICON</p>
            <h2>输入成就图案</h2>
            <p>输入或粘贴 Emoji、符号等文本，网站会直接显示。</p>
            <form className="achievement-emoji-custom" onSubmit={(event) => { event.preventDefault(); chooseEmoji(emojiInput); }}>
              <label htmlFor="achievement-emoji-input">输入 Emoji 或特殊字符</label>
              <div>
                <input
                  id="achievement-emoji-input"
                  value={emojiInput}
                  onChange={(event) => setEmojiInput(event.target.value)}
                  placeholder="例如：🏀 💩 😄"
                  maxLength={32}
                />
                <button type="submit" disabled={!emojiInput.trim()}>使用</button>
              </div>
              <small>Windows：Win + . · macOS：Control + Command + Space</small>
            </form>
          </div>
        </div>
      ) : null}

      {notice ? (
        <div className={pendingSave ? "admin-toast is-error" : "admin-toast"} role="status">
          {pendingSave ? <AlertTriangle size={15} /> : <Check size={15} />}
          <span>{notice}</span>
          {pendingSave ? (
            <button type="button" onClick={retryPendingSave} disabled={onlineStatus === "connecting"}>
              <RefreshCw size={13} />{onlineStatus === "connecting" ? "重试中" : "重新保存"}
            </button>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}

function AdminNav({ active, onClick, icon, label, count }: { active: boolean; onClick: () => void; icon: ReactNode; label: string; count?: number }) {
  return <button className={active ? "active" : ""} onClick={onClick}>{icon}<span>{label}</span>{count !== undefined ? <small>{count}</small> : null}</button>;
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <article className="admin-panel metric-card"><span>{label}</span><strong>{value}</strong><p>{detail}</p></article>;
}

function sectionTitle(section: AdminSection) {
  return {
    administrators: "管理员面板",
    overview: "活动总览",
    "new-activity": "新建活动",
    activity: "活动设置",
    achievements: "成就管理",
    categories: "分类管理",
    lotteries: "抽奖管理",
    packages: "活动包管理",
  }[section];
}

function summaryFromConfig(config: FestivalConfig): FestivalSummary {
  return {
    eventId: config.eventId,
    name: config.name,
    eyebrow: config.eyebrow,
    subtitle: config.subtitle,
    dateLabel: config.dateLabel,
    status: config.status,
    updatedAt: "",
  };
}

function upsertFestivalSummary(current: FestivalSummary[], next: FestivalSummary) {
  const exists = current.some((festival) => festival.eventId === next.eventId);
  return exists
    ? current.map((festival) => festival.eventId === next.eventId ? next : festival)
    : [next, ...current];
}
