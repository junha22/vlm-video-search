"use client";

import { useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { IconLogo } from "@/components/Icons";
import ThemeToggle from "@/components/ThemeToggle";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !password) return;
    setBusy(true);
    setError("");
    try {
      await api.login(username, password);
      window.location.href = "/";
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <main className="login">
      <div className="login-theme">
        <ThemeToggle />
      </div>
      <form className="login-card fade-up" onSubmit={submit}>
        <div className="login-brand">
          <IconLogo size={34} />
          <span>IntentCut</span>
        </div>
        <p className="login-sub">의도 기반 편집 구간 추천</p>

        <label className="login-field">
          <span>아이디</span>
          <input
            id="login-username"
            className="input"
            autoComplete="username"
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label className="login-field">
          <span>비밀번호</span>
          <input
            id="login-password"
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        {error && (
          <div className="login-error" role="alert">
            {error}
          </div>
        )}

        <button id="login-submit" className="btn btn-primary" type="submit" disabled={busy || !password}>
          {busy && <span className="spinner" />}
          로그인
        </button>
      </form>
    </main>
  );
}
