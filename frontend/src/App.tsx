import { useEffect, useState } from "react";
import Console from "./console/Console";
import "./App.css";

type Health = { ok: boolean; service: string };

function Home() {
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: Health | null) => setHealth(data))
      .catch(() => setHealth(null));
  }, []);

  return (
    <div className="page home">
      <header className="header">
        <p className="brand">Canopy Watch</p>
        <nav>
          <a href="#report">Report</a>
          <a href="/console">City console</a>
        </nav>
      </header>

      <main>
        <section className="hero" id="report">
          <h1>Canopy Watch</h1>
          <p className="lede">
            Report tree hazards in your city. Requests are triaged so urgent work
            reaches city crews faster.
          </p>
          <div className="actions">
            <button type="button" disabled>
              Report a tree
            </button>
            <a className="button secondary" href="/console">
              City console
            </a>
          </div>
          <p className="status">
            API:{" "}
            {health?.ok
              ? `connected (${health.service})`
              : "offline — start the server with make dev-server"}
          </p>
        </section>

        <section className="about" id="about">
          <h2>How it works</h2>
          <p>
            Residents submit a photo and location. The system checks public data,
            proposes a priority, and city staff review every request before action.
          </p>
        </section>
      </main>
    </div>
  );
}

function App() {
  if (window.location.pathname.startsWith("/console")) return <Console />;
  return <Home />;
}

export default App;
