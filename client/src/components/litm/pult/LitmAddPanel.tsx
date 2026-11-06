import { useMemo, useState } from "react";
import { useResource } from "../../../data/hooks";
import type { SessionUnionRow, SettingBeing } from "../../../types";
import { DSeg } from "../../DSeg";
import { Modal } from "../../Modal";
import { Rating } from "../LitmBook";
import { norm } from "../litmBookText";
import { LOCATION_ORDER, OWN_LOCATION, type LitmChallengeProfileData } from "../litmChallenge";
import { useLitmBook } from "./useLitmBook";
import type { LitmSource } from "./useLitmRibbon";

type Tab = "scene" | "book" | "setting" | "quick";
interface Choice {
  key: string;
  src: Exclude<LitmSource, { type: "quick" }>;
  limits: string;
  rating: number | null;
  group: string;
}

const NO_BEINGS: SettingBeing[] = [];

function limitsLine(p: LitmChallengeProfileData | null): string {
  return p ? p.limitList.map((l) => `${l.name.toLocaleLowerCase("ru")} ${l.max}`).join(" · ") || "—" : "";
}

/**
 * «Добавить вызов» режима «Вызовы» (Q16, доска Litm-Pult-Add): вызовы сцены,
 * книга по местам, существа сеттинга и «Быстрый» — имя и один предел.
 * Счётчик «×N» ставит копии с номерами.
 */
export function LitmAddPanel({
  systemId,
  settingId,
  inScene,
  onClose,
  onAdd,
}: {
  systemId: number | null;
  settingId: number | null;
  inScene: SessionUnionRow[];
  onClose: () => void;
  onAdd: (src: LitmSource, count: number) => Promise<void>;
}) {
  const [tab, setTab] = useState<Tab>(inScene.length ? "scene" : "book");
  const [q, setQ] = useState("");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [quick, setQuick] = useState({ name: "", limit: "Ранить", max: "3" });

  const bookEntries = useLitmBook(systemId);
  const beings = useResource<SettingBeing[]>(settingId ? `/setting-beings?setting_id=${settingId}` : null).data ?? NO_BEINGS;

  const book = useMemo<Choice[]>(() => {
    return bookEntries
      .map(({ entry, profile: p }) => {
        return { key: `c:${entry.id}`, src: { type: "compendium_entry" as const, id: entry.id, name: entry.name }, limits: limitsLine(p), rating: p.rating, group: p.addon ? "" : p.location };
      })
      .filter((x) => x.group)
      .sort((a, b) => LOCATION_ORDER.indexOf(a.group) - LOCATION_ORDER.indexOf(b.group) || a.src.name.localeCompare(b.src.name, "ru"));
  }, [bookEntries]);

  const scene = useMemo<Choice[]>(
    () => inScene.map((u) => ({ key: `${u.to_type}:${u.to_id}`, src: { type: u.to_type as "compendium_entry" | "being", id: u.to_id, name: u.name }, limits: "", rating: null, group: "В текущей сцене" })),
    [inScene]
  );
  const setting = useMemo<Choice[]>(
    () => beings.map((b) => ({ key: `b:${b.id}`, src: { type: "being" as const, id: b.id, name: b.name }, limits: "", rating: null, group: "Существа сеттинга" })),
    [beings]
  );

  const list = tab === "scene" ? scene : tab === "book" ? book : tab === "setting" ? setting : [];
  const needle = norm(q.trim());
  const shown = needle ? list.filter((x) => norm(x.src.name).includes(needle)) : list;
  const all = [...scene, ...book, ...setting];
  const chosen = all.filter((x) => (counts[x.key] ?? 0) > 0);
  const total = chosen.reduce((n, x) => n + (counts[x.key] ?? 0), 0);
  const quickOk = !!quick.name.trim();

  function bump(key: string, d: number) {
    setCounts((c) => ({ ...c, [key]: Math.max(0, Math.min(9, (c[key] ?? 0) + d)) }));
  }

  async function submit() {
    setBusy(true);
    try {
      if (tab === "quick") {
        const max = Number.parseInt(quick.max, 10);
        await onAdd({ type: "quick", name: quick.name.trim(), limit: quick.limit.trim() && max >= 1 ? { name: quick.limit.trim(), max: Math.min(6, max) } : undefined }, 1);
      } else {
        for (const x of chosen) await onAdd(x.src, counts[x.key] ?? 0);
      }
      onClose();
    } finally {
      setBusy(false);
    }
  }

  let lastGroup = "";
  return (
    <Modal wide onClose={onClose} ariaLabel="Добавить вызов" className="lp-add">
      <h2>Добавить вызов</h2>
      <DSeg<Tab>
        label="Откуда"
        value={tab}
        onChange={setTab}
        items={[
          { id: "scene", label: "Сцена", count: scene.length },
          { id: "book", label: "Книга", count: book.length },
          { id: "setting", label: "Сеттинг", count: setting.length },
          { id: "quick", label: "Быстрый" },
        ]}
      />
      {tab === "quick" ? (
        <div className="lp-quick">
          <label>
            Имя
            <input autoFocus value={quick.name} onChange={(e) => setQuick({ ...quick, name: e.target.value })} placeholder="Стражник ворот" />
          </label>
          <label>
            Предел
            <input value={quick.limit} onChange={(e) => setQuick({ ...quick, limit: e.target.value })} />
          </label>
          <label>
            До
            <input type="number" min={1} max={6} value={quick.max} onChange={(e) => setQuick({ ...quick, max: e.target.value })} />
          </label>
          <p className="muted">Вызов без профиля книги: имя и один предел. Остальное — на ленте.</p>
        </div>
      ) : (
        <>
          <input className="lp-add__q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Найти вызов…" aria-label="Найти вызов" />
          <div className="lp-add__list">
            {shown.length === 0 && (
              <p className="muted">
                {tab === "scene" ? "В текущей сцене вызовов нет — «Кого они приведут» в подготовке." : tab === "setting" ? "У сеттинга нет существ." : "Ничего не нашлось."}
              </p>
            )}
            {shown.map((x) => {
              const head = x.group !== lastGroup ? x.group : null;
              lastGroup = x.group;
              const n = counts[x.key] ?? 0;
              return (
                <div key={x.key}>
                  {head && <div className="lp-add__grp">{head === OWN_LOCATION ? "Свои вызовы" : head}</div>}
                  <div className={`lp-add__row${n ? " is-on" : ""}`}>
                    <span className="lb-name">{x.src.name}</span>
                    <span className="lp-mono">{x.limits}</span>
                    <span>{x.rating != null && <Rating value={x.rating} />}</span>
                    <span className="lp-step">
                      <button type="button" aria-label={`Меньше: ${x.src.name}`} onClick={() => bump(x.key, -1)}>
                        −
                      </button>
                      <b>{n}</b>
                      <button type="button" aria-label={`Больше: ${x.src.name}`} onClick={() => bump(x.key, 1)}>
                        +
                      </button>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="muted">Стартовые статусы из тегов вызова встанут сами. Копии нумеруются: «Разбойник», «Разбойник 2».</p>
        </>
      )}
      <div className="modal-footer row">
        {tab !== "quick" && total > 0 && <span className="lp-mono lp-add__sum">Выбрано: {chosen.map((x) => `${x.src.name} ×${counts[x.key]}`).join(", ")}</span>}
        <button type="button" onClick={onClose}>
          Отмена
        </button>
        <button type="button" className="primary" disabled={busy || (tab === "quick" ? !quickOk : total === 0)} onClick={() => void submit()}>
          {tab === "quick" ? "На ленту" : `Добавить ${total || ""}`.trim()}
        </button>
      </div>
    </Modal>
  );
}
