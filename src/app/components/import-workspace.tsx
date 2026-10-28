"use client";

import { useCallback, useEffect, useState } from "react";

type Batch = { kind: string; source: string; exportId: string | null; rowCount: number; importedAt: string; details: Record<string, unknown> };
type ImportResult = { imports?: Record<string, Batch>; error?: string };

const cards = [
  { kind: "stock", title: "Stock count", help: "Upload the latest physical count JSON." },
  { kind: "staff", title: "HR · Staff master", help: "Import this first so other HR files can check staff IDs." },
  { kind: "leave", title: "HR · Leave decisions", help: "Import approved, pending and declined leave." },
  { kind: "availability", title: "HR · Part-time availability", help: "Import confirmed or pending named shifts." },
  { kind: "crm", title: "Weekly CRM orders", help: "Upload the weekly CSV last. Invalid files leave the saved export unchanged." },
];

function localTime(value: string) {
  return new Intl.DateTimeFormat("en-SG", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Singapore" }).format(new Date(value));
}

export function ImportWorkspace() {
  const [authenticated, setAuthenticated] = useState(false);
  const [passwordConfigured, setPasswordConfigured] = useState(true);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState("");
  const [imports, setImports] = useState<Record<string, Batch>>({});
  const [databaseReady, setDatabaseReady] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    const authResponse = await fetch("/api/import-auth", { cache: "no-store" });
    const auth = await authResponse.json();
    setAuthenticated(Boolean(auth.authenticated));
    setPasswordConfigured(Boolean(auth.passwordConfigured));
    if (!auth.authenticated) return;
    const response = await fetch("/api/imports", { cache: "no-store" });
    const data = await response.json() as ImportResult;
    if (response.ok) {
      setImports(data.imports ?? {});
      setDatabaseReady(true);
      setError("");
    } else {
      setDatabaseReady(false);
      setError(data.error ?? "The saved imports could not be loaded.");
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setSuccess(""); setBusy("login");
    try {
      const response = await fetch("/api/import-auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not sign in.");
      setPassword(""); setSuccess("Signed in. Import status is loading from the database."); await refresh();
      window.dispatchEvent(new Event("kitchen-auth-changed"));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not sign in."); }
    finally { setBusy(""); }
  }

  async function signOut() {
    await fetch("/api/import-auth", { method: "DELETE" });
    setAuthenticated(false); setImports({}); setSuccess(""); setError("");
    window.dispatchEvent(new Event("kitchen-auth-changed"));
  }

  async function upload(kind: string, file: File | undefined) {
    if (!file) { setError("Choose a file before importing."); return; }
    setBusy(kind); setError(""); setSuccess("");
    try {
      const form = new FormData(); form.set("file", file);
      const response = await fetch(`/api/imports/${kind}`, { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Import failed.");
      setSuccess(result.message); await refresh();
      window.dispatchEvent(new Event("kitchen-import-changed"));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Import failed."); }
    finally { setBusy(""); }
  }

  return (
    <section className="imports-card" aria-labelledby="imports-title">
      <div className="imports-heading">
        <div><p className="eyebrow">Owner workspace</p><h3 id="imports-title">Import and save your files</h3></div>
        {authenticated && <button className="text-button" onClick={signOut}>Sign out</button>}
      </div>
      <p className="imports-intro">Files are checked by the server and saved to Postgres. Only accepted uploads replace the current saved records; re-importing an identical file won’t add duplicates.</p>

      {!authenticated ? (
        <form className="login-form" onSubmit={signIn}>
          <label htmlFor="owner-password">Import owner password</label>
          <div className="login-row"><input id="owner-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter the password you configured" disabled={!passwordConfigured} required /><button type="submit" disabled={busy === "login" || !passwordConfigured}>{busy === "login" ? "Signing in…" : "Sign in"}</button></div>
          {!passwordConfigured && <p className="setup-note">Set IMPORT_ADMIN_PASSWORD in your private project-root .env file first. Never put it in a NEXT_PUBLIC_ variable.</p>}
        </form>
      ) : (
        <>
          <div className={`database-notice ${databaseReady ? "connected" : "pending"}`}>
            <span className="notice-dot" />
            {databaseReady ? "Connected to Postgres. Import status is saved." : "Postgres is not connected yet. Set DATABASE_URL in the server environment, then apply the schema."}
          </div>
          <div className="import-grid">
            {cards.map((card, index) => {
              const batch = imports[card.kind];
              return <ImportCard key={card.kind} {...card} index={index} batch={batch} busy={busy === card.kind} onUpload={upload} disabled={!databaseReady} />;
            })}
          </div>
        </>
      )}
      {error && <p className="feedback error" role="alert">{error}</p>}
      {success && <p className="feedback success" role="status">{success}</p>}
    </section>
  );
}

function ImportCard({ kind, title, help, index, batch, busy, disabled, onUpload }: { kind: string; title: string; help: string; index: number; batch?: Batch; busy: boolean; disabled: boolean; onUpload: (kind: string, file: File | undefined) => void }) {
  const id = `file-${kind}`;
  const isCsv = kind === "crm";
  const details = batch?.details ?? {};
  return (
    <form className="import-card" onSubmit={(event) => { event.preventDefault(); onUpload(kind, (event.currentTarget.elements.namedItem("file") as HTMLInputElement).files?.[0]); }}>
      <div className="import-card-top"><span className="step-number">{index + 1}</span><span className="file-type">{isCsv ? "CSV" : "JSON"}</span></div>
      <h4>{title}</h4><p>{help}</p>
      <label className="file-label" htmlFor={id}>Choose {isCsv ? "CSV" : "JSON"} file</label>
      <input id={id} name="file" type="file" accept={isCsv ? ".csv,text/csv" : ".json,application/json"} required disabled={disabled || busy} />
      <button className="upload-button" type="submit" disabled={disabled || busy}>{busy ? "Saving…" : batch ? "Import update" : "Import file"}</button>
      {batch ? (
        <div className="saved-status"><strong>Last saved</strong><span>{batch.source}{batch.exportId ? ` · ${batch.exportId}` : ""}</span><span>{batch.rowCount} rows · imported {localTime(batch.importedAt)} Singapore time</span>{typeof details.exportedAt === "string" && <span>Exported {localTime(details.exportedAt)} Singapore time</span>}{typeof details.effectiveMonth === "string" && <span>Effective month {details.effectiveMonth}</span>}{typeof details.checkedAt === "string" && <span>Count checked {localTime(details.checkedAt)} Singapore time</span>}</div>
      ) : <div className="saved-status empty">No saved import yet</div>}
    </form>
  );
}

