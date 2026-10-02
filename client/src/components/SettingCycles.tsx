import { useState } from "react";
import { Link } from "react-router-dom";
import { useAction, useResource, write } from "../data/hooks";
import { chroniclePaths } from "../data/settingPage";
import { useConfirm } from "../hooks/useConfirm";
import { elapsedDays } from "../inworldCalendar";
import { cycleElements, dayInTurn, elementDays } from "../cycles";
import { RowDeleteButton, RowEditButton } from "./RowIconButtons";
// Раздел живёт и в кампании, а её страница грузится отдельно от сеттинга.
import "../pages/setting-profile.css";
import type { CalendarMonth, SettingCycle, SettingCyclePoint } from "../types";

// Циклы сеттинга: «каждые N дней, начиная с такой-то даты», с элементами
// внутри оборота — отрезками («полнолуние» 14–16) или отметками одного дня.
//
// Обобщённо, а не «луна с фазами»: приложению не нужно знать, что такое луна,
// ему нужно считать «каждые N дней» и подписывать элементы. Тогда та же
// механика берёт приливы, ярмарку раз в десять дней, смену стражи и мир с
// двумя лунами разного периода.
//
// Разбор 2026-10-02: вне правки цикл — полоса одного оборота с подписями,
// шкалой дней и «сейчас» (Q1); карандаш открывает правку одного цикла (Q2);
// начало и конец элемента ставятся щелчками по полосе или числами (Q6).
//
// В кампании (ось кампании, Q9–Q13) раздел тот же: свои циклы кампании
// правятся, циклы сеттинга ниже — только для чтения, со ссылкой в сеттинг;
// свой цикл можно перенести в сеттинг.

type Now = { year: number | null; month: number | null };

// Циклы читаются тем же путём, что берёт ось хроники: добавленный здесь цикл
// появляется на оси сразу, без перезагрузки страницы.
export function SettingCycles({
  settingId,
  campaignId = null,
  months = [],
  now = { year: null, month: null },
}: {
  settingId: number;
  campaignId?: number | null;
  months?: CalendarMonth[];
  now?: Now;
}) {
  // Правки задевают базовый путь — он покрывает и вариант с ?campaign=.
  const cyclesPath = chroniclePaths.cycles(settingId);
  const all = useResource<SettingCycle[]>(chroniclePaths.cycles(settingId, campaignId)).data ?? [];
  const own = all.filter((c) => c.campaign_id === campaignId);
  const inherited = campaignId == null ? [] : all.filter((c) => c.campaign_id == null);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState({ name: "", period_days: "28", year: "1", month: "1", day: "1" });
  const run = useAction();

  async function create() {
    if (!draft.name.trim() || !Number(draft.period_days)) return;
    // Повтор создал бы второй цикл; при отказе набранное остаётся.
    const created = await run(
      () =>
        write.post<SettingCycle>(cyclesPath, {
          name: draft.name.trim(),
          period_days: Number(draft.period_days),
          anchor_year: Number(draft.year) || 1,
          anchor_month: Number(draft.month) || 1,
          anchor_day: Number(draft.day) || 1,
          campaign_id: campaignId,
        }),
      { affects: [{ path: cyclesPath }], retry: false }
    );
    if (!created) return;
    setDraft({ name: "", period_days: "28", year: "1", month: "1", day: "1" });
    setAdding(false);
    // Новый цикл сразу в правке: без элементов ему нечего показывать.
    setEditingId(created.id);
  }

  return (
    <div className="card stack chronicle-panel paper-scope">
      <div className="row cycle-list__head">
        <h3>Циклы</h3>
        <button onClick={() => setAdding((v) => !v)}>+ Добавить цикл</button>
      </div>
      <span className="muted">
        Всё, что повторяется каждые N дней: луна, приливы, ярмарка, смена
        стражи. Элементы оборота — отрезки («полнолуние» с 14-го по 16-й день)
        или отметки одного дня.
        {campaignId != null && " Здесь — циклы только этой кампании; циклы мира живут в сеттинге."}
      </span>

      {adding && (
        <div className="row cycle-form">
          <input placeholder="Название (Луна)" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <label className="row">
            дней
            <input type="number" className="cycle-form__num" title="Длина оборота в днях" value={draft.period_days} onChange={(e) => setDraft({ ...draft, period_days: e.target.value })} />
          </label>
          <span className="muted">отсчёт с</span>
          <input type="number" className="cycle-form__num" placeholder="Год" value={draft.year} onChange={(e) => setDraft({ ...draft, year: e.target.value })} />
          <input type="number" className="cycle-form__num" placeholder="Мес." value={draft.month} onChange={(e) => setDraft({ ...draft, month: e.target.value })} />
          <input type="number" className="cycle-form__num" placeholder="День" value={draft.day} onChange={(e) => setDraft({ ...draft, day: e.target.value })} />
          <button className="primary" onClick={create}>
            Добавить
          </button>
        </div>
      )}

      {own.map((cycle) =>
        editingId === cycle.id ? (
          <CycleEditor key={cycle.id} cycle={cycle} cyclesPath={cyclesPath} months={months} now={now} onDone={() => setEditingId(null)} />
        ) : (
          <CycleView
            key={cycle.id}
            cycle={cycle}
            cyclesPath={cyclesPath}
            months={months}
            now={now}
            // Правится один цикл за раз (Q2).
            onEdit={editingId == null ? () => setEditingId(cycle.id) : undefined}
          />
        )
      )}
      {own.length === 0 && <span className="muted">{campaignId != null ? "Своих циклов у кампании нет." : "Циклов пока нет."}</span>}

      {inherited.length > 0 && (
        <>
          <div className="row cycle-list__head">
            <h3>Из сеттинга</h3>
            <Link to={`/settings/${settingId}?tab=${encodeURIComponent("Хроника")}`}>править в сеттинге ›</Link>
          </div>
          {inherited.map((cycle) => (
            <CycleView key={cycle.id} cycle={cycle} cyclesPath={cyclesPath} months={months} now={now} readOnly />
          ))}
        </>
      )}
    </div>
  );
}

/** День «сейчас» внутри оборота; «сейчас» сеттинга знает только год и месяц. */
function nowInTurn(cycle: SettingCycle, months: CalendarMonth[], now: Now): number | null {
  if (now.year == null || months.length === 0 || cycle.period_days < 1) return null;
  const anchor = elapsedDays(cycle.anchor_year, cycle.anchor_month, cycle.anchor_day, months);
  return dayInTurn(elapsedDays(now.year, now.month ?? 1, 1, months), anchor, cycle.period_days);
}

function CycleView({
  cycle,
  cyclesPath,
  months,
  now,
  onEdit,
  readOnly = false,
}: {
  cycle: SettingCycle;
  cyclesPath: string;
  months: CalendarMonth[];
  now: Now;
  onEdit?: () => void;
  /** Цикл сеттинга на странице кампании — смотреть, не править. */
  readOnly?: boolean;
}) {
  const [confirmDialog, confirm] = useConfirm();
  const run = useAction();
  return (
    <div className="cycle-card">
      <div className="cycle-card__head">
        <strong>{cycle.name}</strong>
        <span className="muted">
          каждые {cycle.period_days} дн., отсчёт с {cycle.anchor_day}.{cycle.anchor_month}.{cycle.anchor_year}
        </span>
        {!readOnly && (
        <span className="cycle-card__actions">
          {onEdit && <RowEditButton label={`Править цикл «${cycle.name}»`} onClick={onEdit} />}
          <RowDeleteButton
            label={`Удалить цикл «${cycle.name}»`}
            onClick={async () => {
              if (!(await confirm(`Удалить цикл «${cycle.name}»?`))) return;
              await run(() => write.del(`/settings/cycles/${cycle.id}`).then(() => true), {
                affects: [{ path: cyclesPath }, { path: chroniclePaths.cycleGroups(cycle.setting_id) }],
              });
            }}
          />
        </span>
        )}
      </div>
      <CycleStrip period={cycle.period_days} elements={cycleElements(cycle)} nowDay={nowInTurn(cycle, months, now)} />
      {confirmDialog}
    </div>
  );
}

type Element = Pick<SettingCyclePoint, "name" | "day_offset" | "day_end">;

/** Полоса одного оборота во всю ширину. Отрезок через конец оборота — двумя кусками. */
function CycleStrip({
  period,
  elements,
  nowDay,
  pending,
  onDay,
}: {
  period: number;
  elements: Element[];
  nowDay: number | null;
  /** Набираемый элемент: где уже щёлкнули. */
  pending?: { start: number | null; end: number | null };
  onDay?: (day: number) => void;
}) {
  if (period < 1) return null;
  const pct = (day: number) => `${(day / period) * 100}%`;
  const step = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].find((s) => period / s <= 10) ?? 1000;
  const ticks: number[] = [];
  for (let d = 0; d < period; d += step) ticks.push(d);
  const pieces = (start: number, days: number) =>
    start + days <= period ? [[start, days]] : [[start, period - start], [0, start + days - period]];

  return (
    <div
      className={`cycle-strip${onDay ? " is-editing" : ""}`}
      onClick={
        onDay
          ? (e) => {
              const r = e.currentTarget.getBoundingClientRect();
              onDay(Math.min(period - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * period))));
            }
          : undefined
      }
    >
      {elements.map((el, i) => {
        const days = elementDays(el, period);
        if (days === 1) {
          return (
            <span key={i} className="cycle-strip__mark" style={{ left: pct(el.day_offset) }} title={`${el.name}: день ${el.day_offset}`}>
              {el.name}
            </span>
          );
        }
        return pieces(el.day_offset, days).map(([start, len], j) => (
          <span
            key={`${i}-${j}`}
            className={`cycle-strip__band${i % 2 ? " is-alt" : ""}`}
            style={{ left: pct(start), width: pct(len) }}
            title={`${el.name}: ${el.day_offset}–${el.day_end}`}
          >
            {j === 0 && el.name}
          </span>
        ));
      })}
      {pending?.start != null && <span className="cycle-strip__pending" style={{ left: pct(pending.start), width: pct(pending.end != null ? elementDays({ day_offset: pending.start, day_end: pending.end }, period) : 1) }} />}
      {nowDay != null && <span className="cycle-strip__now" style={{ left: pct(nowDay + 0.5) }} title={`Сейчас — день ${nowDay}`} />}
      <span className="cycle-strip__scale">
        {ticks.map((d) => (
          <span key={d} style={{ left: pct(d) }}>
            {d}
          </span>
        ))}
      </span>
    </div>
  );
}

type Row = { id: number; name: string; start: string; end: string };
const rowOf = (p: SettingCyclePoint): Row => ({ id: p.id, name: p.name, start: String(p.day_offset), end: p.day_end == null ? "" : String(p.day_end) });

function CycleEditor({
  cycle,
  cyclesPath,
  months,
  now,
  onDone,
}: {
  cycle: SettingCycle;
  cyclesPath: string;
  months: CalendarMonth[];
  now: Now;
  onDone: () => void;
}) {
  const [head, setHead] = useState({
    name: cycle.name,
    period: String(cycle.period_days),
    year: String(cycle.anchor_year),
    month: String(cycle.anchor_month),
    day: String(cycle.anchor_day),
  });
  // Набранное в строках элементов держится до «Готово»; новые и удалённые
  // элементы пишутся сразу — их видно на полосе.
  const [edits, setEdits] = useState<Record<number, Row>>({});
  const [draft, setDraft] = useState({ name: "", start: "", end: "" });
  const run = useAction();
  const [confirmDialog, confirm] = useConfirm();
  const affects = [{ path: cyclesPath }];
  const period = Number(head.period) || cycle.period_days;

  async function toSetting() {
    if (!(await confirm(`Перенести цикл «${cycle.name}» в сеттинг? Его увидят все кампании этого сеттинга.`))) return;
    const done = await run(() => write.post(`/settings/cycles/${cycle.id}/to-setting`).then(() => true), { affects });
    if (done) onDone();
  }

  const rows = cycle.points.map((p) => edits[p.id] ?? rowOf(p));
  const toEnd = (v: string) => (v.trim() === "" ? null : Number(v));
  const preview: Element[] = rows.map((r) => ({ name: r.name, day_offset: Number(r.start) || 0, day_end: toEnd(r.end) }));

  // Q6: первый щелчок — начало, второй — конец, третий — заново.
  function onDay(day: number) {
    setDraft((d) => (d.start === "" || d.end !== "" ? { ...d, start: String(day), end: "" } : { ...d, end: String(day) }));
  }

  async function addElement() {
    if (!draft.name.trim() || draft.start === "") return;
    const done = await run(
      () => write.post(`/settings/cycles/${cycle.id}/points`, { name: draft.name.trim(), day_offset: Number(draft.start), day_end: toEnd(draft.end) }).then(() => true),
      { affects, retry: false }
    );
    if (done) setDraft({ name: "", start: "", end: "" });
  }

  async function finish() {
    const cycleBody: Record<string, unknown> = {};
    if (head.name.trim() && head.name.trim() !== cycle.name) cycleBody.name = head.name.trim();
    if (Number(head.period) >= 1 && Number(head.period) !== cycle.period_days) cycleBody.period_days = Number(head.period);
    if (Number(head.year) !== cycle.anchor_year) cycleBody.anchor_year = Number(head.year) || 1;
    if (Number(head.month) !== cycle.anchor_month) cycleBody.anchor_month = Number(head.month) || 1;
    if (Number(head.day) !== cycle.anchor_day) cycleBody.anchor_day = Number(head.day) || 1;
    const changed = Object.values(edits).filter((r) => {
      const p = cycle.points.find((x) => x.id === r.id);
      return p && (r.name !== p.name || Number(r.start) !== p.day_offset || toEnd(r.end) !== p.day_end);
    });
    const done = await run(
      async () => {
        if (Object.keys(cycleBody).length) await write.put(`/settings/cycles/${cycle.id}`, cycleBody);
        for (const r of changed) {
          await write.put(`/settings/cycle-points/${r.id}`, { name: r.name, day_offset: Number(r.start), day_end: toEnd(r.end) });
        }
        return true;
      },
      { affects }
    );
    if (done) onDone();
  }

  return (
    <div className="cycle-card is-editing">
      <div className="row cycle-form">
        <input aria-label="Название цикла" value={head.name} onChange={(e) => setHead({ ...head, name: e.target.value })} />
        <label className="row">
          дней
          <input type="number" className="cycle-form__num" value={head.period} onChange={(e) => setHead({ ...head, period: e.target.value })} />
        </label>
        <span className="muted">отсчёт с</span>
        <input type="number" className="cycle-form__num" aria-label="Год отсчёта" value={head.year} onChange={(e) => setHead({ ...head, year: e.target.value })} />
        <input type="number" className="cycle-form__num" aria-label="Месяц отсчёта" value={head.month} onChange={(e) => setHead({ ...head, month: e.target.value })} />
        <input type="number" className="cycle-form__num" aria-label="День отсчёта" value={head.day} onChange={(e) => setHead({ ...head, day: e.target.value })} />
      </div>

      <CycleStrip
        period={period}
        elements={preview}
        nowDay={nowInTurn({ ...cycle, period_days: period }, months, now)}
        pending={draft.start === "" ? undefined : { start: Number(draft.start), end: toEnd(draft.end) }}
        onDay={onDay}
      />
      <span className="muted">Щёлкните по полосе: первый раз — начало нового элемента, второй — конец. Без конца — отметка одного дня.</span>

      <div className="cycle-elements">
        {rows.map((r) => (
          <div key={r.id} className="cycle-elements__row">
            <input aria-label="Название элемента" value={r.name} onChange={(e) => setEdits({ ...edits, [r.id]: { ...r, name: e.target.value } })} />
            <label className="row">
              с
              <input type="number" className="cycle-form__num" value={r.start} onChange={(e) => setEdits({ ...edits, [r.id]: { ...r, start: e.target.value } })} />
            </label>
            <label className="row">
              по
              <input type="number" className="cycle-form__num" placeholder="—" value={r.end} onChange={(e) => setEdits({ ...edits, [r.id]: { ...r, end: e.target.value } })} />
            </label>
            <button
              type="button"
              className="row-icon row-icon--cross"
              title={`Убрать «${r.name}»`}
              aria-label={`Убрать «${r.name}»`}
              onClick={() => void run(() => write.del(`/settings/cycle-points/${r.id}`).then(() => true), { affects })}
            />
          </div>
        ))}
        <div className="cycle-elements__row is-new">
          <input placeholder="Новый элемент (Полнолуние)" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <label className="row">
            с
            <input type="number" className="cycle-form__num" value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} />
          </label>
          <label className="row">
            по
            <input type="number" className="cycle-form__num" placeholder="—" value={draft.end} onChange={(e) => setDraft({ ...draft, end: e.target.value })} />
          </label>
          <button type="button" onClick={addElement} disabled={!draft.name.trim() || draft.start === ""}>
            Добавить
          </button>
        </div>
      </div>
      <span className="muted">Дни считаются с нуля: от 0 до {period - 1}. «По» меньше «с» — отрезок через конец оборота.</span>

      <div className="row">
        <button className="primary" onClick={finish}>
          Готово
        </button>
        <button onClick={onDone}>Отмена</button>
        {cycle.campaign_id != null && (
          <button type="button" className="cycle-card__to-setting" onClick={() => void toSetting()}>
            Перенести в сеттинг
          </button>
        )}
      </div>
      {confirmDialog}
    </div>
  );
}
