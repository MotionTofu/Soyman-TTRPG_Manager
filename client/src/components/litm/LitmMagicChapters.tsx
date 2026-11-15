import { useEffect, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { LitmRich, type GrimLinks } from "./LitmBook";
import { Paras } from "./LitmGrimoireView";
import { BookText } from "./LitmRulesView";
import { paras } from "./litmBookText";
import { ingredientAnchor, type CauldronChapter, type MagicExample, type MagicIngredient, type Rote, type RotesChapter } from "./litmMagicChapterData";
import "./litm-magic-chapters.css";

function Examples({ example, entries }: { example: MagicExample; entries: Map<string, MagicIngredient> }) {
  const { search } = useLocation();
  return <>
    <p>{example.text}</p>
    <div className="lmc-parts">
      {example.ingredients.map((id) => {
        const ingredient = entries.get(id);
        return ingredient && <Link key={id} to={{ search, hash: "#" + ingredientAnchor(id) }} preventScrollReset>{ingredient.name}</Link>;
      })}
    </div>
  </>;
}

function Ingredients({ title, items, initial, grim }: {
  title: string; items: MagicIngredient[]; initial?: string; grim: GrimLinks;
}) {
  return <section aria-label={title}>
    <h4 className="lmc-band">{title}</h4>
    {items.map((item) => <details key={item.id} id={ingredientAnchor(item.id)} name="litm-cauldron-ingredients" open={item.id === initial}>
      <summary className="lmc-row">
        <b>{item.name}</b><small>с. {item.page}</small>
      </summary>
      <div className="lmc-detail">
        <i lang="en">{item.nameEn}</i>
        <Paras lines={paras(item.text)} grim={grim} />
        {!!item.variants?.length && <>
          <h5>Варианты</h5>
          <TextList items={item.variants} grim={grim} />
        </>}
      </div>
    </details>)}
  </section>;
}

export function LitmCauldron({ chapter, rotesHref, grim }: {
  chapter: CauldronChapter; rotesHref?: string; grim: GrimLinks;
}) {
  const { hash, key } = useLocation();
  const ids = new Map([...chapter.base, ...chapter.compound].map((item) => [item.id, item]));
  const [example, ...more] = chapter.examples;
  const linkedIngredient = [...ids.keys()].find((id) => "#" + ingredientAnchor(id) === hash);
  const initial = linkedIngredient ?? "preparation";

  useEffect(() => {
    if (!linkedIngredient) return;
    const target = document.getElementById(ingredientAnchor(linkedIngredient));
    if (!(target instanceof HTMLDetailsElement)) return;
    target.open = true;
    target.querySelector("summary")?.focus({ preventScroll: true });
    const frame = requestAnimationFrame(() => target.scrollIntoView({ block: "nearest" }));
    return () => cancelAnimationFrame(frame);
  }, [linkedIngredient, key]);

  return <div className="lmc-book lmc-cauldron">
    <section className="lmc-process" aria-label="Как собрать свой путь">
      <h4>Как собрать свой путь</h4>
      <ol>{chapter.steps.map((step) => (
        <li key={step.title}><b>{step.title}.</b> {step.text}{step.link && <> {rotesHref ?
          <Link className="lb-link" to={rotesHref}>{step.link}</Link> : step.link}.</>}</li>
      ))}</ol>
    </section>
    <Ingredients title="Базовые ингредиенты" items={chapter.base} initial={initial} grim={grim} />
    <Ingredients title="Составные ингредиенты" items={chapter.compound} initial={initial} grim={grim} />
    {example && <aside className="lmc-example">
      <header><h4>Пример · {example.name}</h4><small>с. {example.page}</small></header>
      <Examples example={example} entries={ids} />
    </aside>}
    {more.length > 0 && <section aria-label="Другие идеи для путей магии">
      <h4 className="lmc-band">Другие идеи для путей магии</h4>
      {more.map((item) => (
        <details key={item.name} name="litm-cauldron-examples">
          <summary className="lmc-row"><b>{item.name}</b><small>с. {item.page}</small></summary>
          <div className="lmc-detail"><Examples example={item} entries={ids} /></div>
        </details>
      ))}
    </section>}
    <BookText title="Правила Котла" sub="по книге" open={false}
      sections={chapter.rules.map((section) => ({ ...section, textEn: "" }))} grim={grim} />
  </div>;
}

function TextList({ items, grim }: { items: string[]; grim: GrimLinks }) {
  return <ul>{items.map((text) => <li key={text}><LitmRich text={text} grim={grim} /></li>)}</ul>;
}

function RoteRule({ title, children }: { title: string; children: ReactNode }) {
  return <div><dt>{title}</dt><dd>{children}</dd></div>;
}

function Formula({ formula, open, grim }: { formula: Rote; open: boolean; grim: GrimLinks }) {
  return <details name="litm-rotes" open={open}>
    <summary className="lmc-row">
      <span><b>{formula.name}</b><span className="lmc-practitioners">{formula.practitioners}</span></span>
      <small>{formula.page.replace(/^B/, "")}</small>
    </summary>
    <div className="lmc-detail">
      <i lang="en">{formula.nameEn}</i>
      <Paras lines={paras(formula.description)} grim={grim} />
      <dl>
        {formula.might && <RoteRule title="Могущество"><LitmRich text={formula.might} grim={grim} /></RoteRule>}
        <RoteRule title="Сила"><div><b>Помогает.</b> {formula.helps}</div><div><b>Мешает.</b> {formula.hinders}</div></RoteRule>
        <RoteRule title="Успех"><TextList items={formula.success} grim={grim} /></RoteRule>
        <RoteRule title="Дополнительные подвиги"><TextList items={formula.feats} grim={grim} /></RoteRule>
        <RoteRule title="Последствия"><TextList items={formula.consequences} grim={grim} /></RoteRule>
      </dl>
    </div>
  </details>;
}

export function LitmRotes({ chapter, grim }: { chapter: RotesChapter; grim: GrimLinks }) {
  return <section className="lmc-book lmc-rotes" aria-label="Формулы и те, кто их применяет">
    <div className="lmc-band lmc-column-labels"><span>Формула · кто применяет</span><span>Стр.</span></div>
    {chapter.items.map((formula) => <Formula key={formula.id} formula={formula} open={formula.id === "lightning-arc"} grim={grim} />)}
  </section>;
}
