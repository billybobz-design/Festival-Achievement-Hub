"use client";
/* eslint-disable @next/next/no-img-element -- Admin-uploaded data URLs are previewed without image optimization. */

import { useState } from "react";
import type { FestivalAchievement, FestivalConfig } from "../lib/demo-store";

export function TaskLineEditor({ config, save }: { config: FestivalConfig; save: (config: FestivalConfig, message: string) => unknown }) {
  const [line, setLine] = useState(config.taskLine ?? []);
  const [items, setItems] = useState(config.achievements);
  const [notice, setNotice] = useState("");
  function insert(id: string, before?: string) {
    if (!items.some(item => item.id === id) || id === before) return;
    setLine(current => {
      const next = current.filter(value => value !== id);
      const index = before ? next.indexOf(before) : -1;
      next.splice(index < 0 ? next.length : index, 0, id);
      return next;
    });
  }
  function update(id: string, patch: Partial<FestivalAchievement>) {
    setItems(current => current.map(item => item.id === id ? { ...item, ...patch } : item));
  }
  return <section className="task-line-editor">
    <h3>主线任务</h3>
    <p>把下方成就拖入任务线，拖到另一项前面调整顺序。未加入的成就可独立领取；任务线为空时不限制顺序。</p>
    <div className="task-drop-zone" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); insert(event.dataTransfer.getData("text/plain")); }}>
      {!line.length ? <span>空任务线 · 将成就拖到这里</span> : line.map((id, index) => <div key={id} draggable onDragStart={event => event.dataTransfer.setData("text/plain", id)} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); event.stopPropagation(); insert(event.dataTransfer.getData("text/plain"), id); }}>
        <strong>{index + 1}. {items.find(item => item.id === id)?.name}</strong>
        <button type="button" disabled={!index} onClick={() => insert(id, line[index - 1])}>上移</button>
        <button type="button" onClick={() => setLine(line.filter(value => value !== id))}>移出</button>
      </div>)}
    </div>
    <div className="task-options">{items.map(item => <details key={item.id} draggable onDragStart={event => event.dataTransfer.setData("text/plain", item.id)}>
      <summary>{item.name} {line.includes(item.id) ? "· 已加入主线" : "· 可拖入主线"}</summary>
      <button type="button" disabled={line.includes(item.id)} onClick={() => insert(item.id)}>加入任务线</button>
      <label><input type="checkbox" checked={!!item.hintEnabled} onChange={event => update(item.id, { hintEnabled: event.target.checked })} /> 点击成就时显示提示</label>
      {item.hintEnabled && <>
        <label>提示文字<textarea maxLength={1000} value={item.hintText ?? ""} onChange={event => update(item.id, { hintText: event.target.value })} /></label>
        <label>提示图片（可选，PNG / JPEG / WebP，最大 240 KB）<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => {
          const file = event.target.files?.[0];
          if (!file) return;
          if (file.size > 240000 || !/^image\/(png|jpeg|webp)$/.test(file.type)) { setNotice("请选择 240 KB 以内的 PNG、JPEG 或 WebP 图片"); return; }
          const reader = new FileReader();
          reader.onload = () => { if (typeof reader.result === "string") update(item.id, { hintImage: reader.result }); };
          reader.readAsDataURL(file);
        }} /></label>
        {item.hintImage && <><img src={item.hintImage} alt="提示图片预览" /><button type="button" onClick={() => update(item.id, { hintImage: "" })}>移除图片</button></>}
      </>}
    </details>)}</div>
    <p role="status">{notice}</p>
    <button type="button" className="primary-admin-button" onClick={() => save({ ...config, taskLine: line, achievements: config.achievements.map(item => {
      const draft = items.find(value => value.id === item.id);
      return { ...item, hintEnabled: draft?.hintEnabled, hintText: draft?.hintText, hintImage: draft?.hintImage };
    }) }, "任务线与提示已保存")}>保存任务线与提示</button>
  </section>;
}
