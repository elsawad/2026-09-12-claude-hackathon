import { Routes, Route, Link } from "react-router-dom";
import ResidentHome from "./resident/ResidentHome";
import LiveMapPage from "./resident/LiveMapPage";
import LookupPage from "./resident/LookupPage";
import OfficerConsole from "./officer/OfficerConsole";

export default function App() {
  return (
    <Routes>
      <Route path="/officer/*" element={<OfficerConsole />} />
      <Route
        path="/*"
        element={
          <div className="app-shell">
            <div className="brand-ribbon">HALIFAX REGIONAL MUNICIPALITY — COMMUNITY PILOT PROJECT</div>
            <div className="top-bar">
              <span className="wordmark">Halifax</span>
              <span className="divider" aria-hidden />
              <h1>Canopy Watch</h1>
            </div>
            <Routes>
              <Route path="/" element={<ResidentHome />} />
              <Route path="/map" element={<LiveMapPage />} />
              <Route path="/lookup" element={<LookupPage />} />
            </Routes>
            <nav className="nav-tabs" style={{ padding: "0 16px 16px" }}>
              <Link to="/" style={{ flex: 1 }}>
                <button type="button">Report</button>
              </Link>
              <Link to="/map" style={{ flex: 1 }}>
                <button type="button">Map</button>
              </Link>
              <Link to="/lookup" style={{ flex: 1 }}>
                <button type="button">Check status</button>
              </Link>
            </nav>
          </div>
        }
      />
    </Routes>
  );
}
