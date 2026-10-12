"use client";

import { useEffect, useRef, useState } from "react";
import { formatNumber, type ModelInfo, type Usage } from "@/lib/api";
import { IconCheck, IconChevronDown, IconCpu } from "./Icons";

export function ModelDropdown({
  models,
  value,
  onChange,
}: {
  models: ModelInfo[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = models.find((m) => m.id === value);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <div className="dd" ref={ref}>
      <button id="model-dropdown" className={`dd-trigger ${open ? "open" : ""}`} onClick={() => setOpen((o) => !o)}>
        <span className="dd-avatar">
          <IconCpu size={13} />
        </span>
        <span className="dd-label">{current?.label ?? value}</span>
        <IconChevronDown size={14} className="dd-chev" />
      </button>
      {open && (
        <div className="dd-menu fade-up" role="listbox">
          <div className="dd-menu-title">분석 모델 선택</div>
          {models.map((m) => (
            <button
              key={m.id}
              id={`model-${m.id}`}
              className={`dd-option ${m.id === value ? "selected" : ""}`}
              onClick={() => {
                onChange(m.id);
                setOpen(false);
              }}
            >
              <div>
                <div className="dd-option-label">{m.label}</div>
                <div className="dd-option-desc">{m.desc}</div>
              </div>
              {m.id === value && <IconCheck size={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function TopBar({
  title,
  subtitle,
  connected,
  usage,
  models,
  model,
  onModelChange,
}: {
  title: string;
  subtitle: string;
  connected: boolean | null;
  usage: Usage | null;
  models: ModelInfo[];
  model: string;
  onModelChange: (id: string) => void;
}) {
  return (
    <header className="topbar">
      <div className="tb-title">
        <h1>{title}</h1>
        <span>{subtitle}</span>
      </div>
      <div className="tb-right">
        {connected === false && (
          <div className="tb-status bad">
            <span className="tb-dot" />
            서버 연결 끊김
          </div>
        )}
        {models.length > 0 && <ModelDropdown models={models} value={model} onChange={onModelChange} />}
      </div>
    </header>
  );
}
