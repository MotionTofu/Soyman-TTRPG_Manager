// Эталонный Master–Detail для таба «Информация о локации».
//
// Верхний таб-бар не трогаем: он выбрал домен «информация». Внутри таба:
//   левая панель → Основное / Статьи (N) / Изображения / Наполнение (точки),
//   правая панель → редактор выбранного объекта сразу, без кнопки
//   «Редактировать» и без отдельных страниц.
//
// Паттерн универсальный (см. EntityTabWorkspace): набор секций слева
// зависит от сущности и таба, механика навигации — общая.
import { useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { syncMentionLinks } from "../mentions";
import { MentionTextarea } from "./mentions/MentionTextarea";
import { MentionText } from "./mentions/MentionText";
import {
  EntityFieldInputs,
  hasEmptyRequired,
  type EntityField,
  type EntityFieldValues,
} from "./EntityFieldsCard";
import { EntityImageSlot } from "./EntityImageSlot";
import { LocationContent } from "./LocationContent";
import { EmptyState } from "./EmptyState";
import { useConfirm } from "../hooks/useConfirm";
import { locationRoleOf } from "../locationRoles";
import { EntityTabWorkspace, type WorkspaceSelection } from "./EntityTabWorkspace";
import type { LocationChapter, SettingLocationDetail } from "../types";

export interface InfoImageSlot {
  title: string;
  hint: string;
  url: string | null;
  uploading: boolean;
  onSelect: (file: File | null) => void;
  onDelete?: () => void;
  modal: ReactNode;
}

function toAliasesList(value: string[] | string | null | undefined): string[] {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

const MAIN_FIELDS: EntityField[] = [
  { key: "name", label: "Имя", value: "", required: true },
  {
    key: "role",
    label: "Вес",
    value: "location",
    options: [
      { value: "location", label: "Локация — самостоятельное место" },
      { value: "sector", label: "Сектор — контейнер" },
      { value: "spot", label: "Точка — внутри родителя" },
    ],
    title: "Вес определяет поведение: сектор группирует, точка живёт внутри родителя и не светится в поиске",
  },
  { key: "kind", label: "Тип", value: "", placeholder: "континент/город/таверна…" },
  {
    key: "short_name",
    label: "Короткое имя для карты",
    value: "",
    title: "Показывается вместо полного имени в подписи пина на карте локации",
  },
];

function mainInitial(location: SettingLocationDetail): {
  values: EntityFieldValues;
  description: string;
  aliases: string;
  original: string;
} {
  return {
    values: {
      name: location.name,
      role: locationRoleOf(location),
      kind: location.kind ?? "",
      short_name: location.short_name ?? "",
    },
    description: location.description ?? "",
    aliases: toAliasesList(location.aliases).join(", "),
    original: location.name_original ?? "",
  };
}

export function LocationInfoTab({
  location,
  onChanged,
  onSaveMain,
  thumbnail,
  avatar,
  spot,
}: {
  location: SettingLocationDetail;
  /** Перезагрузить карточку после сохранения (refresh страницы). */
  onChanged: () => void;
  onSaveMain: (values: {
    name: string;
    role?: string;
    kind: string;
    short_name: string;
    description: string;
    aliases: string[];
    name_original: string;
  }) => Promise<void>;
  thumbnail: InfoImageSlot;
  avatar: InfoImageSlot;
  /** Только для точек: наполнение и повышение в локацию. */
  spot: {
    content: SettingLocationDetail["content"];
    promoted: { id: number; name: string }[];
    promoting: boolean;
    onPromote: () => void;
  } | null;
}) {
  const [sel, setSel] = useState<WorkspaceSelection>({ section: "main" });
  const [navError, setNavError] = useState<string | null>(null);

  const chapters = location.chapters ?? [];
  const isSpot = locationRoleOf(location) === "spot";

  const sections = useMemo(
    () => [
      { id: "main", label: "Основное" },
      {
        id: "articles",
        label: "Статьи",
        count: chapters.length,
        items: chapters.map((c) => ({ id: String(c.id), label: c.title || "Без названия" })),
      },
      {
        id: "images",
        label: "Изображения",
        count: (thumbnail.url ? 1 : 0) + (avatar.url ? 1 : 0),
        items: [
          { id: "thumbnail", label: "Тамбнейл — 16×10" },
          { id: "avatar", label: "Аватар — 1:1" },
        ],
      },
      ...(isSpot ? [{ id: "content", label: "Наполнение" }] : []),
    ],
    // chapters/isSpot — производные location: зависимость от location покрывает.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [location, thumbnail.url, avatar.url]
  );

  function handleSelect(next: WorkspaceSelection) {
    // Клик по заголовку категории без элемента — подхватываем первый,
    // чтобы справа сразу был рабочий редактор, а не пустота.
    if (next.section === "articles" && !next.item) {
      const first = chapters[0];
      setSel(first ? { section: "articles", item: String(first.id) } : { section: "articles" });
      return;
    }
    if (next.section === "images" && !next.item) {
      setSel({ section: "images", item: "thumbnail" });
      return;
    }
    setSel(next);
  }

  async function addArticle() {
    const existing = new Set(chapters.map((c) => c.id));
    setNavError(null);
    try {
      const created = await api.post<{ id?: number }>(`/setting-locations/${location.id}/chapters`, {
        title: `Статья ${chapters.length + 1}`,
        content: "",
      });
      onChanged();
      // Сервер отдаёт созданную главу — выбираем её сразу.
      if (created?.id) setSel({ section: "articles", item: String(created.id) });
      else {
        // Запасной путь: подождать прихода глав пропсом нельзя, поэтому
        // помечаем создание — эффект ниже подхватит новую главу.
        pendingCreatedIds.current = existing;
        setSel({ section: "articles", item: "new" });
      }
    } catch (e) {
      setNavError(String(e instanceof Error ? e.message : e));
    }
  }

  // Запасной путь создания: когда сервер не вернул id, выбираем главу,
  // которой не было до создания.
  const pendingCreatedIds = useRef<Set<number>>(new Set());
  const newChapter = chapters.find((c) => !pendingCreatedIds.current.has(c.id));
  const effectiveSel =
    sel.section === "articles" && sel.item === "new" && newChapter
      ? { section: "articles", item: String(newChapter.id) }
      : sel;

  const selectedChapter =
    effectiveSel.section === "articles" && effectiveSel.item && effectiveSel.item !== "new"
      ? chapters.find((c) => String(c.id) === effectiveSel.item)
      : undefined;

  const navFooter =
    effectiveSel.section === "articles" ? (
      <>
        <button onClick={addArticle} style={{ alignSelf: "flex-start" }}>
          + Добавить статью
        </button>
        {navError && (
          <span className="muted" style={{ fontSize: "var(--fs-micro)" }}>
            Не удалось создать статью: {navError}
          </span>
        )}
      </>
    ) : undefined;

  return (
    <EntityTabWorkspace
      sections={sections}
      selection={effectiveSel}
      onSelect={handleSelect}
      navFooter={navFooter}
      workspaceKey={location.id}
    >
      {effectiveSel.section === "main" && (
        <MainEditor key={`main-${location.id}`} location={location} onSaveMain={onSaveMain} />
      )}

      {effectiveSel.section === "articles" &&
        (selectedChapter ? (
          <ArticleEditor
            key={selectedChapter.id}
            chapter={selectedChapter}
            locationId={location.id}
            defaultSettingId={location.setting_id}
            onChanged={onChanged}
            onDeleted={() => {
              setSel({ section: "articles" });
              onChanged();
            }}
          />
        ) : (
          <div className="card stack">
            <h3>Статьи</h3>
            {chapters.length === 0 ? (
              <EmptyState
                title="Статьи помогают описать локацию"
                hint="Запишите подробности, которые не влезают в основное описание — история, тайны, заметки мастера."
                action={
                  <button className="primary" onClick={addArticle}>
                    + Добавить статью
                  </button>
                }
              />
            ) : (
              <>
                <p className="muted">Выберите статью слева — справа откроется её редактор.</p>
                <button onClick={addArticle} style={{ alignSelf: "flex-start" }}>
                  + Добавить статью
                </button>
              </>
            )}
          </div>
        ))}

      {effectiveSel.section === "images" && (
        <ImageWorkspace
          key={effectiveSel.item ?? "thumbnail"}
          title={effectiveSel.item === "avatar" ? "Аватар — квадрат 1:1" : "Тамбнейл — 16×10"}
          slot={effectiveSel.item === "avatar" ? avatar : thumbnail}
        />
      )}

      {effectiveSel.section === "content" && spot && (
        <ContentWorkspace
          key={`content-${location.id}`}
          locationId={location.id}
          spot={spot}
          onChanged={onChanged}
        />
      )}
    </EntityTabWorkspace>
  );
}

// Рабочая область изображения: чтение по умолчанию (превью + подпись),
// замена/кадрирование — по кнопке. Загрузка срабатывает только в правке,
// случайный клик по превью файл не откроет.
function ImageWorkspace({ title, slot }: { title: string; slot: InfoImageSlot }) {
  const [editMode, setEditMode] = useState(false);

  if (!editMode) {
    return (
      <div className="card stack">
        <h3>{title}</h3>
        {slot.url ? (
          <img
            src={slot.url}
            alt=""
            style={{ width: "100%", maxWidth: 480, display: "block", border: "1px solid var(--line)" }}
          />
        ) : (
          <span className="muted">Нет изображения</span>
        )}
        <span className="muted" style={{ fontSize: "var(--fs-micro)", lineHeight: "1.4" }}>
          {slot.hint}
        </span>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <button onClick={() => setEditMode(true)}>{slot.url ? "Заменить" : "Загрузить"}</button>
          {slot.url && slot.onDelete && (
            <button className="danger" onClick={slot.onDelete}>
              Удалить
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="card stack">
      <h3>{title}</h3>
      <EntityImageSlot
        title={slot.title}
        hint={slot.hint}
        url={slot.url}
        uploading={slot.uploading}
        onSelect={slot.onSelect}
        onDelete={slot.onDelete}
      />
      {slot.modal}
      <button onClick={() => setEditMode(false)} style={{ alignSelf: "flex-start" }}>
        Готово
      </button>
    </div>
  );
}

// Рабочая область наполнения точки: чтение по умолчанию, добавление и
// удаление строк — в правке. Повышение в локацию доступно в обоих режимах.
function ContentWorkspace({
  locationId,
  spot,
  onChanged,
}: {
  locationId: number;
  spot: { content: SettingLocationDetail["content"]; promoted: { id: number; name: string }[]; promoting: boolean; onPromote: () => void };
  onChanged: () => void;
}) {
  const [editMode, setEditMode] = useState(false);

  return (
    <div className="card stack" style={{ gap: 8 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0 }}>Наполнение — что внутри</h3>
        <button onClick={() => setEditMode((v) => !v)}>{editMode ? "Готово" : "Редактировать"}</button>
      </div>
      <LocationContent
        locationId={locationId}
        items={spot.content ?? []}
        onChange={onChanged}
        readOnly={!editMode}
      />
      {spot.promoted.length > 0 ? (
        <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>
          Стала локацией:{" "}
          {spot.promoted.map((p, i) => (
            <span key={p.id}>
              {i > 0 && ", "}
              <Link to={`/locations/${p.id}`}>{p.name}</Link>
            </span>
          ))}
        </span>
      ) : (
        <div className="row">
          <button onClick={spot.onPromote} disabled={spot.promoting}>
            {spot.promoting ? "…" : "Создать локацию из этой точки"}
          </button>
          <span className="muted" style={{ fontSize: "var(--fs-micro)", maxWidth: "40ch" }}>
            Точка останется, рядом появится локация с теми же обитателями, статьями и наполнением
          </span>
        </div>
      )}
    </div>
  );
}

// Рабочая область «Основное»: чтение по умолчанию, правка — по кнопке
// «Редактировать». Отдельных страниц нет: выбрал слева — работаешь справа.
function MainEditor({
  location,
  onSaveMain,
}: {
  location: SettingLocationDetail;
  onSaveMain: (values: {
    name: string;
    role?: string;
    kind: string;
    short_name: string;
    description: string;
    aliases: string[];
    name_original: string;
  }) => Promise<void>;
}) {
  const init = useMemo(() => mainInitial(location), [location]);
  const [form, setForm] = useState(init);
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);

  const dirty =
    JSON.stringify({ v: form.values, d: form.description, a: form.aliases, o: form.original }) !==
    JSON.stringify({ v: init.values, d: init.description, a: init.aliases, o: init.original });

  function startEdit() {
    setForm(mainInitial(location));
    setEditMode(true);
  }

  function cancelEdit() {
    setForm(mainInitial(location));
    setEditMode(false);
  }

  async function save() {
    if (hasEmptyRequired(MAIN_FIELDS, form.values) || saving) return;
    setSaving(true);
    try {
      await onSaveMain({
        name: form.values.name,
        role: form.values.role,
        kind: form.values.kind,
        short_name: form.values.short_name,
        description: form.description,
        aliases: form.aliases
          .split(",")
          .map((a) => a.trim())
          .filter(Boolean),
        name_original: form.original.trim(),
      });
      setEditMode(false);
    } finally {
      setSaving(false);
    }
  }

  if (!editMode) {
    const roleLabel =
      MAIN_FIELDS.find((f) => f.key === "role")?.options?.find((o) => o.value === init.values.role)?.label ??
      init.values.role;
    const aliasList = toAliasesList(location.aliases);
    return (
      <div className="card stack">
        <h3>Основное</h3>
        <div className="entity-field-row">
          <span className="muted">Имя</span>
          <span>{location.name || <span className="muted">—</span>}</span>
        </div>
        <div className="entity-field-row">
          <span className="muted">Вес</span>
          <span>{roleLabel}</span>
        </div>
        <div className="entity-field-row">
          <span className="muted">Тип</span>
          <span>{location.kind || <span className="muted">—</span>}</span>
        </div>
        <div className="entity-field-row">
          <span className="muted">Короткое имя для карты</span>
          <span>{location.short_name || <span className="muted">—</span>}</span>
        </div>
        <div className="entity-field-row">
          <span className="muted">Описание</span>
          <span style={{ whiteSpace: "pre-wrap", flex: 1, minWidth: 0 }}>
            {location.description ? (
              <MentionText text={location.description} />
            ) : (
              <span className="muted">—</span>
            )}
          </span>
        </div>
        <div className="entity-field-row">
          <span className="muted">Другие названия</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            {aliasList.length === 0 && !location.name_original ? (
              <span className="muted">—</span>
            ) : (
              <span className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                {aliasList.map((alias) => (
                  <span key={alias} className="badge tag">
                    {alias}
                  </span>
                ))}
                {location.name_original && (
                  <span className="muted">в оригинале: {location.name_original}</span>
                )}
              </span>
            )}
          </span>
        </div>
        <button onClick={startEdit} style={{ alignSelf: "flex-start" }}>
          Редактировать
        </button>
      </div>
    );
  }

  return (
    <div className="card stack">
      <h3>Основное</h3>
      <EntityFieldInputs
        fields={MAIN_FIELDS}
        values={form.values}
        onChange={(key, value) => setForm((prev) => ({ ...prev, values: { ...prev.values, [key]: value } }))}
      />
      <label className="stack editable-card-field">
        <span>Описание</span>
        <MentionTextarea
          value={form.description}
          onChange={(v) => setForm((prev) => ({ ...prev, description: v }))}
          rows={4}
          defaultSettingId={location.setting_id}
        />
        <span className="muted" style={{ fontSize: "var(--fs-micro)", lineHeight: "1.3" }}>
          Короткая сводка о локации — что это за место, чем примечательно.
        </span>
      </label>
      <label className="stack editable-card-field">
        <span>Другие названия</span>
        <input
          value={form.aliases}
          onChange={(e) => setForm((prev) => ({ ...prev, aliases: e.target.value }))}
          placeholder="Синонимы через запятую"
        />
        <span className="muted" style={{ fontSize: "var(--fs-micro)", lineHeight: "1.3" }}>
          Другие переводы и написания имени — по ним работает поиск и сверка при импорте книги.
        </span>
      </label>
      <label className="stack editable-card-field">
        <span>Название в оригинале</span>
        <input
          value={form.original}
          onChange={(e) => setForm((prev) => ({ ...prev, original: e.target.value }))}
          placeholder="Sea Ward"
        />
      </label>
      <div className="row" style={{ alignItems: "center" }}>
        <button className="primary" onClick={save} disabled={!dirty || saving}>
          {saving ? "Сохранение…" : "Сохранить"}
        </button>
        <button onClick={cancelEdit}>Отмена</button>
        {!dirty && (
          <span className="muted" style={{ fontSize: "var(--fs-micro)" }}>
            Все изменения сохранены
          </span>
        )}
      </div>
    </div>
  );
}

// Рабочая область статьи: заголовок, содержание, видимость, сохранение.
// Выбираешь слева — сразу работаешь справа, отдельных страниц нет.
function ArticleEditor({
  chapter,
  locationId,
  defaultSettingId,
  onChanged,
  onDeleted,
}: {
  chapter: LocationChapter;
  locationId: number;
  defaultSettingId?: number;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const [confirmDialog, confirm] = useConfirm();
  const [title, setTitle] = useState(chapter.title);
  const [content, setContent] = useState(chapter.content);
  // Статья открывается чтением; правка — только по кнопке.
  // Пустая (только созданная) — сразу в правке, иначе черновик лежал бы
  // невидимым под кнопкой «Редактировать».
  const [editMode, setEditMode] = useState(() => !chapter.content);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = title !== chapter.title || content !== chapter.content;

  function startEdit() {
    setTitle(chapter.title);
    setContent(chapter.content);
    setError(null);
    setEditMode(true);
  }

  function cancelEdit() {
    setTitle(chapter.title);
    setContent(chapter.content);
    setError(null);
    setEditMode(false);
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await api.put(`/setting-locations/chapters/${chapter.id}`, { title, content });
      syncMentionLinks("location", locationId, chapter.content, content);
      setEditMode(false);
      onChanged();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setSaving(false);
    }
  }

  async function toggleVisible() {
    setError(null);
    try {
      await api.put(`/setting-locations/chapters/${chapter.id}`, {
        visible_to_players: !chapter.visible_to_players,
      });
      onChanged();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  }

  async function remove() {
    const ok = await confirm({
      message: "Удалить статью вместе с её текстом?",
      confirmLabel: "Удалить",
      danger: true,
    });
    if (!ok) return;
    setError(null);
    try {
      await api.del(`/setting-locations/chapters/${chapter.id}`);
      onDeleted();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  }

  return (
    <div className="card stack">
      {confirmDialog}
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0 }}>Статья</h3>
        <button
          className={`visibility-toggle${chapter.visible_to_players ? " is-visible" : ""}`}
          title={chapter.visible_to_players ? "Видно игрокам — нажмите, чтобы скрыть" : "Скрыто от игроков — нажмите, чтобы открыть"}
          onClick={toggleVisible}
        >
          {chapter.visible_to_players ? "Видно игрокам" : "Скрыто"}
        </button>
      </div>
      <label className="stack editable-card-field">
        <span>Заголовок</span>
        {editMode ? (
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Название статьи" />
        ) : (
          <strong>{chapter.title || "Без названия"}</strong>
        )}
      </label>
      {editMode ? (
        <label className="stack editable-card-field">
          <span>Содержание</span>
          <MentionTextarea value={content} onChange={setContent} rows={10} defaultSettingId={defaultSettingId} />
        </label>
      ) : (
        <div style={{ whiteSpace: "pre-wrap" }}>
          {chapter.content ? <MentionText text={chapter.content} /> : <span className="muted">Пусто</span>}
        </div>
      )}
      {error && (
        <span style={{ color: "var(--danger, #c00)", fontSize: "var(--fs-meta)" }}>{error}</span>
      )}
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div className="row" style={{ alignItems: "center" }}>
          {editMode ? (
            <>
              <button className="primary" onClick={save} disabled={!dirty || saving}>
                {saving ? "Сохранение…" : "Сохранить"}
              </button>
              <button onClick={cancelEdit}>Отмена</button>
            </>
          ) : (
            <>
              <button onClick={startEdit}>Редактировать</button>
              {!dirty && chapter.content && (
                <span className="muted" style={{ fontSize: "var(--fs-micro)" }}>
                  Все изменения сохранены
                </span>
              )}
            </>
          )}
        </div>
        <button className="danger" onClick={remove}>
          Удалить
        </button>
      </div>
    </div>
  );
}
