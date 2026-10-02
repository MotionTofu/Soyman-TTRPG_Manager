import { useMemo, useState } from "react";
import { useAction, useResource, write } from "../../data/hooks";
import { chroniclePaths } from "../../data/settingPage";
import { useConfirm } from "../../hooks/useConfirm";
import { Modal } from "../Modal";
import type { TimelineView } from "../Timeline";
import type { SettingCycle, SettingCycleGroup } from "../../types";
import { cycleSegments, type CycleSegment } from "../../cycles";
// Страница кампании грузится отдельно от страницы сеттинга — стили панели берём сами.
import "../../pages/setting-profile.css";

// Панель циклов под осью Хроники (разбор 2026-10-02, Q23–Q25, Q29–Q31): по
// дорожке на цикл, тот же масштаб и сдвиг, что у оси. Группа — фильтр
// дорожек. Элементы — отрезки или отметки дня (Q3 Б); где элементы разных
// видимых циклов пересекаются — пунктир «сходятся» на первом общем дне (Q8),
// с него заводится событие на этот день. На оси кампании та же панель
// (разбор 2026-10-02, ось кампании Q1–Q4, Q12): циклы сеттинга плюс её
// собственные, новая группа — группа кампании; выбор группы общий с сеттингом.

const ALL = "all";
// Меньше стольких пикселей между началами элементов — дорожка не читается.
const MIN_GAP_PX = 4;
const MAX_SEGMENTS = 400;
const LABEL_PX = 50;
// Шире этого окна совпадения по дням не считаются — там всё равно штриховка.
const MAX_CROSS_DAYS = 40000;

function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}
function store(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // без хранилища выбор просто не переживёт перезагрузку
  }
}

export function SettingCyclePanel({
  settingId,
  campaignId = null,
  cycles,
  view,
  onAddCycle,
  onDayMenu,
}: {
  settingId: number;
  campaignId?: number | null;
  cycles: SettingCycle[];
  view: TimelineView;
  onAddCycle: () => void;
  /** ПКМ по линии «сходятся»: день от начала летоисчисления и точка щелчка. */
  onDayMenu: (day: number, x: number, y: number) => void;
}) {
  const groupsPath = chroniclePaths.cycleGroups(settingId, campaignId);
  const groups = useResource<SettingCycleGroup[]>(groupsPath).data ?? [];
  const groupKey = `soyman.cycles.group.${settingId}`;
  const hiddenKey = `soyman.cycles.hidden.${settingId}`;
  const [groupId, setGroupIdState] = useState<number | typeof ALL>(() => readStored(groupKey, ALL));
  const [hidden, setHiddenState] = useState<number[]>(() => readStored(hiddenKey, []));
  const [editing, setEditing] = useState<SettingCycleGroup | "new" | null>(null);

  const group = groupId === ALL ? undefined : groups.find((g) => g.id === groupId);
  const lanes = group ? cycles.filter((c) => group.cycle_ids.includes(c.id)) : cycles;

  function setGroupId(next: number | typeof ALL) {
    setGroupIdState(next);
    store(groupKey, next);
  }
  function toggleHidden(id: number) {
    const next = hidden.includes(id) ? hidden.filter((h) => h !== id) : [...hidden, id];
    setHiddenState(next);
    store(hiddenKey, next);
  }

  const { from, to, pxPerDay, xOf, dayOf } = view;
  const segments = useMemo(() => {
    const out = new Map<number, CycleSegment[] | "dense">();
    for (const cycle of lanes) {
      const found = cycleSegments(cycle, dayOf(cycle.anchor_year, cycle.anchor_month, cycle.anchor_day), from, to, MAX_SEGMENTS);
      if (found === "dense") {
        out.set(cycle.id, "dense");
        continue;
      }
      // Начала ближе MIN_GAP_PX сливаются в серую полосу — честнее штриховка.
      const tooClose = found.some((m, i) => i > 0 && m.start > found[i - 1].start && (m.start - found[i - 1].start) * pxPerDay < MIN_GAP_PX);
      out.set(cycle.id, tooClose ? "dense" : found);
    }
    return out;
  }, [lanes, from, to, pxPerDay, dayOf]);

  // Q8: циклы сходятся, где их элементы пересекаются; пунктир — на первом
  // дне общего промежутка, подсказка — весь промежуток.
  const crossings = useMemo(() => {
    if (to - from > MAX_CROSS_DAYS) return [];
    const byDay = new Map<number, Map<number, string>>();
    for (const cycle of lanes) {
      const list = segments.get(cycle.id);
      if (hidden.includes(cycle.id) || !list || list === "dense") continue;
      for (const seg of list) {
        for (let d = Math.max(seg.start, from); d < Math.min(seg.start + seg.days, to + 1); d++) {
          const at = byDay.get(d) ?? new Map<number, string>();
          if (!at.has(cycle.id)) at.set(cycle.id, `${cycle.name} — ${seg.name}`);
          byDay.set(d, at);
        }
      }
    }
    const runs: { day: number; days: number; names: string[] }[] = [];
    for (const day of [...byDay.keys()].sort((a, b) => a - b)) {
      const at = byDay.get(day)!;
      if (at.size < 2) continue;
      const names = [...at.values()];
      const last = runs[runs.length - 1];
      if (last && last.day + last.days === day && last.names.join() === names.join()) last.days++;
      else runs.push({ day, days: 1, names });
    }
    return runs;
  }, [lanes, segments, hidden, from, to]);

  // Без циклов панель — одна строка с «+ Цикл»: место под ось видно и в
  // кампании, у сеттинга которой циклов ещё нет (просьба владельца 2026-10-02).
  if (cycles.length === 0) {
    return (
      <section className="cycle-panel paper-scope" aria-label="Циклы">
        <div className="cycle-panel__head">
          <span className="cycle-panel__title">Циклы</span>
          <span className="muted">пока нет</span>
          <span className="cycle-panel__grow" />
          <button type="button" onClick={onAddCycle}>
            + Цикл
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="cycle-panel paper-scope" aria-label="Циклы">
      <div className="cycle-panel__head">
        <span className="cycle-panel__title">Циклы</span>
        <button type="button" className={`population__chip${!group ? " is-on" : ""}`} aria-pressed={!group} onClick={() => setGroupId(ALL)}>
          Все · {cycles.length}
        </button>
        {groups.map((g) => (
          <span key={g.id} className="cycle-panel__group">
            <button
              type="button"
              className={`population__chip${group?.id === g.id ? " is-on" : ""}`}
              aria-pressed={group?.id === g.id}
              onClick={() => setGroupId(g.id)}
            >
              {g.name} · {g.cycle_ids.length}
            </button>
            {group?.id === g.id && (
              <button type="button" className="comp-mini" title="Изменить группу" aria-label={`Изменить группу «${g.name}»`} onClick={() => setEditing(g)}>
                ⋯
              </button>
            )}
          </span>
        ))}
        <button type="button" className="population__chip" onClick={() => setEditing("new")}>
          + Группа
        </button>
        <span className="cycle-panel__grow" />
        <button type="button" onClick={onAddCycle}>
          + Цикл
        </button>
      </div>

      <div className="cycle-panel__lanes" {...view.pan}>
        {lanes.map((cycle) => {
          const off = hidden.includes(cycle.id);
          const list = segments.get(cycle.id);
          const n = cycle.points.length;
          const pointsLabel = n === 0 ? "без элементов" : `${n} ${n % 10 === 1 && n % 100 !== 11 ? "элемент" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? "элемента" : "элементов"}`;
          return (
            <div key={cycle.id} className={`cycle-lane${off ? " is-off" : ""}${list === "dense" && !off ? " is-dense" : ""}`}>
              {!off && list === "dense" && <span className="cycle-lane__dense">мельче масштаба</span>}
              {!off && list && list !== "dense" && <CycleLane segments={list} xOf={xOf} />}
              <span className="cycle-lane__label">
                <label>
                  <input type="checkbox" checked={!off} onChange={() => toggleHidden(cycle.id)} />
                  {cycle.name}
                </label>
                <span className="cycle-lane__meta">
                  {cycle.period_days} дн. · {pointsLabel}
                </span>
              </span>
            </div>
          );
        })}
        {lanes.length === 0 && <p className="muted cycle-panel__empty">В группе нет циклов.</p>}
        {crossings.map(({ day, days, names }) => (
          <span
            key={day}
            className="cycle-panel__cross"
            style={{ left: xOf(day) }}
            title={`Сходятся${days > 1 ? ` ${days} дн.` : ""}: ${names.join(", ")}\nПКМ — событие на этот день`}
            onContextMenu={(e) => {
              e.preventDefault();
              onDayMenu(day, e.clientX, e.clientY);
            }}
          />
        ))}
      </div>

      {editing && (
        <CycleGroupModal
          settingId={settingId}
          campaignId={editing === "new" ? campaignId : editing.campaign_id}
          cycles={cycles}
          group={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(id) => {
            setEditing(null);
            if (id != null) setGroupId(id);
            else setGroupId(ALL);
          }}
        />
      )}
    </section>
  );
}

function CycleLane({ segments, xOf }: { segments: CycleSegment[]; xOf: (day: number) => number }) {
  return (
    <>
      {segments.map((seg) => {
        const x = xOf(seg.start);
        const width = xOf(seg.start + seg.days) - x;
        const key = `${seg.start}-${seg.index}`;
        if (seg.days === 1) {
          return (
            <span key={key} className="cycle-lane__mark" style={{ left: x }} title={seg.name}>
              {seg.name}
            </span>
          );
        }
        // На мелком масштабе отрезок шире экрана — подпись держится у левого
        // края видимой части, а не уезжает вместе с началом.
        const hidden = Math.max(0, -x);
        return (
          <span key={key} className={`cycle-lane__phase${seg.index % 2 ? " is-alt" : ""}`} style={{ left: x, width }} title={seg.name}>
            {width - hidden > LABEL_PX && <span style={{ marginLeft: hidden }}>{seg.name}</span>}
          </span>
        );
      })}
    </>
  );
}

function CycleGroupModal({
  settingId,
  campaignId,
  cycles,
  group,
  onClose,
  onSaved,
}: {
  settingId: number;
  /** Владелец группы: кампания или null — сеттинг. */
  campaignId: number | null;
  cycles: SettingCycle[];
  group: SettingCycleGroup | null;
  onClose: () => void;
  /** id созданной/изменённой группы, null — удалена. */
  onSaved: (id: number | null) => void;
}) {
  const [name, setName] = useState(group?.name ?? "");
  const [picked, setPicked] = useState<number[]>(group?.cycle_ids ?? []);
  const [confirmDialog, confirm] = useConfirm();
  const run = useAction();
  const affects = [{ path: chroniclePaths.cycleGroups(settingId) }];
  // Группа сеттинга берёт только циклы сеттинга — сервер отбросил бы остальные.
  const allowed = campaignId == null ? cycles.filter((c) => c.campaign_id == null) : cycles;

  async function save() {
    if (!name.trim()) return;
    const body = { name: name.trim(), cycle_ids: picked, campaign_id: campaignId };
    const saved = await run(
      () =>
        (group
          ? write.put<SettingCycleGroup>(`/settings/cycle-groups/${group.id}`, body)
          : write.post<SettingCycleGroup>(chroniclePaths.cycleGroups(settingId), body)),
      { affects, retry: false }
    );
    if (saved) onSaved(saved.id);
  }

  async function remove() {
    if (!group || !(await confirm(`Удалить группу «${group.name}»? Циклы останутся.`))) return;
    const done = await run(() => write.del(`/settings/cycle-groups/${group.id}`).then(() => true), { affects });
    if (done) onSaved(null);
  }

  return (
    <Modal onClose={onClose} ariaLabel={group ? "Группа циклов" : "Новая группа циклов"}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <h3>{group ? "Группа циклов" : "Новая группа циклов"}</h3>
        <input placeholder="Название (Небо)" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="stack cycle-group-modal__list">
          {allowed.map((c) => (
            <label key={c.id} className="row">
              <input
                type="checkbox"
                checked={picked.includes(c.id)}
                onChange={() => setPicked((p) => (p.includes(c.id) ? p.filter((id) => id !== c.id) : [...p, c.id]))}
              />
              {c.name}
              <span className="muted">{c.period_days} дн.</span>
            </label>
          ))}
        </div>
        <div className="row">
          <button type="submit" className="primary" disabled={!name.trim()}>
            {group ? "Сохранить" : "Создать"}
          </button>
          <button type="button" onClick={onClose}>
            Отмена
          </button>
          {group && (
            <button type="button" className="danger" onClick={remove}>
              Удалить группу
            </button>
          )}
        </div>
      </form>
      {confirmDialog}
    </Modal>
  );
}
