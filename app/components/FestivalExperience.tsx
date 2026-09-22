"use client";

import {
  AlertTriangle,
  ArrowRight,
  Camera,
  Check,
  Dices,
  Gift,
  LockKeyhole,
  QrCode,
  Wrench,
  X,
} from "lucide-react";
import jsQR from "jsqr";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AchievementIconGraphic } from "./AchievementIconGraphic";
import {
  FestivalAchievement,
  FestivalConfig,
  UnlockState,
  defaultAchievementCategory,
  loadUnlockState,
  saveUnlockState,
} from "../lib/demo-store";
import { clearClaimParameters, parseClaimPayload } from "../lib/claim-link";

type ClaimedAchievement = Pick<FestivalAchievement, "id" | "name" | "description" | "icon">;

type ClaimResult = {
  kind: "success" | "already" | "error";
  title: string;
  message: string;
  achievement?: ClaimedAchievement;
};

type OnlineClaimResponse = {
  status: "claimed" | "already" | "event_closed" | "achievement_disabled" | "limit_reached" | "not_found";
  achievement?: ClaimedAchievement;
  claimedCount?: number;
  maxClaims?: number;
  error?: string;
};

type ScannerStatus = "starting" | "scanning" | "verifying" | "unavailable" | "error";

type MaintenanceState = {
  active: boolean;
  message: string;
};

type LotteryWin = {
  drawId: number;
  lotteryId: number;
  lotteryName: string;
  prizeId: number;
  prizeName: string;
  prizeDescription: string;
  prizeIcon: string;
  participantCode: string;
  drawnAt: string;
};

type ParticipantLottery = {
  id: number;
  name: string;
  description: string;
  eligible: boolean;
  prizes: Array<{ id: number; name: string; description: string; icon: string; remaining: number }>;
};

type ParticipantDrawResult = {
  status: "winner" | "no_prize" | "already" | "not_eligible" | "sold_out";
  draw?: { prizeName: string; prizeDescription: string; prizeIcon: string; participantCode: string; drawnAt: string };
};

const inactiveFestivalConfig: FestivalConfig = {
  eventId: "",
  name: "",
  eyebrow: "",
  subtitle: "",
  dateLabel: "",
  status: "closed",
  webScannerEnabled: false,
  categories: [],
  achievements: [],
};

export function FestivalExperience() {
  const [config, setConfig] = useState<FestivalConfig>(inactiveFestivalConfig);
  const [unlockState, setUnlockState] = useState<UnlockState>({ version: 1, unlocked: {} });
  const [hydrated, setHydrated] = useState(false);
  const [claimResult, setClaimResult] = useState<ClaimResult | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerStatus, setScannerStatus] = useState<ScannerStatus>("starting");
  const [scannerMessage, setScannerMessage] = useState("");
  const [directClaimPending, setDirectClaimPending] = useState(false);
  const [packageEntryUrl, setPackageEntryUrl] = useState<string | null>(null);
  const [maintenance, setMaintenance] = useState<MaintenanceState>({ active: false, message: "系统正在维护，请稍后再试。" });
  const [lotteryWins, setLotteryWins] = useState<LotteryWin[]>([]);
  const [prizesOpen, setPrizesOpen] = useState(false);
  const [prizesLoading, setPrizesLoading] = useState(false);
  const [lotteries, setLotteries] = useState<ParticipantLottery[]>([]);
  const [lotteriesOpen, setLotteriesOpen] = useState(false);
  const [selectedLotteryId, setSelectedLotteryId] = useState<number | null>(null);
  const [lotteriesLoading, setLotteriesLoading] = useState(false);
  const [lotteryDrawBusy, setLotteryDrawBusy] = useState(false);
  const [lotteryDrawResult, setLotteryDrawResult] = useState<ParticipantDrawResult | null>(null);
  const processedUrl = useRef(false);
  const packageFrame = useRef<HTMLIFrameElement>(null);
  const scannerVideo = useRef<HTMLVideoElement>(null);
  const scannerCanvas = useRef<HTMLCanvasElement>(null);
  const scannerStream = useRef<MediaStream | null>(null);
  const scannerFrame = useRef<number | null>(null);
  const scannerLocked = useRef(false);
  const lastScannerRead = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const syncConfig = async (preserveOnFailure = false) => {
      const requestedEvent = new URLSearchParams(window.location.search).get("event");
      const endpoint = requestedEvent
        ? `/api/festival?eventId=${encodeURIComponent(requestedEvent)}`
        : "/api/festival";
      try {
        const response = await fetch(endpoint);
        if (!response.ok) throw new Error("活动读取失败");
        const payload = await response.json() as { config: FestivalConfig | null; maintenance?: MaintenanceState };
        if (cancelled) return;
        setMaintenance(payload.maintenance ?? { active: false, message: "系统正在维护，请稍后再试。" });
        const nextConfig = payload.config?.status === "active" ? payload.config : inactiveFestivalConfig;
        setConfig(nextConfig);
        setUnlockState(nextConfig.status === "active" ? loadUnlockState(nextConfig.eventId) : { version: 1, unlocked: {} });
        if (nextConfig.status === "active") {
          try {
            const packageResponse = await fetch(`/api/activity-package?eventId=${encodeURIComponent(nextConfig.eventId)}`, { cache: "no-store" });
            const packagePayload = packageResponse.ok
              ? await packageResponse.json() as { entryUrl: string | null }
              : { entryUrl: null };
            if (!cancelled) setPackageEntryUrl(packagePayload.entryUrl);
          } catch {
            if (!cancelled) setPackageEntryUrl(null);
          }
        } else {
          setPackageEntryUrl(null);
        }
        if (nextConfig.status === "closed") {
          setClaimResult(null);
          setScannerOpen(false);
          setPackageEntryUrl(null);
        }
      } catch {
        if (!cancelled && !preserveOnFailure) {
          setConfig(inactiveFestivalConfig);
          setUnlockState({ version: 1, unlocked: {} });
          setClaimResult(null);
          setScannerOpen(false);
        }
      } finally {
        if (!cancelled) setHydrated(true);
      }
    };

    const hydrationTimer = window.setTimeout(() => {
      void syncConfig();
    }, 0);
    const maintenancePoll = window.setInterval(() => {
      void syncConfig(true);
    }, 10_000);
    return () => {
      cancelled = true;
      window.clearTimeout(hydrationTimer);
      window.clearInterval(maintenancePoll);
    };
  }, []);

  useEffect(() => {
    if (config.status !== "active" || !config.eventId) {
      const resetTimer = window.setTimeout(() => {
        setLotteryWins([]);
        setPrizesOpen(false);
        setLotteries([]);
        setLotteriesOpen(false);
        setSelectedLotteryId(null);
        setLotteryDrawResult(null);
      }, 0);
      return () => window.clearTimeout(resetTimer);
    }
    let cancelled = false;
    async function loadParticipantData(showLoading = false) {
      if (showLoading) { setPrizesLoading(true); setLotteriesLoading(true); }
      try {
        const lotteryResponse = await fetch(`/api/lottery?eventId=${encodeURIComponent(config.eventId)}`, { cache: "no-store" });
        if (lotteryResponse.ok) {
          const payload = await lotteryResponse.json() as { lotteries: ParticipantLottery[] };
          if (!cancelled) setLotteries(payload.lotteries);
        }
        const winsResponse = await fetch(`/api/lottery/wins?eventId=${encodeURIComponent(config.eventId)}`, { cache: "no-store" });
        if (winsResponse.ok) {
          const payload = await winsResponse.json() as { wins: LotteryWin[] };
          if (!cancelled) setLotteryWins(payload.wins);
        }
      } finally {
        if (!cancelled && showLoading) { setPrizesLoading(false); setLotteriesLoading(false); }
      }
    }
    void loadParticipantData();
    const timer = window.setInterval(() => void loadParticipantData(), 8_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [config.eventId, config.status]);

  const activeAchievements = useMemo(
    () => config.achievements.filter((achievement) => achievement.enabled),
    [config.achievements],
  );
  const visibleCategories = useMemo(
    () => [
      ...(activeAchievements.some((achievement) => !achievement.categoryId)
        ? [defaultAchievementCategory]
        : []),
      ...config.categories,
    ],
    [activeAchievements, config.categories],
  );
  const unlockedCount = activeAchievements.filter(
    (achievement) => unlockState.unlocked[achievement.id],
  ).length;
  const progress = activeAchievements.length
    ? Math.round((unlockedCount / activeAchievements.length) * 100)
    : 0;
  const selectedLottery = lotteries.find((lottery) => lottery.id === selectedLotteryId) ?? null;

  async function participateInLottery(lottery: ParticipantLottery) {
    if (lotteryDrawBusy || !lottery.eligible) return;
    setLotteryDrawBusy(true);
    try {
      const response = await fetch("/api/lottery", {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ eventId: config.eventId, lotteryId: lottery.id }),
      });
      const result = await response.json() as ParticipantDrawResult & { error?: string };
      if (!response.ok) throw new Error(result.error || "抽奖暂时无法进行");
      setLotteryDrawResult(result);
      const [lotteryResponse, winsResponse] = await Promise.all([
        fetch(`/api/lottery?eventId=${encodeURIComponent(config.eventId)}`, { cache: "no-store" }),
        fetch(`/api/lottery/wins?eventId=${encodeURIComponent(config.eventId)}`, { cache: "no-store" }),
      ]);
      if (lotteryResponse.ok) setLotteries((await lotteryResponse.json() as { lotteries: ParticipantLottery[] }).lotteries);
      if (winsResponse.ok) setLotteryWins((await winsResponse.json() as { wins: LotteryWin[] }).wins);
    } catch (error) {
      setClaimResult({ kind: "error", title: "抽奖暂不可用", message: error instanceof Error ? error.message : "请稍后重试。" });
    } finally {
      setLotteryDrawBusy(false);
    }
  }
  const claimAchievement = useCallback(async (eventId: string, claimCode: string) => {
    try {
      const response = await fetch("/api/claims", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ eventId, claimCode }),
      });
      const result = await response.json() as OnlineClaimResponse;
      const isStructuredNotFound = response.status === 404 && result.status === "not_found";
      if (!response.ok && !isStructuredNotFound) {
        throw new Error(response.status === 429 ? "操作过于频繁，请一分钟后再试。" : "服务器暂时无法完成校验，请稍后重试。");
      }
      const localAchievement = config.achievements.find((item) => item.claimCode === claimCode);
      const achievement = result.achievement ?? localAchievement;

      if (result.status === "claimed" || result.status === "already") {
        if (!achievement) throw new Error("服务器返回的成就资料不完整");
        setUnlockState((current) => {
          const nextState: UnlockState = {
            version: 1,
            unlocked: {
              ...current.unlocked,
              [achievement.id]: {
                unlockedAt: current.unlocked[achievement.id]?.unlockedAt ?? new Date().toISOString(),
                source: "qr",
              },
            },
          };
          saveUnlockState(eventId, nextState);
          return nextState;
        });
        const quota = result.claimedCount !== undefined && result.maxClaims !== undefined
          ? `当前已领取 ${result.claimedCount}/${result.maxClaims}。`
          : "";
        setClaimResult({
          kind: result.status === "claimed" ? "success" : "already",
          title: result.status === "claimed" ? "新成就已解锁" : "你已经获得此成就",
          message: `${achievement.description}${quota ? ` ${quota}` : ""}`,
          achievement,
        });
        return;
      }

      const errors: Record<OnlineClaimResponse["status"], { title: string; message: string }> = {
        claimed: { title: "领取成功", message: "" },
        already: { title: "已经领取", message: "" },
        event_closed: { title: "活动未开放", message: "该二维码对应的活动当前未开放。" },
        achievement_disabled: { title: "成就已停用", message: "该成就当前不可领取。" },
        limit_reached: { title: "领取名额已满", message: `这枚成就的 ${result.maxClaims ?? "全部"} 个名额已经领完。` },
        not_found: { title: "无法识别此二维码", message: "二维码不属于当前活动或识别码无效。" },
      };
      setClaimResult({ kind: "error", ...errors[result.status] });
    } catch (error) {
      setClaimResult({
        kind: "error",
        title: "暂时无法在线校验",
        message: error instanceof Error ? error.message : "请确认设备已连接校园网络后重试。",
      });
    }
  }, [config]);

  const claimFromPayload = useCallback(async (payload: string) => {
    const target = parseClaimPayload(payload, window.location.origin, config.eventId);
    await claimAchievement(target.eventId, target.claimCode);
  }, [claimAchievement, config.eventId]);

  useEffect(() => {
    if (!hydrated || maintenance.active || processedUrl.current) return;
    processedUrl.current = true;
    if (config.status !== "active") {
      window.history.replaceState({}, "", window.location.pathname);
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const claimCode = params.get("unlock");
    if (!claimCode) return;
    const claimUrl = window.location.href;
    let cancelled = false;
    const claimTimer = window.setTimeout(() => {
      setDirectClaimPending(true);
      try {
        const target = parseClaimPayload(claimUrl, window.location.origin, config.eventId);
        void claimAchievement(target.eventId, target.claimCode).finally(() => {
          if (!cancelled) setDirectClaimPending(false);
        });
      } catch (error) {
        setDirectClaimPending(false);
        setClaimResult({
          kind: "error",
          title: "无法识别此二维码",
          message: error instanceof Error ? error.message : "二维码链接无效。",
        });
      }
    }, 0);
    window.history.replaceState({}, "", clearClaimParameters(window.location.href));
    return () => {
      cancelled = true;
      window.clearTimeout(claimTimer);
    };
  }, [claimAchievement, config.eventId, config.status, hydrated, maintenance.active]);

  const stopLiveScanner = useCallback(() => {
    if (scannerFrame.current !== null) {
      window.cancelAnimationFrame(scannerFrame.current);
      scannerFrame.current = null;
    }
    scannerStream.current?.getTracks().forEach((track) => track.stop());
    scannerStream.current = null;
    if (scannerVideo.current) scannerVideo.current.srcObject = null;
  }, []);

  const openScanner = useCallback(() => {
    setScannerMessage("");
    setScannerStatus("starting");
    scannerLocked.current = false;
    lastScannerRead.current = 0;
    setScannerOpen(true);
  }, []);

  useEffect(() => {
    const frame = packageFrame.current;
    if (!frame || !packageEntryUrl || config.status !== "active") return;
    const activeFrame: HTMLIFrameElement = frame;

    function respond(requestId: string, ok: boolean, value?: unknown, error?: string) {
      activeFrame.contentWindow?.postMessage({
        source: "ncpa-activity-host",
        type: "response",
        requestId,
        ok,
        value,
        error,
      }, "*");
    }

    function handlePackageMessage(event: MessageEvent) {
      if (event.source !== activeFrame.contentWindow) return;
      const message = event.data as { source?: string; type?: string; requestId?: string; method?: string; params?: unknown } | null;
      if (!message || message.source !== "ncpa-activity-package" || message.type !== "request" || typeof message.requestId !== "string") return;

      if (message.method === "getContext") {
        const achievements = activeAchievements.map((achievement) => ({
          ...achievement,
          claimCode: "",
          unlocked: Boolean(unlockState.unlocked[achievement.id]),
        }));
        respond(message.requestId, true, {
          event: config,
          achievements,
          lotteries,
          wins: lotteryWins,
          progress: {
            unlocked: achievements.filter((achievement) => achievement.unlocked).length,
            total: achievements.length,
          },
        });
        return;
      }

      if (message.method === "openScanner") {
        if (!config.webScannerEnabled) {
          respond(message.requestId, false, undefined, "当前活动未开放网页摄像头扫码");
          return;
        }
        openScanner();
        respond(message.requestId, true, true);
        return;
      }

      if (message.method === "openLotteries") {
        if (!lotteries.length) {
          respond(message.requestId, false, undefined, "当前活动还没有可参加的抽奖项目");
          return;
        }
        setLotteryDrawResult(null);
        setSelectedLotteryId(null);
        setLotteriesOpen(true);
        respond(message.requestId, true, true);
        return;
      }

      if (message.method === "openPrizes") {
        setPrizesOpen(true);
        setPrizesLoading(true);
        fetch(`/api/lottery/wins?eventId=${encodeURIComponent(config.eventId)}`, { cache: "no-store" })
          .then((response) => response.ok ? response.json() : null)
          .then((payload: { wins: LotteryWin[] } | null) => { if (payload) setLotteryWins(payload.wins); })
          .finally(() => setPrizesLoading(false));
        respond(message.requestId, true, true);
        return;
      }

      if (message.method === "drawLottery") {
        const params = message.params as { lotteryId?: unknown } | null;
        const lotteryId = params?.lotteryId;
        if (typeof lotteryId !== "number" || !Number.isInteger(lotteryId) || lotteryId <= 0) {
          respond(message.requestId, false, undefined, "抽奖项目编号无效");
          return;
        }
        void (async () => {
          try {
            const response = await fetch("/api/lottery", {
              method: "POST",
              cache: "no-store",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ eventId: config.eventId, lotteryId }),
            });
            const result = await response.json() as ParticipantDrawResult & { error?: string };
            if (!response.ok) throw new Error(result.error || "抽奖暂时无法进行");
            const [lotteryResponse, winsResponse] = await Promise.all([
              fetch(`/api/lottery?eventId=${encodeURIComponent(config.eventId)}`, { cache: "no-store" }),
              fetch(`/api/lottery/wins?eventId=${encodeURIComponent(config.eventId)}`, { cache: "no-store" }),
            ]);
            const nextLotteries = lotteryResponse.ok
              ? (await lotteryResponse.json() as { lotteries: ParticipantLottery[] }).lotteries
              : lotteries;
            const nextWins = winsResponse.ok
              ? (await winsResponse.json() as { wins: LotteryWin[] }).wins
              : lotteryWins;
            setLotteries(nextLotteries);
            setLotteryWins(nextWins);
            respond(message.requestId, true, { result, lotteries: nextLotteries, wins: nextWins });
          } catch (error) {
            respond(message.requestId, false, undefined, error instanceof Error ? error.message : "抽奖暂时无法进行");
          }
        })();
        return;
      }

      respond(message.requestId, false, undefined, "不支持的活动包操作");
    }

    window.addEventListener("message", handlePackageMessage);
    return () => window.removeEventListener("message", handlePackageMessage);
  }, [activeAchievements, config, lotteries, lotteryWins, openScanner, packageEntryUrl, unlockState]);

  function closeScanner() {
    stopLiveScanner();
    setScannerOpen(false);
  }

  function restartScanner() {
    closeScanner();
    window.setTimeout(openScanner, 0);
  }

  useEffect(() => {
    if (!scannerOpen) return;
    let disposed = false;

    async function startScanner() {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setScannerStatus("unavailable");
        setScannerMessage("网页实时摄像头需要 HTTPS 安全连接。你仍可使用手机系统相机扫描打印二维码，打开链接后会自动激活成就。");
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });
        if (disposed) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        const video = scannerVideo.current;
        if (!video) throw new Error("扫码画面尚未准备好");
        scannerStream.current = stream;
        video.srcObject = stream;
        await video.play();
        setScannerStatus("scanning");

        const readFrame = async (time: number) => {
          if (disposed || scannerLocked.current) return;
          if (time - lastScannerRead.current < 140 || video.readyState < HTMLMediaElement.HAVE_ENOUGH_DATA) {
            scannerFrame.current = window.requestAnimationFrame(readFrame);
            return;
          }
          lastScannerRead.current = time;

          const canvas = scannerCanvas.current;
          const context = canvas?.getContext("2d", { willReadFrequently: true });
          if (!canvas || !context || !video.videoWidth || !video.videoHeight) {
            scannerFrame.current = window.requestAnimationFrame(readFrame);
            return;
          }

          const scale = Math.min(1, 720 / video.videoWidth);
          canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
          canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
          const decoded = jsQR(imageData.data, canvas.width, canvas.height, { inversionAttempts: "attemptBoth" });

          if (!decoded?.data) {
            scannerFrame.current = window.requestAnimationFrame(readFrame);
            return;
          }

          scannerLocked.current = true;
          setScannerStatus("verifying");
          stopLiveScanner();
          try {
            await claimFromPayload(decoded.data);
            if (!disposed) setScannerOpen(false);
          } catch (error) {
            if (!disposed) {
              setScannerStatus("error");
              setScannerMessage(error instanceof Error ? error.message : "这个二维码无法识别");
            }
          }
        };

        scannerFrame.current = window.requestAnimationFrame(readFrame);
      } catch (error) {
        stopLiveScanner();
        if (disposed) return;
        const cameraError = error as DOMException;
        const messages: Record<string, string> = {
          NotAllowedError: "没有获得摄像头权限。请在浏览器的网站设置中允许使用摄像头后重试。",
          NotFoundError: "没有找到可用摄像头。",
          NotReadableError: "摄像头正被其他应用占用，请关闭占用摄像头的应用后重试。",
        };
        setScannerStatus("error");
        setScannerMessage(messages[cameraError.name] ?? (error instanceof Error ? error.message : "无法打开摄像头"));
      }
    }

    void startScanner();
    return () => {
      disposed = true;
      stopLiveScanner();
    };
  }, [claimFromPayload, scannerOpen, stopLiveScanner]);

  return (
    <main className={`festival-stage ${config.status === "closed" ? "is-idle" : ""}`}>
      <section className="phone-shell" aria-label="节日成就页面">
        {maintenance.active ? (
          <MaintenanceFestival message={maintenance.message} />
        ) : config.status === "closed" ? (
          <ClosedFestival />
        ) : packageEntryUrl ? (
          <iframe
            key={`${packageEntryUrl}:${Object.keys(unlockState.unlocked).length}`}
            ref={packageFrame}
            className="activity-package-frame"
            src={packageEntryUrl}
            sandbox="allow-scripts"
            title={`${config.name}活动页面`}
          />
        ) : (
          <div className="festival-scroll">
            <header className="festival-header">
              <div>
                <p className="festival-eyebrow">{config.eyebrow}</p>
                <h1>{config.name}</h1>
              </div>
              <div className="live-badge"><span />活动中</div>
            </header>

            {config.dateLabel || config.subtitle ? (
              <section className="activity-intro">
                {config.dateLabel ? <span>{config.dateLabel}</span> : null}
                {config.subtitle ? <p>{config.subtitle}</p> : null}
              </section>
            ) : null}

            {config.webScannerEnabled ? (
              <button className="scan-entry-card" onClick={openScanner}>
                <span className="scan-entry-icon"><QrCode size={23} /></span>
                <span className="scan-entry-copy"><strong>在网页中打开摄像头</strong><span>需要 HTTPS 和摄像头权限</span></span>
                <ArrowRight size={18} />
              </button>
            ) : null}
            <div className="direct-scan-hint">
              <Camera size={17} />
              <span><strong>也可以使用手机系统相机</strong>扫描墙上的二维码，打开链接后会自动激活成就，无需网页摄像头权限。</span>
            </div>

            <section className="progress-card" aria-label={`已解锁${unlockedCount}个，共${activeAchievements.length}个`}>
              <div className="progress-summary">
                <div className="progress-copy">
                  <span className="section-kicker">收集进度</span>
                  <strong>{unlockedCount}<small> / {activeAchievements.length}</small></strong>
                </div>
                <span className="progress-percent">{progress}%</span>
              </div>
              <div className="progress-track" aria-hidden="true"><span style={{ width: `${progress}%` }} /></div>
              <p>{progress === 100 ? "全部成就已解锁" : "继续扫描二维码解锁成就"}</p>
            </section>

            <section className="achievement-section" id="achievements">
              <div className="section-heading">
                <div>
                  <span className="section-kicker">当前活动</span>
                  <h2>成就</h2>
                </div>
              </div>

              {visibleCategories
                .slice()
                .sort((a, b) => a.sortOrder - b.sortOrder)
                .map((category) => {
                  const items = activeAchievements
                    .filter((achievement) => achievement.categoryId === category.id)
                    .sort((a, b) => a.sortOrder - b.sortOrder);
                  if (!items.length) return null;
                  return (
                    <div className="category-block" key={category.id}>
                      <div className="category-title">
                        <h3>{category.name}</h3>
                        <span>{items.filter((item) => unlockState.unlocked[item.id]).length}/{items.length}</span>
                      </div>
                      {category.description ? <p className="category-description">{category.description}</p> : null}
                      <div className="achievement-grid">
                        {items.map((achievement) => {
                          const record = unlockState.unlocked[achievement.id];
                          return (
                            <article className={`achievement-card ${record ? "is-unlocked" : "is-locked"}`} key={achievement.id}>
                              <div className="achievement-icon" aria-hidden="true">
                                {record ? <AchievementIconGraphic icon={achievement.icon} /> : <LockKeyhole size={21} />}
                              </div>
                              <div>
                                <h4>{achievement.hidden && !record ? "未知档案" : achievement.name}</h4>
                                <p>{achievement.hidden && !record ? "完成特殊条件后揭晓" : achievement.description}</p>
                                <span className="achievement-state">
                                  {record ? <><Check size={12} /> 已解锁</> : "尚未发现"}
                                </span>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
            </section>

            <footer className="festival-footer">
              <span>成就记录仅保存在当前浏览器</span>
            </footer>
          </div>
        )}

        {!maintenance.active && config.status === "active" ? (
          <div className="festival-action-bar">
            {lotteries.length ? <button className="lottery-entry-button" type="button" onClick={() => { setLotteriesOpen(true); setLotteryDrawResult(null); setSelectedLotteryId(null); }}>
              <Dices size={17} /><span>参加抽奖</span><strong>{lotteries.length}</strong>
            </button> : null}
            <button className="my-prizes-button" type="button" onClick={() => { setPrizesOpen(true); setPrizesLoading(true); fetch(`/api/lottery/wins?eventId=${encodeURIComponent(config.eventId)}`, { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((payload: { wins: LotteryWin[] } | null) => { if (payload) setLotteryWins(payload.wins); }).finally(() => setPrizesLoading(false)); }}>
              <Gift size={17} /><span>我的奖品</span>{lotteryWins.length ? <strong>{lotteryWins.length}</strong> : null}
            </button>
          </div>
        ) : null}

        {lotteriesOpen && config.status === "active" ? (
          <div className="lottery-participant-overlay" role="dialog" aria-modal="true" aria-label="参加抽奖">
            <header><div><span>LUCKY DRAW</span><h2>{selectedLottery ? selectedLottery.name : "参加抽奖"}</h2></div><button type="button" onClick={() => setLotteriesOpen(false)} aria-label="关闭抽奖"><X size={20} /></button></header>
            {lotteryDrawResult ? <ParticipantLotteryResult result={lotteryDrawResult} onClose={() => setLotteriesOpen(false)} /> : selectedLottery ? (
              <div className="participant-lottery-detail">
                <button className="participant-lottery-back" type="button" onClick={() => setSelectedLotteryId(null)}>← 返回抽奖列表</button>
                {selectedLottery.description ? <p>{selectedLottery.description}</p> : null}
                <div className="participant-prize-list">
                  {selectedLottery.prizes.map((prize) => <article key={prize.id}><span><AchievementIconGraphic icon={prize.icon} alt={prize.name} /></span><div><strong>{prize.name}</strong>{prize.description ? <p>{prize.description}</p> : null}<small>剩余 {prize.remaining} 份</small></div></article>)}
                </div>
                <button className="participant-draw-button" type="button" disabled={lotteryDrawBusy || !selectedLottery.eligible} onClick={() => void participateInLottery(selectedLottery)}>
                  <Dices size={18} />{lotteryDrawBusy ? "正在抽奖" : selectedLottery.eligible ? "立即抽奖" : "集齐所需成就后可参加"}
                </button>
              </div>
            ) : lotteriesLoading ? <div className="prize-wallet-empty"><span className="spinner" /><p>正在读取抽奖项目</p></div> : (
              <div className="participant-lottery-list">
                {lotteries.map((lottery) => <button type="button" key={lottery.id} onClick={() => setSelectedLotteryId(lottery.id)}><Dices size={22} /><span><strong>{lottery.name}</strong><small>{lottery.eligible ? "可以参加" : "尚未集齐参与成就"} · 查看 {lottery.prizes.length} 种奖品</small></span><ArrowRight size={17} /></button>)}
              </div>
            )}
          </div>
        ) : null}

        {prizesOpen && config.status === "active" ? (
          <div className="prize-wallet-overlay" role="dialog" aria-modal="true" aria-label="我的中奖奖品">
            <header><div><span>PRIZE WALLET</span><h2>我的奖品</h2></div><button type="button" onClick={() => setPrizesOpen(false)} aria-label="关闭我的奖品"><X size={20} /></button></header>
            <div className="prize-wallet-notice"><Gift size={18} /><p><strong>请直接将本机页面出示给工作人员</strong><span>兑奖时工作人员会核对奖品名称和中奖编号。</span></p></div>
            {prizesLoading ? <div className="prize-wallet-empty"><span className="spinner" /><p>正在读取中奖结果</p></div> : lotteryWins.length ? (
              <div className="prize-wallet-list">
                {lotteryWins.map((win) => <article key={win.drawId}>
                  <div className="prize-wallet-icon"><AchievementIconGraphic icon={win.prizeIcon} alt={win.prizeName} /></div>
                  <span className="prize-wallet-lottery">{win.lotteryName}</span>
                  <h3>{win.prizeName}</h3>
                  {win.prizeDescription ? <p>{win.prizeDescription}</p> : null}
                  <div className="prize-wallet-code"><span>中奖编号</span><strong>{win.participantCode}</strong></div>
                  <small>中奖时间 {new Date(win.drawnAt).toLocaleString("zh-CN")}</small>
                </article>)}
              </div>
            ) : <div className="prize-wallet-empty"><Gift size={34} /><h3>暂时没有中奖记录</h3><p>参加抽奖后，中奖结果会保存在这里。</p></div>}
            <p className="prize-wallet-footnote">中奖记录与当前浏览器绑定。请勿清除网站数据，并使用领取成就时的同一浏览器出示。</p>
          </div>
        ) : null}

        {directClaimPending ? (
          <div className="claim-overlay direct-claim-pending" role="status" aria-live="polite">
            <div className="claim-seal verifying"><QrCode size={34} /></div>
            <span className="claim-kicker">直链激活</span>
            <h2>正在验证二维码</h2>
            <p>正在检查活动和领取资格，请稍候。</p>
            <span className="spinner" aria-hidden="true" />
          </div>
        ) : null}

        {claimResult && !directClaimPending ? (
          <div className="claim-overlay" role="dialog" aria-modal="true" aria-label={claimResult.title}>
            <button className="overlay-close" onClick={() => setClaimResult(null)} aria-label="关闭提示"><X size={20} /></button>
            <div className={`claim-seal ${claimResult.kind}`}>
              {claimResult.achievement
                ? <AchievementIconGraphic icon={claimResult.achievement.icon} alt={claimResult.achievement.name} />
                : (claimResult.kind === "error" ? "!" : "✓")}
            </div>
            <span className="claim-kicker">
              {claimResult.kind === "success" ? "成就解锁" : claimResult.kind === "already" ? "重复领取" : "扫码提示"}
            </span>
            <h2>{claimResult.title}</h2>
            {claimResult.achievement ? <h3>{claimResult.achievement.name}</h3> : null}
            <p>{claimResult.message}</p>
            <button className="primary-button" onClick={() => setClaimResult(null)}>返回活动</button>
          </div>
        ) : null}

        {scannerOpen && config.status === "active" && config.webScannerEnabled ? (
          <div className="scanner-page" role="dialog" aria-modal="true" aria-label="二维码扫描器">
            <header className="scanner-header">
              <div><h2>扫描二维码</h2></div>
              <button onClick={closeScanner} aria-label="关闭扫码页面"><X size={20} /></button>
            </header>

            <div className={`scanner-viewport is-${scannerStatus}`}>
              {scannerStatus === "starting" || scannerStatus === "scanning" || scannerStatus === "verifying" ? (
                <video ref={scannerVideo} muted playsInline aria-label="摄像头扫码画面" />
              ) : (
                <div className="scanner-fallback"><Camera size={34} /><strong>{scannerStatus === "unavailable" ? "实时扫码暂不可用" : "摄像头未能启动"}</strong></div>
              )}
              <span className="scanner-corner top-left" /><span className="scanner-corner top-right" />
              <span className="scanner-corner bottom-left" /><span className="scanner-corner bottom-right" />
              <div className="scanner-state">
                {scannerStatus === "starting" ? <><span className="spinner" />正在打开摄像头</> : null}
                {scannerStatus === "scanning" ? <><span className="scanner-live-dot" />将二维码放入框内</> : null}
                {scannerStatus === "verifying" ? <><span className="spinner" />已识别，正在在线校验</> : null}
              </div>
            </div>
            <canvas ref={scannerCanvas} className="scanner-canvas" aria-hidden="true" />

            {scannerMessage ? <div className="scanner-message"><AlertTriangle size={15} /><span>{scannerMessage}</span>{scannerStatus === "error" ? <button onClick={restartScanner}>重试</button> : null}</div> : null}
            <p className="scanner-privacy">摄像头画面仅在当前设备中实时识别，不会保存或上传；只有活动编号、成就识别码和匿名设备标识会发送给校验服务器。</p>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function ClosedFestival() {
  return (
    <div className="closed-festival">
      <h1>活动未开始</h1>
    </div>
  );
}

function MaintenanceFestival({ message }: { message: string }) {
  return (
    <div className="maintenance-festival" role="status" aria-live="polite">
      <span><Wrench size={25} /></span>
      <p>MAINTENANCE</p>
      <h1>系统维护中</h1>
      <div>{message}</div>
      <small>页面会在更新完成后自动恢复</small>
    </div>
  );
}

function ParticipantLotteryResult({ result, onClose }: { result: ParticipantDrawResult; onClose: () => void }) {
  if (result.status === "winner" && result.draw) return <div className="participant-lottery-result is-winner"><span><AchievementIconGraphic icon={result.draw.prizeIcon} alt={result.draw.prizeName} /></span><small>恭喜中奖</small><h3>{result.draw.prizeName}</h3>{result.draw.prizeDescription ? <p>{result.draw.prizeDescription}</p> : null}<div><span>中奖编号</span><strong>{result.draw.participantCode}</strong></div><button type="button" onClick={onClose}>完成</button></div>;
  const messages = {
    no_prize: ["本次未中奖", "本次机会没有抽中奖品，抽奖入口已从本机移除。"],
    already: ["已经参加过", "每个抽奖项目只能参加一次，请前往“我的奖品”查看结果。"],
    not_eligible: ["尚未满足条件", "请先集齐这个抽奖要求的全部成就。"],
    sold_out: ["奖品已经抽完", "这个抽奖项目已结束，入口会自动消失。"],
  } as const;
  const message = messages[result.status === "winner" ? "already" : result.status];
  return <div className="participant-lottery-result"><Dices size={38} /><h3>{message[0]}</h3><p>{message[1]}</p><button type="button" onClick={onClose}>返回活动</button></div>;
}
