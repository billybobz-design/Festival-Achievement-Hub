"use client";
/* eslint-disable @next/next/no-img-element -- Administrator-uploaded data URLs are previewed without image optimization. */

import { useState } from "react";
import type { FestivalAchievement, FestivalConfig } from "../lib/demo-store";
import { AchievementIconGraphic } from "../components/AchievementIconGraphic";

type SaveConfig = (config: FestivalConfig, message: string) => unknown;

export function TaskLineEditor({ config, save }: { config: FestivalConfig; save: SaveConfig }) {
  const [line, setLine] = useState(config.taskLine ?? []);

  function insert(id: string, before?: string) {
    if (!config.achievements.some((item) => item.id === id) || id === before) return;
    setLine((current) => {
      const next = current.filter((value) => value !== id);
      const index = before ? next.indexOf(before) : -1;
      next.splice(index < 0 ? next.length : index, 0, id);
      return next;
    });
  }

  return <div className="admin-content">
    <section className="admin-panel task-line-editor">
      <div className="panel-heading"><div><span className="panel-kicker">STORY ROUTE</span><h2>主线任务</h2></div><span>{line.length} 项</span></div>
      <p>把成就拖入任务线并调整顺序。参与者必须完成前一项才能领取后一项；任务线为空时不限制顺序。</p>
      <div className="task-drop-zone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); insert(event.dataTransfer.getData("text/plain")); }}>
        {!line.length ? <span>空任务线 · 将下方成就拖到这里</span> : line.map((id, index) => {
          const achievement = config.achievements.find((item) => item.id === id);
          return <div key={id} draggable onDragStart={(event) => event.dataTransfer.setData("text/plain", id)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); insert(event.dataTransfer.getData("text/plain"), id); }}>
            <strong>{index + 1}. {achievement?.name}</strong>
            <button type="button" disabled={!index} onClick={() => insert(id, line[index - 1])}>上移</button>
            <button type="button" onClick={() => setLine(line.filter((value) => value !== id))}>移出</button>
          </div>;
        })}
      </div>
      <div className="task-source-grid">
        {config.achievements.map((item) => <button key={item.id} type="button" draggable onDragStart={(event) => event.dataTransfer.setData("text/plain", item.id)} disabled={line.includes(item.id)} onClick={() => insert(item.id)}>
          <span><AchievementIconGraphic icon={item.icon} /></span><strong>{item.name}</strong><small>{line.includes(item.id) ? "已加入主线" : "加入主线"}</small>
        </button>)}
      </div>
      <button type="button" className="primary-admin-button" onClick={() => save({ ...config, taskLine: line }, "任务线已保存")}>保存任务线</button>
    </section>
  </div>;
}

export function ClueEditor({ config, save }: { config: FestivalConfig; save: SaveConfig }) {
  const [items, setItems] = useState(config.achievements);
  const [notice, setNotice] = useState("");

  function update(id: string, patch: Partial<FestivalAchievement>) {
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  return <div className="admin-content">
    <section className="admin-panel task-line-editor">
      <div className="panel-heading"><div><span className="panel-kicker">CLUES</span><h2>线索提示</h2></div><span>{items.filter((item) => item.hintEnabled).length} 项已开启</span></div>
      <p>为成就开启可点击的图文线索。提示文字和图片均可留空。</p>
      <div className="task-options">{items.map((item) => <details key={item.id}>
        <summary>{item.icon} {item.name} {item.hintEnabled ? "· 已开启" : "· 未开启"}</summary>
        <label><input type="checkbox" checked={!!item.hintEnabled} onChange={(event) => update(item.id, { hintEnabled: event.target.checked })} /> 点击成就时显示线索</label>
        {item.hintEnabled && <>
          <label>线索文字（可选）<textarea maxLength={1000} value={item.hintText ?? ""} onChange={(event) => update(item.id, { hintText: event.target.value })} /></label>
          <label>线索图片（可选，PNG / JPEG / WebP，最大 240 KB）<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            if (file.size > 240000 || !/^image\/(png|jpeg|webp)$/.test(file.type)) { setNotice("请选择 240 KB 以内的 PNG、JPEG 或 WebP 图片"); return; }
            const reader = new FileReader();
            reader.onload = () => { if (typeof reader.result === "string") update(item.id, { hintImage: reader.result }); };
            reader.readAsDataURL(file);
          }} /></label>
          {item.hintImage && <><img src={item.hintImage} alt="线索图片预览" /><button type="button" onClick={() => update(item.id, { hintImage: "" })}>移除图片</button></>}
        </>}
      </details>)}</div>
      <p role="status">{notice}</p>
      <button type="button" className="primary-admin-button" onClick={() => save({ ...config, achievements: config.achievements.map((item) => {
        const draft = items.find((value) => value.id === item.id);
        return { ...item, hintEnabled: draft?.hintEnabled, hintText: draft?.hintText, hintImage: draft?.hintImage };
      }) }, "线索提示已保存")}>保存线索</button>
    </section>
  </div>;
}
