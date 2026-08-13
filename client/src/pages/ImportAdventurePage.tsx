// Экран импорта книги приключений (Этап 4).
//
// Три шага на одной странице: выбрать файл → сверить, что приедет → записать.
// Сверка — главное здесь: модель ошибается в категориях личностей и не знает,
// что половина локаций в сеттинге уже есть, поэтому каждая сущность приходит с
// галочкой, а совпавшие по имени — с выбором «создать новую или использовать
// существующую».

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { SectionHeading } from "../components/SectionHeading";
import { CREATABLE_BEING_CATEGORIES } from "../beingCategories";
import type { Setting } from "../types";

interface Problem {
  path: string;
  message: string;
}
interface PlanMatch {
  ref: string;
  name: string;
  hint: string;
  /** Чем совпало: название, синоним, оригинал — или только похожее написание. */
  reason: string;
  exact: boolean;
}
interface PlanEntry {
  key: string;
  type: string;
  name: string;
  note: string;
  category?: string;
  known: string | null;
  /** Имя того, на что ведёт занятый ключ: по нему видно столкновение. */
  knownName?: string | null;
  matches: PlanMatch[];
  /** Только у бестиария: монстры компендиума систем, в которые играют по сеттингу. */
  compendium?: PlanMatch[];
}
interface PlanSection {
  id: string;
  title: string;
  type: string;
  entries: PlanEntry[];
}
interface PlanResponse {
  ok: boolean;
  errors: Problem[];
  warnings: Problem[];
  counts: Record<string, number>;
  matches: { id: number; name: string; reason: string }[];
  setting?: { key: string; name: string; description: string };
  source?: { title: string; authors: string; pages: string; part: string };
  /** Системы, в компендиум которых можно заводить недостающих монстров. */
  systems?: { id: number; name: string; section_id: number }[];
  plan: { sections: PlanSection[]; extras: Record<string, number> };
}
interface ApplyResponse {
  ok: boolean;
  batch_id: number;
  setting_id: number;
  setting_created: boolean;
  counts: Record<string, number>;
  warnings: Problem[];
}
/** Занятый ключ сеттинга: вкладывается в промпт следующей части книги. */
interface KeyEntry {
  key: string;
  type: string;
  name: string;
  label: string;
}
interface Batch {
  id: number;
  setting_id: number;
  setting_name: string;
  file_name: string;
  source_title: string;
  source_part: string;
  created_at: string;
  counts: Record<string, number>;
}

function countsLine(counts: Record<string, number>): string {
  return Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([what, n]) => `${what}: ${n}`)
    .join(", ");
}

export function ImportAdventurePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const settingParam = params.get("setting");
  const [settingId, setSettingId] = useState<number | null>(
    settingParam ? Number(settingParam) : null
  );
  const [settings, setSettings] = useState<Setting[]>([]);

  const [fileName, setFileName] = useState("");
  const [raw, setRaw] = useState<unknown>(null);
  const [parseError, setParseError] = useState("");
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [busy, setBusy] = useState(false);

  // Решения человека по каждому ключу.
  const [skip, setSkip] = useState<Record<string, boolean>>({});
  const [reuse, setReuse] = useState<Record<string, string>>({});
  const [categories, setCategories] = useState<Record<string, string>>({});
  // key записи бестиария → id монстра компендиума либо "new" — «завести в
  // компендиуме». Связь необязательная: пусто значит «не связывать», и это
  // нормальный исход.
  const [compendium, setCompendium] = useState<Record<string, string>>({});
  // В компендиум какой системы заводить новых монстров. У сеттинга своей
  // системы нет: их дают кампании, и Вотердип водят сразу в двух.
  const [compendiumSystem, setCompendiumSystem] = useState<number | null>(null);
  // Ключи, про которые человек сказал «это другая сущность»: занятый ключ
  // перестаёт считаться занятым, и сущность создаётся заново.
  const [detach, setDetach] = useState<Record<string, boolean>>({});

  const [result, setResult] = useState<ApplyResponse | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [keys, setKeys] = useState<KeyEntry[]>([]);
  const [keysOpen, setKeysOpen] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "done" | "failed">("idle");
  const keysRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    api.get<Setting[]>("/settings").then(setSettings);
  }, []);

  const loadBatches = useCallback(() => {
    const query = settingId ? `?setting_id=${settingId}` : "";
    api.get<Batch[]>(`/import/batches${query}`).then(setBatches);
  }, [settingId]);
  useEffect(loadBatches, [loadBatches]);

  const loadKeys = useCallback(() => {
    if (!settingId) return setKeys([]);
    api.get<KeyEntry[]>(`/import/keys?setting_id=${settingId}`).then(setKeys);
  }, [settingId]);
  useEffect(loadKeys, [loadKeys, result]);

  // Готовый к вставке в промпт список: ключ — имя, по строке на сущность.
  const keysText = useMemo(
    () => keys.map((k) => `${k.key} — ${k.name} (${k.label})`).join("\n"),
    [keys]
  );

  /**
   * Доступ к буферу браузер может и запретить (NotAllowedError). Молча показать
   * «Скопировано» в этом случае — худший исход: человек вставит в промпт пустоту
   * и узнает об этом, только когда вторая часть книги приедет дублями. Поэтому
   * при отказе список раскрывается и выделяется целиком — останется Ctrl+C.
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

  const setting = settings.find((s) => s.id === settingId) ?? null;

  const requestPlan = useCallback(
    async (data: unknown, target: number | null) => {
      setBusy(true);
      try {
        const response = await api.post<PlanResponse>("/import/plan", {
          data,
          setting_id: target,
        });
        setPlan(response);
        // Совпавшее по имени по умолчанию не склеивается: молча слить две разные
        // таверны «Красный кабан» хуже, чем оставить дубль на виду.
        setSkip({});
        setReuse({});
        setCategories({});
        setCompendium({});
        // Одна система — выбирать не из чего, ставим её сразу.
        setCompendiumSystem(response.systems?.length === 1 ? response.systems[0].id : null);
        setDetach({});
        setResult(null);
      } finally {
        setBusy(false);
      }
    },
    []
  );

  async function onFile(file: File) {
    setParseError("");
    setPlan(null);
    setResult(null);
    setFileName(file.name);
    const text = await file.text();
    try {
      const data = JSON.parse(text);
      setRaw(data);
      await requestPlan(data, settingId);
    } catch (e) {
      setRaw(null);
      setParseError(`Это не JSON: ${(e as Error).message}`);
    }
  }

  async function changeTarget(next: number | null) {
    setSettingId(next);
    if (raw) await requestPlan(raw, next);
  }

  const entries = useMemo(
    () => plan?.plan.sections.flatMap((s) => s.entries) ?? [],
    [plan]
  );
  const systems = plan?.systems ?? [];
  const newInCompendium = Object.entries(compendium).filter(
    ([key, value]) => value === "new" && !skip[key]
  ).length;
  // Отцепленный ключ перестаёт быть занятым: сущность поедет как новая.
  const held = (e: PlanEntry) => !!e.known && !detach[e.key];
  const willCreate = entries.filter((e) => !skip[e.key] && !held(e) && !reuse[e.key]).length;
  const willReuse = entries.filter((e) => !skip[e.key] && (held(e) || reuse[e.key])).length;
  const willSkip = entries.filter((e) => skip[e.key]).length;

  function toggleSection(section: PlanSection, on: boolean) {
    setSkip((prev) => {
      const next = { ...prev };
      for (const entry of section.entries) next[entry.key] = !on;
      return next;
    });
  }

  async function apply() {
    if (!raw || !plan?.ok) return;
    setBusy(true);
    try {
      const response = await api.post<ApplyResponse>("/import/apply", {
        data: raw,
        setting_id: settingId,
        file_name: fileName,
        skip: Object.entries(skip)
          .filter(([, on]) => on)
          .map(([key]) => key),
        reuse,
        categories,
        // Сервер принимает список: у записи бестиария может быть монстр
        // в компендиуме каждой из систем сеттинга. Здесь выбирается один.
        compendium: Object.fromEntries(
          Object.entries(compendium)
            .filter(([key, value]) => !skip[key] && value !== "new")
            .map(([key, id]) => [key, [Number(id)]])
        ),
        compendium_new: Object.entries(compendium)
          .filter(([key, value]) => !skip[key] && value === "new")
          .map(([key]) => key),
        compendium_system: compendiumSystem,
        detach: Object.entries(detach)
          .filter(([, on]) => on)
          .map(([key]) => key),
      });
      setResult(response);
      setSettingId(response.setting_id);
      loadBatches();
    } finally {
      setBusy(false);
    }
  }

  async function rollback(batchId: number) {
    if (!confirm("Откатить импорт? Всё, что он создал, будет удалено.")) return;
    await api.del(`/import/batches/${batchId}`);
    if (result?.batch_id === batchId) setResult(null);
    loadBatches();
    // Откат удаляет сущности, а с ними и их ключи: список для промпта следующей
    // части обязан похудеть вместе с базой, иначе туда уедут ключи в никуда.
    loadKeys();
  }

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <SectionHeading section="settings">Импорт приключения</SectionHeading>
        {setting && <Link to={`/settings/${setting.id}`}>← {setting.name}</Link>}
      </div>

      {/* --- шаг 1: файл ---------------------------------------------------- */}
      <div className="card stack">
        <h3>Файл разбора</h3>
        <div className="muted">
          JSON формата <code>adventure-import/1</code> — его выдаёт нейросеть по промпту
          из <code>docs/adventure-import/prompt.md</code>.
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
            value={settingId ?? ""}
            onChange={(e) => void changeTarget(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Новый сеттинг из файла</option>
            {settings.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        {parseError && <div className="danger-text">{parseError}</div>}
      </div>

      {busy && !plan && <div className="muted">Разбираю файл…</div>}

      {/* --- шаг 2: сверка -------------------------------------------------- */}
      {plan && !result && (
        <>
          {plan.errors.length > 0 && (
            <div className="card stack">
              <h3>Файл не подходит</h3>
              <div className="muted">
                Импорт невозможен, пока это не исправлено — обычно проще перепрогнать
                промпт, чем править JSON руками.
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
              {plan.setting && (
                <div className="card stack">
                  <h3>{plan.setting.name}</h3>
                  {plan.source?.title && (
                    <div className="muted">
                      {[plan.source.title, plan.source.part, plan.source.authors]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  )}
                  {settingId == null && plan.matches.length > 0 && (
                    <div className="stack">
                      <div className="muted">
                        Похоже, такой сеттинг уже есть. Дозалить в него?
                      </div>
                      <div className="row">
                        {plan.matches.map((m) => (
                          <button key={m.id} onClick={() => void changeTarget(m.id)}>
                            {m.name} — {m.reason}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="muted">
                    Будет создано: {willCreate} · использовано существующих: {willReuse} ·
                    пропущено: {willSkip}
                  </div>
                  <div className="muted">
                    Совпадения ищутся по названию, синонимам и оригиналу; то, что нашлось лишь
                    по похожему написанию, помечено «Похоже, это». Выбранное существующее
                    запомнит название из книги как своё второе имя.
                  </div>
                </div>
              )}

              {plan.plan.sections.map((section) => (
                <div key={section.id} className="card stack">
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <h3>
                      {section.title}{" "}
                      <span className="muted">({section.entries.length})</span>
                    </h3>
                    <div className="row">
                      <button onClick={() => toggleSection(section, true)}>Все</button>
                      <button onClick={() => toggleSection(section, false)}>Никого</button>
                    </div>
                  </div>
                  {section.id === "bestiary" && newInCompendium > 0 && (
                    <div className="stack">
                      <label className="row">
                        <span className="muted">Заводить монстров в компендиуме системы:</span>
                        <select
                          value={compendiumSystem ?? ""}
                          onChange={(e) =>
                            setCompendiumSystem(e.target.value ? Number(e.target.value) : null)
                          }
                        >
                          <option value="">Не выбрана</option>
                          {systems.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="muted">
                        Компендиум системы общий для всех кампаний на ней — заведённый монстр
                        появится и в чужих. Откат импорта его удалит.
                      </div>
                      {compendiumSystem == null && (
                        <div className="danger-text">
                          Система не выбрана — {newInCompendium} монстр(ов) заведено не будет.
                        </div>
                      )}
                    </div>
                  )}
                  <div className="stack">
                    {section.entries.map((entry) => (
                      <div key={entry.key} className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                        <label className="row" style={{ gap: 6, minWidth: 240 }}>
                          <input
                            type="checkbox"
                            checked={!skip[entry.key]}
                            disabled={!!entry.known && !detach[entry.key]}
                            onChange={(e) =>
                              setSkip((prev) => ({ ...prev, [entry.key]: !e.target.checked }))
                            }
                          />
                          <span>{entry.name}</span>
                          {entry.note && <span className="muted">{entry.note}</span>}
                        </label>

                        {entry.known && (
                          <select
                            value={detach[entry.key] ? "new" : "keep"}
                            onChange={(e) =>
                              setDetach((prev) => ({
                                ...prev,
                                [entry.key]: e.target.value === "new",
                              }))
                            }
                          >
                            <option value="keep">
                              Уже импортировано
                              {entry.knownName ? `: ${entry.knownName}` : ""}
                            </option>
                            <option value="new">Это другая сущность — создать новую</option>
                          </select>
                        )}

                        {!entry.known && entry.matches.length > 0 && (
                          <select
                            value={reuse[entry.key] ?? ""}
                            onChange={(e) =>
                              setReuse((prev) => {
                                const next = { ...prev };
                                if (e.target.value) next[entry.key] = e.target.value;
                                else delete next[entry.key];
                                return next;
                              })
                            }
                          >
                            <option value="">
                              {entry.matches.some((m) => m.exact)
                                ? "Создать новую"
                                : "Создать новую (совпадений нет)"}
                            </option>
                            {entry.matches.map((m) => (
                              <option key={m.ref} value={m.ref}>
                                {m.exact ? "Использовать" : "Похоже, это"}: {m.name}
                                {` — ${m.reason}`}
                                {m.hint ? ` (${m.hint})` : ""}
                              </option>
                            ))}
                          </select>
                        )}

                        {entry.category && !held(entry) && !reuse[entry.key] && (
                          <select
                            value={categories[entry.key] ?? entry.category}
                            onChange={(e) =>
                              setCategories((prev) => ({ ...prev, [entry.key]: e.target.value }))
                            }
                          >
                            {CREATABLE_BEING_CATEGORIES.map((c) => (
                              <option key={c.key} value={c.key}>
                                {c.label}
                              </option>
                            ))}
                          </select>
                        )}

                        {entry.compendium && systems.length > 0 && (
                          <select
                            value={compendium[entry.key] ?? ""}
                            onChange={(e) =>
                              setCompendium((prev) => {
                                const next = { ...prev };
                                if (e.target.value) next[entry.key] = e.target.value;
                                else delete next[entry.key];
                                return next;
                              })
                            }
                          >
                            <option value="">Без статблока системы</option>
                            {entry.compendium.map((m) => (
                              <option key={m.ref} value={m.ref.split(":")[1]}>
                                {m.exact ? "Статблок" : "Похоже, это"}: {m.name}
                                {m.hint ? ` (${m.hint})` : ""}
                              </option>
                            ))}
                            <option value="new">Завести в компендиуме системы</option>
                          </select>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {Object.keys(plan.plan.extras).length > 0 && (
                <div className="card stack">
                  <h3>Приедет вместе с ними</h3>
                  <div className="muted">{countsLine(plan.plan.extras)}</div>
                  <div className="muted">
                    Сцены, проверки и связи отдельными галочками не разбираются: они живут
                    внутри приключения, снятого или оставленного целиком.
                  </div>
                </div>
              )}

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
                  {settingId ? "Импортировать в сеттинг" : "Создать сеттинг и импортировать"}
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
            <button
              className="primary"
              onClick={() => navigate(`/settings/${result.setting_id}?tab=Приключения`)}
            >
              Открыть сеттинг
            </button>
            <button className="danger" onClick={() => void rollback(result.batch_id)}>
              Откатить импорт
            </button>
          </div>
        </div>
      )}

      {/* --- ключи для следующей части --------------------------------------- */}
      {keys.length > 0 && (
        <div className="card stack">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h3>
              Ключи сеттинга <span className="muted">({keys.length})</span>
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
            Разбирая следующую часть той же книги, вложите этот список в промпт — в нём есть
            раздел «Если это продолжение». Тогда модель возьмёт готовый ключ вместо того,
            чтобы выдумать для той же локации второй, и части сойдутся.
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
              style={{
                maxHeight: 320,
                overflow: "auto",
                whiteSpace: "pre-wrap",
                margin: 0,
              }}
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
                  <Link to={`/settings/${batch.setting_id}`}>{batch.setting_name}</Link>
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
