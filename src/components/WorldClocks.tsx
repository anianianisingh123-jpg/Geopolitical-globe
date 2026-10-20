import { memo, useEffect, useState } from "react";

const ZONES: { label: string; tz: string }[] = [
  { label: "WASHINGTON", tz: "America/New_York" },
  { label: "LONDON", tz: "Europe/London" },
  { label: "MOSCOW", tz: "Europe/Moscow" },
  { label: "BEIJING", tz: "Asia/Shanghai" },
];

const fmt = (tz: string, seconds: boolean) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", second: seconds ? "2-digit" : undefined, hour12: false });

const UTC_FMT = fmt("UTC", true);
const CITY_FMT = ZONES.map((z) => ({ ...z, f: fmt(z.tz, false) }));
const DATE_FMT = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" });

/** Only this component re-renders each second. */
export const WorldClocks = memo(function WorldClocks({ compact }: { compact: boolean }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let t = 0;
    const tick = () => {
      setNow(new Date());
      t = window.setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
    };
    t = window.setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div className="clocks mono" aria-label="World clocks">
      <div className="clock clock-utc">
        <span className="clock-k">{DATE_FMT.format(now).toUpperCase()} · UTC</span>
        <span className="clock-v">{UTC_FMT.format(now)}Z</span>
      </div>
      {!compact &&
        CITY_FMT.map((z) => (
          <div className="clock" key={z.label}>
            <span className="clock-k">{z.label}</span>
            <span className="clock-v">{z.f.format(now)}</span>
          </div>
        ))}
    </div>
  );
});
