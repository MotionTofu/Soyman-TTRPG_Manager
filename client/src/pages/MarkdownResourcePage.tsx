import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { errorText, useAfterWrite, useResource, write } from "../data/hooks";
import { MentionText } from "../components/mentions/MentionText";
import { MentionTextarea } from "../components/mentions/MentionTextarea";
import type { Resource } from "../types";
import { getAuthToken } from "../api/client";
import "./pdf-markdown.css";

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
  const [editing, setEditing] = useState(false);
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

  return <section className="pdf-markdown markdown-resource">
    <header className="pdf-markdown__toolbar">
      <Link to={returnTo} onClick={event => {
        if (!dirty) return;
        event.preventDefault();
        void save().then(ok => { if (ok) navigate(returnTo); });
      }}>← Назад</Link>
      <strong>{resourceQuery.data.name}</strong>
      <span className="pdf-markdown__spacer" />
      <button type="button" onClick={() => setEditing(value => !value)} aria-pressed={editing}>
        {editing ? "Читать" : "Редактировать .md"}
      </button>
      <button type="button" onClick={download}>Скачать .md</button>
      <button type="button" onClick={() => void downloadBundle()} disabled={bundleBusy || saveState === "conflict"}>{bundleBusy ? "Собираю ZIP…" : "Скачать с вложениями"}</button>
    </header>
    {bundleError && <p role="alert">{bundleError}</p>}
    <main className="pdf-markdown__body">
      {editing ? <>
        <p className="pdf-markdown__hint">Исходный Markdown. Alt+Q открывает внутреннюю ссылку, Alt+W оформляет цитату. Если ссылка помечена «Вложение не прикреплено», прикрепите файл ниже и замените старую ссылку.</p>
        <div className="markdown-resource__insert-actions">
          <button type="button" onClick={() => { setResourcePicker("link"); setAttachmentError(""); }}>Вставить ссылку на Ресурс</button>
          <button type="button" onClick={() => { setResourcePicker("image"); setAttachmentError(""); }}>Вставить изображение</button>
        </div>
        {resourcePicker && <div className="markdown-resource__picker">
          <div className="markdown-resource__picker-head"><strong>{resourcePicker === "image" ? "Изображение" : "Ресурс"}</strong><button type="button" onClick={() => setResourcePicker(null)}>Закрыть</button></div>
          <label>Найти Ресурс <input value={resourceSearch} onChange={event => setResourceSearch(event.target.value)} placeholder="Название" /></label>
          <div className="markdown-resource__picker-list">
            {pickableResources.slice(0, 40).map(resource => <button type="button" key={resource.id} onClick={() => insertResource(resource)}>{resource.name}</button>)}
            {!pickableResources.length && <span>Подходящих Ресурсов нет</span>}
          </div>
          <label>Или прикрепить файл <input type="file" accept={resourcePicker === "image" ? "image/png,image/jpeg,image/gif,image/webp,image/avif" : "image/*,.pdf,.md"} onChange={event => setAttachment(event.target.files?.[0] ?? null)} /></label>
          <button type="button" disabled={!attachment || inserting} onClick={() => void uploadAttachment()}>{inserting ? "Прикрепляю…" : "Прикрепить и вставить"}</button>
          {attachmentError && <p role="alert">{attachmentError}</p>}
        </div>}
        <MentionTextarea value={draft} onChange={changeDraft} rows={18} insertRequest={insertRequest}
          onInsertHandled={key => setInsertRequest(previous => previous?.key === key ? null : previous)} />
        <div className="markdown-resource__actions">
          <button type="button" className="primary" onClick={() => void save()} disabled={!dirty || saveState === "saving" || saveState === "conflict"}>Сохранить файл</button>
          <span role="status">{saveState === "saving" ? "Сохраняю…" : saveState === "saved" ? "Сохранено" : saveState === "unsaved" ? "Черновик сохраняется автоматически" : saveError}</span>
          {saveState === "conflict" && <button type="button" onClick={download}>Скачать черновик .md</button>}
        </div>
        <h2>Предпросмотр</h2>
      </> : null}
      <article className="markdown-resource__preview"><MentionText text={draft} /></article>
    </main>
  </section>;
}
