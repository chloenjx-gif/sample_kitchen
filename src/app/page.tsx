import { ImportWorkspace } from "./components/import-workspace";
import { AgentWorkspace } from "./components/agent-workspace";

export default function Home() {
  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">K</div>
        <div><p className="eyebrow">Sample Central Kitchen</p><h1>Kitchen Planner</h1></div>
        <span className="status"><span /> Imports available</span>
      </header>

      <section className="welcome">
        <p className="eyebrow">Weekly operations</p>
        <h2>Your plan, in one place.</h2>
        <p className="intro">The server now calculates production, a draft roster and stock requests from saved imports. A full review dashboard is coming in a later step.</p>
      </section>

      <section className="setup-card" aria-labelledby="setup-title">
        <div className="setup-icon" aria-hidden="true">1</div>
        <div className="setup-copy">
          <h3 id="setup-title">Import your operating files</h3>
          <p>The import workspace below saves validated stock, HR and CRM files. Your saved status appears after you sign in. The server recalculates whenever those imports change.</p>
          <div className="checklist">
            <div><span className="check done">✓</span><span>Planning rules and recipe references added</span><span className="tag">Ready</span></div>
            <div><span className="check">2</span><span>Import stock count, HR records and weekly orders</span><span className="tag muted">Available</span></div>
            <div><span className="check done">✓</span><span>Calculate production, roster and purchasing</span><span className="tag">Ready</span></div>
          </div>
        </div>
      </section>

      <ImportWorkspace />
      <AgentWorkspace />

      <footer>Planning week <strong>2–6 November 2026</strong><span>·</span> Singapore time</footer>
    </main>
  );
}

