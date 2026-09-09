"use client";

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="en">
      <body>
        <main className="app-recovery-screen">
          <section className="app-recovery-card" role="alert">
            <span className="app-recovery-mark">VV</span>
            <p>ValoVault needs a quick reload</p>
            <h1>The desktop shell is still safe.</h1>
            <small>{error.digest ? `Recovery code ${error.digest}` : "Your account and presets were not changed."}</small>
            <button type="button" onClick={() => window.location.reload()}>Reload ValoVault</button>
          </section>
        </main>
      </body>
    </html>
  );
}
