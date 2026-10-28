import { useState } from "react";
import { resolveCutsceneStep } from "@shared/cutscenes/resolve";
import type { CutsceneDocument } from "@shared/cutscenes/types";
import { MentionText } from "../mentions/MentionText";

/** Private read-only text browsing on both desktop and phone; no playback controls or autoscroll. */
export function CutsceneReading({ document }: { document: CutsceneDocument }) {
  const [picked, setPicked] = useState<string | null>(null);
  const stepId = document.steps.some(step => step.id === picked) ? picked : document.steps[0]?.id;
  const resolved = stepId ? resolveCutsceneStep(document, stepId) : null;
  return <section className="cutscene-reading" aria-label="Тексты и заметки">
    <h2>Тексты и заметки</h2>
    {!document.steps.length ? <p className="muted">В катсцене пока нет шагов.</p> : <>
      <label className="cutscene-reading__select">Шаг<select value={stepId ?? ""} onChange={event => setPicked(event.target.value)}>
        {document.steps.map((step, index) => <option key={step.id} value={step.id}>Шаг {index + 1}</option>)}
      </select></label>
      <div className="cutscene-reading__columns">
        <section aria-label="Текст ведущего"><h3>Текст ведущего</h3><div className="reading-text">
          {resolved?.text.text ? <MentionText text={resolved.text.text} mentionsAsBold /> : <p className="muted">На этом шаге нет текста для чтения.</p>}
        </div></section>
        <aside aria-label="Заметки шага"><h3>Заметки шага</h3><div className="reading-text">
          {resolved?.notes ? <MentionText text={resolved.notes} mentionsAsBold /> : <p className="muted">Заметок к шагу нет.</p>}
        </div></aside>
      </div>
    </>}
  </section>;
}
