import { useState } from "react";
import { errorText, useAfterWrite, useResource, write } from "../data/hooks";
import { readResource } from "../data/imperative";
import { showSaveError } from "../data/notices";
import { remindersPath } from "../data/sessions";
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
const NO_REMINDERS: GmReminder[] = [];
const NO_ENTRIES: InitiativeEntry[] = [];

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
  // Напоминалки кампании и очередь инициативы — из кэша слоя данных: заявка
  // игрока (событие hunter-mark) и правки очереди перечитывают их сами
  // (data/syncAffects.ts), своих слушателей здесь больше нет. Список
  // напоминалок — тот же ключ, что у виджета напоминаний рядом.
  const reminderListPath = remindersPath("campaign", campaignId);
  const entriesPath = `/initiative-entries?session_id=${sessionId}`;
  const reminders = useResource<GmReminder[]>(reminderListPath).data ?? NO_REMINDERS;
  const entries = useResource<InitiativeEntry[]>(entriesPath).data ?? NO_ENTRIES;
  const afterWrite = useAfterWrite();
  const [targetByReminder, setTargetByReminder] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);

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
      // Очередь — свежая, мимо кэша: поверх неё сразу пишут прицелы.
      const live = await readResource<InitiativeEntry[]>(entriesPath, { fresh: true });
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
          await write.put(`/initiative-entries/${e.id}`, { conditions: next });
        }
      }
      const base = `🏹 ${mark.caster}: ${mark.spell} — ${mark.mode}. Цель: ${name}.`;
      await write.del(`${reminderListPath}/${mark.reminder.id}`);
      await write.post(reminderListPath, { message: base });
    } catch (e) {
      showSaveError(`Цель метки не назначилась: ${errorText(e)}`);
    } finally {
      afterWrite([{ path: reminderListPath }, { path: entriesPath }]);
      setBusy(false);
    }
  }

  async function clearMark(mark: ParsedMark) {
    if (busy) return;
    setBusy(true);
    try {
      const label = markLabel(mark);
      const live = await readResource<InitiativeEntry[]>(entriesPath, { fresh: true });
      for (const e of live) {
        const cur = parseConditions(e.conditions);
        const next = cur.filter((c) => c !== label && !c.startsWith(`${label} →`));
        if (next.length !== cur.length) {
          await write.put(`/initiative-entries/${e.id}`, { conditions: next });
        }
      }
      await write.del(`${reminderListPath}/${mark.reminder.id}`);
    } catch (e) {
      showSaveError(`Метка не снялась: ${errorText(e)}`);
    } finally {
      afterWrite([{ path: reminderListPath }, { path: entriesPath }]);
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
