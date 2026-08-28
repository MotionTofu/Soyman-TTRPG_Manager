import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import { api } from "../api/client";

// «Привести справочник в порядок»: три шага в одном окне.
//
// План — сколько работы нашлось, числами. Сверка — что переносить в
// «Транспорт»: список короткий, разовый, и решение по каждой строке своё,
// поэтому здесь галочки, а не общее «да». Отчёт — что записалось и что не
// разобралось; списки короткие, читаются целиком, кнопка «Скопировать» — для
// тех, кто разбирает найденное потом.

export interface MoveCandidate {
  id: number;
  name: string;
  from: string;
  hint: string;
  targetKind: "vehicle" | "vehicle_post";
  suggested: boolean;
}

interface TidyPlan {
  vehicleSectionId: number | null;
  bestiary: { entries: number; size: number; creatureType: number; cr: number; alignment: number };
  vehicles: { entries: number; fields: number };
  candidates: MoveCandidate[];
}

interface TidyReport {
  bestiary: {
    changed: number;
    size: number;
    creatureType: number;
    cr: number;
    alignment: number;
    conflicts: { name: string; field: string; entry: string; statblock: string }[];
    unknownTypes: { name: string; word: string }[];
    noStatblock: string[];
  };
  vehicles: { changed: number; fields: number; noCategory: string[] };
  moved: { name: string; from: string; to: string }[];
  vehicleSectionMissing: boolean;
}

const plural = (n: number, one: string, few: string, many: string) => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
};

const entries = (n: number) => `${n} ${plural(n, "запись", "записи", "записей")}`;

function reportText(report: TidyReport): string {
  const lines: string[] = [];
  lines.push("Бестиарий:");
  lines.push(
    report.bestiary.changed
      ? `  заполнено ${entries(report.bestiary.changed)} — размер ${report.bestiary.size}, тип ${report.bestiary.creatureType}, класс опасности ${report.bestiary.cr}, мировоззрение ${report.bestiary.alignment}`
      : "  нечего заполнять"
  );
  if (report.bestiary.conflicts.length) {
    lines.push(`  расходится со статблоком (оставлено как было) — ${report.bestiary.conflicts.length}:`);
    for (const c of report.bestiary.conflicts)
      lines.push(`    ${c.name}: ${c.field} — в записи «${c.entry}», в статблоке «${c.statblock}»`);
  }
  if (report.bestiary.unknownTypes.length) {
    lines.push(`  тип не опознан — ${report.bestiary.unknownTypes.length}:`);
    for (const u of report.bestiary.unknownTypes) lines.push(`    ${u.name}: «${u.word}»`);
  }
  if (report.bestiary.noStatblock.length) {
    lines.push(`  без D&D-статблока — ${report.bestiary.noStatblock.length}:`);
    for (const n of report.bestiary.noStatblock) lines.push(`    ${n}`);
  }
  lines.push("Транспорт:");
  lines.push(
    report.vehicles.changed
      ? `  разобрано ${entries(report.vehicles.changed)}, заполнено полей: ${report.vehicles.fields}`
      : "  нечего разбирать"
  );
  if (report.vehicles.noCategory.length) {
    lines.push(`  категория не определена — ${report.vehicles.noCategory.length}:`);
    for (const n of report.vehicles.noCategory) lines.push(`    ${n}`);
  }
  lines.push(
    report.moved.length ? `Перенесено ${entries(report.moved.length)}:` : "Перенос: ничего не отмечено"
  );
  for (const m of report.moved) lines.push(`  ${m.name} — из «${m.from}»`);
  return lines.join("\n");
}

export function TidyCompendiumDialog({ systemId, onClose }: { systemId: number; onClose: () => void }) {
  const [plan, setPlan] = useState<TidyPlan | null>(null);
  const [step, setStep] = useState<"plan" | "candidates" | "report">("plan");
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [report, setReport] = useState<TidyReport | null>(null);
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.get<TidyPlan>(`/systems/${systemId}/tidy`).then((p) => {
      setPlan(p);
      setChecked(new Set(p.candidates.filter((c) => c.suggested).map((c) => c.id)));
    });
  }, [systemId]);

  async function run() {
    setRunning(true);
    const result = await api.post<TidyReport>(`/systems/${systemId}/tidy`, {
      move_ids: [...checked],
    });
    setReport(result);
    setStep("report");
    setRunning(false);
  }

  function toggle(id: number) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Modal onClose={onClose}>
      <h3>Привести справочник в порядок</h3>

      {!plan && <p className="muted">Считаю…</p>}

      {plan && step === "plan" && (
        <div className="stack">
          <p>
            Будут заполнены <strong>пустые</strong> Размер, Тип существа, Класс опасности и
            Мировоззрение — из статблоков. Заполненное вручную не изменится.
          </p>
          <ul style={{ margin: 0 }}>
            <li>
              Бестиарий: {entries(plan.bestiary.entries)} — размер {plan.bestiary.size}, тип{" "}
              {plan.bestiary.creatureType}, класс опасности {plan.bestiary.cr}, мировоззрение{" "}
              {plan.bestiary.alignment}
            </li>
            <li>
              Транспорт: описания {entries(plan.vehicles.entries)}, полей {plan.vehicles.fields}
            </li>
            <li>Перенос в «Транспорт»: {entries(plan.candidates.length)} на выбор</li>
          </ul>
          {plan.vehicleSectionId === null && (
            <p className="muted">
              Раздела «Транспорт» в системе нет — перенос будет пропущен. Заведите раздел вида
              «Транспорт» и запустите ещё раз.
            </p>
          )}
          <div className="row" style={{ marginTop: 12 }}>
            <button
              className="primary"
              onClick={() => (plan.candidates.length ? setStep("candidates") : run())}
              disabled={running}
            >
              Дальше
            </button>
            <button onClick={onClose}>Отмена</button>
          </div>
        </div>
      )}

      {plan && step === "candidates" && (
        <div className="stack">
          <p className="muted">
            Отмечено то, что опознано уверенно. Остальное — похоже по названию: проверьте, прежде
            чем переносить.
          </p>
          <div className="stack" style={{ maxHeight: 320, overflowY: "auto", gap: 6 }}>
            {plan.candidates.map((c) => (
              <label key={c.id} className="row" style={{ alignItems: "flex-start", gap: 6 }}>
                <input type="checkbox" checked={checked.has(c.id)} onChange={() => toggle(c.id)} />
                <span>
                  <strong>{c.name}</strong>{" "}
                  <span className="muted">
                    — из «{c.from}»
                    {c.targetKind === "vehicle_post" ? ", как пост экипажа" : ""}
                  </span>
                  {c.hint && (
                    <>
                      <br />
                      <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>
                        {c.hint}
                      </span>
                    </>
                  )}
                </span>
              </label>
            ))}
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="primary" onClick={run} disabled={running}>
              {running ? "Работаю…" : `Применить (перенести ${checked.size})`}
            </button>
            <button onClick={() => setStep("plan")} disabled={running}>
              Назад
            </button>
          </div>
        </div>
      )}

      {report && step === "report" && (
        <div className="stack">
          <pre
            style={{
              whiteSpace: "pre-wrap",
              maxHeight: 360,
              overflowY: "auto",
              margin: 0,
              fontSize: "var(--fs-meta)",
            }}
          >
            {reportText(report)}
          </pre>
          <div className="row" style={{ marginTop: 12 }}>
            <button
              onClick={() => {
                navigator.clipboard.writeText(reportText(report));
                setCopied(true);
              }}
            >
              {copied ? "Скопировано" : "Скопировать"}
            </button>
            <button className="primary" onClick={onClose}>
              Готово
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
