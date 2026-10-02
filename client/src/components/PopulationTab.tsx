import { useEffect, useMemo, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAction, useAfterWrite, useEntity, useResource, write } from "../data/hooks";
import { settingPaths } from "../data/settingEntities";
import { populationPaths } from "../data/settingPage";
import { useConfirm, usePrompt } from "../hooks/useConfirm";
import { useUndoDelete } from "../hooks/useUndoDelete";
import { CreatureCardLoader } from "./CreatureCard";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { EmptyState } from "./EmptyState";
import { EntityWizard } from "./entityWizard/EntityWizard";
import { ListSkeleton, Loadable } from "./Loadable";
import { LocationFilter } from "./LocationCascadePicker";
import { MentionText } from "./mentions/MentionText";
import { TypeGlyph } from "./TypeGlyph";
import { readRecentBeings } from "../populationRecent";
import type { BeingCategory, SettingBeing, SettingCommunity, SettingCommunityDetail, SettingLocation } from "../types";

// «Население» сеттинга на бумаге (разбор «Населения» 2026-10-01, Q1–Q14;
// макет — холст «Профили», доски 7–10).
//
// Вместо дерева категорий слева и плиток по страницам — один список, где
// вес личности виден размером (Q4/Q9): ключевые — карточками, влиятельные —
// плашками, занимательные — строками реестра. Справа — карточка «за столом»
// выбранного (Q3); щелчок выбирает, двойной щелчок или «Профиль ›»
// открывает профиль, стрелки двигают выбор (Q12). Без выбора справа — пять
// последних открытых (Q13). На узком окне карточка выезжает шторкой (Q14).

const SECTIONS = ["Личности", "Бестиарий", "Сообщества"] as const;
type Section = (typeof SECTIONS)[number];

const NO_BEINGS: SettingBeing[] = [];
const NO_COMMUNITIES: SettingCommunity[] = [];
const NO_LOCATIONS: SettingLocation[] = [];

const WEIGHTS: { key: BeingCategory; label: string }[] = [
  { key: "key_figure", label: "Ключевые фигуры" },
  { key: "influential", label: "Влиятельные" },
  { key: "notable", label: "Занимательные" },
];

function useDebounced(value: string, ms = 250): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

function firstSentence(text: string): string {
  // Ссылки — подписью, разметка цитаты — прочь: строке списка нужен текст.
  const plain = text.replace(/\[\[[^\]]*\|([^\]|]*)\]\]/g, "$1").replace(/\{\/?quote\}/g, "").trim();
  const m = plain.match(/^(.{0,140}?[.!?])(\s|$)/);
  return m ? m[1] : plain.slice(0, 140);
}

function parseRoles(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((r): r is string => typeof r === "string");
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((r): r is string => typeof r === "string") : [];
  } catch {
    return [];
  }
}

function Avatar({ name, url, size }: { name: string; url: string | null; size: "l" | "m" | "s" }) {
  return url ? (
    <img className={`pop-avatar is-${size}`} src={url} alt="" />
  ) : (
    <span className={`pop-mono is-${size}`} aria-hidden="true">
      {(name.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}

/**
 * Выбор, клавиатура и меню записи — общие у трёх подразделов. `order` —
 * записи в том порядке, в каком они нарисованы: стрелки идут по нему.
 */
function useListSelection(order: number[], openPath: (id: number) => string) {
  const navigate = useNavigate();
  const [selId, setSelId] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);

  // Выбранного больше нет в списке (поиск, фильтр) — выбор снимается.
  useEffect(() => {
    if (selId != null && !order.includes(selId)) setSelId(null);
  }, [order, selId]);

  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Enter") return;
    if (e.key === "Enter") {
      if (selId != null) navigate(openPath(selId));
      return;
    }
    e.preventDefault();
    const at = selId == null ? -1 : order.indexOf(selId);
    const next = order[e.key === "ArrowDown" ? Math.min(order.length - 1, at + 1) : Math.max(0, at - 1)];
    if (next == null) return;
    setSelId(next);
    e.currentTarget.querySelector<HTMLElement>(`[data-pop-id="${next}"]`)?.focus();
  }

  function itemProps(id: number, items: ContextMenuItem[]) {
    return {
      "data-pop-id": id,
      "aria-pressed": selId === id,
      onClick: () => setSelId(id),
      onDoubleClick: () => navigate(openPath(id)),
      onContextMenu: (e: MouseEvent) => {
        e.preventDefault();
        setSelId(id);
        setMenu({ x: e.clientX, y: e.clientY, items });
      },
    };
  }

  const menuNode = menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />;
  return { selId, setSelId, onKeyDown, itemProps, menuNode };
}

function Toolbar({
  query,
  onQuery,
  placeholder,
  chips,
  sort,
  onSort,
  extra,
  menuItems,
  createLabel,
  onCreate,
}: {
  query: string;
  onQuery: (q: string) => void;
  placeholder: string;
  chips: ReactNode;
  sort: "name" | "recent";
  onSort: (s: "name" | "recent") => void;
  extra?: ReactNode;
  menuItems?: ContextMenuItem[];
  createLabel: string;
  onCreate: () => void;
}) {
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  return (
    <div className="population__toolbar">
      <input
        type="search"
        className="population__search"
        placeholder={placeholder}
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        aria-label="Поиск"
      />
      {chips}
      <select value={sort} onChange={(e) => onSort(e.target.value as "name" | "recent")} aria-label="Сортировка">
        <option value="name">А–Я</option>
        <option value="recent">Недавние</option>
      </select>
      {extra}
      <span className="population__spacer" />
      {menuItems && menuItems.length > 0 && (
        <button
          type="button"
          aria-label="Ещё действия"
          aria-haspopup="menu"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setMenuAt({ x: r.right, y: r.bottom });
          }}
        >
          …
        </button>
      )}
      {menuAt && menuItems && (
        <ContextMenu x={menuAt.x} y={menuAt.y} items={menuItems} onClose={() => setMenuAt(null)} />
      )}
      <button type="button" className="population__create" onClick={onCreate}>
        + {createLabel}
      </button>
    </div>
  );
}

function Chip({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`population__chip${on ? " is-on" : ""}`} aria-pressed={on} onClick={onClick}>
      {on ? label : `+ ${label}`}
    </button>
  );
}

/** Правая колонка: карточка выбранного или «последние открытые». */
function Aside({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <aside className={`population__aside${open ? " is-open" : ""}`} aria-label="Карточка выбранного">
      <button type="button" className="population__sheet-close" aria-label="Закрыть карточку" onClick={onClose} />
      {children}
    </aside>
  );
}

function RecentList({ settingId, onPick }: { settingId: number; onPick: (id: number) => void }) {
  const recent = readRecentBeings(settingId);
  return (
    <div className="pop-recent">
      <span className="paper-label">Недавно открытые</span>
      {recent.length === 0 ? (
        <span className="muted">Щёлкните по записи — её карточка встанет здесь.</span>
      ) : (
        <ul>
          {recent.map((r) => (
            <li key={r.id}>
              <button type="button" className="mention-link mention--pop" onClick={() => onPick(r.id)}>
                {r.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Подразделы ────────────────────────────────────────────────────────────

export function PopulationTab({ settingId }: { settingId: number }) {
  const [section, setSection] = useState<Section>(() => {
    const p = new URLSearchParams(window.location.search).get("population");
    return (SECTIONS as readonly string[]).includes(p ?? "") ? (p as Section) : "Личности";
  });
  // Счётчики — те же списки, что читают разделы без фильтров: открытый раздел
  // берёт их из кэша, а правка в разделе обновляет и число на вкладке.
  const counts: Record<Section, number | null> = {
    Личности: useResource<SettingBeing[]>(populationPaths.beings(settingId)).data?.length ?? null,
    Бестиарий: useResource<SettingBeing[]>(populationPaths.bestiary(settingId)).data?.length ?? null,
    Сообщества: useResource<SettingCommunity[]>(populationPaths.communities(settingId)).data?.length ?? null,
  };
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("population", section);
    window.history.replaceState(null, "", url.toString());
  }, [section]);

  return (
    <div className="paper-sheet paper-scope population" id="population">
      <div className="population__subnav" role="tablist" aria-label="Подразделы населения">
        {SECTIONS.map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={section === s}
            className="population__subtab"
            onClick={() => setSection(s)}
          >
            {counts[s] != null ? `${s} · ${counts[s]}` : s}
          </button>
        ))}
      </div>
      {section === "Личности" && <PeopleSection settingId={settingId} />}
      {section === "Бестиарий" && <BestiarySection settingId={settingId} />}
      {section === "Сообщества" && <CommunitiesSection settingId={settingId} />}
    </div>
  );
}

function useBeingActions(beings: SettingBeing[], noun: string) {
  const run = useAction();
  const afterWrite = useAfterWrite();
  const [promptDialog, promptText] = usePrompt();
  const [confirmDialog, confirm] = useConfirm();
  const { deleteWithUndo } = useUndoDelete();

  async function archive(beingId: number) {
    const ok = await confirm({
      title: `Архивировать ${noun}?`,
      message: "Будет скрыта из списков, связи останутся. Можно восстановить в архиве.",
      confirmLabel: "Архивировать",
      danger: true,
    });
    if (!ok) return;
    const name = beings.find((b) => b.id === beingId)?.name ?? "Запись";
    await run(
      () =>
        deleteWithUndo({
          entityName: name,
          deleteFn: async () => {
            await write.del(`/setting-beings/${beingId}`);
          },
          restoreFn: async () => {
            await write.put(`/setting-beings/${beingId}/restore`);
            afterWrite([{ kind: "being" }]);
          },
        }).then(() => true),
      { affects: [{ kind: "being" }] }
    );
  }

  async function rename(being: SettingBeing) {
    const name = await promptText({ title: "Переименовать", message: "Имя", defaultValue: being.name });
    if (!name?.trim() || name.trim() === being.name) return;
    await run(() => write.put(`/setting-beings/${being.id}`, { name: name.trim() }).then(() => true), {
      affects: [{ kind: "being", id: being.id }],
    });
  }

  const menuFor = (b: SettingBeing, open: () => void): ContextMenuItem[] => [
    { label: "Открыть профиль", onClick: open },
    { label: "Переименовать", onClick: () => rename(b) },
    { label: "Архивировать", danger: true, onClick: () => archive(b.id) },
  ];

  return { dialogs: [confirmDialog, promptDialog], menuFor };
}

function PeopleSection({ settingId }: { settingId: number }) {
  const navigate = useNavigate();
  const run = useAction();
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounced(query);
  const [locationFilter, setLocationFilter] = useState("");
  const [communityFilter, setCommunityFilter] = useState("");
  const [openFilter, setOpenFilter] = useState<"location" | "community" | null>(null);
  const [sort, setSort] = useState<"name" | "recent">("name");
  const [grouping, setGrouping] = useState<"weight" | "community">("weight");
  const [creating, setCreating] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [bulkFaction, setBulkFaction] = useState("");

  // Последние фильтры — для крошки «Население» в профиле: назад к тому же списку.
  useEffect(() => {
    try {
      const p = new URLSearchParams();
      if (locationFilter) p.set("location_id", locationFilter);
      if (communityFilter) p.set("community_id", communityFilter);
      if (debouncedQuery.trim()) p.set("q", debouncedQuery.trim());
      const str = p.toString();
      if (str) sessionStorage.setItem(`population-last-filters-${settingId}`, str);
      else sessionStorage.removeItem(`population-last-filters-${settingId}`);
    } catch {
      /* без sessionStorage крошка просто ведёт в «Население» без фильтров */
    }
  }, [locationFilter, communityFilter, debouncedQuery, settingId]);

  const listState = useResource<SettingBeing[]>(
    populationPaths.beings(settingId, {
      locationId: locationFilter,
      communityId: communityFilter,
      query: debouncedQuery,
      sort,
      dir: sort === "recent" ? "desc" : "asc",
    }),
    { keepPrevious: true }
  );
  const beings = listState.data ?? NO_BEINGS;
  const locations = useResource<SettingLocation[]>(settingPaths.inSetting("location", settingId)).data ?? NO_LOCATIONS;
  const allCommunities = useResource<SettingCommunity[]>(settingPaths.inSetting("community", settingId)).data ?? NO_COMMUNITIES;
  const { dialogs, menuFor } = useBeingActions(beings, "личность");

  const groups = useMemo(() => {
    if (grouping === "weight") {
      return WEIGHTS.map((w) => ({ key: w.key, label: w.label, items: beings.filter((b) => b.category === w.key) })).filter(
        (g) => g.items.length > 0
      );
    }
    // По сообществам: состоящий в двух — в обеих группах; без сообщества — последней.
    const map = new Map<string, { label: string; items: SettingBeing[] }>();
    const none: SettingBeing[] = [];
    for (const b of beings) {
      const comms = (b as SettingBeing & { communities?: { id: number; name: string }[] }).communities ?? [];
      if (comms.length === 0) none.push(b);
      for (const c of comms) {
        const g = map.get(String(c.id)) ?? { label: c.name, items: [] };
        g.items.push(b);
        map.set(String(c.id), g);
      }
    }
    const out = [...map.entries()]
      .sort((a, b) => a[1].label.localeCompare(b[1].label, "ru"))
      .map(([key, g]) => ({ key, label: g.label, items: g.items }));
    if (none.length) out.push({ key: "none", label: "Без сообщества", items: none });
    return out;
  }, [beings, grouping]);

  const order = useMemo(() => groups.flatMap((g) => g.items.map((b) => b.id)), [groups]);
  const sel = useListSelection(order, (id) => `/beings/${id}`);

  function toggleChecked(id: number) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function bulkAddToFaction() {
    if (!bulkFaction || checked.size === 0) return;
    const ids = Array.from(checked);
    const done = await run(
      () => Promise.all(ids.map((id) => write.post(`/setting-communities/${bulkFaction}/members`, { being_id: id }))).then(() => true),
      // Состав виден и у сообщества, и в «Сообществах» каждого существа.
      { affects: [{ kind: "being" }, { kind: "community", id: Number(bulkFaction) }] }
    );
    if (done) setChecked(new Set());
  }

  function itemFor(b: SettingBeing) {
    const props = sel.itemProps(b.id, menuFor(b, () => navigate(`/beings/${b.id}`)));
    return selecting
      ? { ...props, onClick: () => toggleChecked(b.id), "aria-pressed": checked.has(b.id) }
      : props;
  }

  const comms = (b: SettingBeing) => (b as SettingBeing & { communities?: { id: number; name: string }[] }).communities ?? [];
  const isSelected = (id: number) => (selecting ? checked.has(id) : sel.selId === id);

  function keyCard(b: SettingBeing) {
    const want = b.force?.want?.trim();
    return (
      <button key={b.id} type="button" className={`pop-item${isSelected(b.id) ? " is-selected" : ""}`} {...itemFor(b)}>
        <Avatar name={b.name} url={b.avatar_image_url} size="l" />
        <span className="pop-item__text">
          <span className="pop-item__name">{b.name || "Без названия"}</span>
          {(b.aliases ?? [])[0] && <span className="pop-item__alias">«{b.aliases[0]}»</span>}
          <span className="pop-item__line">
            {want ? (
              <>
                <b>хочет:</b> <MentionText text={want} />
              </>
            ) : (
              firstSentence(b.description ?? "")
            )}
          </span>
          {comms(b).length > 0 && (
            <span className="pop-item__chips">
              {comms(b).map((c) => (
                <span key={c.id} className="pop-item__chip">
                  {c.name}
                </span>
              ))}
            </span>
          )}
        </span>
      </button>
    );
  }

  function inflCard(b: SettingBeing) {
    const c = comms(b)[0];
    return (
      <button key={b.id} type="button" className={`pop-item${isSelected(b.id) ? " is-selected" : ""}`} {...itemFor(b)}>
        <Avatar name={b.name} url={b.avatar_image_url} size="m" />
        <span className="pop-item__text">
          <span className="pop-item__name">{b.name || "Без названия"}</span>
          <span className="pop-item__line is-clamped">
            {(b.aliases ?? [])[0] ? `«${b.aliases[0]}»` : firstSentence(b.description ?? "")}
            {c && ` · ${c.name}`}
          </span>
        </span>
      </button>
    );
  }

  function row(b: SettingBeing) {
    return (
      <li key={b.id}>
        <button type="button" className={`pop-row${isSelected(b.id) ? " is-selected" : ""}`} {...itemFor(b)}>
          <span>{b.name || "Без названия"}</span>
          <span className="pop-row__muted">{b.locations.map((l) => l.name).join(", ") || "—"}</span>
          <span className="pop-row__muted">{comms(b).map((c) => c.name).join(", ") || "—"}</span>
        </button>
      </li>
    );
  }

  return (
    <div className="population__body">
      {dialogs}
      {sel.menuNode}
      {creating && <EntityWizard initialType="being" ctx={{ settingId }} onClose={() => setCreating(false)} />}
      <Toolbar
        query={query}
        onQuery={setQuery}
        placeholder="Имя, прозвище, сообщество…"
        chips={
          <>
            <Chip
              label={locationFilter ? locations.find((l) => String(l.id) === locationFilter)?.name ?? "Место" : "Место"}
              on={!!locationFilter || openFilter === "location"}
              onClick={() => (locationFilter ? setLocationFilter("") : setOpenFilter(openFilter === "location" ? null : "location"))}
            />
            <Chip
              label={
                communityFilter === "none"
                  ? "Без сообщества"
                  : communityFilter
                    ? allCommunities.find((c) => String(c.id) === communityFilter)?.name ?? "Сообщество"
                    : "Сообщество"
              }
              on={!!communityFilter || openFilter === "community"}
              onClick={() =>
                communityFilter ? setCommunityFilter("") : setOpenFilter(openFilter === "community" ? null : "community")
              }
            />
          </>
        }
        sort={sort}
        onSort={setSort}
        extra={
          <div className="population__seg" role="group" aria-label="Группировка">
            <button type="button" aria-pressed={grouping === "weight"} onClick={() => setGrouping("weight")}>
              по весу
            </button>
            <button type="button" aria-pressed={grouping === "community"} onClick={() => setGrouping("community")}>
              по сообществам
            </button>
          </div>
        }
        menuItems={[
          {
            label: selecting ? "Закончить выбор" : "Выбрать несколько",
            onClick: () => {
              setSelecting(!selecting);
              setChecked(new Set());
            },
          },
        ]}
        createLabel="Создать личность"
        onCreate={() => setCreating(true)}
      />
      {openFilter === "location" && !locationFilter && (
        <div className="population__filters">
          <LocationFilter
            locations={locations}
            value={locationFilter}
            onChange={(v) => {
              setLocationFilter(v);
              setOpenFilter(null);
            }}
          />
        </div>
      )}
      {openFilter === "community" && !communityFilter && (
        <div className="population__filters">
          <select
            value=""
            onChange={(e) => {
              setCommunityFilter(e.target.value);
              setOpenFilter(null);
            }}
            aria-label="Сообщество"
          >
            <option value="">Выберите сообщество…</option>
            <option value="none">Без сообщества</option>
            {allCommunities.map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {selecting && (
        <div className="population__filters">
          <span className="muted">Выбрано {checked.size}</span>
          <select value={bulkFaction} onChange={(e) => setBulkFaction(e.target.value)} aria-label="Сообщество для выбранных">
            <option value="">Добавить в сообщество…</option>
            {allCommunities.map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.name}
              </option>
            ))}
          </select>
          <button type="button" className="primary" disabled={!bulkFaction || checked.size === 0} onClick={bulkAddToFaction}>
            Добавить
          </button>
          <button type="button" onClick={() => setChecked(new Set(beings.map((b) => b.id)))}>
            Выбрать всех
          </button>
        </div>
      )}
      <Loadable
        loading={listState.loading}
        error={listState.data ? null : listState.error}
        errorTitle="Не удалось загрузить личностей"
        onRetry={listState.reload}
        skeleton={<ListSkeleton variant="rows" label="Загрузка личностей" />}
        empty={
          beings.length === 0 ? (
            <EmptyState
              title={debouncedQuery || locationFilter || communityFilter ? "Никого не нашлось" : "Личностей пока нет"}
              hint="Ключевые фигуры, влиятельные и занимательные — начните с первой."
              action={
                <button className="primary" onClick={() => setCreating(true)}>
                  Создать личность
                </button>
              }
            />
          ) : null
        }
      >
        <div className="population__split">
          <div className="population__list" onKeyDown={sel.onKeyDown}>
            {groups.map((g) => (
              <section key={g.key}>
                <h3 className="pop-group__head">
                  {g.label} <span className="pop-group__count">{g.items.length}</span>
                </h3>
                {grouping === "weight" && g.key === "key_figure" ? (
                  <div className="pop-keys">{g.items.map(keyCard)}</div>
                ) : grouping === "weight" && g.key === "influential" ? (
                  <div className="pop-infl">{g.items.map(inflCard)}</div>
                ) : (
                  <ul className="pop-rows">{g.items.map(row)}</ul>
                )}
              </section>
            ))}
          </div>
          <Aside open={sel.selId != null} onClose={() => sel.setSelId(null)}>
            {sel.selId != null ? (
              <CreatureCardLoader key={sel.selId} type="being" id={sel.selId} variant="page" />
            ) : (
              <RecentList settingId={settingId} onPick={(id) => navigate(`/beings/${id}`)} />
            )}
          </Aside>
        </div>
      </Loadable>
    </div>
  );
}

function BestiarySection({ settingId }: { settingId: number }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounced(query);
  const [locationFilter, setLocationFilter] = useState("");
  const [locationOpen, setLocationOpen] = useState(false);
  const [sort, setSort] = useState<"name" | "recent">("name");
  const [creating, setCreating] = useState(false);

  const listState = useResource<SettingBeing[]>(
    populationPaths.bestiary(settingId, {
      query: debouncedQuery,
      locationId: locationFilter,
      sort,
      dir: sort === "recent" ? "desc" : "asc",
    }),
    { keepPrevious: true }
  );
  const beings = listState.data ?? NO_BEINGS;
  const locations = useResource<SettingLocation[]>(settingPaths.inSetting("location", settingId)).data ?? NO_LOCATIONS;
  const { dialogs, menuFor } = useBeingActions(beings, "запись бестиария");

  // Группы по типу существа (Q10); тип — из статблока, без статблока — «Без типа» последней.
  const groups = useMemo(() => {
    const map = new Map<string, SettingBeing[]>();
    for (const b of beings) {
      const k = b.creature_meta?.creatureType?.trim() || "";
      map.set(k, [...(map.get(k) ?? []), b]);
    }
    return [...map.entries()]
      .sort((a, b) => (a[0] === "" ? 1 : b[0] === "" ? -1 : a[0].localeCompare(b[0], "ru")))
      .map(([k, items]) => ({ key: k || "none", label: k || "Без типа", items }));
  }, [beings]);
  const order = useMemo(() => groups.flatMap((g) => g.items.map((b) => b.id)), [groups]);
  const sel = useListSelection(order, (id) => `/beings/${id}`);

  return (
    <div className="population__body">
      {dialogs}
      {sel.menuNode}
      {creating && <EntityWizard initialType="bestiary" ctx={{ settingId }} onClose={() => setCreating(false)} />}
      <Toolbar
        query={query}
        onQuery={setQuery}
        placeholder="Имя, тип…"
        chips={
          <Chip
            label={locationFilter ? locations.find((l) => String(l.id) === locationFilter)?.name ?? "Место" : "Место"}
            on={!!locationFilter || locationOpen}
            onClick={() => (locationFilter ? setLocationFilter("") : setLocationOpen(!locationOpen))}
          />
        }
        sort={sort}
        onSort={setSort}
        createLabel="Создать существо"
        onCreate={() => setCreating(true)}
      />
      {locationOpen && !locationFilter && (
        <div className="population__filters">
          <LocationFilter
            locations={locations}
            value={locationFilter}
            onChange={(v) => {
              setLocationFilter(v);
              setLocationOpen(false);
            }}
          />
        </div>
      )}
      <Loadable
        loading={listState.loading}
        error={listState.data ? null : listState.error}
        errorTitle="Не удалось загрузить бестиарий"
        onRetry={listState.reload}
        skeleton={<ListSkeleton variant="rows" count={1} label="Загрузка бестиария" />}
        empty={
          beings.length === 0 ? (
            <EmptyState
              title={debouncedQuery || locationFilter ? "Ничего не нашлось" : "Бестиарий пока пуст"}
              hint="Виды без имени — гоблины, утопленники, духи леса. Добавьте первый."
              action={
                <button className="primary" onClick={() => setCreating(true)}>
                  Создать существо
                </button>
              }
            />
          ) : null
        }
      >
        <div className="population__split">
          <div className="population__list" onKeyDown={sel.onKeyDown}>
            {groups.map((g) => (
              <section key={g.key}>
                <h3 className="pop-group__head">
                  {g.label} <span className="pop-group__count">{g.items.length}</span>
                </h3>
                <ul className="pop-rows">
                  {g.items.map((b) => {
                    const roles = parseRoles((b as SettingBeing & { combat_roles?: unknown }).combat_roles);
                    return (
                      <li key={b.id}>
                        <button
                          type="button"
                          className={`pop-row pop-row--beast${sel.selId === b.id ? " is-selected" : ""}`}
                          {...sel.itemProps(b.id, menuFor(b, () => navigate(`/beings/${b.id}`)))}
                        >
                          <span>{b.name || "Без названия"}</span>
                          <span className="pop-row__num">
                            <span className="paper-label">КД</span>
                            {b.creature_meta?.ac ?? "—"}
                          </span>
                          <span className="pop-row__num">
                            <span className="paper-label">Хиты</span>
                            {b.creature_meta?.hp || "—"}
                          </span>
                          <span className="pop-row__roles">
                            {roles.length ? (
                              roles.map((r) => (
                                <span key={r} className="pop-item__chip is-dark">
                                  {r}
                                </span>
                              ))
                            ) : (
                              <span className="pop-row__muted">роль не задана</span>
                            )}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
          <Aside open={sel.selId != null} onClose={() => sel.setSelId(null)}>
            {sel.selId != null ? (
              <CreatureCardLoader key={sel.selId} type="being" id={sel.selId} variant="page" />
            ) : (
              <div className="pop-recent">
                <span className="paper-label">Бестиарий</span>
                <span className="muted">Щёлкните по существу — карточка «В бою» встанет здесь.</span>
              </div>
            )}
          </Aside>
        </div>
      </Loadable>
    </div>
  );
}

function CommunitiesSection({ settingId }: { settingId: number }) {
  const navigate = useNavigate();
  const run = useAction();
  const afterWrite = useAfterWrite();
  const [promptDialog, promptText] = usePrompt();
  const [confirmDialog, confirm] = useConfirm();
  const { deleteWithUndo } = useUndoDelete();
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounced(query);
  const [locationFilter, setLocationFilter] = useState("");
  const [locationOpen, setLocationOpen] = useState(false);
  const [sort, setSort] = useState<"name" | "recent">("name");
  const [creating, setCreating] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  const listState = useResource<SettingCommunity[]>(
    populationPaths.communities(settingId, {
      locationId: locationFilter,
      query: debouncedQuery,
      sort,
      dir: sort === "recent" ? "desc" : "asc",
    }),
    { keepPrevious: true }
  );
  const communities = listState.data ?? NO_COMMUNITIES;
  const locations = useResource<SettingLocation[]>(settingPaths.inSetting("location", settingId)).data ?? NO_LOCATIONS;
  const filtered = !!debouncedQuery.trim() || !!locationFilter;

  // Дерево вложенности (Q11). С фильтром — плоско: найденное вложенное без
  // своего родителя в дереве не повисло бы ни на чём.
  const rows = useMemo(() => {
    if (filtered) return communities.map((c) => ({ c, depth: 0, hasKids: false }));
    const ids = new Set(communities.map((c) => c.id));
    const kids = new Map<number | null, SettingCommunity[]>();
    for (const c of communities) {
      const parent = c.parent_id != null && ids.has(c.parent_id) ? c.parent_id : null;
      kids.set(parent, [...(kids.get(parent) ?? []), c]);
    }
    const out: { c: SettingCommunity; depth: number; hasKids: boolean }[] = [];
    const walk = (parent: number | null, depth: number) => {
      for (const c of kids.get(parent) ?? []) {
        const hasKids = (kids.get(c.id) ?? []).length > 0;
        out.push({ c, depth, hasKids });
        if (hasKids && !collapsed.has(c.id)) walk(c.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [communities, filtered, collapsed]);
  const order = useMemo(() => rows.map((r) => r.c.id), [rows]);
  const sel = useListSelection(order, (id) => `/communities/${id}`);

  async function archive(id: number) {
    const ok = await confirm({
      title: "Архивировать сообщество?",
      message: "Будет скрыто из списков, личности останутся. Можно восстановить в архиве.",
      confirmLabel: "Архивировать",
      danger: true,
    });
    if (!ok) return;
    const name = communities.find((c) => c.id === id)?.name ?? "Сообщество";
    await run(
      () =>
        deleteWithUndo({
          entityName: name,
          deleteFn: async () => {
            await write.del(`/setting-communities/${id}`);
          },
          restoreFn: async () => {
            await write.put(`/setting-communities/${id}/restore`);
            afterWrite([{ kind: "community" }]);
          },
        }).then(() => true),
      { affects: [{ kind: "community" }] }
    );
  }

  async function rename(c: SettingCommunity) {
    const name = await promptText({ title: "Переименовать сообщество", message: "Название", defaultValue: c.name });
    if (!name?.trim() || name.trim() === c.name) return;
    await run(() => write.put(`/setting-communities/${c.id}`, { name: name.trim() }).then(() => true), {
      affects: [{ kind: "community", id: c.id }],
    });
  }

  function toggle(id: number) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="population__body">
      {confirmDialog}
      {promptDialog}
      {sel.menuNode}
      {creating && <EntityWizard initialType="community" ctx={{ settingId }} onClose={() => setCreating(false)} />}
      <Toolbar
        query={query}
        onQuery={setQuery}
        placeholder="Название сообщества…"
        chips={
          <Chip
            label={locationFilter ? locations.find((l) => String(l.id) === locationFilter)?.name ?? "Место" : "Место"}
            on={!!locationFilter || locationOpen}
            onClick={() => (locationFilter ? setLocationFilter("") : setLocationOpen(!locationOpen))}
          />
        }
        sort={sort}
        onSort={setSort}
        createLabel="Создать сообщество"
        onCreate={() => setCreating(true)}
      />
      {locationOpen && !locationFilter && (
        <div className="population__filters">
          <LocationFilter
            locations={locations}
            value={locationFilter}
            onChange={(v) => {
              setLocationFilter(v);
              setLocationOpen(false);
            }}
          />
        </div>
      )}
      <Loadable
        loading={listState.loading}
        error={listState.data ? null : listState.error}
        errorTitle="Не удалось загрузить сообщества"
        onRetry={listState.reload}
        skeleton={<ListSkeleton variant="rows" count={1} label="Загрузка сообществ" />}
        empty={
          communities.length === 0 ? (
            <EmptyState
              title={filtered ? "Ничего не нашлось" : "Сообществ пока нет"}
              hint="Народы, культуры, фракции, гильдии — начните с первого объединения."
              action={
                <button className="primary" onClick={() => setCreating(true)}>
                  Создать сообщество
                </button>
              }
            />
          ) : null
        }
      >
        <div className="population__split">
          <div className="population__list" onKeyDown={sel.onKeyDown}>
            <section>
              <h3 className="pop-group__head">
                {filtered ? "Найдено" : "Все сообщества"} <span className="pop-group__count">{communities.length}</span>
              </h3>
              <ul className="pop-rows">
                {rows.map(({ c, depth, hasKids }) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className={`pop-row pop-row--tree${sel.selId === c.id ? " is-selected" : ""}`}
                      data-depth={Math.min(depth, 4)}
                      {...sel.itemProps(c.id, [
                        { label: "Открыть профиль", onClick: () => navigate(`/communities/${c.id}`) },
                        { label: "Переименовать", onClick: () => rename(c) },
                        { label: "Архивировать", danger: true, onClick: () => archive(c.id) },
                      ])}
                    >
                      <span
                        className="pop-row__twisty"
                        aria-label={hasKids ? (collapsed.has(c.id) ? "Развернуть" : "Свернуть") : undefined}
                        onClick={(e) => {
                          if (!hasKids) return;
                          e.stopPropagation();
                          toggle(c.id);
                        }}
                      >
                        {hasKids ? (collapsed.has(c.id) ? "▸" : "▾") : ""}
                      </span>
                      <span className="pop-row__glyph">
                        <TypeGlyph type="community" />
                      </span>
                      <span>{c.name || "Без названия"}</span>
                      <span className="pop-row__muted">· {c.member_count ?? 0}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </div>
          <Aside open={sel.selId != null} onClose={() => sel.setSelId(null)}>
            {sel.selId != null ? (
              <CommunityCard key={sel.selId} communityId={sel.selId} />
            ) : (
              <div className="pop-recent">
                <span className="paper-label">Сообщества</span>
                <span className="muted">Щёлкните по сообществу — описание и состав встанут здесь.</span>
              </div>
            )}
          </Aside>
        </div>
      </Loadable>
    </div>
  );
}

// Карточка сообщества справа: имя, описание, цели и состав (Q11).
function CommunityCard({ communityId }: { communityId: number }) {
  const detailState = useEntity<SettingCommunityDetail>("community", communityId);
  const detail = detailState.data;
  if (!detail) {
    return detailState.error ? (
      <div className="card">Не удалось загрузить сообщество: {detailState.error}</div>
    ) : (
      <div className="card" aria-busy="true">
        <span className="muted">Загрузка…</span>
      </div>
    );
  }
  const MEMBERS_SHOWN = 8;
  return (
    <div className="card stack">
      <div className="row">
        <TypeGlyph type="community" />
        <strong>{detail.name || "Без названия"}</strong>
      </div>
      {(detail.ancestors.length > 0 || detail.children.length > 0) && (
        <span className="paper-label">
          {detail.ancestors.length > 0 && `в составе: ${detail.ancestors.map((a) => a.name).join(" → ")}`}
          {detail.ancestors.length > 0 && detail.children.length > 0 && " · "}
          {detail.children.length > 0 && `внутри: ${detail.children.map((c) => c.name).join(", ")}`}
        </span>
      )}
      {detail.description.trim() ? <MentionText text={detail.description} /> : <span className="muted">Описания нет.</span>}
      <div className="stack">
        <span className="paper-label">Цели</span>
        {detail.goals?.trim() ? <MentionText text={detail.goals} /> : <span className="muted">не записаны</span>}
      </div>
      <div className="stack">
        <span className="paper-label">Состав · {detail.members.length}</span>
        {detail.members.length === 0 ? (
          <span className="muted">Пока никого.</span>
        ) : (
          <ul className="paper-rows">
            {detail.members.slice(0, MEMBERS_SHOWN).map((m) => (
              <li key={m.id}>
                <Avatar name={m.name} url={m.avatar_image_url} size="s" />
                <Link className="mention-link mention--pop paper-rows__main" to={`/beings/${m.id}`}>
                  {m.name || "Без названия"}
                </Link>
              </li>
            ))}
          </ul>
        )}
        {detail.members.length > MEMBERS_SHOWN && (
          <Link className="paper-more" to={`/communities/${communityId}`}>
            ещё {detail.members.length - MEMBERS_SHOWN} ›
          </Link>
        )}
      </div>
      <Link className="creature-card__button" to={`/communities/${communityId}`}>
        Профиль ›
      </Link>
    </div>
  );
}
