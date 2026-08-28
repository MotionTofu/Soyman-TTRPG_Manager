import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { Modal } from "./Modal";
import { MentionTextarea } from "./mentions/MentionTextarea";
import { syncMentionLinks } from "../mentions";
import { IMAGE_ACCEPT, IMAGE_HINT } from "../imageUpload";
import {
  CalendarPresetPicker,
  EMPTY_CALENDAR,
  type CalendarChoice,
} from "./CalendarPresetPicker";
import type { Setting } from "../types";

// Создание сеттинга по шагам. Смысл визарда — не в том, чтобы задать больше
// вопросов, а в том, чтобы созданный мир не открывался чистым листом: те же
// локации, сообщества и НПЦ заводятся и на странице сеттинга, но туда надо
// сначала догадаться пойти.
//
// Поэтому обязательное поле здесь ровно одно — название, а кнопки создания
// доступны с первого шага: остальные шаги можно проходить, а можно нет.
// Оболочка повторяет EntityWizard, чтобы визардов было два, а язык — один.

const STEP_TITLES = [
  "Название и обложка",
  "Описание",
  "Локации",
  "Население",
  "Календарь",
];

// Категории существа, которые имеет смысл заводить руками. Бестиарий сюда не
// входит: монстры приходят из компендиума, а не из поля ввода.
const BEING_CATEGORIES = [
  { value: "key_figure", label: "Ключевая фигура" },
  { value: "influential", label: "Влиятельная персона" },
  { value: "notable", label: "Примечательная личность" },
];

interface DraftLocation {
  key: number;
  name: string;
  depth: number;
}

interface DraftCommunity {
  key: number;
  name: string;
}

interface DraftBeing {
  key: number;
  name: string;
  category: string;
  locationKey: number | null;
  communityKeys: number[];
}

let nextKey = 1;
const newKey = () => nextKey++;

export function SettingWizard({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [stepIndex, setStepIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [cover, setCover] = useState<File | null>(null);
  const [calendar, setCalendar] = useState<CalendarChoice>(EMPTY_CALENDAR);
  const [locations, setLocations] = useState<DraftLocation[]>([
    { key: newKey(), name: "", depth: 0 },
  ]);
  const [communities, setCommunities] = useState<DraftCommunity[]>([
    { key: newKey(), name: "" },
  ]);
  const [beings, setBeings] = useState<DraftBeing[]>([
    { key: newKey(), name: "", category: "key_figure", locationKey: null, communityKeys: [] },
  ]);

  const coverPreview = useMemo(() => (cover ? URL.createObjectURL(cover) : null), [cover]);
  useEffect(
    () => () => {
      if (coverPreview) URL.revokeObjectURL(coverPreview);
    },
    [coverPreview]
  );
  const canCreate = name.trim().length > 0 && !saving;

  // Родитель строки — ближайшая сверху строка меньшей глубины. Дерево не
  // хранится отдельно: глубина строки и есть вся структура, а лишний
  // параллельный список рассинхронизировался бы на первой же вставке.
  function parentKeyOf(index: number, rows: DraftLocation[]): number | null {
    for (let i = index - 1; i >= 0; i--) {
      if (rows[i].depth < rows[index].depth) return rows[i].key;
    }
    return null;
  }

  async function create(then: "close" | "setting") {
    if (!canCreate) return;
    setSaving(true);
    setError(null);
    try {
      // Пустые строки выбрасываются вместе с тем, что в них вложено: вложить
      // что-то в пустоту — опечатка, а не иерархия. Сервер поднимет осиротевших
      // детей в корень, здесь же они просто не отправляются.
      const namedLocations = locations.filter((l) => l.name.trim());
      const droppedKeys = new Set(
        locations.filter((l) => !l.name.trim()).map((l) => l.key)
      );
      const payloadLocations = namedLocations.map((l) => {
        const parent = parentKeyOf(locations.indexOf(l), locations);
        return {
          key: l.key,
          parent_key: parent !== null && !droppedKeys.has(parent) ? parent : null,
          name: l.name.trim(),
        };
      });
      const payloadCommunities = communities
        .filter((c) => c.name.trim())
        .map((c) => ({ key: c.key, name: c.name.trim() }));
      const liveLocationKeys = new Set(payloadLocations.map((l) => l.key));
      const liveCommunityKeys = new Set(payloadCommunities.map((c) => c.key));
      const payloadBeings = beings
        .filter((b) => b.name.trim())
        .map((b) => ({
          name: b.name.trim(),
          category: b.category,
          location_key:
            b.locationKey !== null && liveLocationKeys.has(b.locationKey) ? b.locationKey : null,
          community_keys: b.communityKeys.filter((k) => liveCommunityKeys.has(k)),
        }));

      const created = await api.post<Setting>("/settings/wizard", {
        name: name.trim(),
        description,
        calendar,
        locations: payloadLocations,
        communities: payloadCommunities,
        beings: payloadBeings,
      });
      syncMentionLinks("setting", created.id, "", description);

      // Картинка идёт отдельным запросом: сеттинг уже создан, и её потеря —
      // не повод откатывать мир. Одна и та же картинка ложится в оба слота,
      // кадрирование остаётся на странице сеттинга.
      if (cover) {
        for (const kind of ["background", "thumbnail"] as const) {
          const form = new FormData();
          form.append("file", cover);
          await api.post(`/settings/${created.id}/${kind}`, form).catch(() => undefined);
        }
      }

      if (then === "setting") navigate(`/settings/${created.id}`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose} closeOnBackdropClick={false}>
      <div className="stack wizard">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
          <h3 style={{ margin: 0 }}>Новый сеттинг</h3>
          <span className="muted">
            Шаг {stepIndex + 1} из {STEP_TITLES.length} — {STEP_TITLES[stepIndex]}
          </span>
        </div>

        {stepIndex === 0 && (
          <div className="stack">
            <label className="stack editable-card-field">
              <span>Название</span>
              <input
                autoFocus
                value={name}
                placeholder="Как называется мир"
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <div className="stack editable-card-field">
              <span>Заглавное изображение</span>
              <span className="muted image-hint">{IMAGE_HINT}</span>
              <div className="row" style={{ alignItems: "center" }}>
                {coverPreview && <img src={coverPreview} alt="" className="wizard-avatar-preview" />}
                <label className="character-avatar-upload">
                  {cover ? "Заменить" : "Выбрать изображение"}
                  <input
                    type="file"
                    accept={IMAGE_ACCEPT}
                    style={{ display: "none" }}
                    onChange={(e) => setCover(e.target.files?.[0] ?? null)}
                  />
                </label>
                {cover && (
                  <button type="button" onClick={() => setCover(null)}>
                    Убрать
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {stepIndex === 1 && (
          <label className="stack editable-card-field">
            <span>Описание</span>
            <MentionTextarea value={description} onChange={setDescription} />
          </label>
        )}

        {stepIndex === 2 && (
          <LocationOutline rows={locations} onChange={setLocations} />
        )}

        {stepIndex === 3 && (
          <PopulationStep
            communities={communities}
            onCommunities={setCommunities}
            beings={beings}
            onBeings={setBeings}
            locations={locations}
          />
        )}

        {stepIndex === 4 && <CalendarPresetPicker value={calendar} onChange={setCalendar} />}

        {error && <span className="backup-info error">{error}</span>}

        <div className="row wizard-steps-nav">
          <button disabled={stepIndex === 0} onClick={() => setStepIndex((i) => i - 1)}>
            Назад
          </button>
          <button
            disabled={stepIndex >= STEP_TITLES.length - 1}
            onClick={() => setStepIndex((i) => i + 1)}
          >
            Далее
          </button>
        </div>
        <div className="row wizard-actions">
          <button className="primary" disabled={!canCreate} onClick={() => create("close")}>
            Создать и вернуться
          </button>
          <button disabled={!canCreate} onClick={() => create("setting")}>
            Создать и перейти в сеттинг
          </button>
          <button onClick={onClose}>Отмена</button>
        </div>
      </div>
    </Modal>
  );
}

// Аутлайнер локаций: одна очередь строк с клавиатуры. Enter — соседняя
// строка, Tab — вложить в предыдущую, Shift+Tab — вынести, Backspace на
// пустой — убрать. Мышь нужна только чтобы передумать.
function LocationOutline({
  rows,
  onChange,
}: {
  rows: DraftLocation[];
  onChange: (rows: DraftLocation[]) => void;
}) {
  // Куда ставить фокус после правки списка: DOM-узла новой строки в момент
  // обработчика ещё нет, поэтому запоминаем ключ и наводимся по нему после
  // отрисовки. autoFocus здесь не годится — он срабатывает только на монтаж,
  // а после удаления строки фокус надо вернуть на уже существующую соседнюю.
  const [focusKey, setFocusKey] = useState<number | null>(null);
  const inputs = useRef(new Map<number, HTMLInputElement>());
  useEffect(() => {
    if (focusKey === null) return;
    inputs.current.get(focusKey)?.focus();
    setFocusKey(null);
  }, [focusKey, rows]);

  function patch(index: number, values: Partial<DraftLocation>) {
    onChange(rows.map((r, i) => (i === index ? { ...r, ...values } : r)));
  }

  function keyDown(e: KeyboardEvent<HTMLInputElement>, index: number) {
    const row = rows[index];
    if (e.key === "Enter") {
      e.preventDefault();
      const created: DraftLocation = { key: newKey(), name: "", depth: row.depth };
      onChange([...rows.slice(0, index + 1), created, ...rows.slice(index + 1)]);
      setFocusKey(created.key);
    } else if (e.key === "Tab" && !e.shiftKey) {
      // Вложить можно только под строку, которая уже есть выше и не глубже
      // самой себя — иначе получился бы уровень без родителя.
      const above = rows[index - 1];
      if (!above || row.depth > above.depth) return;
      e.preventDefault();
      patch(index, { depth: row.depth + 1 });
    } else if (e.key === "Tab" && e.shiftKey) {
      if (row.depth === 0) return;
      e.preventDefault();
      patch(index, { depth: row.depth - 1 });
    } else if (e.key === "Backspace" && row.name === "" && rows.length > 1) {
      e.preventDefault();
      onChange(rows.filter((_, i) => i !== index));
      setFocusKey(rows[Math.max(0, index - 1)].key);
    }
  }

  return (
    <div className="stack editable-card-field">
      <span>Локации</span>
      <span className="muted image-hint">
        Напишите названия нескольких ключевых локаций вашего сеттинга и мы сразу создадим для них
        профили.
      </span>
      <div className="stack" style={{ gap: 4 }}>
        {rows.map((row, index) => (
          <div key={row.key} className="row" style={{ gap: 6, alignItems: "center" }}>
            <input
              value={row.name}
              ref={(el) => {
                if (el) inputs.current.set(row.key, el);
                else inputs.current.delete(row.key);
              }}
              style={{ marginLeft: row.depth * 22, flex: 1 }}
              placeholder={row.depth === 0 ? "Королевство, город, лес…" : "Внутри предыдущей"}
              onChange={(e) => patch(index, { name: e.target.value })}
              onKeyDown={(e) => keyDown(e, index)}
            />
            <button
              type="button"
              title="Убрать строку"
              disabled={rows.length === 1}
              onClick={() => onChange(rows.filter((_, i) => i !== index))}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <div className="row">
        <button
          type="button"
          onClick={() => {
            const created: DraftLocation = { key: newKey(), name: "", depth: 0 };
            onChange([...rows, created]);
            setFocusKey(created.key);
          }}
        >
          + Локация
        </button>
        <span className="muted">Enter — строка, Tab — вложить, Shift+Tab — вынести</span>
      </div>
    </div>
  );
}

// Население: сначала сообщества, потом личности — иначе НПЦ некуда
// приписывать, и Мастеру пришлось бы возвращаться.
function PopulationStep({
  communities,
  onCommunities,
  beings,
  onBeings,
  locations,
}: {
  communities: DraftCommunity[];
  onCommunities: (rows: DraftCommunity[]) => void;
  beings: DraftBeing[];
  onBeings: (rows: DraftBeing[]) => void;
  locations: DraftLocation[];
}) {
  const namedLocations = locations.filter((l) => l.name.trim());
  const namedCommunities = communities.filter((c) => c.name.trim());

  function patchBeing(index: number, values: Partial<DraftBeing>) {
    onBeings(beings.map((b, i) => (i === index ? { ...b, ...values } : b)));
  }

  return (
    <div className="stack">
      <div className="stack editable-card-field">
        <span>Сообщества</span>
        <span className="muted image-hint">
          Напишите несколько ключевых фракций или народов вашего сеттинга и мы сразу создадим для
          них профили.
        </span>
        <div className="stack" style={{ gap: 4 }}>
          {communities.map((row, index) => (
            <div key={row.key} className="row" style={{ gap: 6, alignItems: "center" }}>
              <input
                value={row.name}
                style={{ flex: 1 }}
                placeholder="Гильдия, орден, народ…"
                onChange={(e) =>
                  onCommunities(
                    communities.map((c, i) => (i === index ? { ...c, name: e.target.value } : c))
                  )
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onCommunities([
                      ...communities.slice(0, index + 1),
                      { key: newKey(), name: "" },
                      ...communities.slice(index + 1),
                    ]);
                  }
                }}
              />
              <button
                type="button"
                title="Убрать строку"
                disabled={communities.length === 1}
                onClick={() => onCommunities(communities.filter((_, i) => i !== index))}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <div className="row">
          <button type="button" onClick={() => onCommunities([...communities, { key: newKey(), name: "" }])}>
            + Сообщество
          </button>
        </div>
      </div>

      <div className="stack editable-card-field">
        <span>Личности</span>
        <span className="muted image-hint">
          Напишите несколько ключевых личностей вашего сеттинга и мы сразу создадим для них профили.
        </span>
        <div className="stack" style={{ gap: 8 }}>
          {beings.map((row, index) => (
            <div key={row.key} className="stack" style={{ gap: 4 }}>
              <div className="row" style={{ gap: 6, alignItems: "center" }}>
                <input
                  value={row.name}
                  style={{ flex: 1 }}
                  placeholder="Имя"
                  onChange={(e) => patchBeing(index, { name: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      onBeings([
                        ...beings.slice(0, index + 1),
                        {
                          key: newKey(),
                          name: "",
                          category: "key_figure",
                          locationKey: null,
                          communityKeys: [],
                        },
                        ...beings.slice(index + 1),
                      ]);
                    }
                  }}
                />
                <select
                  value={row.category}
                  onChange={(e) => patchBeing(index, { category: e.target.value })}
                >
                  {BEING_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  title="Убрать строку"
                  disabled={beings.length === 1}
                  onClick={() => onBeings(beings.filter((_, i) => i !== index))}
                >
                  ✕
                </button>
              </div>
              {/* Привязки показываются только когда есть к чему привязывать:
                  пустой выпадающий — это вопрос без ответов. */}
              {(namedLocations.length > 0 || namedCommunities.length > 0) && (
                <div className="row" style={{ gap: 6, marginLeft: 2, flexWrap: "wrap" }}>
                  {namedLocations.length > 0 && (
                    <select
                      value={row.locationKey ?? ""}
                      onChange={(e) =>
                        patchBeing(index, {
                          locationKey: e.target.value === "" ? null : Number(e.target.value),
                        })
                      }
                    >
                      <option value="">Без локации</option>
                      {namedLocations.map((l) => (
                        <option key={l.key} value={l.key}>
                          {"— ".repeat(l.depth)}
                          {l.name}
                        </option>
                      ))}
                    </select>
                  )}
                  {namedCommunities.map((c) => (
                    <label key={c.key} className="wizard-pick-row">
                      <input
                        type="checkbox"
                        checked={row.communityKeys.includes(c.key)}
                        onChange={() =>
                          patchBeing(index, {
                            communityKeys: row.communityKeys.includes(c.key)
                              ? row.communityKeys.filter((k) => k !== c.key)
                              : [...row.communityKeys, c.key],
                          })
                        }
                      />
                      <span>{c.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="row">
          <button
            type="button"
            onClick={() =>
              onBeings([
                ...beings,
                { key: newKey(), name: "", category: "key_figure", locationKey: null, communityKeys: [] },
              ])
            }
          >
            + Личность
          </button>
        </div>
      </div>
    </div>
  );
}
