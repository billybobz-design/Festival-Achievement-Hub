"use client";

import { ArrowLeft, CirclePlus, Gift, ImagePlus, Save, TicketCheck, Trash2, Trophy } from "lucide-react";
import { ChangeEvent, FormEvent, PointerEvent as ReactPointerEvent, useEffect, useState } from "react";
import { AchievementIconGraphic } from "../components/AchievementIconGraphic";
import { FestivalConfig } from "../lib/demo-store";
import { describeAdminError, readAdminJson } from "../lib/admin-api";

type AdminFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type LotterySummary = {
  id: number; eventId: string; name: string; description: string; requirementCount: number;
  prizeCount: number; eligibleCount: number; winnerCount: number; createdAt: string; updatedAt: string;
};
type LotteryPrize = {
  id: number; lotteryId: number; name: string; description: string; icon: string;
  probabilityBps: number; quantity: number; awardedCount: number; sortOrder: number;
};
type LotteryDraw = {
  id: number; prizeId: number; prizeName: string; prizeIcon: string;
  participantCode: string; drawnBy: string; drawnAt: string;
};
type LotteryDetail = LotterySummary & {
  requirements: string[]; prizes: LotteryPrize[]; draws: LotteryDraw[]; totalProbabilityBps: number;
};
type PrizeDraft = { name: string; description: string; icon: string; probabilityBps: number; quantity: number; sortOrder: number };
type DrawResponse = {
  status: "winner" | "no_prize" | "no_eligible"; roll: number;
  draw?: { prizeName: string; prizeIcon: string; prizeDescription: string; participantCode: string; drawnAt: string };
};

const emptyPrize: PrizeDraft = { name: "", description: "", icon: "🎁", probabilityBps: 1000, quantity: 1, sortOrder: 10 };

export function LotteryManager({ config, adminFetch, setNotice }: {
  config: FestivalConfig; adminFetch: AdminFetch; setNotice: (notice: string) => void;
}) {
  const [lotteries, setLotteries] = useState<LotterySummary[]>([]);
  const [detail, setDetail] = useState<LotteryDetail | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [prize, setPrize] = useState<PrizeDraft>(emptyPrize);
  const [busy, setBusy] = useState(false);
  const [drawResult, setDrawResult] = useState<DrawResponse | null>(null);

  async function loadList() {
    try {
      const response = await adminFetch(`/api/admin/lotteries?eventId=${encodeURIComponent(config.eventId)}`, { cache: "no-store" });
      const payload = await readAdminJson<{ lotteries: LotterySummary[] }>(response);
      setLotteries(payload.lotteries);
    } catch (error) {
      setNotice(describeAdminError(error, "读取抽奖项目"));
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void loadList(), 0);
    return () => window.clearTimeout(timer);
  }, [config.eventId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function api(body: Record<string, unknown>) {
    const response = await adminFetch("/api/admin/lotteries", {
      method: "POST", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    return readAdminJson<{ lottery?: LotteryDetail; lotteries?: LotterySummary[]; removed?: true; result?: DrawResponse }>(response);
  }

  async function openLottery(id: number) {
    setBusy(true);
    setDrawResult(null);
    try {
      const response = await adminFetch(`/api/admin/lotteries?lotteryId=${id}`, { cache: "no-store" });
      const payload = await readAdminJson<{ lottery: LotteryDetail }>(response);
      setDetail(payload.lottery);
    } catch (error) {
      setNotice(describeAdminError(error, "读取抽奖详情"));
    } finally { setBusy(false); }
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const payload = await api({ action: "createLottery", eventId: config.eventId, name, description });
      if (payload.lottery) setDetail(payload.lottery);
      setName(""); setDescription("");
      setNotice("抽奖项目已创建，请设置参与条件和奖品");
      await loadList();
    } catch (error) { setNotice(describeAdminError(error, "创建抽奖项目")); }
    finally { setBusy(false); }
  }

  async function removeLottery() {
    if (!detail || busy || !window.confirm(`删除抽奖项目“${detail.name}”？已经产生的中奖记录也会删除。`)) return;
    setBusy(true);
    try {
      await api({ action: "deleteLottery", lotteryId: detail.id });
      setDetail(null); setDrawResult(null); setNotice("抽奖项目已删除"); await loadList();
    } catch (error) { setNotice(describeAdminError(error, "删除抽奖项目")); }
    finally { setBusy(false); }
  }

  async function saveRequirements(achievementIds: string[]) {
    if (!detail || busy) return;
    setBusy(true);
    try {
      const payload = await api({ action: "setRequirements", lotteryId: detail.id, achievementIds });
      if (payload.lottery) setDetail(payload.lottery);
      setNotice("抽奖参与条件已保存"); await loadList();
    } catch (error) { setNotice(describeAdminError(error, "保存参与条件")); }
    finally { setBusy(false); }
  }

  async function addPrize(event: FormEvent) {
    event.preventDefault();
    if (!detail || busy) return;
    setBusy(true);
    try {
      const payload = await api({ action: "createPrize", lotteryId: detail.id, ...prize });
      if (payload.lottery) setDetail(payload.lottery);
      setPrize({ ...emptyPrize, sortOrder: (detail.prizes.length + 1) * 10 });
      setNotice("奖品已添加"); await loadList();
    } catch (error) { setNotice(describeAdminError(error, "添加奖品")); }
    finally { setBusy(false); }
  }

  async function savePrize(prizeId: number, next: PrizeDraft) {
    if (busy) return;
    setBusy(true);
    try {
      const payload = await api({ action: "updatePrize", prizeId, ...next });
      if (payload.lottery) setDetail(payload.lottery);
      setNotice("奖品设置已保存"); await loadList();
    } catch (error) { setNotice(describeAdminError(error, "保存奖品")); }
    finally { setBusy(false); }
  }

  async function removePrize(prizeId: number) {
    if (busy || !window.confirm("删除这个奖品？已经中过该奖品时不能删除。")) return;
    setBusy(true);
    try {
      const payload = await api({ action: "deletePrize", prizeId });
      if (payload.lottery) setDetail(payload.lottery);
      setNotice("奖品已删除"); await loadList();
    } catch (error) { setNotice(describeAdminError(error, "删除奖品")); }
    finally { setBusy(false); }
  }

  async function draw() {
    if (!detail || busy) return;
    setBusy(true); setDrawResult(null);
    try {
      const payload = await api({ action: "draw", lotteryId: detail.id });
      if (payload.lottery) setDetail(payload.lottery);
      if (payload.result) setDrawResult(payload.result);
      await loadList();
    } catch (error) { setNotice(describeAdminError(error, "执行抽奖")); }
    finally { setBusy(false); }
  }

  if (!detail) return (
    <div className="admin-content lottery-overview">
      <div className="activity-list-heading">
        <div><span className="panel-kicker">LOTTERIES</span><h2>抽奖项目</h2><p>每个项目单独设置集齐条件、奖品库存和中奖概率。</p></div>
        <span>{lotteries.length} 个项目</span>
      </div>
      <div className="lottery-overview-grid">
        <section className="lottery-catalog">
          {lotteries.map((lottery) => (
            <button className="admin-panel lottery-card" key={lottery.id} onClick={() => void openLottery(lottery.id)} disabled={busy}>
              <span className="lottery-card-icon"><Trophy size={20} /></span>
              <div><strong>{lottery.name}</strong><p>{lottery.description || "尚未填写抽奖说明"}</p></div>
              <dl><span>条件 {lottery.requirementCount}</span><span>奖品 {lottery.prizeCount}</span><span>候选 {lottery.eligibleCount}</span><span>已中 {lottery.winnerCount}</span></dl>
            </button>
          ))}
          {!lotteries.length ? <div className="admin-panel lottery-empty"><Gift size={28} /><h3>还没有抽奖项目</h3><p>从右侧创建第一个项目。</p></div> : null}
        </section>
        <form className="admin-panel create-form lottery-create" onSubmit={create}>
          <div className="panel-heading"><div><span className="panel-kicker">NEW LOTTERY</span><h2>创建抽奖项目</h2></div><CirclePlus size={20} /></div>
          <label>项目名称<input required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：集章幸运抽奖" /></label>
          <label>说明<textarea maxLength={500} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="说明抽奖时间或兑奖位置" /></label>
          <button className="primary-admin-button" type="submit" disabled={busy}><CirclePlus size={15} />创建并设置</button>
        </form>
      </div>
    </div>
  );

  const selected = new Set(detail.requirements);
  return (
    <div className="admin-content lottery-detail">
      <div className="lottery-detail-heading">
        <button className="text-admin-button" type="button" onClick={() => { setDetail(null); setDrawResult(null); void loadList(); }}><ArrowLeft size={15} />返回抽奖项目</button>
        <div><span className="panel-kicker">LOTTERY #{detail.id}</span><h2>{detail.name}</h2><p>{detail.description}</p></div>
        <button className="lottery-delete" type="button" onClick={() => void removeLottery()} disabled={busy}><Trash2 size={14} />删除项目</button>
      </div>

      <section className="admin-panel lottery-requirements">
        <div className="panel-heading"><div><span className="panel-kicker">ELIGIBILITY</span><h2>选择参与所需成就</h2></div><span>{detail.eligibleCount} 个合格设备</span></div>
        <p>学生必须集齐你勾选的全部成就才进入候选池。至少选择一个。</p>
        <div className="lottery-achievement-checks">
          {config.achievements.map((achievement) => (
            <label key={achievement.id}>
              <input type="checkbox" checked={selected.has(achievement.id)} onChange={(event) => {
                const next = new Set(detail.requirements);
                if (event.target.checked) next.add(achievement.id); else next.delete(achievement.id);
                setDetail({ ...detail, requirements: [...next] });
              }} />
              <span><AchievementIconGraphic icon={achievement.icon} /></span><div><strong>{achievement.name}</strong><small>{achievement.claimCode}</small></div>
            </label>
          ))}
        </div>
        <button className="primary-admin-button" type="button" disabled={busy || !detail.requirements.length} onClick={() => void saveRequirements(detail.requirements)}><Save size={15} />保存参与条件</button>
      </section>

      <section className="admin-panel lottery-prizes-section">
        <div className="panel-heading"><div><span className="panel-kicker">PRIZES & PROBABILITY</span><h2>奖品与中奖概率</h2></div><ProbabilitySummary value={detail.totalProbabilityBps} /></div>
        <p className="lottery-probability-note">每个奖品有自己的饼图。拖动圆周上的控制点或填写百分比；未分配概率为“本次未中奖”。</p>
        <div className="lottery-prize-list">
          {detail.prizes.map((item) => <PrizeEditor key={item.id} prize={item} busy={busy} onSave={savePrize} onDelete={removePrize} />)}
        </div>
        <form className="lottery-new-prize" onSubmit={addPrize}>
          <div className="lottery-new-prize-title"><CirclePlus size={18} /><div><strong>添加新奖品</strong><small>新奖品使用独立概率饼图</small></div></div>
          <PrizeFields value={prize} onChange={setPrize} />
          <button className="primary-admin-button" type="submit" disabled={busy}><CirclePlus size={15} />添加奖品</button>
        </form>
      </section>

      <section className="admin-panel lottery-draw-panel">
        <div><span className="panel-kicker">DRAW</span><h2>开始抽取</h2><p>当前有 {detail.eligibleCount} 个合格且尚未中奖的设备；已有 {detail.winnerCount} 个中奖记录。</p></div>
        <button className="lottery-draw-button" type="button" disabled={busy || !detail.requirements.length || !detail.prizes.length || detail.eligibleCount < 1} onClick={() => void draw()}><TicketCheck size={19} />{busy ? "正在抽取" : "抽取一名"}</button>
        {drawResult ? <DrawResult result={drawResult} /> : null}
      </section>

      <section className="admin-panel lottery-winners">
        <div className="panel-heading"><div><span className="panel-kicker">WINNERS</span><h2>中奖记录</h2></div><span>{detail.draws.length} 条</span></div>
        {detail.draws.map((draw) => <article key={draw.id}><span><AchievementIconGraphic icon={draw.prizeIcon} /></span><div><strong>{draw.prizeName}</strong><small>{draw.participantCode} · {new Date(draw.drawnAt).toLocaleString("zh-CN")}</small></div><em>{draw.drawnBy}</em></article>)}
        {!detail.draws.length ? <p className="lottery-no-records">尚未产生中奖记录。</p> : null}
      </section>
    </div>
  );
}

function PrizeEditor({ prize, busy, onSave, onDelete }: { prize: LotteryPrize; busy: boolean; onSave: (id: number, value: PrizeDraft) => Promise<void>; onDelete: (id: number) => Promise<void> }) {
  const [value, setValue] = useState<PrizeDraft>({ name: prize.name, description: prize.description, icon: prize.icon, probabilityBps: prize.probabilityBps, quantity: prize.quantity, sortOrder: prize.sortOrder });
  return <article className="lottery-prize-editor">
    <div className="lottery-prize-stock"><span><AchievementIconGraphic icon={value.icon} /></span><div><strong>{prize.awardedCount}/{value.quantity}</strong><small>已发出 / 总库存</small></div></div>
    <PrizeFields value={value} onChange={setValue} />
    <div className="lottery-prize-actions"><button className="text-admin-button" type="button" disabled={busy} onClick={() => void onDelete(prize.id)}><Trash2 size={13} />删除</button><button className="primary-admin-button" type="button" disabled={busy} onClick={() => void onSave(prize.id, value)}><Save size={13} />保存</button></div>
  </article>;
}

function PrizeFields({ value, onChange }: { value: PrizeDraft; onChange: (value: PrizeDraft) => void }) {
  async function readIcon(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 240_000) { window.alert("请选择不超过 240 KB 的 PNG、JPEG 或 WebP 图片"); return; }
    const reader = new FileReader();
    reader.onload = () => { if (typeof reader.result === "string") onChange({ ...value, icon: reader.result }); };
    reader.readAsDataURL(file);
  }
  return <div className="lottery-prize-fields">
    <label>奖品名称<input required maxLength={80} value={value.name} onChange={(event) => onChange({ ...value, name: event.target.value })} /></label>
    <label>奖品说明<input maxLength={500} value={value.description} onChange={(event) => onChange({ ...value, description: event.target.value })} /></label>
    <div className="lottery-icon-field"><span><AchievementIconGraphic icon={value.icon} /></span><label>图案或 Emoji<input required maxLength={350000} value={value.icon.startsWith("data:image/") ? "已上传图片" : value.icon} disabled={value.icon.startsWith("data:image/")} onChange={(event) => onChange({ ...value, icon: event.target.value })} /></label><label className="lottery-image-upload"><ImagePlus size={13} />上传图片<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void readIcon(event)} /></label>{value.icon.startsWith("data:image/") ? <button type="button" onClick={() => onChange({ ...value, icon: "🎁" })}>改用 Emoji</button> : null}</div>
    <label>库存数量<input required type="number" min="1" max="100000" value={value.quantity} onChange={(event) => onChange({ ...value, quantity: Number(event.target.value) })} /></label>
    <ProbabilityPie valueBps={value.probabilityBps} onChange={(probabilityBps) => onChange({ ...value, probabilityBps })} />
  </div>;
}

function ProbabilityPie({ valueBps, onChange }: { valueBps: number; onChange: (value: number) => void }) {
  const percent = valueBps / 100;
  function update(event: ReactPointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - (rect.left + rect.width / 2); const y = event.clientY - (rect.top + rect.height / 2);
    let degrees = Math.atan2(y, x) * 180 / Math.PI + 90; if (degrees < 0) degrees += 360;
    onChange(Math.min(10_000, Math.max(0, Math.round(degrees / 360 * 1000) * 10)));
  }
  return <div className="probability-control">
    <div className="probability-pie" role="slider" aria-label="中奖概率" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} tabIndex={0}
      style={{ background: `conic-gradient(#8b6726 0 ${percent}%, #ebe5da ${percent}% 100%)` }}
      onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); update(event); }} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) update(event); }}>
      <span>{percent.toFixed(1)}%</span><i style={{ transform: `rotate(${valueBps / 10 * 0.36}deg)` }} />
    </div>
    <label>中奖概率<div><input type="number" min="0" max="100" step="0.1" value={percent} onChange={(event) => onChange(Math.round(Math.min(100, Math.max(0, Number(event.target.value))) * 100))} /><span>%</span></div><small>拖动饼图控制点调整</small></label>
  </div>;
}

function ProbabilitySummary({ value }: { value: number }) {
  return <div className={value > 10_000 ? "probability-summary is-error" : "probability-summary"}><strong>{(value / 100).toFixed(1)}%</strong><span>已分配 · 剩余 {((10_000 - value) / 100).toFixed(1)}%</span></div>;
}

function DrawResult({ result }: { result: DrawResponse }) {
  if (result.status === "no_prize") return <div className="lottery-draw-result is-empty"><strong>本次未中奖</strong><p>随机值落在未分配或已无库存的概率区间，没有选中参与者。</p></div>;
  if (result.status === "no_eligible") return <div className="lottery-draw-result is-empty"><strong>没有可抽取参与者</strong><p>当前没有集齐条件且尚未中奖的设备。</p></div>;
  return <div className="lottery-draw-result is-winner"><span><AchievementIconGraphic icon={result.draw?.prizeIcon ?? "🎁"} /></span><div><small>中奖编号</small><strong>{result.draw?.participantCode}</strong><p>{result.draw?.prizeName} · 请让学生在原手机打开“我的奖品”核对。</p></div></div>;
}
