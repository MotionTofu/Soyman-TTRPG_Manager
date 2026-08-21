import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import type { SettingCycle } from "../types";

// Циклы сеттинга: «каждые N дней, начиная с такой-то даты», с именованными
// точками внутри — «полнолуние» на 14-м дне, «новолуние» на 28-м.
//
// Обобщённо, а не «луна с фазами»: приложению не нужно знать, что такое луна,
// ему нужно считать «каждые N дней» и подписывать точки. Тогда та же механика
// берёт приливы, ярмарку раз в десять дней, смену стражи и мир с двумя лунами
// разного периода.
//
// Живёт рядом с календарём, а не своей вкладкой: цикл — устройство мира,
// ровно как длина месяца, его заводят один раз и потом не трогают.

export function SettingCycles({ settingId }: { settingId: number }) {
  const [cycles, setCycles] = useState<SettingCycle[]>([]);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: "", period_days: "28", year: "1", month: "1", day: "1" });

  const refresh = useCallback(() => {
    api.get<SettingCycle[]>(`/settings/${settingId}/cycles`).then(setCycles);
  }, [settingId]);
  useEffect(refresh, [refresh]);

  async function create() {
    if (!draft.name.trim() || !Number(draft.period_days)) return;
    await api.post(`/settings/${settingId}/cycles`, {
      name: draft.name.trim(),
      period_days: Number(draft.period_days),
      anchor_year: Number(draft.year) || 1,
      anchor_month: Number(draft.month) || 1,
      anchor_day: Number(draft.day) || 1,
    });
    setDraft({ name: "", period_days: "28", year: "1", month: "1", day: "1" });
    setAdding(false);
    refresh();
  }

  return (
    <div className="card stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h3 style={{ margin: 0 }}>Циклы</h3>
        <button onClick={() => setAdding((v) => !v)}>+ Добавить цикл</button>
      </div>
      <span className="muted">
        Всё, что повторяется каждые N дней: луна, приливы, ярмарка, смена
        стражи. Точки внутри оборота — «полнолуние» на 14-м дне. На оси времени
        показываются на масштабах дня и месяца.
      </span>

      {adding && (
        <div className="row" style={{ flexWrap: "wrap" }}>
          <input
            placeholder="Название (Луна)"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <input
            type="number"
            style={{ width: 110 }}
            placeholder="Дней"
            title="Длина оборота в днях"
            value={draft.period_days}
            onChange={(e) => setDraft({ ...draft, period_days: e.target.value })}
          />
          <span className="muted">отсчёт с</span>
          <input
            type="number"
            style={{ width: 90 }}
            placeholder="Год"
            value={draft.year}
            onChange={(e) => setDraft({ ...draft, year: e.target.value })}
          />
          <input
            type="number"
            style={{ width: 70 }}
            placeholder="Мес."
            value={draft.month}
            onChange={(e) => setDraft({ ...draft, month: e.target.value })}
          />
          <input
            type="number"
            style={{ width: 70 }}
            placeholder="День"
            value={draft.day}
            onChange={(e) => setDraft({ ...draft, day: e.target.value })}
          />
          <button className="primary" onClick={create}>
            Добавить
          </button>
        </div>
      )}

      {cycles.map((cycle) => (
        <CycleRow key={cycle.id} cycle={cycle} onChanged={refresh} />
      ))}
      {cycles.length === 0 && <span className="muted">Циклов пока нет.</span>}
    </div>
  );
}

function CycleRow({ cycle, onChanged }: { cycle: SettingCycle; onChanged: () => void }) {
  const [pointName, setPointName] = useState("");
  const [pointDay, setPointDay] = useState("");
  const [error, setError] = useState("");

  async function addPoint() {
    if (!pointName.trim() || pointDay === "") return;
    try {
      setError("");
      await api.post(`/settings/cycles/${cycle.id}/points`, {
        name: pointName.trim(),
        day_offset: Number(pointDay),
      });
      setPointName("");
      setPointDay("");
      onChanged();
    } catch (e) {
      // День за пределами оборота сервер не принимает: свернуть его по модулю
      // значило бы поставить точку не туда, где Мастер её ждёт.
      setError(e instanceof Error ? e.message : "не вышло");
    }
  }

  return (
    <div className="stack" style={{ gap: 4, borderLeft: "2px solid var(--line)", paddingLeft: 9 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span>
          <strong>{cycle.name}</strong>{" "}
          <span className="muted">
            каждые {cycle.period_days} дн., отсчёт с {cycle.anchor_day}.{cycle.anchor_month}.
            {cycle.anchor_year}
          </span>
        </span>
        <button
          className="danger"
          onClick={async () => {
            if (!confirm(`Удалить цикл «${cycle.name}»?`)) return;
            await api.del(`/settings/cycles/${cycle.id}`);
            onChanged();
          }}
        >
          ✕
        </button>
      </div>

      {cycle.points.map((p) => (
        <div key={p.id} className="row" style={{ justifyContent: "space-between" }}>
          <span className="muted">
            {p.name} — день {p.day_offset}
          </span>
          <button
            className="comp-mini danger"
            onClick={async () => {
              await api.del(`/settings/cycle-points/${p.id}`);
              onChanged();
            }}
          >
            ✕
          </button>
        </div>
      ))}

      <div className="row">
        <input
          placeholder="Точка (Полнолуние)"
          value={pointName}
          onChange={(e) => setPointName(e.target.value)}
        />
        <input
          type="number"
          style={{ width: 90 }}
          placeholder="День"
          title={`От 0 до ${cycle.period_days - 1}`}
          value={pointDay}
          onChange={(e) => setPointDay(e.target.value)}
        />
        <button onClick={addPoint}>Добавить точку</button>
      </div>
      {error && <span className="muted">{error}</span>}
    </div>
  );
}
