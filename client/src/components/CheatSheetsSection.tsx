import { memo, useEffect, useState } from "react";
import { api } from "../api/client";
import { resolveEntityLabel } from "../api/resolveEntity";
import type { SettingBeing } from "../types";

type SheetFormat = "a4" | "a5";
type SheetKind = "overview" | "combat" | "combo";

interface GenericLink {
  id: number;
  from_type: string;
  from_id: number;
  to_type: string;
  to_id: number;
}

interface LinkedEntry {
  id: number;
  type: string;
  label: string;
}

interface Props {
  sessionId: number;
  ideaNotes: string;
}

async function loadLinkedLabels(sessionId: number, section: string): Promise<LinkedEntry[]> {
  const links = await api.get<GenericLink[]>(
    `/links?type=session&id=${sessionId}&section=${section}`
  );
  return Promise.all(
    links.map(async (l) => {
      const other =
        l.from_type === "session" && l.from_id === sessionId
          ? { type: l.to_type, id: l.to_id }
          : { type: l.from_type, id: l.from_id };
      const label = await resolveEntityLabel(other.type, other.id);
      return { id: other.id, type: other.type, label };
    })
  );
}

async function loadEnemies(sessionId: number): Promise<SettingBeing[]> {
  const links = await api.get<GenericLink[]>(
    `/links?type=session&id=${sessionId}&section=enemies`
  );
  const beingLinks = links.filter(
    (l) =>
      (l.from_type === "session" && l.to_type === "being") ||
      (l.to_type === "session" && l.from_type === "being")
  );
  const resolved = await Promise.all(
    beingLinks.map(async (l) => {
      const beingId = l.from_type === "being" ? l.from_id : l.to_id;
      try {
        return await api.get<SettingBeing>(`/setting-beings/${beingId}`);
      } catch {
        return null;
      }
    })
  );
  return resolved.filter((b): b is SettingBeing => b !== null);
}

const PAGE_SIZE: Record<SheetFormat, string> = {
  a4: "A4 landscape",
  a5: "A5 portrait",
};

// Memoized — see ObstacleDropZone's comment; props here are plain
// primitives so no caller-side changes are needed for this to take effect.
export const CheatSheetsSection = memo(function CheatSheetsSection({ sessionId, ideaNotes }: Props) {
  const [characters, setCharacters] = useState<LinkedEntry[]>([]);
  const [locations, setLocations] = useState<LinkedEntry[]>([]);
  const [enemies, setEnemies] = useState<SettingBeing[]>([]);
  const [overviewFormat, setOverviewFormat] = useState<SheetFormat>("a4");
  const [combatFormat, setCombatFormat] = useState<SheetFormat>("a4");
  const [printJob, setPrintJob] = useState<{ kind: SheetKind; pageSize: string } | null>(null);

  useEffect(() => {
    loadLinkedLabels(sessionId, "plot_characters").then(setCharacters);
    loadLinkedLabels(sessionId, "locations").then(setLocations);
    loadEnemies(sessionId).then(setEnemies);
  }, [sessionId]);

  // Printing a specific template means hiding everything else on the page
  // for the duration of the browser print dialog — the CSS in index.css
  // (`.printing-cheatsheet`) does the actual hide/show, this effect just
  // drives the @page size (which differs per format/combo) and cleans up
  // once the dialog closes, whether the user printed or cancelled.
  useEffect(() => {
    if (!printJob) return;
    const style = document.createElement("style");
    style.textContent = `@page { size: ${printJob.pageSize}; margin: 10mm; }`;
    document.head.appendChild(style);
    document.body.classList.add("printing-cheatsheet");
    function cleanup() {
      document.body.classList.remove("printing-cheatsheet");
      style.remove();
      setPrintJob(null);
      window.removeEventListener("afterprint", cleanup);
    }
    window.addEventListener("afterprint", cleanup);
    const raf = requestAnimationFrame(() => window.print());
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printJob]);

  const bothA5 = overviewFormat === "a5" && combatFormat === "a5";

  return (
    <div className="stack">
      <p className="muted">
        Заполняемые шаблоны для печати перед офлайн-сессией. A4 печатается альбомно на одном
        листе, A5 — книжно; если оба шаблона в формате A5, их можно напечатать вдвоём на одном
        листе A4, чтобы не переводить бумагу.
      </p>

      <div className="card stack">
        <strong>Обзор сессии</strong>
        <p className="muted" style={{ margin: 0 }}>
          Задумка, сюжетные персонажи, локации и противники одним взглядом.
        </p>
        <div className="row">
          <select
            value={overviewFormat}
            onChange={(e) => setOverviewFormat(e.target.value as SheetFormat)}
          >
            <option value="a4">A4 (альбомная)</option>
            <option value="a5">A5 (книжная)</option>
          </select>
          <button
            type="button"
            onClick={() => setPrintJob({ kind: "overview", pageSize: PAGE_SIZE[overviewFormat] })}
          >
            Сохранить под печать
          </button>
        </div>
      </div>

      <div className="card stack">
        <strong>Боевая шпаргалка</strong>
        <p className="muted" style={{ margin: 0 }}>
          Строка на каждого противника: КД, инициатива, ХП и клетки для учёта урона.
        </p>
        <div className="row">
          <select
            value={combatFormat}
            onChange={(e) => setCombatFormat(e.target.value as SheetFormat)}
          >
            <option value="a4">A4 (альбомная)</option>
            <option value="a5">A5 (книжная)</option>
          </select>
          <button
            type="button"
            onClick={() => setPrintJob({ kind: "combat", pageSize: PAGE_SIZE[combatFormat] })}
          >
            Сохранить под печать
          </button>
        </div>
      </div>

      {bothA5 && (
        <button
          type="button"
          onClick={() => setPrintJob({ kind: "combo", pageSize: PAGE_SIZE.a4 })}
        >
          Напечатать оба A5 на одном A4
        </button>
      )}

      <div className={`cheatsheet-print-root${printJob ? " active" : ""}`}>
        {printJob?.kind === "overview" && (
          <OverviewSheet
            format={overviewFormat}
            ideaNotes={ideaNotes}
            characters={characters}
            locations={locations}
            enemies={enemies}
          />
        )}
        {printJob?.kind === "combat" && <CombatSheet format={combatFormat} enemies={enemies} />}
        {printJob?.kind === "combo" && (
          <div className="cheatsheet-combo">
            <OverviewSheet
              format="a5"
              ideaNotes={ideaNotes}
              characters={characters}
              locations={locations}
              enemies={enemies}
            />
            <CombatSheet format="a5" enemies={enemies} />
          </div>
        )}
      </div>
    </div>
  );
});

function OverviewSheet({
  format,
  ideaNotes,
  characters,
  locations,
  enemies,
}: {
  format: SheetFormat;
  ideaNotes: string;
  characters: LinkedEntry[];
  locations: LinkedEntry[];
  enemies: SettingBeing[];
}) {
  return (
    <div className="cheatsheet-sheet" data-format={format}>
      <h2>Обзор сессии</h2>
      <section>
        <h3>Задумка</h3>
        <p style={{ whiteSpace: "pre-wrap" }}>{ideaNotes || "—"}</p>
      </section>
      <div className="cheatsheet-columns">
        <section>
          <h3>Сюжетные персонажи</h3>
          <ul>
            {characters.map((c) => (
              <li key={`${c.type}-${c.id}`}>{c.label}</li>
            ))}
            {characters.length === 0 && <li className="muted">—</li>}
          </ul>
        </section>
        <section>
          <h3>Локации</h3>
          <ul>
            {locations.map((l) => (
              <li key={`${l.type}-${l.id}`}>{l.label}</li>
            ))}
            {locations.length === 0 && <li className="muted">—</li>}
          </ul>
        </section>
        <section>
          <h3>Противники</h3>
          <ul>
            {enemies.map((e) => (
              <li key={e.id}>
                {e.name}
                {e.statblock_short && (
                  <span className="muted"> — {e.statblock_short.split("\n")[0]}</span>
                )}
              </li>
            ))}
            {enemies.length === 0 && <li className="muted">—</li>}
          </ul>
        </section>
      </div>
      <section>
        <h3>Заметки мастера</h3>
        <div className="cheatsheet-lines">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="cheatsheet-line" />
          ))}
        </div>
      </section>
    </div>
  );
}

function CombatSheet({ format, enemies }: { format: SheetFormat; enemies: SettingBeing[] }) {
  return (
    <div className="cheatsheet-sheet" data-format={format}>
      <h2>Боевая шпаргалка</h2>
      {enemies.length === 0 && (
        <p className="muted">Нет противников — добавьте их в разделе «Противники».</p>
      )}
      {enemies.map((e) => (
        <div key={e.id} className="combat-row">
          <div className="combat-row-name">
            <strong>{e.name}</strong>
            {e.statblock_short && (
              <div className="muted combat-row-note">{e.statblock_short.split("\n")[0]}</div>
            )}
          </div>
          <label className="combat-field">
            КД <span className="fill-box" />
          </label>
          <label className="combat-field">
            Иниц. <span className="fill-box" />
          </label>
          <label className="combat-field">
            ХП <span className="fill-box wide" />
          </label>
          <div className="combat-boxes">
            {Array.from({ length: 20 }).map((_, i) => (
              <span key={i} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
