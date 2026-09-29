import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useAfterWrite, write } from "../data/hooks";
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

export function PdfEntityPanel({ resource, sources, quote, page, placement, onPlacementChange, onClose }: {
  resource: Resource; quote: string; page: number | null; placement: "left" | "right";
  sources: PdfEntitySource[];
  onPlacementChange: (value: "left" | "right") => void; onClose: () => void;
}) {
  const [mode, setMode] = useState<"create" | "edit">("create");
  const [kind, setKind] = useState<PdfEntityKind>("being");
  const [settings, setSettings] = useState<Row[]>([]);
  const [systems, setSystems] = useState<Row[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [candidates, setCandidates] = useState<Row[]>([]);
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
  const afterWrite = useAfterWrite();
  const isCompendium = kind === "item" || kind === "magic_item";
  const config = KINDS[kind];

  useEffect(() => {
    let alive = true;
    void Promise.all([api.get<Row[]>("/settings"), api.get<Row[]>("/systems")]).then(([s, y]) => {
      if (alive) { setSettings(s); setSystems(y); }
    }).catch((reason) => { if (alive) setError(reason instanceof Error ? reason.message : "Не удалось загрузить контекст"); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    void api.get<{ setting_id: number | null; system_id: number | null }>(`/pdf-entity-sources/context/${resource.id}`)
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
    void api.get<Section[]>(`/systems/${systemId}/sections`).then((rows) => {
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
    if (mode !== "edit" || !(isCompendium ? systemId && sectionId : settingId)) { setCandidates([]); return; }
    let alive = true;
    const path = isCompendium ? `/systems/${systemId}/entries?section_id=${sectionId}` :
      `${config.path}?setting_id=${settingId}`;
    void api.get<Row[]>(path).then((rows) => {
      if (alive) setCandidates(isCompendium ? rows.filter((r) => r.kind === kind) : rows);
    }).catch((reason) => { if (alive) setError(reason instanceof Error ? reason.message : "Не удалось загрузить карточки"); });
    return () => { alive = false; };
  }, [mode, kind, settingId, systemId, sectionId, isCompendium, config.path]);

  useEffect(() => {
    if (mode !== "edit" || !targetId) return;
    let alive = true;
    const path = isCompendium ? `/systems/entries/${targetId}` : `${config.path}/${targetId}`;
    void api.get<Row>(path).then((row) => {
      if (alive) { setName(row.name); setBody(String(row[field] ?? "")); setInserted(false); }
    }).catch((reason) => { if (alive) setError(reason instanceof Error ? reason.message : "Не удалось открыть карточку"); });
    return () => { alive = false; };
  }, [mode, targetId, field, isCompendium, config.path]);

  function selectKind(next: PdfEntityKind) {
    setKind(next); setField(KINDS[next].fields[0].key); setTargetId(0); setName(""); setBody("");
    if (next === "item" || next === "magic_item") setSectionId(0);
    setPendingTarget(null); setSavedTarget(null); setError(""); setInserted(false);
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
    setPendingTarget(null); setSavedTarget(null); setError("");
  }

  async function save() {
    if (!name.trim() || !(isCompendium ? systemId && sectionId : settingId) || (mode === "edit" && !targetId)) return;
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
      afterWrite([{ path: editPath }, { path: `/pdf-entity-sources/resource/${resource.id}` },
        { path: `/pdf-entity-sources/entity/${kind}/${target.id}` }]);
      setSavedTarget(target); setPendingTarget(null); setInserted(false);
      if (mode === "create") { setMode("edit"); setTargetId(target.id); }
    } catch (reason) {
      if (target) setPendingTarget(target);
      setError(reason instanceof Error ? reason.message : "Не удалось сохранить Сущность или источник. Повторите сохранение.");
    } finally { setBusy(false); }
  }

  return <aside className={`pdf-reader__entity-panel is-${placement}`} aria-label="Редактор Сущности">
    <div className="pdf-reader__entity-head"><strong>Сущность из PDF</strong><button type="button" aria-label="Закрыть редактор Сущности" onClick={onClose}>×</button></div>
    <div className="pdf-reader__entity-scroll">
      {sources.length > 0 && <details className="pdf-reader__entity-linked"><summary>Связано с этим PDF ({sources.length})</summary>
        {sources.map((source) => <button type="button" key={source.id} disabled={!!pendingTarget} onClick={() => editLinked(source)}>
          {source.target_name || KINDS[source.target_kind].label} · {KINDS[source.target_kind].label}
          {source.page_number ? ` · стр. ${source.page_number}` : ""}
        </button>)}
      </details>}
      <div className="pdf-reader__entity-switch" role="group" aria-label="Действие">
        <button type="button" disabled={!!pendingTarget} aria-pressed={mode === "create"} onClick={() => { setMode("create"); setTargetId(0); setName(""); setBody(""); setPendingTarget(null); setSavedTarget(null); setInserted(false); }}>Создать</button>
        <button type="button" disabled={!!pendingTarget} aria-pressed={mode === "edit"} onClick={() => { setMode("edit"); setTargetId(0); setName(""); setBody(""); setPendingTarget(null); setSavedTarget(null); setInserted(false); }}>Изменить</button>
      </div>
      <div className="pdf-reader__entity-switch" role="group" aria-label="Положение панели">
        <button type="button" aria-pressed={placement === "right"} onClick={() => onPlacementChange("right")}>Справа</button>
        <button type="button" aria-pressed={placement === "left"} onClick={() => onPlacementChange("left")}>Слева</button>
      </div>
      <label>Вид Сущности<select value={kind} disabled={!!pendingTarget} onChange={(event) => selectKind(event.target.value as PdfEntityKind)}>
        {Object.entries(KINDS).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
      </select></label>
      {isCompendium ? <>
        <label>Система<select value={systemId} disabled={!!pendingTarget} onChange={(event) => { setSystemId(Number(event.target.value)); setSectionId(0); setTargetId(0); }}>
          <option value={0}>Выберите систему</option>{systems.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
        </select></label>
        <label>Раздел<select value={sectionId} disabled={!!pendingTarget} onChange={(event) => { setSectionId(Number(event.target.value)); setTargetId(0); }}>
          <option value={0}>Выберите раздел</option>{sections.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
        </select></label>
      </> : <label>Сеттинг<select value={settingId} disabled={!!pendingTarget} onChange={(event) => { setSettingId(Number(event.target.value)); setTargetId(0); }}>
        <option value={0}>Выберите сеттинг</option>{settings.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
      </select></label>}
      {mode === "edit" && <label>Карточка<select value={targetId} disabled={!!pendingTarget} onChange={(event) => { setTargetId(Number(event.target.value)); setPendingTarget(null); setSavedTarget(null); setInserted(false); }}>
        <option value={0}>Выберите карточку</option>{candidates.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
      </select></label>}
      <label>Название<input value={name} onChange={(event) => setName(event.target.value)} disabled={mode === "edit" || !!pendingTarget} placeholder="Название Сущности" /></label>
      <label>Поле для текста<select value={field} disabled={!!pendingTarget} onChange={(event) => setField(event.target.value)}>
        {config.fields.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
      </select></label>
      {quote && <div className="pdf-reader__entity-quote"><small>PDF · стр. {page}</small><blockquote>{quote}</blockquote>
        <button type="button" onClick={insertQuote}>Вставить цитату в выбранное поле</button>
      </div>}
      <label>Текст поля<textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder="Текст можно редактировать" /></label>
      {inserted && <p className="muted">При сохранении к карточке добавится ссылка на PDF и страницу.</p>}
      {error && <p role="alert" className="pdf-reader__entity-error">{error}</p>}
      {pendingTarget && <p>Карточка уже существует. Повторите сохранение связи с PDF.
        {" "}<Link to={detailPath(kind, pendingTarget, systemId)}>Открыть карточку ↗</Link></p>}
      <button type="button" className="primary" onClick={() => void save()} disabled={busy || !name.trim() || !(isCompendium ? systemId && sectionId : settingId) || (mode === "edit" && !targetId)}>
        {busy ? "Сохраняю…" : mode === "create" ? "Создать Сущность" : "Сохранить изменения"}
      </button>
      {savedTarget && <p role="status">Сохранено. <Link to={detailPath(kind, savedTarget, systemId)}>Открыть карточку ↗</Link></p>}
    </div>
  </aside>;
}
