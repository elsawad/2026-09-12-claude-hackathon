/** Free, keyless current-conditions wind fetch (Open-Meteo) for scoring context. */
export async function getWindContext(lat: number, lng: number): Promise<string | null> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=wind_speed_10m,wind_gusts_10m&wind_speed_unit=kmh`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as {
      current?: { wind_speed_10m: number; wind_gusts_10m: number };
    };
    if (!data.current) return null;
    const { wind_speed_10m, wind_gusts_10m } = data.current;
    return `wind ${Math.round(wind_speed_10m)} km/h, gusts ${Math.round(wind_gusts_10m)} km/h`;
  } catch (err) {
    console.error("[wind] fetch failed:", (err as Error).message);
    return null;
  }
}
