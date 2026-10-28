import { cutsceneStepTitle, resolveCutsceneStep } from "@shared/cutscenes/resolve";
import type { CutsceneDocument } from "@shared/cutscenes/types";
import { MentionText } from "../mentions/MentionText";
import { CutsceneDraftFrame } from "./CutsceneDraftFrame";

/** Private read-only script on both desktop and phone: every step in order, no playback controls or autoscroll. */
export function CutsceneReading({ id, document }: { id?: number; document: CutsceneDocument }) {
  return <section className="cutscene-reading" aria-label="Тексты и заметки">
    <h2>Тексты и заметки</h2>
    {!document.steps.length ? <p className="muted">В катсцене пока нет шагов.</p> : <ol className="cutscene-reading__steps">
      {document.steps.map((step, index) => {
        const resolved = resolveCutsceneStep(document, step.id), from = document.steps.findIndex(row => row.id === resolved?.text.sourceStepId);
        return <li key={step.id} className="cutscene-reading__step">
          <header>{id !== undefined && <span className="cutscene-reading__thumb" aria-hidden="true"><CutsceneDraftFrame id={id} composition={resolved?.image.composition ?? null} /></span>}
            <h3>{cutsceneStepTitle(step, index)}</h3></header>
          {step.text.action === "replace" ? (step.text.text.trim() ? <div className="reading-text"><MentionText text={step.text.text} mentionsAsBold /></div> : <p className="muted">Текста нет.</p>)
            : step.text.action === "clear" ? <p className="cutscene-reading__inherit">Текст скрыт.</p>
            : from >= 0 ? <p className="cutscene-reading__inherit">Текст продолжается с шага «{cutsceneStepTitle(document.steps[from], from)}».</p> : null}
          {step.notes.trim() && <div className="reading-text cutscene-reading__notes" aria-label="Заметки шага"><MentionText text={step.notes} mentionsAsBold /></div>}
        </li>;
      })}
    </ol>}
  </section>;
}
