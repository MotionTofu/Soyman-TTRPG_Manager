import { useEffect, useId, useState } from "react";
import { Modal } from "../Modal";
import { MentionTextarea } from "../mentions/MentionTextarea";
import { useConfirm } from "../../hooks/useConfirm";
import { useAction, useResource, write } from "../../data/hooks";
import { IMAGE_ACCEPT } from "../../imageUpload";
import type { MasteringSection, System } from "../../types";
import { MASTERING_CATEGORIES, type MasteringDraft } from "./masteringTypes";

export function MasteringBookForm({ initial, editing = false, systems, sections, onSubmit, onClose, hideCategory = false, placementOptions }: {
  initial: MasteringDraft;
  editing?: boolean;
  systems: System[];
  sections: MasteringSection[];
  onSubmit: (draft: MasteringDraft) => Promise<boolean>;
  onClose: () => void;
  hideCategory?: boolean;
  placementOptions?: {departments:{id:number;name:string}[];department:number|null;onChange:(id:number|null)=>void};
}) {
  const [draft, setDraft] = useState(initial);
  const textId = useId();
  const [saving, setSaving] = useState(false);
  const [coverMode, setCoverMode] = useState(initial.cover_image == null ? "auto" : initial.cover_image === "" ? "plain" : "custom");
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [coverError, setCoverError] = useState("");
  const run = useAction();
  const resourceUid = /^soyman:resource\/([0-9a-f-]{36})$/i.exec(draft.cover_image ?? "")?.[1];
  const resolved = useResource<{ file_url: string | null }[]>(resourceUid ? `/resources/resolve?uids=${resourceUid}` : null).data;
  const preview = filePreview ?? (resourceUid ? resolved?.[0]?.file_url : draft.cover_image);
  useEffect(() => {
    if (!coverFile) { setFilePreview(null); return; }
    const url = URL.createObjectURL(coverFile);
    setFilePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [coverFile]);
  const [dialog, confirm] = useConfirm();
  const changed = !!coverFile || JSON.stringify(draft) !== JSON.stringify(initial);
  async function close() {
    if (saving) return;
    if (changed && !(await confirm({ message: "Закрыть книгу без сохранения изменений?", confirmLabel: "Закрыть без сохранения" }))) return;
    onClose();
  }
  async function submit() {
    if (saving || !draft.title.trim()) return;
    setCoverError("");
    if (coverMode === "custom" && !coverFile && !/^(https?:\/\/[^\s]+|\/files\/[^\s]+|soyman:resource\/[0-9a-f-]{36})$/i.test(draft.cover_image ?? "")) {
      setCoverError("Загрузите изображение или укажите ссылку на него."); return;
    }
    setSaving(true);
    try {
      let cover_image = draft.cover_image;
      if (coverFile) {
        const data = new FormData();
        data.append("file", coverFile); data.append("name", `Обложка · ${draft.title.trim()}`); data.append("scope", "global"); data.append("category", "image"); data.append("type", "image");
        const uploaded = await run(() => write.post<{ uid: string }>("/resources", data, { timeoutMs: 120_000 }), { affects: [{ kind: "resource" }], retry: false });
        if (!uploaded) return;
        cover_image = `soyman:resource/${uploaded.uid}`;
        setDraft({ ...draft, cover_image }); setCoverFile(null);
      }
      if (await onSubmit({ ...draft, cover_image, title: draft.title.trim() })) onClose();
    }
    finally { setSaving(false); }
  }
  return <>
    <Modal wide className="mastering-book-modal" ariaLabel={editing ? "Редактирование книги" : "Новая книга"} closeOnBackdropClick={false} onClose={() => void close()}>
      <form className="mastering-book-form" onSubmit={event => { event.preventDefault(); void submit(); }}>
        <h2>{editing ? "Редактирование книги" : "Новая книга"}</h2>
        <div className="mastering-book-form__body">
        <label>Название<input required value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} placeholder="Как назовём книгу" /></label>
        <div className="mastering-form-columns">
          {placementOptions && <label>Подраздел<select value={placementOptions.department??""} onChange={event=>{placementOptions.onChange(event.target.value?Number(event.target.value):null);setDraft({...draft,section_id:null});}}><option value="">Без подраздела</option>{placementOptions.departments.map(department=><option key={department.id} value={department.id}>{department.name}</option>)}</select></label>}
          {!hideCategory && <label>Категория<select disabled={editing} value={draft.category} onChange={event => setDraft({ ...draft, category: event.target.value as MasteringDraft["category"], section_id: null })}>
            {MASTERING_CATEGORIES.map(category => <option key={category.key} value={category.key}>{category.label}</option>)}
          </select></label>}
          {(!editing || !hideCategory) && <label>Полка<select value={draft.section_id ?? ""} onChange={event => setDraft({ ...draft, section_id: event.target.value ? Number(event.target.value) : null })}>
            <option value="">Без раздела</option>
            {sections.filter(section => section.category === draft.category).map(section => <option key={section.id} value={section.id}>{section.name}</option>)}
          </select></label>}
          <label>Система<select value={draft.system_id ?? ""} onChange={event => setDraft({ ...draft, system_id: event.target.value ? Number(event.target.value) : null })}>
            <option value="">Без системы</option>
            {systems.map(system => <option key={system.id} value={system.id}>{system.name}</option>)}
          </select></label>
        </div>
        <fieldset className="mastering-cover-settings" disabled={saving}>
          <legend>Обложка</legend>
          <label>Оформление<select aria-label="Оформление" value={coverMode} onChange={event => { const mode = event.target.value; setCoverMode(mode); setCoverFile(null); setCoverError(""); setDraft({ ...draft, cover_image: mode === "auto" ? null : "" }); }}>
            <option value="auto">Изображение из статьи</option><option value="plain">Переплёт без картинки</option><option value="custom">Своя картинка</option>
          </select></label>
          {coverMode === "custom" && <div className="mastering-cover-settings__custom">
            {preview && <img className="mastering-cover-preview" src={preview} alt="Предпросмотр обложки" />}
            <div className="mastering-cover-settings__fields">
              <label>Загрузить обложку<input type="file" accept={IMAGE_ACCEPT} onChange={event => {
                const file = event.target.files?.[0]; if (!file) return;
                if (!/^image\/(jpeg|png|gif|webp|avif)$/.test(file.type) || file.size > 15 * 1024 * 1024) { setCoverError("Нужно изображение JPG, PNG, GIF, WebP или AVIF до 15 МБ."); event.target.value = ""; return; }
                setCoverFile(file); setCoverError("");
              }} /></label>
              <label>Или ссылка на изображение<input value={draft.cover_image ?? ""} onChange={event => { setCoverFile(null); setCoverError(""); setDraft({ ...draft, cover_image: event.target.value }); }} placeholder="https://…" /></label>
              {coverFile && <span className="muted">{coverFile.name}</span>}
            </div>
          </div>}
          {coverError && <p role="alert">{coverError}</p>}
        </fieldset>
        <div className="mastering-text-field"><label htmlFor={textId}>Текст статьи</label><MentionTextarea id={textId} autoGrow={false} value={draft.content} onChange={content => setDraft({ ...draft, content })} rows={12} placeholder="Markdown, изображения и [[ссылки]] на сущности" /></div>
        { /!\[[^\]]*\]\((?!https?:|soyman:|\/files\/)[^)]*\)/i.test(draft.content) && <p className="muted">Относительные пути изображений из Markdown нужно заменить ссылками на прикреплённые ресурсы.</p>}
        </div>
        <div className="mastering-form-actions"><button type="button" onClick={() => void close()} disabled={saving}>Отмена</button><button className="primary" type="submit" disabled={saving || !draft.title.trim()}>{saving ? "Сохраняем…" : editing ? "Сохранить" : "Добавить книгу"}</button></div>
      </form>
    </Modal>
    {dialog}
  </>;
}
