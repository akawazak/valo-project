"use client";

import { useEffect } from "react";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.warn("ValoVault recovered from a screen error", {
      message: error.message,
      digest: error.digest,
    });
  }, [error]);

  return (
    <main className="app-recovery-screen">
      <section className="app-recovery-card" role="alert">
        <span className="app-recovery-mark">VV</span>
        <p>ValoVault kept running</p>
        <h1>This screen hit a temporary problem.</h1>
        <small>Your account and presets were not changed.</small>
        <button type="button" onClick={reset}>Try this screen again</button>
      </section>
    </main>
  );
}
