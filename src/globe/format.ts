/** Three-free helpers shared by the globe chunk and the entry-chunk HUD widgets. */

export function fmtLat(lat: number): string {
  return `${Math.abs(lat).toFixed(2).padStart(5, "0")}${lat >= 0 ? "N" : "S"}`;
}

export function fmtLng(lng: number): string {
  return `${Math.abs(lng).toFixed(2).padStart(6, "0")}${lng >= 0 ? "E" : "W"}`;
}

/** Subsolar point (±~1°): declination from day-of-year, longitude from UTC time + equation of time. */
export function subsolarPoint(date: Date): { lat: number; lng: number } {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const day = (date.getTime() - start) / 86_400_000;
  const g = ((2 * Math.PI) / 365) * (day - 1);
  const decl =
    0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g);
  const eqTimeMin =
    229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const utcMin = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  const lng = -((utcMin + eqTimeMin - 720) / 4);
  return { lat: (decl * 180) / Math.PI, lng: ((lng + 540) % 360) - 180 };
}

/** UTC time as HHMMZ. */
export const hhmm = (ms: number): string => {
  const d = new Date(ms);
  return `${String(d.getUTCHours()).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}Z`;
};
