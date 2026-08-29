import { useEffect, useState } from "react";
import { api } from "./api/client";
import type { SessionSummary } from "./types";
import { parseDateKey, toLocalDateKey } from "./utils/date";

const REFRESH_MS = 60_000;

function pickNearestId(sessions: SessionSummary[]): number | null {
  const now = new Date();
  const todayStr = toLocalDateKey(now);
  const planned = sessions
    .filter((s) => s.status === "planned")
    .map((s) => {
      const d = parseDateKey(s.date);
      const [h, m] = (s.start_time ?? "00:00").split(":").map(Number);
      d.setHours(h, m, 0, 0);
      return { s, dt: d };
    })
    .sort((a, b) => a.dt.getTime() - b.dt.getTime() || a.s.id - b.s.id);

  // "Current" — the latest of today's sessions whose start time has already
  // arrived. Restricted to todayStr so a forgotten week-old planned session
  // never gets picked up as "current".
  let current: SessionSummary | null = null;
  for (const { s, dt } of planned) {
    if (s.date === todayStr && dt.getTime() <= now.getTime()) current = s;
  }
  if (current) return current.id;

  const upcoming = planned.find(({ dt }) => dt.getTime() > now.getTime());
  return upcoming ? upcoming.s.id : null;
}

// The session cockpit nav button always points at whichever planned session
// is "happening now" (same-day, start time already passed) or, if none is,
// the soonest upcoming one — see nearestSessionCockpit.ts's pickNearestId
// for the exact tie-break rules requested by the user.
export function useNearestSessionCockpitId(): number | null {
  const [id, setId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    function refresh() {
      api.get<SessionSummary[]>("/calendar").then((sessions) => {
        if (!cancelled) setId(pickNearestId(sessions));
      });
    }
    refresh();
    const interval = setInterval(refresh, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return id;
}
