import { MentionText } from "../mentions/MentionText";
import { OtherscapeSource } from "./OtherscapeSource";
import { OtherscapeText } from "./OtherscapeText";
import { displayLimitName } from "./powerSetPresentation";
import type { ChallengePresentation } from "./challengePresentation";
import "./otherscape-power-sets.css";

export function OtherscapeChallengeBody({ name, originalName, challenge, catalog = false }: {
  name: string;
  originalName: string;
  challenge: ChallengePresentation;
  catalog?: boolean;
}) {
  const main = challenge.sections.filter(section => !["Limits", "Threats / Consequences"].includes(section.key));
  return <article className="oc-dossier" aria-label={`${name} [${originalName}]`}>
    <header className="oc-dossier-header">
      <h2>{name} <span className="oc-original-name">[{originalName}]</span></h2>
      <div className="oc-profile-metrics">
        <div className="oc-difficulty"><strong>{challenge.isPowerSet ? "+" : ""}{challenge.difficulty}</strong><span>{challenge.isPowerSet ? "К сложности" : "Сложность"}</span></div>
        {challenge.scale !== null && <div className="oc-scale"><strong>{challenge.scale}</strong><span>Масштаб [Scale]</span></div>}
      </div>
    </header>
    {challenge.description && <blockquote className="oc-flavor"><span aria-hidden="true">“</span><OtherscapeText text={challenge.description} /></blockquote>}
    {challenge.introduction && <div className="oc-introduction"><OtherscapeText text={challenge.introduction} /></div>}
    <div className="oc-mechanics oc-mechanics--with-limits">
      <div className="oc-main-rules">
        {main.map((section, index) => <section key={index}>
          {section.key === "Specials" && challenge.specials ? <>
            {catalog && <h3>Особые правила</h3>}
            {challenge.specialIntroduction && <div className="oc-special-introduction"><OtherscapeText text={challenge.specialIntroduction} /></div>}
            {challenge.specials.map((special, n) => <section className="oc-special" key={n}>
              <h3>{special.title}</h3><OtherscapeText text={special.text} />
            </section>)}
          </> : <><h3>{section.key === "Tags & Statuses" ? <>Базовые теги и статусы <span className="oc-section-original">[Tags & Statuses]</span></> : section.title}</h3><OtherscapeText text={section.text} /></>}
        </section>)}
      </div>
      <aside className="oc-limits" aria-label="Пределы — Limits">
        <div className="oc-limit-label">{catalog ? "Пределы" : "Пределы [Limits]"}</div>
        {challenge.limits?.map((limit, index) => <div className="oc-limit-value" key={index}>
          <strong>{displayLimitName(limit.name)}</strong>
          {catalog && limit.value !== null && limit.value > 0 && limit.value <= 10 && <i className="oc-limit-boxes" aria-hidden="true">{Array.from({ length: limit.value }, (_, n) => <i key={n} />)}</i>}
          <span>{limit.value ?? "–"}</span>
          <div className="oc-limit-translation">{limit.label}{limit.value === null ? " · иммунитет" : ""}</div>
        </div>)}
        {challenge.limitNotes && <OtherscapeText text={challenge.limitNotes} />}
      </aside>
    </div>
    {challenge.sections.filter(section => section.key === "Threats / Consequences").map((section, index) => <section className="oc-consequences" key={index}>
      <h3>Угрозы и возможные последствия <span className="oc-section-original">[Threats / Consequences]</span></h3>
      {challenge.threats ? <ol className="oc-threat-list">{challenge.threats.map((item, n) => <li key={n}>
        <div className="oc-threat"><OtherscapeText text={item.threat} /></div>
        {item.consequences && <div className="oc-threat-result"><OtherscapeText text={item.consequences} /></div>}
      </li>)}</ol> : <OtherscapeText text={section.text} />}
    </section>)}
    {challenge.original && <details className="oc-original"><summary>Оригинал — Original</summary><div className="oc-original-text"><MentionText text={challenge.original} /></div></details>}
    {challenge.related && <div className="oc-related"><MentionText text={challenge.related} /></div>}
    <OtherscapeSource source={challenge.source} pages={challenge.pages} />
  </article>;
}
