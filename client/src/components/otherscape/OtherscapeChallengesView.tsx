import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { addToBag } from "../../bag";
import { MentionText } from "../mentions/MentionText";
import type { CompendiumEntry } from "../../types";
import { OtherscapeChallengeBody } from "./OtherscapeChallengeBody";
import { parseChallengePresentation } from "./challengePresentation";
import "./otherscape-views.css";

/** «Испытания» Otherscape — макет «Д» Roll-OS-Challenges: слева дерево
 *  категорий, справа досье выбранного испытания в главном блоке. */
export function OtherscapeChallengesView({ entries, query, difficulty = "", selectedId, onSelect }: {
  entries: CompendiumEntry[];
  query: string;
  difficulty?: string;
  selectedId: number | undefined;
  onSelect: (id: number) => void;
}) {
  const children = useMemo(() => {
    const map = new Map<number | null, CompendiumEntry[]>();
    for (const e of entries) {
      const list = map.get(e.parent_id) ?? [];
      list.push(e);
      map.set(e.parent_id, list);
    }
    return map;
  }, [entries]);
  const needle = query.trim().toLocaleLowerCase("ru");
  const matches = (e: CompendiumEntry) => {
    if (difficulty && String(parseChallengePresentation(e.description ?? "", e.name_original ?? "")?.difficulty) !== difficulty) return false;
    return !needle || e.name.toLocaleLowerCase("ru").includes(needle)
      || (e.name_original ?? "").toLocaleLowerCase("ru").includes(needle);
  };
  const categories = (children.get(null) ?? []).map((category) => ({
    category,
    items: (children.get(category.id) ?? []).filter(matches),
  })).filter((c) => !(needle || difficulty) || c.items.length > 0);
  const all = categories.flatMap((c) => c.items);
  const item = all.find((e) => e.id === selectedId) ?? all[0];
  const itemCategory = item && categories.find((c) => c.category.id === item.parent_id)?.category;
  // Раскрыта категория выбранного; остальные — по щелчку. При поиске видно всё.
  const [opened, setOpened] = useState<Set<number>>(() => new Set());
  const challenge = useMemo(
    () => item?.description ? parseChallengePresentation(item.description, item.name_original ?? "") : null,
    [item]
  );

  if (!all.length) return <p className="muted">{needle || difficulty ? "Ничего не найдено." : "Испытаний пока нет."}</p>;

  return (
    <div className="os-challenges">
      <nav className="os-cat" aria-label="Категории испытаний">
        {categories.map(({ category, items }) => {
          const open = !!needle || category.id === itemCategory?.id || opened.has(category.id);
          return (
            <div key={category.id}>
              <button
                type="button"
                className={`os-cat__group${open ? " is-open" : ""}`}
                aria-expanded={open}
                onClick={() => setOpened((prev) => {
                  const next = new Set(prev);
                  if (next.has(category.id)) next.delete(category.id); else next.add(category.id);
                  return next;
                })}
              >
                <span>{open ? "▾" : "▸"} {category.name}</span>
                <span className="os-cat__count">{items.length}</span>
              </button>
              {open && items.map((e) => (
                <button key={e.id} type="button" className={`os-cat__item${e.id === item?.id ? " active" : ""}`} aria-pressed={e.id === item?.id} onClick={() => onSelect(e.id)}>
                  {e.name}
                </button>
              ))}
            </div>
          );
        })}
      </nav>
      {item && (
        <section className="d-focal os-challenge" aria-label={`Испытание: ${item.name}`}>
          <div className="d-plate-row">
            <span className="d-mono">{[itemCategory?.name, item.name_original].filter(Boolean).join(" · ")}</span>
            <span className="d-end os-challenge__acts">
              <button
                type="button"
                className="d-btn d-btn--sm"
                onClick={() => addToBag({ type: "compendium_entry", id: item.id, title: item.name, kind: item.kind, system_id: item.system_id, section_id: item.section_id })}
              >
                В мешок
              </button>
              <Link className="d-btn d-btn--sm" to={`/systems/${item.system_id}?section=${item.section_id}&entry=${item.id}&view=list`}>Профиль</Link>
            </span>
          </div>
          <div className="otherscape-dossier">
            {challenge
              ? <OtherscapeChallengeBody catalog name={item.name} originalName={item.name_original ?? ""} challenge={challenge} />
              : <><h3 className="os-challenge__title">{item.name}</h3><MentionText text={item.description ?? ""} /></>}
          </div>
        </section>
      )}
    </div>
  );
}
