import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { compendiumPaths } from "../../data/compendiumEntries";
import { useResource } from "../../data/hooks";
import type { CompendiumEntry, SystemSection } from "../../types";
import { DSeg } from "../DSeg";
import { NavIcon } from "../NavIcons";
import type { GrimLinks } from "./LitmBook";
import { Paras } from "./LitmGrimoireView";
import { paras, plural } from "./litmBookText";
import { filterStore, storeOf, type StoreCategory, type StoreItem } from "./litmStore";

const NO_SECTIONS: SystemSection[] = [];
const NO_LINKS: GrimLinks = { article: () => null, rule: () => null };
const SHOWN = 9;

/** Предмет сюжетным тегом; пояснение книги — подсказкой при наведении и фокусе. */
function Item({ item }: { item: StoreItem }) {
  if (!item.note) return <span className="lb-ts">{item.name}</span>;
  return (
    <span className="ls-tip" tabIndex={0}>
      <span className="lb-ts">{item.name}</span>
      <span className="ls-tip__box" role="tooltip">{item.note}{item.nameEn && <small>{item.nameEn}</small>}</span>
    </span>
  );
}

function Row({ c, focus, coin }: { c: StoreCategory; focus: boolean; coin?: boolean }) {
  const e = c.entry;
  return (
    <div className={`ls-row${coin ? " ls-row--coin" : ""}${focus ? " is-on" : ""}`} id={`litm-bp-${e.id}`}>
      <b className="ls-row__name">{e.name}{e.name_original && <small>{e.name_original}</small>}{c.page && <i>с. {c.page}</i>}</b>
      <div>
        {e.description && <div className="ls-rule"><Paras lines={paras(e.description)} grim={NO_LINKS} /></div>}
        {c.subs.map((s) => (
          <div key={s.name} className="ls-items">
            {s.name && <span className="ls-sub">{s.name}</span>}
            {s.items.map((i) => <Item key={i.name} item={i} />)}
          </div>
        ))}
        {c.subs.filter((s) => s.text).map((s) => <p key={s.name} className="ls-note"><b>{s.name}.</b> {s.text}</p>)}
        {c.tail && <p className="ls-note">{c.tail}</p>}
      </div>
    </div>
  );
}

/** «Общая лавка» LitM по доске Litm-Store: рюкзак таблицей без раскрытий, Монеты, Награды. */
export function LitmStoreView({ systemId, entries, selectedId }: {
  systemId: number;
  entries: CompendiumEntry[];
  selectedId: number | undefined;
}) {
  const book = useMemo(() => storeOf(entries), [entries]);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"bag" | "rewards">(selectedId !== undefined && selectedId === book.rewards?.entry.id ? "rewards" : "bag");
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [pick, setPick] = useState<{ name: string; group: string } | null>(null);
  const shown = useMemo(() => filterStore(book, query), [book, query]);
  const sections = useResource<SystemSection[]>(compendiumPaths.sections(systemId)).data ?? NO_SECTIONS;
  const treasury = sections.find((s) => s.name === "Сокровищница");
  const searching = query.trim() !== "";
  useEffect(() => {
    if (selectedId !== undefined) document.getElementById(`litm-bp-${selectedId}`)?.scrollIntoView({ block: "center" });
  }, [selectedId, book]);

  const cats = book.categories.length + (book.coin ? 1 : 0);
  const rewardsTotal = book.rewards?.groups.reduce((n, g) => n + g.items.length, 0) ?? 0;
  const randomReward = () => {
    const all = book.rewards?.groups.flatMap((g) => g.items.map((i) => ({ name: i.name, group: g.name }))) ?? [];
    if (all.length) setPick(all[Math.floor(Math.random() * all.length)]);
  };
  const last = book.coin ?? book.categories[book.categories.length - 1];
  const bagPages = [book.intro?.data?.page, last?.page].filter((p): p is string => typeof p === "string" && p !== "");
  const rw = shown.rewards;
  return (
    <div className="lg ls">
      <div className="lb-head">
        <h2>Общая лавка</h2>
        <span className="d-mono">{cats} {plural(cats, "категория", "категории", "категорий")} · {rewardsTotal} {plural(rewardsTotal, "награда", "награды", "наград")}</span>
      </div>
      <div className="lb-bar">
        <label className="d-field">
          <NavIcon name="search" />
          <input type="search" aria-label="Найти предмет" placeholder="Найти предмет или тег: «кольчуга», «бинты», «лисёнок»…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        {!searching && <DSeg label="Часть лавки" value={tab} onChange={setTab} items={[{ id: "bag", label: "Рюкзак" }, { id: "rewards", label: "Награды" }]} />}
      </div>
      {(searching || tab === "bag") && (
        <>
          {!searching && book.intro?.description && <div className="lb-lead"><Paras lines={paras(book.intro.description)} grim={NO_LINKS} /></div>}
          {(shown.categories.length > 0 || shown.coin) && (
            <div className="ls-table">
              {shown.categories.map((c) => <Row key={c.entry.id} c={c} focus={c.entry.id === selectedId} />)}
              {shown.coin && <Row c={shown.coin} focus={shown.coin.entry.id === selectedId} coin />}
            </div>
          )}
        </>
      )}
      {(searching || tab === "rewards") && rw && (searching ? rw.groups.length > 0 : true) && (
        <section className="ls-rewards" id={`litm-bp-${rw.entry.id}`}>
          <h3>Награды<small>Rewards · что дать за выигранную сцену{rw.page && ` · с. ${rw.page}`}</small>
            {!searching && <button type="button" className="d-btn d-btn--sm" onClick={randomReward}>Случайная награда</button>}
          </h3>
          {!searching && (
            <>
              {rw.lead.length > 0 && <div className="lb-lead"><Paras lines={rw.lead} grim={NO_LINKS} /></div>}
              {pick && <p className="ls-pick" aria-live="polite"><span className="lb-ts">{pick.name}</span><small>{pick.group}</small></p>}
              <div className="ls-rwhead">
                {rw.parts.map((p) => (
                  <div key={p.head}>
                    <b>{p.head}</b>
                    <p>{p.text}</p>
                    {/сокровищ/i.test(p.head) && treasury && <Link to={`/systems/${systemId}?section=${treasury.id}`}>Сокровищница →</Link>}
                  </div>
                ))}
              </div>
            </>
          )}
          <div className="ls-rw">
            {rw.groups.map((g) => {
              const all = searching || open.has(g.name);
              return (
                <section key={g.name}>
                  <h4>{g.name}<small>{g.nameEn}</small></h4>
                  <div className="ls-items">
                    {(all ? g.items : g.items.slice(0, SHOWN)).map((i) => <span key={i.name} className="lb-ts" title={i.nameEn || undefined}>{i.name}</span>)}
                    {!all && g.items.length > SHOWN && (
                      <button type="button" className="ls-more" onClick={() => setOpen((s) => new Set(s).add(g.name))}>все {g.items.length} ›</button>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </section>
      )}
      {searching && !shown.categories.length && !shown.coin && !rw?.groups.length && <p className="lb-empty">Ничего не найдено.</p>}
      <div className="lb-src">
        Legend in the Mist{bagPages.length > 0 && ` · том I · с. ${bagPages.join("–")}`}{book.rewards?.page && ` · том II · с. ${book.rewards.page}`}
      </div>
    </div>
  );
}
