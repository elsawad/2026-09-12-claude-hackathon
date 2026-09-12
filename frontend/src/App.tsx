import { useEffect, useState } from "react";
import "./App.css";
import LandCheck from "./LandCheck";

type Health = { ok: boolean; service: string };
type View = "home" | "land";

function pathToView(pathname: string): View {
  return pathname === "/land" ? "land" : "home";
}

function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [view, setView] = useState<View>(() => pathToView(window.location.pathname));

  useEffect(() => {
    fetch("/api/health")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: Health | null) => setHealth(data))
      .catch(() => setHealth(null));
  }, []);

  useEffect(() => {
    const onPop = () => setView(pathToView(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  function go(next: View) {
    const path = next === "land" ? "/land" : "/";
    if (window.location.pathname !== path) {
      window.history.pushState({}, "", path);
    }
    setView(next);
  }

  return (
    <div className={`page${view === "land" ? " page-land" : ""}`}>
      <header className="header">
        <button type="button" className="brand-btn" onClick={() => go("home")}>
          Canopy Watch
        </button>
        <nav>
          <button
            type="button"
            className={view === "home" ? "nav-active" : undefined}
            onClick={() => go("home")}
          >
            Report
          </button>
          <button
            type="button"
            className={view === "land" ? "nav-active" : undefined}
            onClick={() => go("land")}
          >
            Land check
          </button>
        </nav>
      </header>

      {view === "land" ? (
        <LandCheck />
      ) : (
        <main>
          <section className="hero" id="report">
            <h1>Canopy Watch</h1>
            <p className="lede">
              Report tree hazards in your city. Requests are triaged so urgent
              work reaches city crews faster.
            </p>
            <div className="actions">
              <button type="button" disabled>
                Report a tree
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => go("land")}
              >
                Land check
              </button>
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
              Residents submit a photo and location. The system checks public
              data, proposes a priority, and city staff review every request
              before action. Use{" "}
              <button type="button" className="text-link" onClick={() => go("land")}>
                Land check
              </button>{" "}
              to see Cityworks work orders against HRM-owned parcels.
            </p>
          </section>
        </main>
      )}
    </div>
  );
}

export default App;
