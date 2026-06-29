import React from "react";
import { createRoot } from "react-dom/client";
import AuthGate from "./AuthGate";
import CityDweller from "./CityDweller";

createRoot(document.getElementById("root")).render(
  <AuthGate>
    {({ user, signOut }) => <CityDweller user={user} signOut={signOut} />}
  </AuthGate>
);
