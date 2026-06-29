import React from "react";
import { createRoot } from "react-dom/client";
import AuthGate from "./AuthGate";

function LoggedIn({ user, signOut }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, fontFamily: "system-ui, sans-serif", background: "#F4F2EC", textAlign: "center", padding: 20 }}>
      <div style={{ fontSize: 26, fontWeight: 800, color: "#2C2C2A" }}>✅ You're logged in!</div>
      <div style={{ color: "#5F5E5A", maxWidth: 360 }}>
        The connection to your database and login both work. Signed in as <strong>{user.email}</strong>.
        This is the test placeholder — the full CityDweller app gets wired in next.
      </div>
      <button onClick={signOut} style={{ border: "none", background: "#534AB7", color: "#fff", padding: "10px 18px", borderRadius: 10, fontWeight: 700, cursor: "pointer" }}>Sign out</button>
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <AuthGate>
    {({ user, signOut }) => <LoggedIn user={user} signOut={signOut} />}
  </AuthGate>
);
