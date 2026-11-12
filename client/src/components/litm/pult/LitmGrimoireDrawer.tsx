import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { compendiumPaths } from "../../../data/compendiumEntries";
import { useResource } from "../../../data/hooks";
import type { CompendiumEntry, SystemSection } from "../../../types";
import { NavIcon } from "../../NavIcons";
import { Article, ArticleRows } from "../LitmGrimoireView";
import { useGrimoire } from "../useGrimoire";
import { splitConsequence } from "../litmBookText";
import { EFFECT_NAMES, OUTCOMES, articleEffects, articleOutcome, grimGive, searchGrimoire, type GrimGive } from "../litmGrimoire";

const NO_ENTRIES: CompendiumEntry[] = [];
const NO_SECTIONS: SystemSection[] = [];
const GRIMOIRE_SECTION = "Гримуар действий";

type PickMenu = (e: MouseEvent, items: { label: string; onClick: () => void }[]) => void;

/**
 * Шторка «Гримуар» пульта «Вызовы» (Q8, доска Litm-Pult-Grimoire): поиск по
 * указателю книги, статья в одну колонку, из успеха — «Дать статус…» цели,
 * из последствия — статус герою в спотлайте, именованное — в лог.
 */
export function LitmGrimoireDrawer({ systemId, spotName, onGive, onLog, onScratch, onPick, onClose }: {
  systemId: number;
  spotName: string | null;
  onGive: (name: string, tier: number | undefined, toSpot: boolean) => void;
  onLog: (name: string) => void;
  onScratch: (e: MouseEvent) => void;
  onPick: PickMenu;
  onClose: () => void;
}) {
  const sectionsRes = useResource<SystemSection[]>(compendiumPaths.sections(systemId)).data;
  const sections = sectionsRes ?? NO_SECTIONS;
  const sectionId = sections.find((s) => s.name === GRIMOIRE_SECTION)?.id ?? 0;
  const entries = useResource<CompendiumEntry[]>(sectionId ? compendiumPaths.sectionEntries(systemId, sectionId) : null).data ?? NO_ENTRIES;
  const { chapters, articles, grim, tips, link } = useGrimoire(systemId, sectionId, entries);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<number | null>(null);
  const hits = useMemo(() => searchGrimoire(articles, query, 12), [articles, query]);
  const shownId = picked ?? hits[0]?.article.entry.id ?? null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector(".modal-backdrop, .context-menu")) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Ссылки статьи (крошки, соседние, «Название» (с. N)) листают шторку, а не уводят с пульта.
  function stayInside(e: MouseEvent) {
    const a = (e.target as HTMLElement).closest("a");
    if (!a || a.target === "_blank") return;
    const url = new URL(a.href, window.location.origin);
    if (url.pathname !== `/systems/${systemId}` || url.searchParams.get("section") !== String(sectionId)) return;
    e.preventDefault();
    setPicked(Number(url.searchParams.get("entry")));
  }

  const giveBtn = (label: string, statuses: GrimGive["statuses"], toSpot: boolean) => (
    <button
      type="button"
      className="lp-give"
      title={toSpot ? "Герою в спотлайте: уровень — в окне «Дать статус»" : "Цель и уровень — в окне «Дать статус»"}
      onClick={(e) =>
        statuses.length === 1
          ? onGive(statuses[0].name, statuses[0].tier, toSpot)
          : onPick(e, statuses.map((s) => ({ label: s.name, onClick: () => onGive(s.name, s.tier, toSpot) })))
      }
    >
      {label}
    </button>
  );

  const acts = {
    success: (text: string): ReactNode => {
      const g = grimGive(text);
      return g.statuses.length > 0 && giveBtn("Дать статус…", g.statuses, false);
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

  const at = articles.findIndex((a) => a.entry.id === shownId);
  const article = at >= 0 ? articles[at] : null;
  const chapter = chapters.find((c) => c.entry.id === (article ? article.chapterId : shownId)) ?? null;
  const chapterOf = (id: number) => chapters.find((c) => c.entry.id === id)?.entry.name ?? "";

  return (
    <>
      <div className="lp-dim" onClick={onClose} aria-hidden />
      <aside className="lp-grim litm-book" aria-label="Гримуар действий" onClickCapture={stayInside}>
        <header>
          <h2>Гримуар действий</h2>
          <span className="lp-mono">поиск по указателю</span>
          <span className="lp-end">
            {sectionId > 0 && (
              <a className="d-btn d-btn--sm d-btn--ghost" href={shownId ? link(shownId) : `/systems/${systemId}?section=${sectionId}`} target="_blank" rel="noreferrer">
                Открыть в справочнике ↗
              </a>
            )}
            <button type="button" className="d-btn d-btn--sm" aria-label="Закрыть Гримуар" onClick={onClose}>
              ✕
            </button>
          </span>
        </header>
        <div className="lp-grim__body">
          <label className="d-field">
            <NavIcon name="search" />
            <input
              type="search"
              autoFocus
              aria-label="Найти действие"
              placeholder="Найти действие: «подкуп», «обезоружить»…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPicked(null);
              }}
            />
          </label>
          {sectionsRes && !sectionId && <p className="lb-empty">В системе нет раздела «{GRIMOIRE_SECTION}».</p>}
          {query.trim() && (
            <div className="lp-ghits">
              <div className="lp-mono">
                Указатель · «{query.trim()}» — {hits.length || "ничего"}
              </div>
              {hits.map((h) => {
                const a = h.article;
                const effs = articleEffects(a).filter((k) => !OUTCOMES.has(k)).map((k) => EFFECT_NAMES[k] ?? k);
                const line = [h.phrase ? a.entry.name : chapterOf(a.chapterId), articleOutcome(a)?.toLocaleLowerCase("ru"), ...effs].filter(Boolean).join(" · ");
                return (
                  <button key={a.entry.id} type="button" className={`lp-ghit${a.entry.id === shownId ? " is-on" : ""}`} onClick={() => setPicked(a.entry.id)}>
                    <b>{h.phrase ?? a.entry.name}</b>
                    {a.page !== null && <em>с. {a.page}</em>}
                    <span>
                      {line}
                      {a.see && " → см."}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {article && chapter ? (
            <Article
              key={article.entry.id}
              a={article}
              chapter={chapter}
              prev={articles[at - 1] ?? null}
              next={articles[at + 1] ?? null}
              link={link}
              grim={grim}
              tips={tips}
              acts={acts}
            />
          ) : chapter ? (
            <section className="lg-chapter">
              <h3>{chapter.entry.name}</h3>
              <ArticleRows chapter={chapter} link={link} />
            </section>
          ) : (
            !query.trim() &&
            chapters.map((c) => (
              <section key={c.entry.id} className="lp-grim__ch">
                <h3>
                  <a href={link(c.entry.id)}>{c.entry.name}</a>
                </h3>
                <ArticleRows chapter={c} link={link} />
              </section>
            ))
          )}
        </div>
      </aside>
    </>
  );
}
