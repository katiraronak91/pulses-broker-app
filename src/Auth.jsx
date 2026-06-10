import React, { useState } from "react";
import { supabase } from "./supabaseClient";

const C = {
  paper: "#FBF6EC", ink: "#2B2118", maroon: "#7A1F1F", toor: "#E3A82B",
  line: "#E8DFCE", grey: "#8A7F6F", red: "#B3261E",
};

const inputStyle = {
  width: "100%", boxSizing: "border-box", padding: "12px 14px",
  border: `1.5px solid ${C.line}`, borderRadius: 8, fontSize: 15,
  background: "#fff", color: C.ink, outline: "none", marginBottom: 12,
};

export default function Auth() {
  const [mode, setMode] = useState("login"); // login | signup
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setMsg("");
    if (!email || !password) return setMsg("Enter email and password.");
    if (password.length < 6) return setMsg("Password must be at least 6 characters.");
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setMsg("Account created! If asked, check your email to confirm, then log in.");
        setMode("login");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        // App.jsx listens for the session change and takes over from here
      }
    } catch (e) {
      setMsg(e.message || "Something went wrong. Try again.");
    }
    setBusy(false);
  };

  return (
    <div style={{ fontFamily: "system-ui", background: C.paper, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 380 }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ fontSize: 26, fontWeight: 800, color: C.maroon }}>
            Dalal Bahi <span style={{ color: C.toor }}>·</span> Pulses Desk
          </div>
          <div style={{ fontSize: 13.5, color: C.grey, marginTop: 4 }}>
            Your private trade ledger
          </div>
        </div>

        <div style={{ background: "#fff", border: `1.5px solid ${C.line}`, borderRadius: 14, padding: 20 }}>
          <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 14, color: C.ink }}>
            {mode === "login" ? "Log in" : "Create your account"}
          </div>
          <input style={inputStyle} type="email" placeholder="Email" value={email}
            onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          <input style={inputStyle} type="password" placeholder="Password (min 6 characters)" value={password}
            onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"}
            onKeyDown={(e) => e.key === "Enter" && submit()} />
          {msg && <div style={{ fontSize: 13, color: msg.includes("created") ? "#1F7A4D" : C.red, marginBottom: 10 }}>{msg}</div>}
          <button onClick={submit} disabled={busy}
            style={{ width: "100%", background: C.maroon, color: "#fff", border: "none", borderRadius: 8, padding: 13, fontSize: 15, fontWeight: 800, cursor: "pointer", opacity: busy ? 0.6 : 1 }}>
            {busy ? "Please wait…" : mode === "login" ? "Log in" : "Sign up"}
          </button>
        </div>

        <div style={{ textAlign: "center", marginTop: 14, fontSize: 14, color: C.grey }}>
          {mode === "login" ? (
            <>New here? <button onClick={() => { setMode("signup"); setMsg(""); }} style={{ border: "none", background: "none", color: C.maroon, fontWeight: 800, cursor: "pointer", fontSize: 14 }}>Create account</button></>
          ) : (
            <>Already have an account? <button onClick={() => { setMode("login"); setMsg(""); }} style={{ border: "none", background: "none", color: C.maroon, fontWeight: 800, cursor: "pointer", fontSize: 14 }}>Log in</button></>
          )}
        </div>
      </div>
    </div>
  );
}
