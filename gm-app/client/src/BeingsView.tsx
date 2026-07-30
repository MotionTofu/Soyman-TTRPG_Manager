import { useEffect, useState } from "react";
import type { SettingBeing, Statblock } from "./types";

interface Props {
  settingId: number;
  settingName: string;
}

// "Статблоки существ" — scoped to the campaign's whole setting bestiary
// rather than resolving which beings are specifically dropped into a given
// session's Препятствия (a generic_links target that can be any entity
// type — being/character/community/location/artifact — and would need much
// more resolution logic than a mobile companion's v1 warrants). Browsing
// the bestiary directly is a reasonable, simpler stand-in for "what am I
// likely to need to look up mid-combat."
export function BeingsView({ settingId, settingName }: Props) {
  const [beings, setBeings] = useState<SettingBeing[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    window.gmApp
      .apiGet<SettingBeing[]>(`/api/setting-beings?setting_id=${settingId}`)
      .then(setBeings)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [settingId]);

  return (
    <div className="stack">
      <h2 style={{ margin: 0 }}>Бестиарий — {settingName}</h2>
      {error && <p className="error">{error}</p>}
      {!beings && !error && <p className="muted">Загрузка…</p>}
      {beings?.length === 0 && <p className="muted">Существ пока нет.</p>}
      {beings?.map((b) => (
        <BeingRow key={b.id} being={b} />
      ))}
    </div>
  );
}

function BeingRow({ being }: { being: SettingBeing }) {
  const [statblocks, setStatblocks] = useState<Statblock[] | null>(null);

  function onToggle(e: React.SyntheticEvent<HTMLDetailsElement>) {
    if (e.currentTarget.open && !statblocks) {
      window.gmApp.apiGet<Statblock[]>(`/api/statblocks?owner_type=being&owner_id=${being.id}`).then(setStatblocks);
    }
  }

  return (
    <details className="card" onToggle={onToggle}>
      <summary>
        <strong className="entry-title">{being.name}</strong>
      </summary>
      <div className="stack" style={{ marginTop: 8 }}>
        {!statblocks && <span className="muted">Загрузка…</span>}
        {statblocks?.length === 0 && <span className="muted">Статблоков нет.</span>}
        {statblocks?.map((s) => (
          <div key={s.id} className="stack" style={{ gap: 2 }}>
            <span className="muted">{s.kind === "short" ? "Кратко" : "Полный"}</span>
            <div style={{ whiteSpace: "pre-wrap" }}>{s.content}</div>
          </div>
        ))}
      </div>
    </details>
  );
}
