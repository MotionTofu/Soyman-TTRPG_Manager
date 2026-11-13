import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { NavIcon } from "../../NavIcons";
import { Article, ArticleRows } from "../LitmGrimoireView";
import { RulePage } from "../LitmRulesView";
import { grimoireHref } from "../useGrimoire";
import { splitConsequence } from "../litmBookText";
import { grimGive, type GrimGive } from "../litmGrimoire";
import { useLitmCompendium, type LitmArticleTarget } from "./useLitmCompendium";
import "./litm-pult.css";

interface GrimoireActions {
  spotName: string | null;
  onGive: (name: string, tier: number | undefined, toSpot: boolean, mode?: "give" | "reduce") => void;
  onLog: (name: string) => void;
  onScratch: (e: MouseEvent) => void;
  onPick: (e: MouseEvent, items: { label: string; onClick: () => void }[]) => void;
}

/** Чтение статей на пульте. В режиме «Вызовы» Гримуар также применяет эффекты. */
export function LitmCompendiumDrawer({ systemId, initialArticle, actions, onClose }: {
  systemId: number;
  initialArticle?: LitmArticleTarget;
  actions?: GrimoireActions;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<LitmArticleTarget | null>(initialArticle ?? null);
  const { rules, grimoire, rulesId, grimoireId, hits, loading, error, reload } = useLitmCompendium(systemId, query);
  const { chapters, articles, grim, tips, link } = grimoire;
  const body = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const page = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    return () => { if (opener?.isConnected) opener.focus({ preventScroll: true }); };
  }, []);

  useEffect(() => {
    (picked ? page.current : search.current)?.focus({ preventScroll: true });
    if (body.current) body.current.scrollTop = 0;
  }, [picked]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector(".modal-backdrop, .context-menu")) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Крошки, соседние статьи и ссылки книги открываются в этой же шторке.
  function stayInside(e: MouseEvent) {
    if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    const a = (e.target as HTMLElement).closest("a");
    if (!a || a.target === "_blank") return;
    const url = new URL(a.href, window.location.origin);
    if (url.origin !== window.location.origin || url.pathname !== `/systems/${systemId}`) return;
    const sectionId = Number(url.searchParams.get("section"));
    const entryId = Number(url.searchParams.get("entry"));
    if (!entryId || (sectionId !== rulesId && sectionId !== grimoireId)) return;
    e.preventDefault();
    setPicked({ sectionId, entryId });
  }

  const at = picked?.sectionId === grimoireId ? articles.findIndex((a) => a.entry.id === picked?.entryId) : -1;
  const article = articles[at];
  const chapter = picked?.sectionId === grimoireId ? chapters.find((c) => c.entry.id === (article?.chapterId ?? picked?.entryId)) : undefined;
  const acts = actions ? grimoireActions(actions) : undefined;

  return createPortal(
    <>
      <div className="lp-dim" onClick={onClose} aria-hidden />
      <aside className="lp-grim lp-compendium litm-book" role="dialog" aria-label="Компендиум" onClickCapture={stayInside}>
        <header>
          <h2>Компендиум</h2>
          <span className="lp-end">
            {picked && (
              <a className="d-btn d-btn--sm d-btn--ghost" href={grimoireHref(systemId, picked.sectionId, picked.entryId)} target="_blank" rel="noreferrer">
                В книге ↗
              </a>
            )}
            <button type="button" className="d-btn d-btn--sm" aria-label="Закрыть Компендиум" onClick={onClose}>✕</button>
          </span>
        </header>
        <div className="lp-grim__body" ref={body}>
          <label className="d-field">
            <NavIcon name="search" />
            <input
              ref={search}
              type="search"
              aria-label="Поиск по Справочнику и Гримуару"
              placeholder="Правило, термин или действие"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (picked) setPicked(null);
              }}
            />
          </label>
          {loading && <p className="lb-empty" role="status">Загружаем Компендиум…</p>}
          {error && <p className="lb-empty" role="alert">Не удалось загрузить Компендиум. <button type="button" className="d-btn d-btn--sm" onClick={reload}>Повторить</button></p>}
          {picked ? (
            <>
              <button type="button" className="d-btn d-btn--sm" onClick={() => setPicked(null)}>{query.trim() ? "← К результатам" : "← К поиску"}</button>
              <div ref={page} tabIndex={-1}>
                {picked.sectionId === rulesId ? (
                  <RulePage key={picked.entryId} book={rules} selectedId={picked.entryId} grim={{ ...rules.grim, article: grim.article }} />
                ) : article && chapter ? (
                  <Article key={article.entry.id} a={article} chapter={chapter} prev={articles[at - 1] ?? null} next={articles[at + 1] ?? null} link={link} grim={grim} tips={tips} acts={acts} />
                ) : chapter ? (
                  <section className="lg-chapter"><h3>{chapter.entry.name}</h3><ArticleRows chapter={chapter} link={link} /></section>
                ) : !loading && !error && <p className="lb-empty">Статья не найдена.</p>}
              </div>
            </>
          ) : query.trim() ? (
            <div className="lp-ghits">
              {hits.map(({ entry, source, phrase }) => (
                <button key={entry.id} type="button" className="lp-ghit" onClick={() => setPicked({ sectionId: entry.section_id, entryId: entry.id })}>
                  <b>{entry.name}</b><em>{source}</em>
                  {phrase && <span>{phrase}</span>}
                </button>
              ))}
              {!hits.length && !loading && !error && <p className="lb-empty">Ничего не найдено.</p>}
            </div>
          ) : (
            <>
              {rules.groups.length > 0 && <section className="lp-grim__ch">
                <h3>Справочник</h3>
                <ul className="lg-rows">{rules.groups.map((group) => (
                  <li key={group.entry.id}><a className="lg-row" href={rules.link(group.entry.id)}>{group.entry.name}</a></li>
                ))}</ul>
              </section>}
              {chapters.length > 0 && <section className="lp-grim__ch">
                <h3>Гримуар действий</h3>
                <ul className="lg-rows">{chapters.map((c) => (
                  <li key={c.entry.id}><a className="lg-row" href={link(c.entry.id)}>{c.entry.name}</a></li>
                ))}</ul>
              </section>}
              {!rules.groups.length && !chapters.length && !loading && !error && <p className="lb-empty">В Компендиуме пока нет статей Справочника и Гримуара.</p>}
            </>
          )}
        </div>
      </aside>
    </>,
    document.body,
  );
}

function grimoireActions({ spotName, onGive, onLog, onScratch, onPick }: GrimoireActions) {
  const giveBtn = (label: string, statuses: GrimGive["statuses"], toSpot: boolean, mode: "give" | "reduce" = "give") => (
    <button
      type="button"
      className="lp-give"
      title={toSpot ? "Герою в спотлайте: уровень — в окне «Дать статус»" : "Цель и уровень — в окне «Дать статус»"}
      onClick={(e) =>
        statuses.length === 1
          ? onGive(statuses[0].name, statuses[0].tier, toSpot, mode)
          : onPick(e, statuses.map((s) => ({ label: s.name, onClick: () => onGive(s.name, s.tier, toSpot, mode) })))
      }
    >
      {label}
    </button>
  );

  return {
    success: (text: string, effects: string[]): ReactNode => {
      const g = grimGive(text);
      const restorative = effects.includes("RESTORE") || effects.includes("SETBACK");
      const reduces = effects.includes("WEAKEN") || (restorative && /снять|снизить|ослабить/.test(text));
      if (effects.includes("LESSEN") || (!reduces && restorative && !/дать статус/.test(text))) return null;
      return g.statuses.length > 0 && giveBtn(reduces ? "Ослабить статус…" : "Дать статус…", g.statuses, false, reduces ? "reduce" : "give");
    },
    consequence: (text: string): ReactNode => {
      const effect = splitConsequence(text.replace(/\.$/, "")).effect;
      if (!effect) return null;
      const g = grimGive(effect);
      // «убеждён → Воин»: имя героя не склоняем
      const to = spotName ? ` → ${spotName}` : "";
      return (
        <>
          {g.statuses.length > 0 && giveBtn(`${g.statuses.length === 1 ? g.statuses[0].name : "Статус"}${to} ▾`, g.statuses, true)}
          {g.scratch && (
            <button type="button" className="lp-give" onClick={onScratch}>
              Вычеркнуть ▾
            </button>
          )}
          {g.named.map((n) => (
            <button key={n} type="button" className="lp-give lp-give--log" onClick={() => onLog(n)}>
              {g.named.length > 1 ? `В лог: ${n}` : "В лог"}
            </button>
          ))}
        </>
      );
    },
  };
}
