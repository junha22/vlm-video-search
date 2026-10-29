"use client";

import type { KeyboardEvent, PointerEvent } from "react";

/** 패널 사이 세로 손잡이: 드래그로 너비 조절, 키보드 ←/→, 더블클릭하면 기본 너비로 */
export default function Splitter({
  label,
  onDrag,
  onReset,
}: {
  label: string;
  onDrag: (dx: number) => void;
  onReset: () => void;
}) {
  const start = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    let last = e.clientX;
    const move = (ev: globalThis.PointerEvent) => {
      onDrag(ev.clientX - last);
      last = ev.clientX;
    };
    const end = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("pointercancel", end);
      document.body.classList.remove("resizing");
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    document.body.classList.add("resizing");
  };

  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      onDrag(e.key === "ArrowLeft" ? -16 : 16);
    }
  };

  return (
    <div
      className="splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      tabIndex={0}
      title="드래그해서 너비 조절 · 더블클릭하면 원래대로"
      onPointerDown={start}
      onDoubleClick={onReset}
      onKeyDown={key}
    />
  );
}
