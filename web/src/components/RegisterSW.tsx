"use client";
import { useEffect } from "react";

/** Registers a minimal service worker, so the site can be installed as an app on the phone. */
export function RegisterSW() {
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  return null;
}
