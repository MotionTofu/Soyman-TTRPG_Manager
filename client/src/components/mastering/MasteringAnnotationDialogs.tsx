import { useId } from "react";
import { Modal } from "../Modal";
import { MentionTextarea } from "../mentions/MentionTextarea";
import { MentionText } from "../mentions/MentionText";
import type { useMasteringAnnotations } from "./useMasteringAnnotations";

export function MasteringAnnotationDialogs({ annotations }: { annotations: ReturnType<typeof useMasteringAnnotations> }) {
  const { composer, opened, saving } = annotations;
  const textId = useId();
  return <>
    {annotations.dialog}
    {composer && <Modal wide className="mastering-book-modal mastering-note-modal" ariaLabel={composer.id ? "Редактирование заметки" : "Новая заметка"} closeOnBackdropClick={false} onClose={() => void annotations.closeComposer()}>
      <form className="mastering-book-form" onSubmit={event => { event.preventDefault(); void annotations.save(); }}>
        <h2>{composer.id ? "Редактирование заметки" : "Новая заметка"}</h2>
        <div className="mastering-book-form__body">
          {composer.draft.quote ? <blockquote className="mastering-note-quote">{composer.draft.quote}</blockquote> : <p className="muted">Ко всей книге</p>}
          <div className="mastering-text-field"><label htmlFor={textId}>Текст заметки</label><MentionTextarea id={textId} autoGrow={false} value={composer.body} onChange={body => annotations.setComposer({ ...composer, body })} placeholder="Markdown и ссылки на сущности" rows={8} /></div>
        </div>
        <div className="mastering-form-actions"><button type="button" disabled={saving} onClick={() => void annotations.closeComposer()}>Отмена</button><button type="submit" className="primary" disabled={saving || !composer.body.trim() || composer.body.length > 20_000}>{saving ? "Сохраняем…" : "Сохранить заметку"}</button></div>
      </form>
    </Modal>}
    {opened && <Modal wide className="mastering-book-modal mastering-note-modal" ariaLabel="Полная заметка" onClose={() => annotations.setOpenedId(null)}>
      <div className="mastering-book-form"><h2>Заметка</h2><div className="mastering-book-form__body">{opened.quote && <blockquote className="mastering-note-quote">{opened.quote}</blockquote>}<div className="reading-text"><MentionText text={opened.body} /></div></div><div className="mastering-form-actions">{opened.located && <button type="button" onClick={() => { annotations.actions.onLocate(opened); annotations.setOpenedId(null); }}>К цитате</button>}<button type="button" onClick={() => annotations.actions.onEdit(opened)}>Править</button><button type="button" onClick={() => annotations.setOpenedId(null)}>Закрыть</button></div></div>
    </Modal>}
  </>;
}
