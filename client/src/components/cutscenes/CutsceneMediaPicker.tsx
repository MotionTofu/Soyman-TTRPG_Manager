import { useState } from "react";
import type { CutsceneMediaKind } from "@shared/cutscenes/types";
import type { GalleryImage, Resource } from "../../types";
import { useResource } from "../../data/hooks";
import { cutsceneMedia, workshopMediaPath, type WorkshopMedia, type WorkshopMediaSource } from "../../data/cutsceneMedia";
import { IMAGE_ACCEPT } from "../../imageUpload";
import { Modal } from "../Modal";
import { LoadErrorCard } from "../Loadable";
import { MentionPickerModal } from "../mentions/MentionPickerModal";

export function CutsceneMediaPicker({ id, kind, multiple = false, title, onPick, onClose }: {
  id: number; kind: CutsceneMediaKind; multiple?: boolean; title: string; onPick: (media: WorkshopMedia[]) => void; onClose: () => void;
}) {
  const [tab, setTab] = useState<"resources" | "gallery" | "own">("resources"), [search, setSearch] = useState("");
  const [owner, setOwner] = useState<{ type: string; id: number; title: string } | null>(null), [ownerPicker, setOwnerPicker] = useState(false);
  const [selection, setSelection] = useState<string[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const resources = useResource<Resource[]>(tab === "resources" ? `/resources?category=${kind}` : null);
  const gallery = useResource<GalleryImage[]>(tab === "gallery" && owner ? `/gallery?owner_type=${owner.type}&owner_id=${owner.id}` : null);
  const own = useResource<WorkshopMedia[]>(tab === "own" ? workshopMediaPath(id) : null);
  const rows: { key: string; name: string; url?: string | null; source?: WorkshopMediaSource; media?: WorkshopMedia }[] = tab === "resources"
    ? (resources.data ?? []).filter(row => row.file_path).map(row => ({ key: `r${row.id}`, name: row.name, url: kind === "image" ? row.file_url : null, source: { kind: "resource", id: row.id } }))
    : tab === "gallery" ? (gallery.data ?? []).map(row => ({ key: `g${row.id}`, name: row.caption || `Изображение ${row.position + 1}`, url: row.image_url, source: { kind: "gallery", id: row.id } }))
    : (own.data ?? []).filter(row => row.ref.kind === kind && row.state === "ready").map(row => ({ key: row.ref.id, name: row.name, media: row }));
  const query = tab === "resources" ? resources : tab === "gallery" ? gallery : own;
  async function selected() {
    if (busy) return; setBusy(true); setError(null);
    const result: WorkshopMedia[] = [];
    try {
      for (const key of selection) { const row = rows.find(candidate => candidate.key === key); if (!row) continue;
        result.push(row.media ?? await cutsceneMedia.importMedia(id, kind, row.source!)); }
      if (result.length) onPick(result); onClose();
    } catch (failure) {
      // Successful imports remain available even if a later file fails.
      if (result.length) { onPick(result); setSelection(old => old.filter(key => !selection.slice(0, result.length).includes(key))); }
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally { setBusy(false); }
  }
  async function upload(files: File[]) {
    if (!files.length || busy) return; setBusy(true); setError(null);
    const result: WorkshopMedia[] = [];
    try { for (const file of files) result.push(await cutsceneMedia.upload(id, kind, file)); onPick(result); onClose(); }
    catch (failure) { if (result.length) onPick(result); setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setBusy(false); }
  }
  return <Modal wide ariaLabel={title} closeOnBackdropClick={false} onClose={() => { if (!busy) onClose(); }}><div className="stack cs-media-picker">
    <h2>{title}</h2><p className="muted">Материал сохраняется как независимая версия катсцены. Локальный файл — до 200 МБ.</p>
    <div className="cs-toolbar"><label className="button">Загрузить с компьютера<input aria-label="Файлы с компьютера" type="file" accept={kind === "image" ? IMAGE_ACCEPT : ".mp3,.wav,.ogg,.m4a,.flac,.aac,.opus,.webm"}
      multiple={multiple} disabled={busy} onChange={event => { void upload(Array.from(event.target.files ?? [])); event.target.value = ""; }} /></label></div>
    <div className="cs-toolbar" role="group" aria-label="Источник материала">{([['resources',kind === 'image' ? 'Изображения' : 'Аудиотека'], ...(kind === 'image' ? [['gallery','Галерея записи']] : []), ['own','В этой катсцене']] as const).map(([key,label]) =>
      <button key={key} disabled={busy} aria-pressed={tab === key} onClick={() => { setTab(key as typeof tab); setSelection([]); }}>{label}</button>)}</div>
    {tab === "gallery" && <div className="cs-toolbar"><span>{owner?.title ?? "Выберите запись с галереей"}</span><button disabled={busy} onClick={() => setOwnerPicker(true)}>Выбрать запись</button></div>}
    <label>Поиск материала<input value={search} onChange={event => setSearch(event.target.value)} /></label>
    {query.error && <LoadErrorCard message={query.error} onRetry={query.reload} />}
    {query.loading ? <p>Загрузка…</p> : <div className="cs-media-list">{rows.filter(row => row.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(row =>
      <label key={row.key} className="cs-media-row"><input type={multiple ? "checkbox" : "radio"} name="cutscene-media" disabled={busy} checked={selection.includes(row.key)}
        onChange={event => setSelection(old => multiple ? event.target.checked ? [...old,row.key] : old.filter(key => key !== row.key) : [row.key])} />
        {row.url && <img src={row.url} alt="" loading="lazy" />}<span>{row.name}</span></label>)}
      {!rows.length && <p className="muted">Нет доступных локальных файлов.</p>}</div>}
    {(error || busy) && <p role={error ? "alert" : "status"}>{error ?? "Подготовка материалов…"}</p>}
    <div className="cs-toolbar"><button disabled={busy} onClick={onClose}>Закрыть</button><button className="primary" disabled={busy || !selection.length} onClick={() => void selected()}>Добавить{multiple ? ` (${selection.length})` : ""}</button></div>
  </div>{ownerPicker && <MentionPickerModal initialQuery="" heading="Запись с галереей" direct onlyTypes={["character","being","location","community","artifact","compendium_entry"]}
    onClose={() => setOwnerPicker(false)} onPick={result => { setOwner(result); setSelection([]); setOwnerPicker(false); }} />}</Modal>;
}
