import { useEffect, useId, useLayoutEffect, useRef, useState, type ChangeEventHandler, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAfterWrite, useResource, write } from "../data/hooks";
import { readResource } from "../data/imperative";
import type { Resource } from "../types";

export type PdfEntityKind = "being" | "location" | "community" | "artifact" | "item" | "magic_item";
export type PdfEntitySource = {
  id: string; resource_id: number; resource_name: string; target_kind: PdfEntityKind;
  target_id: number; target_name: string; target_setting_id: number | null;
  target_system_id: number | null; target_section_id: number | null;
  field_name: string; page_number: number | null; quote: string; needs_reattach: number;
};
type Row = { id: number; name: string; [key: string]: unknown };
type Section = { id: number; name: string; kind: string };
type KindConfig = { label: string; path: string; fields: { key: string; label: string }[] };

const KINDS: Record<PdfEntityKind, KindConfig> = {
  being: { label: "Существо", path: "/setting-beings", fields: [
    { key: "description", label: "Описание" }, { key: "history", label: "История" },
    { key: "behavior", label: "Поведение" }, { key: "secret", label: "Секрет" },
    { key: "player_text", label: "Текст для игроков" },
  ] },
  location: { label: "Локация", path: "/setting-locations", fields: [
    { key: "description", label: "Описание" }, { key: "player_text", label: "Текст для игроков" },
  ] },
  community: { label: "Фракция", path: "/setting-communities", fields: [
    { key: "description", label: "Описание" }, { key: "history", label: "История" },
    { key: "current_situation", label: "Текущее положение" }, { key: "features", label: "Особенности" },
    { key: "goals", label: "Цели" }, { key: "player_text", label: "Текст для игроков" },
  ] },
  artifact: { label: "Артефакт сеттинга", path: "/artifacts", fields: [
    { key: "description", label: "Описание" }, { key: "history", label: "История" },
    { key: "power", label: "Свойства" }, { key: "notes", label: "Заметки" }, { key: "secret", label: "Секрет" },
  ] },
  item: { label: "Предмет справочника", path: "/systems/entries", fields: [{ key: "description", label: "Описание" }] },
  magic_item: { label: "Магический предмет", path: "/systems/entries", fields: [{ key: "description", label: "Описание" }] },
};

function detailPath(kind: PdfEntityKind, row: Row, systemId: number) {
  switch (kind) {
    case "being": return `/beings/${row.id}`;
    case "location": return `/locations/${row.id}`;
    case "community": return `/communities/${row.id}`;
    case "artifact": return `/artifacts/${row.id}`;
    default: return `/systems/${systemId}?section=${row.section_id}&entry=${row.id}`;
  }
}

function EntitySelect({ label, value, disabled, onChange, children }: {
  label: string; value: number | string; disabled?: boolean;
  onChange: ChangeEventHandler<HTMLSelectElement>; children: ReactNode;
}) {
  return <label className="pdf-reader__entity-field">
    <span>{label}</span>
    <span className="pdf-reader__entity-select">
      <select className="d-select" value={value} disabled={disabled} onChange={onChange}>{children}</select>
      <span className="pdf-reader__entity-chevron" aria-hidden="true">▾</span>
    </span>
  </label>;
}

export function PdfEntityPanel({ resource, sources, quote, page }: {
  resource: Resource; quote: string; page: number | null;
  sources: PdfEntitySource[];
}) {
  const [mode, setMode] = useState<"create" | "edit">("create");
  const [kind, setKind] = useState<PdfEntityKind>("being");
  const [settings, setSettings] = useState<Row[]>([]);
  const [systems, setSystems] = useState<Row[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [settingId, setSettingId] = useState(resource.setting_id ?? 0);
  const [systemId, setSystemId] = useState(resource.system_id ?? 0);
  const [sectionId, setSectionId] = useState(0);
  const [targetId, setTargetId] = useState(0);
  const [name, setName] = useState("");
  const [field, setField] = useState<string>(KINDS.being.fields[0].key);
  const [body, setBody] = useState("");
  const [inserted, setInserted] = useState(false);
  const [pendingTarget, setPendingTarget] = useState<Row | null>(null);
  const [savedTarget, setSavedTarget] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const quoteHighlightRef = useRef<HTMLDivElement>(null);
  const bodyId = useId();
  const sourceHintId = useId();
  const afterWrite = useAfterWrite();
  const isCompendium = kind === "item" || kind === "magic_item";
  const config = KINDS[kind];
  const candidatesPath = isCompendium
    ? systemId && sectionId ? `/systems/${systemId}/entries?section_id=${sectionId}` : null
    : settingId ? `${config.path}?setting_id=${settingId}` : null;
  const candidatesQuery = useResource<Row[]>(candidatesPath);
  const candidates = (candidatesQuery.data ?? []).filter((row) => !isCompendium || row.kind === kind);
  const currentCardName = pendingTarget?.name ?? savedTarget?.name ?? name;
  const selectedQuoteStart = quote ? body.lastIndexOf(quote) : -1;
  const canSave = !!name.trim() && !!(isCompendium ? systemId && sectionId : settingId)
    && (mode === "create" || !!targetId);

  function syncQuoteHighlight() {
    if (quoteHighlightRef.current && bodyRef.current) {
      quoteHighlightRef.current.scrollTop = bodyRef.current.scrollTop;
    }
  }
  useLayoutEffect(syncQuoteHighlight, [body, quote]);

  useEffect(() => {
    let alive = true;
    void Promise.all([readResource<Row[]>("/settings"), readResource<Row[]>("/systems")]).then(([s, y]) => {
      if (alive) { setSettings(s); setSystems(y); }
    }).catch((reason) => { if (alive) setError(reason instanceof Error ? reason.message : "Не удалось загрузить контекст"); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    void readResource<{ setting_id: number | null; system_id: number | null }>(`/pdf-entity-sources/context/${resource.id}`)
      .then((context) => {
        if (!alive) return;
        if (context.setting_id) setSettingId(context.setting_id);
        if (context.system_id) setSystemId(context.system_id);
      }).catch(() => undefined);
    return () => { alive = false; };
  }, [resource.id]);

  useEffect(() => {
    if (!systemId) { setSections([]); return; }
    let alive = true;
    void readResource<Section[]>(`/systems/${systemId}/sections`).then((rows) => {
      if (alive) {
        setSections(rows);
        setSectionId((old) => {
          if (rows.some((r) => r.id === old)) return old;
          const matching = rows.filter((r) => r.kind === (kind === "magic_item" ? "magic_item" : "equipment"));
          return matching.length === 1 ? matching[0].id : 0;
        });
      }
    }).catch(() => { if (alive) setSections([]); });
    return () => { alive = false; };
  }, [systemId, kind]);

  useEffect(() => {
    if (mode !== "edit" || !targetId) return;
    let alive = true;
    const path = isCompendium ? `/systems/entries/${targetId}` : `${config.path}/${targetId}`;
    void readResource<Row>(path).then((row) => {
      if (alive) { setName(row.name); setBody(String(row[field] ?? "")); setInserted(false); }
    }).catch((reason) => { if (alive) setError(reason instanceof Error ? reason.message : "Не удалось открыть карточку"); });
    return () => { alive = false; };
  }, [mode, targetId, field, isCompendium, config.path]);

  function selectKind(next: PdfEntityKind) {
    setMode("create"); setKind(next); setField(KINDS[next].fields[0].key); setTargetId(0); setName(""); setBody("");
    if (next === "item" || next === "magic_item") setSectionId(0);
    setPendingTarget(null); setSavedTarget(null); setError(""); setInserted(false);
  }

  function selectCard(next: number) {
    setMode(next ? "edit" : "create");
    setTargetId(next);
    setName("");
    setBody("");
    setInserted(false);
    setSavedTarget(null);
    setError("");
  }

  function insertQuote() {
    if (!quote) return;
    setBody((current) => current ? `${current.trimEnd()}\n\n${quote}` : quote);
    setInserted(true);
  }

  function editLinked(source: PdfEntitySource) {
    setKind(source.target_kind); setMode("edit"); setField(source.field_name);
    setSettingId(source.target_setting_id ?? 0); setSystemId(source.target_system_id ?? 0);
    setSectionId(source.target_section_id ?? 0); setTargetId(source.target_id);
    setName(source.target_name); setBody(""); setInserted(false);
    setPendingTarget(null); setSavedTarget(null); setError("");
  }

  async function save() {
    if (!canSave) return;
    setBusy(true); setError("");
    let target = pendingTarget;
    try {
      if (!target) {
        if (mode === "create") {
          const createPath = isCompendium ? `/systems/${systemId}/entries` : config.path;
          target = await write.post<Row>(createPath, isCompendium
            ? { name: name.trim(), section_id: sectionId, kind }
            : { name: name.trim(), setting_id: settingId });
          setPendingTarget(target);
        } else target = { id: targetId, name };
      }
      const editPath = isCompendium ? `/systems/entries/${target.id}` : `${config.path}/${target.id}`;
      target = await write.put<Row>(editPath, { [field]: body });
      setPendingTarget(target);
      if (inserted && quote && page != null) {
        await write.post("/pdf-entity-sources", {
          resource_id: resource.id, target_kind: kind, target_id: target.id,
          field_name: field, page_number: page, quote,
        });
      }
      afterWrite([{ path: editPath }, ...(candidatesPath ? [{ path: candidatesPath }] : []),
        { path: `/pdf-entity-sources/resource/${resource.id}` },
        { path: `/pdf-entity-sources/entity/${kind}/${target.id}` }]);
      setSavedTarget(target); setPendingTarget(null); setInserted(false);
      if (mode === "create") { setMode("edit"); setTargetId(target.id); }
    } catch (reason) {
      if (target) setPendingTarget(target);
      setError(reason instanceof Error ? reason.message : "Не удалось сохранить Сущность или источник. Повторите сохранение.");
    } finally { setBusy(false); }
  }

  return <div className="pdf-reader__entity-panel" role="tabpanel" aria-label="Редактор Сущности">
    <div className="pdf-reader__entity-scroll">
      {sources.length > 0 && <details className="pdf-reader__entity-linked"><summary>Связано с этим PDF ({sources.length})</summary>
        {sources.map((source) => <button type="button" className="d-btn d-btn--sm" key={source.id} disabled={busy || !!pendingTarget} onClick={() => editLinked(source)}>
          {source.target_name || KINDS[source.target_kind].label} · {KINDS[source.target_kind].label}
          {source.page_number ? ` · стр. ${source.page_number}` : ""}
        </button>)}
      </details>}
      <div className="pdf-reader__entity-row">
        {isCompendium
          ? <EntitySelect label="Система" value={systemId} disabled={busy || !!pendingTarget} onChange={(event) => {
            setSystemId(Number(event.target.value)); setSectionId(0); selectCard(0);
          }}>
            <option value={0}>Выберите систему</option>
            {systems.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </EntitySelect>
          : <label className="pdf-reader__entity-field">
            <span>Система</span>
            <input className="d-select" readOnly value={systems.find((row) => row.id === systemId)?.name ?? ""} placeholder="—" />
          </label>}
        {isCompendium
          ? <EntitySelect label="Раздел" value={sectionId} disabled={busy || !systemId || !!pendingTarget} onChange={(event) => {
            setSectionId(Number(event.target.value)); selectCard(0);
          }}>
            <option value={0}>Выберите раздел</option>
            {sections.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </EntitySelect>
          : <EntitySelect label="Сеттинг" value={settingId} disabled={busy || !!pendingTarget} onChange={(event) => {
            setSettingId(Number(event.target.value)); selectCard(0);
          }}>
            <option value={0}>Выбрать сеттинг</option>
            {settings.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </EntitySelect>}
      </div>
      <EntitySelect label="Карточка" value={targetId} disabled={!!pendingTarget || busy}
        onChange={(event) => selectCard(Number(event.target.value))}>
        <option value={0}>Создать новую</option>
        {targetId !== 0 && !candidates.some((row) => row.id === targetId) &&
          <option value={targetId}>{currentCardName || "Загружаю карточку…"}</option>}
        {candidates.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
      </EntitySelect>
      <div className="pdf-reader__entity-row">
        <EntitySelect label="Вид" value={kind} disabled={busy || !!pendingTarget} onChange={(event) => selectKind(event.target.value as PdfEntityKind)}>
          {Object.entries(KINDS).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
        </EntitySelect>
        <EntitySelect label="Поле" value={field} disabled={busy || !!pendingTarget} onChange={(event) => setField(event.target.value)}>
          {config.fields.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
        </EntitySelect>
      </div>
      <label className="pdf-reader__entity-field">
        <span>Название</span>
        <input className="d-select" value={name} onChange={(event) => setName(event.target.value)}
          disabled={busy || mode === "edit" || !!pendingTarget} placeholder="Название сущности" />
      </label>
      <div className="pdf-reader__entity-editor">
        {quote && selectedQuoteStart < 0 && !inserted &&
          <blockquote className="pdf-reader__entity-preview"><mark>{quote}</mark></blockquote>}
        <div className="pdf-reader__entity-textbox">
          <div ref={quoteHighlightRef} className="pdf-reader__entity-markup" aria-hidden="true">
            {selectedQuoteStart >= 0
              ? <>{body.slice(0, selectedQuoteStart)}<mark>{quote}</mark>{body.slice(selectedQuoteStart + quote.length)}</>
              : body}
            {"\u200b"}
          </div>
          <textarea id={bodyId} ref={bodyRef} aria-label="Текст поля" aria-describedby={quote ? sourceHintId : undefined}
            value={body} readOnly={busy} onScroll={syncQuoteHighlight} onChange={(event) => setBody(event.target.value)} placeholder="Текст поля" />
        </div>
      </div>
      {quote && <>
        <button type="button" className="d-btn d-btn--sm pdf-reader__entity-insert" aria-controls={bodyId}
          onClick={insertQuote} disabled={busy || (mode === "edit" && !name)}>Вставить цитату в поле</button>
        <p id={sourceHintId} className="pdf-reader__entity-hint">
          {inserted && page != null
            ? `При сохранении к карточке добавится ссылка на PDF и страницу ${page}.`
            : page != null ? `Цитата из PDF · стр. ${page}` : "Цитата из PDF"}
        </p>
      </>}
      {(error || candidatesQuery.error) && <p role="alert" className="pdf-reader__entity-error">{error || candidatesQuery.error}</p>}
      {pendingTarget && <p>Карточка уже существует. Повторите сохранение связи с PDF.
        {" "}<Link to={detailPath(kind, pendingTarget, systemId)}>Открыть карточку ↗</Link></p>}
      <button type="button" className="d-btn pdf-reader__entity-submit" onClick={() => void save()} disabled={busy || !canSave}>
        {busy ? "Сохраняю…" : mode === "create" ? "Создать сущность" : "Сохранить изменения"}
      </button>
      {savedTarget && <p role="status">Сохранено. <Link to={detailPath(kind, savedTarget, systemId)}>Открыть карточку ↗</Link></p>}
    </div>
  </div>;
}
