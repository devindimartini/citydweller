import React, { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";

export default function AuthGate({ children }) {
  const [session, setSession] = useState(undefined);
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  async function submit() {
    setBusy(true); setMsg("");
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setMsg("Account created — if email confirmation is on, check your inbox; otherwise you're in.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (e) { setMsg(e.message || "Something went wrong."); }
    finally { setBusy(false); }
  }

  if (session === undefined) return <div style={S.center}>Loading…</div>;

  if (!session) {
    return (
      <div style={S.center}>
        <div style={S.card}>
          <div style={S.brand}>CityDweller</div>
          <div style={S.sub}>{mode === "signin" ? "Welcome back" : "Create your account"}</div>
          <input style={S.input} type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input style={S.input} type="password" placeholder="Password" value={password}
            onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
          <button style={S.primary} onClick={submit} disabled={busy || !email || !password}>
            {busy ? "…" : mode === "signin" ? "Sign in" : "Sign up"}
          </button>
          {msg && <div style={S.msg}>{msg}</div>}
          <button style={S.switch} onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setMsg(""); }}>
            {mode === "signin" ? "Need an account? Sign up" : "Have an account? Sign in"}
          </button>
        </div>
      </div>
    );
  }
  return children({ user: session.user, signOut: () => supabase.auth.signOut() });
}

const S = {
  center: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F4F2EC", fontFamily: "system-ui, sans-serif" },
  card: { width: 320, background: "#fff", borderRadius: 16, padding: 28, boxShadow: "0 8px 30px rgba(0,0,0,0.10)", display: "flex", flexDirection: "column", gap: 10 },
  brand: { fontSize: 24, fontWeight: 800, color: "#2C2C2A" },
  sub: { fontSize: 14, color: "#5F5E5A", marginBottom: 8 },
  input: { border: "1px solid #E3E0D8", borderRadius: 10, padding: "11px 12px", fontSize: 15, outline: "none" },
  primary: { border: "none", background: "#534AB7", color: "#fff", padding: "12px", borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: "pointer", marginTop: 4 },
  switch: { border: "none", background: "transparent", color: "#534AB7", fontSize: 13.5, cursor: "pointer", marginTop: 4 },
  msg: { fontSize: 13, color: "#C0392B", lineHeight: 1.4 },
};
