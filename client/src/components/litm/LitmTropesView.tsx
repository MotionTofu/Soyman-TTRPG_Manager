import { Fragment, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { addToBag } from "../../bag";
import { compendiumPaths } from "../../data/compendiumEntries";
import { useResource } from "../../data/hooks";
import type { CompendiumEntry, SystemSection } from "../../types";
import { NavIcon } from "../NavIcons";
import { MightMark, Tag } from "./LitmBook";
import { isLitmThemesSection, isMight, norm, plural } from "./litmBookText";
import { kitKey } from "./litmCompendium";

interface KitRef { name: string; name_original: string; theme: string; page?: string }
const NO_ENTRIES: CompendiumEntry[] = [];
const NO_SECTIONS: SystemSection[] = [];
const refs = (v: unknown) => (Array.isArray(v) ? (v as KitRef[]) : []);
const strs = (v: unknown) => (Array.isArray(v) ? (v as string[]) : []);

/** «Тропы» LitM — доска Litm-Tropes: десять групп книги, троп раскрывается под
 *  ними — три набора, один на выбор и рюкзак. Наборы — ссылками в «Темы». */
export function LitmTropesView({ systemId, entries, selectedId, onSelect }: {
  systemId: number;
  entries: CompendiumEntry[];
  selectedId: number | undefined;
  onSelect: (id: number | undefined) => void;
}) {
  const sections = useResource<SystemSection[]>(compendiumPaths.sections(systemId)).data ?? NO_SECTIONS;
  const themesSection = sections.find((s) => isLitmThemesSection(s.name));
  const waysSection = sections.find((s) => s.kind === "magic_way");
  const themeEntries = useResource<CompendiumEntry[]>(themesSection ? compendiumPaths.sectionEntries(systemId, themesSection.id) : null).data ?? NO_ENTRIES;
  const wayEntries = useResource<CompendiumEntry[]>(waysSection ? compendiumPaths.sectionEntries(systemId, waysSection.id) : null).data ?? NO_ENTRIES;
  // Наборы тем и наборы путей магии — по оригинальному имени книги (апострофы и пометки в скобках не важны).
  const { kitByName, bookByEn, wayById } = useMemo(() => ({
    kitByName: new Map([...themeEntries, ...wayEntries].filter((e) => e.kind === "theme_kit").map((e) => [kitKey(e.name_original ?? ""), e])),
    bookByEn: new Map(themeEntries.filter((e) => e.kind === "themebook").map((e) => [e.name_original, e])),
    wayById: new Map(wayEntries.filter((e) => e.kind === "magic_way").map((e) => [e.id, e])),
  }), [themeEntries, wayEntries]);

  const [query, setQuery] = useState("");
  const needle = norm(query.trim());
  const tropes = useMemo(() => entries.filter((e) => e.kind === "trope").sort((a, b) => a.position - b.position || a.id - b.id), [entries]);
  const groups = useMemo(() => {
    const map = new Map<string, CompendiumEntry[]>();
    for (const t of tropes) {
      const g = String(t.data?.group ?? "Без группы");
      map.set(g, [...(map.get(g) ?? []), t]);
    }
    return [...map.entries()];
  }, [tropes]);
  const hit = (t: CompendiumEntry) => !needle || norm([
    t.name, t.name_original, ...refs(t.data?.kits_fixed).map((k) => `${k.name} ${k.name_original}`),
    ...refs(t.data?.kits_choose).map((k) => `${k.name} ${k.name_original}`), ...strs(t.data?.backpack),
  ].join(" ")).includes(needle);
  const trope = selectedId !== undefined ? tropes.find((t) => t.id === selectedId) : undefined;

  const kitRow = (k: KitRef) => {
    const kit = kitByName.get(kitKey(k.name_original));
    const book = bookByEn.get(k.theme);
    const way = kit?.parent_id != null ? wayById.get(kit.parent_id) : undefined;
    const might = isMight(book?.data?.might) ? book.data.might : isMight(kit?.data?.might) ? kit.data.might : book ? undefined : "variable";
    const themeName = book?.name ?? way?.name ?? "путь магии";
    const target = kit ? `/systems/${systemId}?section=${kit.section_id}&entry=${kit.id}` : null;
    return (
      <div key={k.name_original} className="lb-tkit">
        <span className="lb-name">
          {target ? <Link to={target}>{k.name}</Link> : k.name}
          <small>{k.name_original}</small>
        </span>
        <span className="lb-tkit__meta">
          {might ? <MightMark might={might} label={themeName} /> : <span className="lb-mt">{themeName}</span>}
          {k.page && <span className="d-mono"> · {k.page}</span>}
        </span>
        {!book && <span className="lb-tkit__note">Путь магии — набор в разделе «Пути магии»</span>}
      </div>
    );
  };

  return (
    <div className="lb-tropes">
      <div className="lb-head">
        <h2>Тропы</h2>
        <span className="d-mono">{tropes.length} {plural(tropes.length, "троп", "тропа", "тропов")} · {groups.length} {plural(groups.length, "группа", "группы", "групп")} · быстрое создание героя</span>
      </div>
      <div className="lb-bar">
        <label className="d-field">
          <NavIcon name="search" />
          <input type="search" aria-label="Поиск тропа или набора" placeholder="Найти троп или набор…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      </div>
      <div className="lb-tgroups">
        {groups.map(([g, list]) => {
          const shown = list.filter(hit);
          if (needle && !shown.length) return null;
          return (
            <section key={g} className="lb-tgrp">
              <h3>{g}</h3>
              {shown.map((t) => (
                <button key={t.id} type="button" className={`lb-trow${t.id === trope?.id ? " is-on" : ""}`} aria-pressed={t.id === trope?.id}
                  onClick={() => onSelect(t.id === trope?.id ? undefined : t.id)}>
                  {t.name}
                </button>
              ))}
            </section>
          );
        })}
      </div>
      {!tropes.some(hit) && <p className="lb-empty">Ничего не найдено.</p>}
      {trope && (
        <article className="lb-art lb-trope" aria-label={`Троп: ${trope.name}`}>
          <div className="lb-art__head">
            <h3>{trope.name}<span className="lb-orig">[{trope.name_original}]</span></h3>
            <span className="d-end">
              <button type="button" className="d-btn d-btn--sm"
                onClick={() => addToBag({ type: "compendium_entry", id: trope.id, title: trope.name, kind: trope.kind, system_id: trope.system_id, section_id: trope.section_id })}>
                В мешок
              </button>
              <Link className="d-btn d-btn--sm" to={`/compendium/${trope.id}`}>Править</Link>
              <button type="button" className="d-btn d-btn--sm" onClick={() => onSelect(undefined)}>Свернуть ▴</button>
            </span>
          </div>
          <div className="lb-file"><span className="lb-kind">Троп</span><span>{String(trope.data?.group ?? "")}</span><span>быстрое создание героя</span></div>
          {typeof trope.data?.blurb === "string" && trope.data.blurb && <p className="lb-lead">{trope.data.blurb}</p>}
          <div className="lb-tcols">
            <div>
              <div className="lb-lbl">Три темы<small>Theme Kits</small></div>
              {refs(trope.data?.kits_fixed).map(kitRow)}
            </div>
            <div>
              <div className="lb-lbl">И одна на выбор<small>Choose One</small></div>
              {refs(trope.data?.kits_choose).map(kitRow)}
            </div>
          </div>
          {strs(trope.data?.backpack).length > 0 && (
            <div className="lb-backpack">
              <div className="lb-lbl">Рюкзак — один тег на выбор<small>Backpack</small></div>
              <div className="lb-tags">
                {strs(trope.data?.backpack).map((t, i) => <Fragment key={t}>{i > 0 && <span className="lb-or">или</span>}<Tag>{t}</Tag></Fragment>)}
              </div>
            </div>
          )}
          {typeof trope.data?.page === "string" && <div className="lb-src">Legend in the Mist · том I · с. {trope.data.page}</div>}
        </article>
      )}
    </div>
  );
}
