import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { errorText, useAfterWrite, useResource, write } from "../data/hooks";
import { MentionText } from "../components/mentions/MentionText";
import type { Resource } from "../types";
import { getAuthToken } from "../api/client";
import { SheetEditor } from "../components/sheet/SheetEditor";
import { SheetMenu, SheetView, rememberedSheetMode, type SheetMode } from "../components/sheet/SheetView";
import "./pdf-markdown.css";

const SHEET_MODES: SheetMode[] = ["source", "hybrid", "reading"];

const IMAGE_FILE_RE = /\.(?:png|jpe?g|gif|webp|avif)(?:\?|$)/i;

type MarkdownDocument = { resource_id: number; content: string; sha256: string };
type SaveState = "saved" | "unsaved" | "saving" | "conflict" | "error";

export function MarkdownResourcePage() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const from = (location.state as { from?: unknown } | null)?.from;
  const returnTo = typeof from === "string" && from.startsWith("/") && !from.startsWith("//") ? from : "/resources";
  const resourceQuery = useResource<Resource>(id ? `/resources/${id}` : null);
  const documentQuery = useResource<MarkdownDocument>(id ? `/resources/${id}/markdown-content` : null);
  const resourceList = useResource<Resource[]>("/resources");
  const [draft, setDraft] = useState("");
  const [dirty, setDirty] = useState(false);
  const [chosenMode, setChosenMode] = useState<SheetMode | null>(null);
  const [insertOpen, setInsertOpen] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  // На сенсорном экране правой кнопки нет — то же меню открывает «Aa» (Q27).
  const [menuRequest, setMenuRequest] = useState(0);
  const [coarsePointer] = useState(() => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches);
  const [version, setVersion] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState("");
  const [saveCycle, setSaveCycle] = useState(0);
  const [resourcePicker, setResourcePicker] = useState<"link" | "image" | null>(null);
  const [resourceSearch, setResourceSearch] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [attachmentError, setAttachmentError] = useState("");
  const [inserting, setInserting] = useState(false);
  const [bundleError, setBundleError] = useState("");
  const [bundleBusy, setBundleBusy] = useState(false);
  const [insertRequest, setInsertRequest] = useState<{ key: number; text: string } | null>(null);
  const nextInsertKey = useRef(0);
  const draftRef = useRef("");
  const savingRef = useRef(false);
  const afterWrite = useAfterWrite();

  useEffect(() => {
    if (!documentQuery.data || dirty) return;
    setDraft(documentQuery.data.content);
    draftRef.current = documentQuery.data.content;
    setVersion(documentQuery.data.sha256);
  }, [documentQuery.data]);

  const save = useCallback(async (): Promise<boolean> => {
    if (!dirty) return true;
    if (!id || !version || savingRef.current) return false;
    const submitted = draftRef.current;
    savingRef.current = true;
    setSaveState("saving");
    try {
      const result = await write.put<MarkdownDocument>(`/resources/${id}/markdown-content`,
        { content: submitted, expected_sha256: version }, { timeoutMs: 30_000 });
      setVersion(result.sha256);
      afterWrite([{ path: `/resources/${id}/markdown-content` }]);
      if (draftRef.current === submitted) {
        setDirty(false);
        setSaveState("saved");
        return true;
      } else {
        setSaveState("unsaved");
        setSaveCycle(value => value + 1);
        return false;
      }
    } catch (error) {
      const conflict = (error as { status?: number }).status === 409;
      setSaveState(conflict ? "conflict" : "error");
      setSaveError(errorText(error));
      return false;
    } finally {
      savingRef.current = false;
    }
  }, [afterWrite, dirty, id, version]);

  useEffect(() => {
    if (!dirty || saveState !== "unsaved") return;
    const timer = window.setTimeout(() => void save(), 1200);
    return () => window.clearTimeout(timer);
  }, [draft, dirty, save, saveCycle, saveState]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // Ctrl+S — сохранить сразу, не дожидаясь автосохранения.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      void save();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [save]);

  function changeDraft(value: string) {
    draftRef.current = value;
    setDraft(value);
    setDirty(true);
    setSaveState(previous => previous === "conflict" ? previous : "unsaved");
  }

  function insertResource(resource: Resource) {
    if (!resource.uid || !resourcePicker) return;
    const label = resource.name.replace(/([\\\[\]])/g, "\\$1");
    const token = `${resourcePicker === "image" ? "!" : ""}[${label}](soyman:resource/${resource.uid})`;
    setInsertRequest({ key: ++nextInsertKey.current, text: token });
    setResourcePicker(null);
    setResourceSearch("");
    setAttachment(null);
    setAttachmentError("");
  }

  async function uploadAttachment() {
    if (!attachment || !resourceQuery.data || !resourcePicker) return;
    const source = resourceQuery.data;
    const form = new FormData();
    form.append("name", attachment.name);
    form.append("scope", source.scope);
    if (source.campaign_id) form.append("campaign_id", String(source.campaign_id));
    if (source.session_id) form.append("session_id", String(source.session_id));
    if (source.setting_id) form.append("setting_id", String(source.setting_id));
    if (source.system_id) form.append("system_id", String(source.system_id));
    form.append("file", attachment);
    setInserting(true);
    setAttachmentError("");
    try {
      const created = await write.post<Resource>("/resources", form, { timeoutMs: 120_000 });
      if (!created.uid) throw new Error("У файла нет стабильного адреса");
      afterWrite([{ path: "/resources" }]);
      insertResource(created);
    } catch (error) { setAttachmentError(errorText(error)); }
    finally { setInserting(false); }
  }

  const pickableResources = (resourceList.data ?? []).filter(resource =>
    resource.id !== Number(id) && resource.type !== "pdf_notes" && !!resource.uid && resource.markdown_linkable && !!resource.file_url &&
    (resourcePicker !== "image" || resource.category === "image" || IMAGE_FILE_RE.test(resource.file_url ?? "")) &&
    resource.name.toLocaleLowerCase("ru").includes(resourceSearch.toLocaleLowerCase("ru")));

  function download() {
    const blob = new Blob([draft], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = resourceQuery.data?.name.toLowerCase().endsWith(".md") ? resourceQuery.data.name : `${resourceQuery.data?.name ?? "document"}.md`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function downloadBundle() {
    if (!id || bundleBusy || saveState === "conflict") return;
    setBundleBusy(true);
    setBundleError("");
    try {
      if (dirty && !await save()) throw new Error("Сначала сохраните Markdown");
      const response = await fetch(`/api/resources/${id}/markdown-bundle`, {
        headers: getAuthToken() ? { Authorization: `Bearer ${getAuthToken()}` } : undefined,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error || "Не удалось скачать комплект");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `${resourceQuery.data?.name ?? "document"}.zip`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setBundleError(errorText(error)); }
    finally { setBundleBusy(false); }
  }

  if (resourceQuery.loading || documentQuery.loading) return <p>Открываю Markdown…</p>;
  if (resourceQuery.error || documentQuery.error || resourceQuery.data?.type !== "markdown" || !documentQuery.data)
    return <p role="alert">Markdown-ресурс не найден. <Link to="/resources">К Ресурсам</Link></p>;

  const content = documentQuery.data.content;
  const mode: SheetMode = chosenMode ?? (content.trim() ? rememberedSheetMode(SHEET_MODES) ?? "reading" : "hybrid");
  const editing = mode !== "reading";
  const saveTitle = saveState === "saving" ? "Сохраняю…" : saveState === "saved" ? "Сохранено"
    : saveState === "unsaved" ? "Сохранить (Ctrl+S) — черновик сохраняется сам" : saveError || "Сохранить";
  function openPicker(kind: "link" | "image") {
    setResourcePicker(kind);
    setAttachmentError("");
  }

  const actions = <>
    {editing && <button type="button" className="sheet-btn sheet-btn--primary" title={saveTitle} aria-label={saveTitle}
      onClick={() => void save()} disabled={!dirty || saveState === "saving" || saveState === "conflict"}>
      ✓{dirty && <span className="sheet-btn__dot" />}
    </button>}
    {editing && coarsePointer && <button type="button" className="sheet-btn" title="Форматирование" aria-label="Форматирование"
      onClick={() => setMenuRequest(n => n + 1)}>Aa</button>}
    {editing && <SheetMenu label="Вставить" icon="+" wide open={insertOpen}
      onOpenChange={open => { setInsertOpen(open); if (!open) setResourcePicker(null); }}>
      {!resourcePicker ? <>
        <button type="button" onClick={() => openPicker("link")}>Ссылка на Ресурс</button>
        <button type="button" onClick={() => openPicker("image")}>Изображение</button>
        <span className="pdf-markdown__hint" style={{ padding: "4px 14px", fontSize: 12 }}>Alt+Q — внутренняя ссылка, Alt+W — цитата</span>
      </> : <div className="markdown-resource__picker" style={{ margin: 0, border: 0 }}>
        <div className="markdown-resource__picker-head"><strong>{resourcePicker === "image" ? "Изображение" : "Ресурс"}</strong><button type="button" onClick={() => setResourcePicker(null)}>Назад</button></div>
        <label>Найти Ресурс <input value={resourceSearch} onChange={event => setResourceSearch(event.target.value)} placeholder="Название" /></label>
        <div className="markdown-resource__picker-list">
          {pickableResources.slice(0, 40).map(resource => <button type="button" key={resource.id} onClick={() => { insertResource(resource); setInsertOpen(false); }}>{resource.name}</button>)}
          {!pickableResources.length && <span>Подходящих Ресурсов нет</span>}
        </div>
        <label>Или прикрепить файл <input type="file" accept={resourcePicker === "image" ? "image/png,image/jpeg,image/gif,image/webp,image/avif" : "image/*,.pdf,.md"} onChange={event => setAttachment(event.target.files?.[0] ?? null)} /></label>
        <button type="button" disabled={!attachment || inserting} onClick={() => void uploadAttachment().then(() => setInsertOpen(false))}>{inserting ? "Прикрепляю…" : "Прикрепить и вставить"}</button>
        {attachmentError && <p role="alert">{attachmentError}</p>}
      </div>}
    </SheetMenu>}
    <SheetMenu label="Скачать" icon="⤓" open={downloadOpen} onOpenChange={setDownloadOpen}>
      <button type="button" onClick={() => { download(); setDownloadOpen(false); }}>Скачать .md</button>
      <button type="button" disabled={bundleBusy || saveState === "conflict"}
        onClick={() => { void downloadBundle(); setDownloadOpen(false); }}>{bundleBusy ? "Собираю ZIP…" : "Скачать с вложениями"}</button>
    </SheetMenu>
  </>;

  const notice = (bundleError || saveState === "conflict" || saveState === "error") && <p role="alert" className="markdown-resource__notice">
    {bundleError || saveError}
    {saveState === "conflict" && <button type="button" onClick={download}>Скачать черновик .md</button>}
  </p>;

  return <section className="pdf-markdown markdown-resource">
    <SheetView docKey={`resource-md-${id}`} contentKey={draft} modes={SHEET_MODES} mode={mode} onMode={next => {
        // Уход в «Чтение» сохраняет набранное (Q10).
        if (next === "reading" && dirty) void save();
        setChosenMode(next);
      }}
      back={{ to: returnTo, label: "Назад", onClick: event => {
        if (!dirty) return;
        event.preventDefault();
        void save().then(ok => { if (ok) navigate(returnTo); });
      } }}
      actions={actions} notice={notice}>
      {editing
        ? <SheetEditor hybrid={mode === "hybrid"} value={draft} onChange={changeDraft} insertRequest={insertRequest} menuRequest={menuRequest}
            onInsertHandled={key => setInsertRequest(previous => previous?.key === key ? null : previous)} />
        : <MentionText text={draft} />}
    </SheetView>
  </section>;
}
