import { Fragment, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { addToBag } from "../../bag";
import { useAction, useResource, write } from "../../data/hooks";
import { compendiumMembershipAffects } from "../../data/compendiumEntries";
import { labelled } from "../../data/notices";
import { useConfirm, usePrompt } from "../../hooks/useConfirm";
import { ContextMenu, type ContextMenuItem } from "../ContextMenu";
import type { CompendiumEntry, Statblock } from "../../types";
import { DSeg } from "../DSeg";
import { NavIcon } from "../NavIcons";
import { LitmChallengeProfile } from "./LitmChallengeProfile";
import { Rating, Roles } from "./LitmBook";
import { norm, plural } from "./litmBookText";
import {
  challengeProfile, challengeSearchText, emptyChallengeProfile, LOCATION_ORDER, OWN_LOCATION, ROLE_ORDER, toEntryData, toStatblockContent,
  type LitmChallengeProfileData,
} from "./litmChallenge";
import { litmChallengeAffects } from "./litmChallengeSave";

type Grouping = "place" | "role" | "alpha";
interface Row { entry: CompendiumEntry; statblock: Statblock | undefined; profile: LitmChallengeProfileData; search: string }

const NO_STATBLOCKS: Statblock[] = [];

/** «Вызовы» LitM — доска Litm-Challenges: каталог по местам книги, строка
 *  «имя · роли · пределы · рейтинг», профиль раскрывается под строкой. */
export function LitmChallengesView({ systemId, sectionId, entries, selectedId, onSelect }: {
  systemId: number;
  sectionId: number;
  entries: CompendiumEntry[];
  selectedId: number | undefined;
  onSelect: (id: number | undefined) => void;
}) {
  const navigate = useNavigate();
  const run = useAction();
  const [confirmDialog, confirm] = useConfirm();
  const [promptDialog, prompt] = usePrompt();
  const [menu, setMenu] = useState<{ x: number; y: number; entry: CompendiumEntry } | null>(null);

  // Новый вызов — сразу запись и пустой профиль, правка открывается на его странице.
  async function addChallenge() {
    const blank = emptyChallengeProfile("Новый вызов");
    const created = await run(labelled("Новый вызов", async () => {
      const entry = await write.post<CompendiumEntry>(`/systems/${systemId}/entries`, {
        section_id: sectionId, parent_id: null, kind: "monster", name: blank.title, level: null, data: toEntryData(blank), description: "",
      });
      await write.post("/statblocks", { owner_type: "compendium_entry", owner_id: entry.id, kind: "full", format: "litm_challenge", content: JSON.stringify(toStatblockContent(blank)) });
      return entry;
    }), { affects: [...compendiumMembershipAffects(systemId), { path: "/statblocks?owner_type=compendium_entry" }], retry: false });
    if (created) navigate(`/compendium/${created.id}?edit=1`);
  }

  async function rename(entry: CompendiumEntry, statblock: Statblock | undefined) {
    const name = (await prompt({ message: "Имя вызова", defaultValue: entry.name, confirmLabel: "Переименовать" }))?.trim();
    if (!name || name === entry.name) return;
    await run(labelled(`Переименование «${entry.name}»`, async () => {
      await write.put(`/systems/entries/${entry.id}`, { name });
      if (statblock) await write.put(`/statblocks/${statblock.id}`, { contentPatch: { title: name } });
    }), { affects: litmChallengeAffects(entry) });
  }

  async function remove(entry: CompendiumEntry) {
    if (!(await confirm({ message: `Удалить вызов «${entry.name}» вместе с профилем?`, confirmLabel: "Удалить", danger: true }))) return;
    if (selectedId === entry.id) onSelect(undefined);
    await run(labelled(`Удаление «${entry.name}»`, () => write.del(`/systems/entries/${entry.id}`)), { affects: compendiumMembershipAffects(systemId, entry.id) });
  }
  const ids = useMemo(() => entries.map((e) => e.id).sort((a, b) => a - b).join(","), [entries]);
  // ponytail: один запрос на раздел; правка статблока на странице записи
  // увидится здесь при следующем чтении (свежесть слоя — 30 с), не мгновенно.
  const statblocks = useResource<Statblock[]>(ids ? `/statblocks?owner_type=compendium_entry&owner_ids=${ids}` : null).data ?? NO_STATBLOCKS;
  const rows = useMemo<Row[]>(() => {
    const byOwner = new Map<number, Statblock>();
    for (const s of statblocks) if (s.format === "litm_challenge" && !byOwner.has(s.owner_id)) byOwner.set(s.owner_id, s);
    return entries.map((entry) => {
      const statblock = byOwner.get(entry.id);
      const profile = challengeProfile(entry, statblock);
      return { entry, statblock, profile, search: norm(challengeSearchText(profile)) };
    });
  }, [entries, statblocks]);

  const [query, setQuery] = useState("");
  const [grouping, setGrouping] = useState<Grouping>("place");
  const [role, setRole] = useState("");
  const [rating, setRating] = useState("");
  const [favOnly, setFavOnly] = useState(false);
  const [opened, setOpened] = useState<Set<string>>(() => new Set());
  const [closed, setClosed] = useState<Set<string>>(() => new Set());

  const needle = norm(query.trim());
  const shown = rows.filter((r) =>
    (!needle || r.search.includes(needle))
    && (!role || r.profile.roles.includes(role))
    && (!rating || String(r.profile.rating) === rating)
    && (!favOnly || r.entry.favourite));
  const filtering = !!(needle || role || rating || favOnly);

  const groups = useMemo(() => {
    const map = new Map<string, Row[]>();
    const put = (key: string, r: Row) => { const l = map.get(key) ?? []; l.push(r); map.set(key, l); };
    if (grouping === "alpha") {
      for (const r of [...shown].sort((a, b) => a.entry.name.localeCompare(b.entry.name, "ru"))) put(r.entry.name[0]?.toUpperCase() ?? "#", r);
      return [...map.entries()].map(([key, items]) => ({ key, items, en: "", page: "" }));
    }
    if (grouping === "role") {
      for (const r of shown) for (const x of r.profile.roles.length ? r.profile.roles : ["Без роли"]) put(x, r);
      const order = (k: string) => { const i = ROLE_ORDER.indexOf(k); return i < 0 ? 99 : i; };
      return [...map.entries()].sort((a, b) => order(a[0]) - order(b[0])).map(([key, items]) => ({ key, items, en: "", page: "" }));
    }
    for (const r of shown) put(r.profile.location, r);
    const order = (k: string) => { const i = LOCATION_ORDER.indexOf(k); return i < 0 ? LOCATION_ORDER.length - 1.5 : i; };
    return [...map.entries()].sort((a, b) => order(a[0]) - order(b[0])).map(([key, items]) => {
      const pages = items.map((r) => r.profile.page).filter((p) => /^B\d+$/.test(p)).map((p) => Number(p.slice(1)));
      return {
        key,
        items,
        en: key === OWN_LOCATION ? "вызовы Мастера" : items[0].profile.locationEn,
        page: pages.length ? `B${Math.min(...pages)}` : "",
      };
    });
  }, [shown, grouping]);

  const selectedGroup = groups.find((g) => g.items.some((r) => r.entry.id === selectedId))?.key;
  const isOpen = (key: string) => !closed.has(key) && (filtering || grouping !== "place" || opened.has(key) || key === selectedGroup
    || (!selectedGroup && key === groups[0]?.key));
  const toggle = (key: string) => {
    if (isOpen(key)) {
      setClosed((s) => new Set(s).add(key));
      setOpened((s) => { const n = new Set(s); n.delete(key); return n; });
    } else {
      setOpened((s) => new Set(s).add(key));
      setClosed((s) => { const n = new Set(s); n.delete(key); return n; });
    }
  };

  const book = rows.filter((r) => r.profile.location !== OWN_LOCATION);
  const addons = book.filter((r) => r.profile.addon).length;
  const own = rows.length - book.length;
  const ratings = [...new Set(rows.map((r) => r.profile.rating).filter(Boolean))].sort();
  const roles = ROLE_ORDER.filter((x) => rows.some((r) => r.profile.roles.includes(x)));

  return (
    <div className="lb-challenges">
      <div className="lb-head">
        <h2>Вызовы</h2>
        <span className="d-end"><button type="button" className="d-btn d-btn--sm" onClick={() => void addChallenge()}>+ Вызов</button></span>
        <span className="d-mono lb-head__sub">
          {book.length - addons} {plural(book.length - addons, "профиль", "профиля", "профилей")} книги · {addons} {plural(addons, "надстройка", "надстройки", "надстроек")} · {own} {plural(own, "свой", "своих", "своих")}
        </span>
      </div>
      <div className="lb-bar">
        <label className="d-field">
          <NavIcon name="search" />
          <input type="search" aria-label="Поиск вызова" placeholder="Найти вызов, тег или статус…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <select className="d-select" aria-label="Роль" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">Любая роль</option>
          {roles.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <select className="d-select" aria-label="Рейтинг" value={rating} onChange={(e) => setRating(e.target.value)}>
          <option value="">Любой рейтинг</option>
          {ratings.map((n) => <option key={n} value={String(n)}>Рейтинг {n}</option>)}
        </select>
        <button type="button" className={`d-btn d-btn--sm${favOnly ? " active" : ""}`} aria-pressed={favOnly} onClick={() => setFavOnly((v) => !v)}>★ Избранное</button>
      </div>
      <div className="lb-bar">
        <DSeg label="Группировка вызовов" value={grouping} onChange={setGrouping}
          items={[{ id: "place", label: "По местам" }, { id: "role", label: "Роли" }, { id: "alpha", label: "А–Я" }]} />
        <span className="d-mono">{grouping === "place" ? "порядок книги" : `${shown.length} / ${rows.length}`}</span>
      </div>
      {!shown.length && <p className="lb-empty">{filtering ? "Ничего не найдено." : "Вызовов пока нет."}</p>}
      {groups.map((g) => {
        const open = isOpen(g.key);
        return (
          <section key={g.key} className={`lb-group${open ? " is-open" : ""}`}>
            <button type="button" className="lb-group__head" aria-expanded={open} onClick={() => toggle(g.key)}>
              <b>{g.key}</b>
              {(g.en || g.page) && <small>{[g.en, g.page].filter(Boolean).join(" · ")}</small>}
              <i>{g.items.length} {open ? "▴" : "▾"}</i>
            </button>
            {open && (
              <div role="list">
                <div className="lb-crow lb-crow--head" aria-hidden="true"><span>Вызов</span><span>Роли</span><span>Пределы</span><span>Рейтинг</span><span /></div>
                {g.items.map(({ entry, profile }) => {
                  const active = entry.id === selectedId;
                  return (
                    <Fragment key={entry.id}>
                      <div role="listitem" className="lb-crow-wrap" onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, entry }); }}>
                      <button
                        type="button"
                        className={`lb-crow${active ? " is-open" : ""}`}
                        aria-expanded={active}
                        onClick={() => onSelect(active ? undefined : entry.id)}
                      >
                        <span className="lb-name">{entry.name}{profile.titleEn && <small>{profile.titleEn}</small>}</span>
                        <span><Roles roles={profile.roles} /></span>
                        <span className="lb-crow__lim">{profile.limitList.map((l) => `${l.name.toLocaleLowerCase("ru")} ${l.max}`).join(" · ") || "—"}</span>
                        <span>{profile.rating > 0 && <Rating value={profile.rating} />}</span>
                        <em aria-hidden="true">{active ? "▴" : "▾"}</em>
                      </button>
                      <button type="button" className="lb-crow__more" aria-label={`Действия: ${entry.name}`} aria-haspopup="menu"
                        onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom, entry }); }}>⋯</button>
                      </div>
                      {active && (
                        <div className="lb-cart">
                          <article className="lb-art" aria-label={`Вызов: ${entry.name}`}>
                            <div className="lb-art__head">
                              <h3>{entry.name}{profile.titleEn && <span className="lb-orig">[{profile.titleEn}]</span>}</h3>
                              <span className="d-end">
                                <button type="button" className="d-btn d-btn--sm"
                                  onClick={() => addToBag({ type: "compendium_entry", id: entry.id, title: entry.name, kind: entry.kind, system_id: entry.system_id, section_id: entry.section_id })}>
                                  В мешок
                                </button>
                                <Link className="d-btn d-btn--sm" to={`/compendium/${entry.id}`}>Профиль</Link>
                                <Link className="d-btn d-btn--sm" to={`/compendium/${entry.id}?edit=1`}>Править</Link>
                                <button type="button" className="d-btn d-btn--sm" onClick={() => onSelect(undefined)}>Свернуть ▴</button>
                              </span>
                            </div>
                            <div className="lb-file">
                              <span className="lb-kind">Профиль вызова</span>
                              <span>{profile.location}</span>
                              {profile.roles.length > 0 && <Roles roles={profile.roles} />}
                              {profile.rating > 0 && <span>рейтинг <Rating value={profile.rating} /></span>}
                            </div>
                            <LitmChallengeProfile profile={profile} />
                            {profile.page && <div className="lb-src">Legend in the Mist · том II · с. {profile.page}</div>}
                          </article>
                        </div>
                      )}
                    </Fragment>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} title={menu.entry.name} ariaLabel={`Действия: ${menu.entry.name}`} onClose={() => setMenu(null)}
          items={menuItems(menu.entry)} />
      )}
      {confirmDialog}
      {promptDialog}
    </div>
  );

  function menuItems(entry: CompendiumEntry): ContextMenuItem[] {
    const statblock = rows.find((r) => r.entry.id === entry.id)?.statblock;
    return [
      { label: "Открыть профиль", onClick: () => navigate(`/compendium/${entry.id}`) },
      { label: "Править", onClick: () => navigate(`/compendium/${entry.id}?edit=1`) },
      { label: "Переименовать", onClick: () => void rename(entry, statblock) },
      { label: "В мешок", onClick: () => addToBag({ type: "compendium_entry", id: entry.id, title: entry.name, kind: entry.kind, system_id: entry.system_id, section_id: entry.section_id }) },
      { label: "Удалить", danger: true, dividerBefore: true, onClick: () => void remove(entry) },
    ];
  }
}
