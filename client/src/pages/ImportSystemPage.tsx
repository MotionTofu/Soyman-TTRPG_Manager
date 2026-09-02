// Экран импорта книги правил (system-import/1).
//
// Отличается от импорта приключения тем же, чем отличается сам формат: книга
// правил не заливается один раз, к ней возвращаются. Поэтому здесь нет сверки
// «эта таверна — та же самая?»: совпадение определяется ключом, не похожестью
// имени, и главный вопрос экрана другой — «что именно перепишется».
//
// Записи, которые импорт перепишет, помечены и их можно снять поштучно: между
// импортами человек правил компендиум руками, и он должен видеть, чего это
// коснётся, до того как нажмёт.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { SectionHeading } from "../components/SectionHeading";
import { clearDndSystemIdCache } from "../components/dnd/dndCompendium";
import type { System } from "../types";

interface Problem {
  path: string;
  message: string;
}
interface PlanEntry {
  key: string;
  name: string;
  kind: string;
  /** Ключ класса или вида, внутри которого запись живёт: умения, подклассы. */
  parentKey: string | null;
  /** Такой ключ в системе уже есть — запись будет переписана, а не заведена. */
  exists: boolean;
  /** Запись с тем же названием, заведённая раньше руками: ключа у неё нет. */
  match: { id: number; name: string; exact: boolean } | null;
  /** Прочие записи того же вида — на случай, когда названия разошлись сильно. */
  candidates: { id: number; name: string }[];
}
interface PlanSection {
  id: string;
  title: string;
  entries: PlanEntry[];
}
/**
 * Ссылка файла, которой не на что указывать. Обычный случай первого импорта в
 * компендиум, набитый руками: классы там есть, ключа у них нет.
 */
interface UnresolvedRef {
  ref: string;
  expect: string[];
  paths: string[];
  suggestion: { id: number; name: string } | null;
  candidates: { id: number; name: string; kind: string }[];
}
interface ValidateResponse {
  ok: boolean;
  errors: Problem[];
  warnings: Problem[];
  counts: Record<string, number>;
  matches: { id: number; name: string; reason: string }[];
  preview: { updates: string[]; creates: number };
  system?: { key: string; name: string; description: string };
  source?: { title: string; part: string };
  sections: PlanSection[];
  unresolved: UnresolvedRef[];
}
interface ApplyResponse {
  ok: boolean;
  batch_id: number;
  system_id: number;
  system_created: boolean;
  counts: Record<string, number>;
  warnings: Problem[];
}
interface KeyEntry {
  key: string;
  kind: string;
  name: string;
}
interface Batch {
  id: number;
  system_id: number;
  system_name: string;
  file_name: string;
  source_title: string;
  source_part: string;
  created_at: string;
  counts: Record<string, number>;
}

const KIND_LABELS: Record<string, string> = {
  mechanic_item: "пункт справочника",
  spell: "заклинание",
  class: "класс",
  subclass: "подкласс",
  feature: "умение",
  class_option: "опция",
  species: "вид",
  background: "предыстория",
  feat: "черта",
  equipment: "снаряжение",
  magic_item: "маг. предмет",
  monster: "существо",
};

function countsLine(counts: Record<string, number>): string {
  return Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([what, n]) => `${what}: ${n}`)
    .join(", ");
}

export function ImportSystemPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const systemParam = params.get("system");
  const [systemId, setSystemId] = useState<number | null>(
    systemParam ? Number(systemParam) : null
  );
  const [systems, setSystems] = useState<System[]>([]);

  const [fileName, setFileName] = useState("");
  const [raw, setRaw] = useState<unknown>(null);
  const [parseError, setParseError] = useState("");
  const [plan, setPlan] = useState<ValidateResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [skip, setSkip] = useState<Record<string, boolean>>({});
  // ключ файла → id записи компендиума, с которой человек его связал
  const [bind, setBind] = useState<Record<string, number>>({});
  const [result, setResult] = useState<ApplyResponse | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [keys, setKeys] = useState<KeyEntry[]>([]);
  const [keysOpen, setKeysOpen] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "done" | "failed">("idle");
  const keysRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    api.get<System[]>("/systems").then(setSystems);
  }, []);

  const loadBatches = useCallback(() => {
    const query = systemId ? `?system_id=${systemId}` : "";
    api.get<Batch[]>(`/system-import/batches${query}`).then(setBatches);
  }, [systemId]);
  useEffect(loadBatches, [loadBatches]);

  const loadKeys = useCallback(() => {
    if (!systemId) return setKeys([]);
    api.get<KeyEntry[]>(`/system-import/keys?system_id=${systemId}`).then(setKeys);
  }, [systemId]);
  useEffect(loadKeys, [loadKeys, result]);

  const keysText = useMemo(
    () => keys.map((k) => `${k.key} — ${k.name} (${KIND_LABELS[k.kind] ?? k.kind})`).join("\n"),
    [keys]
  );

  /**
   * Буфер обмена браузер может и запретить. Молча показать «Скопировано» —
   * худший исход: человек вложит в промпт пустоту и узнает об этом, когда
   * следующая глава приедет со вторыми ключами на то же самое.
   */
  async function copyKeys() {
    setKeysOpen(true);
    try {
      await navigator.clipboard.writeText(keysText);
      setCopyState("done");
    } catch {
      setCopyState("failed");
      requestAnimationFrame(() => {
        const node = keysRef.current;
        if (!node) return;
        const range = document.createRange();
        range.selectNodeContents(node);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      });
    }
    setTimeout(() => setCopyState("idle"), 4000);
  }

  const requestPlan = useCallback(async (data: unknown, target: number | null) => {
    setBusy(true);
    try {
      const response = await api.post<ValidateResponse>("/system-import/validate", {
        data,
        system_id: target,
      });
      setPlan(response);
      setSkip({});
      // Уверенная догадка (совпал английский оригинал в скобках) проставляется
      // сразу — иначе на главе заклинаний человеку пришлось бы вручную выбирать
      // те же двенадцать классов, которые видно и так.
      // Заодно — записи, которые в компендиуме уже есть под тем же названием.
      // Точное совпадение связывается сразу: «Огненный шар» из книги и
      // «Огненный шар» в компендиуме — одно заклинание, и второй такой же
      // рядом хуже любой ошибки связывания, которую видно и можно снять.
      // Похожее остаётся на выбор человека.
      setBind({
        ...Object.fromEntries(
          response.unresolved.filter((u) => u.suggestion).map((u) => [u.ref, u.suggestion!.id])
        ),
        ...Object.fromEntries(
          response.sections
            .flatMap((s) => s.entries)
            .filter((e) => e.match?.exact)
            .map((e) => [e.key, e.match!.id])
        ),
      });
      setResult(null);
    } finally {
      setBusy(false);
    }
  }, []);

  async function onFile(file: File) {
    setParseError("");
    setPlan(null);
    setResult(null);
    setFileName(file.name);
    const text = await file.text();
    try {
      const data = JSON.parse(text);
      setRaw(data);
      await requestPlan(data, systemId);
    } catch (e) {
      setRaw(null);
      setParseError(`Это не JSON: ${(e as Error).message}`);
    }
  }

  async function changeTarget(next: number | null) {
    setSystemId(next);
    if (raw) await requestPlan(raw, next);
  }

  const entries = useMemo(() => plan?.sections.flatMap((s) => s.entries) ?? [], [plan]);
  // Перепишется и то, у чего ключ уже есть, и то, что человек связал с
  // существующей записью на этом экране, — для него это одно и то же.
  const rewrites = (e: PlanEntry) => e.exists || bind[e.key] != null;
  const willUpdate = entries.filter((e) => rewrites(e) && !skip[e.key]).length;
  const willCreate = entries.filter((e) => !rewrites(e) && !skip[e.key]).length;
  const willSkip = entries.filter((e) => skip[e.key]).length;
  const fuzzy = entries.filter((e) => e.match && !e.match.exact && bind[e.key] == null).length;

  function toggleSection(section: PlanSection, on: boolean) {
    setSkip((prev) => {
      const next = { ...prev };
      for (const entry of section.entries) next[entry.key] = !on;
      return next;
    });
  }

  /** Снять все правки разом: частый случай — «долей новое, старое не трогай». */
  function keepExisting() {
    setSkip((prev) => {
      const next = { ...prev };
      for (const entry of entries) if (entry.exists) next[entry.key] = true;
      return next;
    });
  }

  async function apply() {
    if (!raw || !plan?.ok) return;
    setBusy(true);
    try {
      const response = await api.post<ApplyResponse>("/system-import/apply", {
        data: raw,
        system_id: systemId,
        file_name: fileName,
        skip: Object.entries(skip)
          .filter(([, on]) => on)
          .map(([key]) => key),
        bind,
      });
      clearDndSystemIdCache();
      setResult(response);
      setSystemId(response.system_id);
      loadBatches();
    } finally {
      setBusy(false);
    }
  }

  async function rollback(batchId: number) {
    if (
      !confirm(
        "Откатить импорт? Созданное им будет удалено, а переписанное вернётся к прежнему виду."
      )
    )
      return;
    await api.del(`/system-import/batches/${batchId}`);
    clearDndSystemIdCache();
    if (result?.batch_id === batchId) setResult(null);
    loadBatches();
    loadKeys();
  }

  const system = systems.find((s) => s.id === systemId) ?? null;

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <SectionHeading section="systems">Импорт книги правил</SectionHeading>
        {system && <Link to={`/systems/${system.id}`}>← {system.name}</Link>}
      </div>

      {/* --- шаг 1: файл ---------------------------------------------------- */}
      <div className="card stack">
        <h3>Файл разбора</h3>
        <div className="muted">
          JSON формата <code>system-import/1</code> — его выдаёт нейросеть по промпту из{" "}
          <code>docs/system-import/prompt.md</code>.
        </div>
        <input
          type="file"
          accept="application/json,.json"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onFile(file);
          }}
        />
        <label className="row">
          <span className="muted">Куда импортировать:</span>
          <select
            value={systemId ?? ""}
            onChange={(e) => void changeTarget(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Новая система из файла</option>
            {systems.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        {parseError && <div className="danger-text">{parseError}</div>}
      </div>

      {busy && !plan && <div className="muted">Разбираю файл…</div>}

      {/* --- шаг 2: что приедет --------------------------------------------- */}
      {plan && !result && (
        <>
          {plan.errors.length > 0 && (
            <div className="card stack">
              <h3>Файл не подходит</h3>
              <div className="muted">
                Импорт невозможен, пока это не исправлено — обычно проще перепрогнать промпт,
                чем править JSON руками.
              </div>
              <ul>
                {plan.errors.map((e, i) => (
                  <li key={i}>
                    <code>{e.path}</code> — {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {plan.ok && (
            <>
              <div className="card stack">
                <h3>{plan.system?.name}</h3>
                {plan.source?.title && (
                  <div className="muted">
                    {[plan.source.title, plan.source.part].filter(Boolean).join(" · ")}
                  </div>
                )}
                {systemId == null && plan.matches.length > 0 && (
                  <div className="stack">
                    <div className="muted">Похоже, такая система уже есть. Импортировать в неё?</div>
                    <div className="row">
                      {plan.matches.map((m) => (
                        <button key={m.id} onClick={() => void changeTarget(m.id)}>
                          {m.name} — {m.reason}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div>
                  Будет заведено: {willCreate} · переписано: {willUpdate} · пропущено: {willSkip}
                </div>
                <div className="muted">
                  Совпадение определяется ключом: та же глава, залитая второй раз, правит те
                  же записи. У записей, заведённых руками, ключа нет — они найдены по
                  названию и связываются здесь же, по одной. В записи переписываются только
                  поля из файла: дописанное руками в редакторе остаётся.
                </div>
                {fuzzy > 0 && (
                  <div className="muted">
                    Похожих по названию, но не совпавших точно: {fuzzy}. Такие по умолчанию
                    приедут отдельными записями — посмотрите их в списках ниже.
                  </div>
                )}
                {willUpdate > 0 && (
                  <div className="row">
                    <button onClick={keepExisting}>Не трогать существующие</button>
                    <span className="muted">
                      Тогда приедет только новое: {willCreate} записей.
                    </span>
                  </div>
                )}
              </div>

              {plan.unresolved.length > 0 && (
                <div className="card stack">
                  <h3>
                    Ссылки на то, чего нет в файле{" "}
                    <span className="muted">({plan.unresolved.length})</span>
                  </h3>
                  <div className="muted">
                    Глава ссылается на записи, которых в ней самой нет, — обычно они в
                    компендиуме давно есть, просто заведены руками и ключа не имеют. Свяжите
                    их один раз: связь запомнится, и следующие главы про них уже не спросят.
                    Несвязанное просто не запишется — заклинание приедет без этого класса.
                  </div>
                  <div className="stack" style={{ gap: 4 }}>
                    {plan.unresolved.map((item) => (
                      <label key={item.ref} className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                        <code style={{ minWidth: 220 }}>{item.ref}</code>
                        <select
                          value={bind[item.ref] ?? ""}
                          onChange={(e) => {
                            const value = e.target.value;
                            setBind((prev) => {
                              const next = { ...prev };
                              if (value) next[item.ref] = Number(value);
                              else delete next[item.ref];
                              return next;
                            });
                          }}
                        >
                          <option value="">— не связывать —</option>
                          {item.candidates.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                        <span className="muted">
                          ссылок: {item.paths.length}
                          {item.suggestion ? " · подставлено по оригиналу названия" : ""}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {plan.sections.map((section) => (
                <div key={section.id} className="card stack">
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <h3>
                      {section.title} <span className="muted">({section.entries.length})</span>
                    </h3>
                    <div className="row">
                      <button onClick={() => toggleSection(section, true)}>Все</button>
                      <button onClick={() => toggleSection(section, false)}>Никого</button>
                    </div>
                  </div>
                  <div className="stack" style={{ gap: 2 }}>
                    {section.entries.map((entry) => (
                      <label key={entry.key} className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                        <input
                          type="checkbox"
                          checked={!skip[entry.key]}
                          onChange={(e) =>
                            setSkip((prev) => ({ ...prev, [entry.key]: !e.target.checked }))
                          }
                        />
                        {/* Вложенное — со сдвигом: умение читается как часть своего класса. */}
                        <span style={{ paddingLeft: entry.parentKey ? 16 : 0 }}>{entry.name}</span>
                        <span className="muted">{KIND_LABELS[entry.kind] ?? entry.kind}</span>
                        {entry.exists && <span className="muted">· перепишется</span>}
                        {/* Такая же запись уже есть, но заведена руками и ключа
                            не имеет: выбор — переписать её или завести вторую. */}
                        {!entry.exists && entry.candidates.length > 0 && (
                          <select
                            value={bind[entry.key] ?? ""}
                            onChange={(e) => {
                              const value = e.target.value;
                              setBind((prev) => {
                                const next = { ...prev };
                                if (value) next[entry.key] = Number(value);
                                else delete next[entry.key];
                                return next;
                              });
                            }}
                          >
                            <option value="">завести новую</option>
                            {entry.candidates.map((c) => (
                              <option key={c.id} value={c.id}>
                                перепишет «{c.name}»
                              </option>
                            ))}
                          </select>
                        )}
                        {!entry.exists && entry.match && !entry.match.exact && (
                          <span className="muted">· только похоже по названию</span>
                        )}
                      </label>
                    ))}
                  </div>
                </div>
              ))}

              {plan.warnings.length > 0 && (
                <details className="card">
                  <summary>
                    Предупреждения ({plan.warnings.length}) — импорт пройдёт, но что-то
                    потеряется
                  </summary>
                  <ul>
                    {plan.warnings.map((w, i) => (
                      <li key={i}>
                        <code>{w.path}</code> — {w.message}
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              <div className="row">
                <button className="primary" disabled={busy} onClick={() => void apply()}>
                  {systemId ? "Импортировать в систему" : "Создать систему и импортировать"}
                </button>
                <span className="muted">Одной транзакцией, с возможностью отката.</span>
              </div>
            </>
          )}
        </>
      )}

      {/* --- шаг 3: итог ---------------------------------------------------- */}
      {result && (
        <div className="card stack">
          <h3>Импорт завершён</h3>
          <div>{countsLine(result.counts)}</div>
          {result.warnings.length > 0 && (
            <details>
              <summary>Предупреждения ({result.warnings.length})</summary>
              <ul>
                {result.warnings.map((w, i) => (
                  <li key={i}>
                    <code>{w.path}</code> — {w.message}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="row">
            <button className="primary" onClick={() => navigate(`/systems/${result.system_id}`)}>
              Открыть систему
            </button>
            <button className="danger" onClick={() => void rollback(result.batch_id)}>
              Откатить импорт
            </button>
          </div>
        </div>
      )}

      {/* --- ключи для следующей главы -------------------------------------- */}
      {keys.length > 0 && (
        <div className="card stack">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h3>
              Ключи системы <span className="muted">({keys.length})</span>
            </h3>
            <div className="row">
              <button onClick={() => void copyKeys()}>
                {copyState === "done"
                  ? "Скопировано"
                  : copyState === "failed"
                    ? "Выделено — Ctrl+C"
                    : "Скопировать"}
              </button>
              <button onClick={() => setKeysOpen((v) => !v)}>
                {keysOpen ? "Свернуть" : "Показать"}
              </button>
            </div>
          </div>
          <div className="muted">
            Разбирая следующую главу той же книги, вложите этот список в промпт. Тогда модель
            сошлётся на приехавшее — на тот же тип урона, тот же класс — вместо того чтобы
            выдумать для них второй ключ.
          </div>
          {copyState === "failed" && (
            <div className="muted">
              Браузер не дал доступ к буферу обмена. Список ниже выделен целиком — скопируйте
              его вручную.
            </div>
          )}
          {keysOpen && (
            <pre
              ref={keysRef}
              style={{ maxHeight: 320, overflow: "auto", whiteSpace: "pre-wrap", margin: 0 }}
            >
              {keysText}
            </pre>
          )}
        </div>
      )}

      {/* --- история -------------------------------------------------------- */}
      {batches.length > 0 && (
        <div className="card stack">
          <h3>История импортов</h3>
          {batches.map((batch) => (
            <div key={batch.id} className="row" style={{ justifyContent: "space-between" }}>
              <div className="stack" style={{ gap: 2 }}>
                <div>
                  <Link to={`/systems/${batch.system_id}`}>{batch.system_name}</Link>
                  {batch.source_title ? ` — ${batch.source_title}` : ""}
                  {batch.source_part ? `, ${batch.source_part}` : ""}
                </div>
                <div className="muted">
                  {batch.created_at} · {batch.file_name} · {countsLine(batch.counts)}
                </div>
              </div>
              <button className="danger" onClick={() => void rollback(batch.id)}>
                Откатить
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
