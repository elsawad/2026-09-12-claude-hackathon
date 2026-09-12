import { useEffect, useState } from "react";
import Console from "./console/Console";
import "./App.css";
import LandCheck from "./LandCheck";
import ResidentHome from "./resident/ResidentHome";
import LiveMapPage from "./resident/LiveMapPage";
import LookupPage from "./resident/LookupPage";
import "./resident/resident.css";

type Health = { ok: boolean; service: string };
type View = "home" | "land" | "report" | "map" | "lookup";

function pathToView(pathname: string): View {
  if (pathname === "/land") return "land";
  if (pathname === "/report") return "report";
  if (pathname === "/map") return "map";
  if (pathname === "/lookup") return "lookup";
  return "home";
}

function Home() {
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
    const path = next === "home" ? "/" : `/${next}`;
    if (window.location.pathname !== path) {
      window.history.pushState({}, "", path);
    }
    setView(next);
  }

  const isReportFlow = view === "report" || view === "map" || view === "lookup";

  return (
    <div className={`page${view === "land" ? " page-land" : " home"}`}>
      <header className="header">
        <button type="button" className="brand-btn" onClick={() => go("home")}>
          Canopy Watch
        </button>
        <nav>
          <button
            type="button"
            className={isReportFlow ? "nav-active" : undefined}
            onClick={() => go("report")}
          >
            Report
          </button>
          {isReportFlow && (
            <>
              <button type="button" className={view === "map" ? "nav-active" : undefined} onClick={() => go("map")}>
                Map
              </button>
              <button
                type="button"
                className={view === "lookup" ? "nav-active" : undefined}
                onClick={() => go("lookup")}
              >
                Check status
              </button>
            </>
          )}
          <button
            type="button"
            className={view === "land" ? "nav-active" : undefined}
            onClick={() => go("land")}
          >
            Land check
          </button>
          <a href="/console">City console</a>
        </nav>
      </header>

      {view === "land" ? (
        <LandCheck />
      ) : isReportFlow ? (
        <div className="resident">
          {view === "report" && <ResidentHome onViewMap={() => go("map")} />}
          {view === "map" && <LiveMapPage />}
          {view === "lookup" && <LookupPage />}
        </div>
      ) : (
        <main>
          <section className="hero" id="report">
            <h1>Canopy Watch</h1>
            <p className="lede">
              Report tree hazards in your city. Requests are triaged so urgent
              work reaches city crews faster.
            </p>
            <div className="actions">
              <button type="button" onClick={() => go("report")}>
                Report a tree
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => go("land")}
              >
                Land check
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

function App() {
  if (window.location.pathname.startsWith("/console")) return <Console />;
  return <Home />;
}

export default App;
