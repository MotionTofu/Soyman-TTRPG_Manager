import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { GmReminder, InitiativeEntry } from "../types";

// Цели для меток (Метка охотника / Сглаз): живут в панели «Напоминания»
// пульта сессии, рядом с самими напоминалками.
//
// Поток: игрок заявляет метку кнопкой в карточке заклинания → сервер кладёт
// напоминалку кампании «🏹 Имя: Метка — вешает. Цель не выбрана» и шлёт живое
// событие (панель перечитывается и подсвечивает новую). Мастер выбирает цель
// из инициативы сессии или вписывает строкой → прицел пишется condition-кой
// «Метка охотника: Имя» / «Сглаз: Имя» на строку цели (трекер рисует ⌖ по
// префиксу), а напоминалка пересоздаётся с текстом цели. Перевешивание снимает
// старый прицел того же кастера со всех строк само. Снятие прицела и удаление
// напоминалки — руками (вариант «а»): крестик и пикер состояний трекера.

const MARK_PREFIX = "🏹 ";

function parseConditions(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((c): c is string => typeof c === "string") : [];
  } catch {
    return [];
  }
}

interface ParsedMark {
  reminder: GmReminder;
  caster: string;
  spell: string;
  mode: string;
}

function parseMark(r: GmReminder): ParsedMark | null {
  if (!r.message.startsWith(MARK_PREFIX)) return null;
  const m = /^🏹 (.*?): (Метка охотника|Сглаз) — (.*?)(?:\. Цель: (.*))?\.$/.exec(r.message.trim());
  if (!m) return { reminder: r, caster: "", spell: "", mode: "" };
  return { reminder: r, caster: m[1], spell: m[2], mode: m[3] };
}

export function MarkTargetPicker({ sessionId, campaignId }: { sessionId: number; campaignId: number }) {
  const [reminders, setReminders] = useState<GmReminder[]>([]);
  const [entries, setEntries] = useState<InitiativeEntry[]>([]);
  const [targetByReminder, setTargetByReminder] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);

  function refresh() {
    api.get<GmReminder[]>(`/campaigns/${campaignId}/reminders`).then((rows) => {
      setReminders(rows.filter((r) => r.message.startsWith(MARK_PREFIX)));
    });
    api.get<InitiativeEntry[]>(`/initiative-entries?session_id=${sessionId}`).then(setEntries);
  }
  useEffect(refresh, [sessionId, campaignId]);
  useEffect(() => {
    const handler = () => refresh();
    window.addEventListener("hunter-mark", handler);
    return () => window.removeEventListener("hunter-mark", handler);
  }, [sessionId, campaignId]);

  const marks = reminders.map(parseMark).filter((m): m is ParsedMark => m != null && !!m.caster);
  if (marks.length === 0) return null;

  // Прицел кастера: префикс «Метка охотника: Имя» / «Сглаз: Имя».
  const markLabel = (mark: ParsedMark) => `${mark.spell}: ${mark.caster}`;

  async function applyTarget(mark: ParsedMark, targetName: string) {
    const name = targetName.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const label = markLabel(mark);
      const live = await api.get<InitiativeEntry[]>(`/initiative-entries?session_id=${sessionId}`);
      // Старый прицел этого кастера снимаем со всех строк (перевешивание),
      // новый ставим только на строку с совпавшим именем — вписанное вручную
      // имя может не совпасть ни с чем, тогда прицела в трекере не будет, но
      // напоминалка цель запомнит.
      for (const e of live) {
        const cur = parseConditions(e.conditions);
        const cleaned = cur.filter((c) => c !== label && !c.startsWith(`${label} →`));
        const next =
          e.name.trim().toLowerCase() === name.toLowerCase() && !cleaned.includes(label)
            ? [...cleaned, label]
            : cleaned;
        if (next.length !== cur.length || next.some((c, i) => c !== cur[i])) {
          await api.put(`/initiative-entries/${e.id}`, { conditions: next });
        }
      }
      const base = `🏹 ${mark.caster}: ${mark.spell} — ${mark.mode}. Цель: ${name}.`;
      await api.del(`/campaigns/${campaignId}/reminders/${mark.reminder.id}`);
      await api.post(`/campaigns/${campaignId}/reminders`, { message: base });
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function clearMark(mark: ParsedMark) {
    if (busy) return;
    setBusy(true);
    try {
      const label = markLabel(mark);
      const live = await api.get<InitiativeEntry[]>(`/initiative-entries?session_id=${sessionId}`);
      for (const e of live) {
        const cur = parseConditions(e.conditions);
        const next = cur.filter((c) => c !== label && !c.startsWith(`${label} →`));
        if (next.length !== cur.length) {
          await api.put(`/initiative-entries/${e.id}`, { conditions: next });
        }
      }
      await api.del(`/campaigns/${campaignId}/reminders/${mark.reminder.id}`);
      refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      {marks.map((mark) => (
        <div key={mark.reminder.id} className="card" style={{ padding: "8px" }}>
          <div style={{ whiteSpace: "pre-wrap" }}>{mark.reminder.message}</div>
          <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 6 }}>
            <select
              value={targetByReminder[mark.reminder.id] ?? ""}
              onChange={(e) => setTargetByReminder((prev) => ({ ...prev, [mark.reminder.id]: e.target.value }))}
              aria-label="Цель из инициативы"
            >
              <option value="">— из инициативы —</option>
              {entries.map((e) => (
                <option key={e.id} value={e.name}>
                  {e.name}
                </option>
              ))}
            </select>
            <input
              placeholder="или строкой…"
              value={targetByReminder[mark.reminder.id] ?? ""}
              onChange={(e) => setTargetByReminder((prev) => ({ ...prev, [mark.reminder.id]: e.target.value }))}
              style={{ flex: 1, minWidth: 120 }}
            />
            <button
              type="button"
              className="primary comp-mini"
              disabled={busy || !(targetByReminder[mark.reminder.id] ?? "").trim()}
              onClick={() => applyTarget(mark, targetByReminder[mark.reminder.id] ?? "")}
            >
              Назначить
            </button>
            <button
              type="button"
              className="comp-mini"
              disabled={busy}
              title="Снять прицел и удалить напоминалку"
              onClick={() => clearMark(mark)}
            >
              Снять
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
