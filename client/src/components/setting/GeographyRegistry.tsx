import { useMemo, useState, type ReactNode } from "react";
import { useResource } from "../../data/hooks";
import { settingPaths } from "../../data/settingEntities";
import { EntityWizard } from "../entityWizard/EntityWizard";
import { EmptyState } from "../EmptyState";
import { LoadErrorCard, SkeletonBlock } from "../Loadable";
import { PlaceCard } from "../PlaceCard";
import { LOCATION_ROLE_LABELS, locationRoleOf } from "../../locationRoles";
import type { SettingLocation } from "../../types";

// «Список» Географии — реестр для ревизии мира (разбор 2026-10-02, Q5;
// доска 16б): колонки — чтобы ходить по миру, реестр — чтобы его доделывать.
// Строки сгруппированы по местам первого уровня каждого корня; места первого
// уровня без вложенных и сам корень собраны в группу корня. Чипы отбирают
// долги — места без описания или без карты.

const NO_LOCATIONS: SettingLocation[] = [];
// Длинная группа показывает начало; остальное — по «ещё N».
const GROUP_LIMIT = 12;

type Filter = "all" | "nodesc" | "nomap";

const hasDesc = (l: SettingLocation) => !!(l.description ?? "").trim();
const hasMap = (l: SettingLocation) => !!(l.map_image_path || l.map_image_url);

interface Group {
  key: string;
  /** Место первого уровня (оно же первая строка — у него тоже бывают долги);
   * null — группа корня (сам корень и одиночные места). */
  head: SettingLocation | null;
  root: SettingLocation;
  rows: { loc: SettingLocation; path: string }[];
}

export function GeographyRegistry({
  settingId,
  lead,
  onOpenInColumns,
}: {
  settingId: number;
  lead?: ReactNode;
  /** «В колонках ›»: путь от корня до места. */
  onOpenInColumns: (chain: number[]) => void;
}) {
  const state = useResource<SettingLocation[]>(settingPaths.inSetting("location", settingId));
  const locations = state.data ?? NO_LOCATIONS;
  const counts = useResource<Record<string, number>>(`/setting-locations/inhabitant-counts?setting_id=${settingId}`).data ?? {};
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [full, setFull] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [wizardParent, setWizardParent] = useState<number | null | undefined>(undefined);

  const alive = useMemo(() => locations.filter((l) => !l.archived_at), [locations]);
  const byId = useMemo(() => new Map(alive.map((l) => [l.id, l])), [alive]);
  const kidsOf = useMemo(() => {
    const m = new Map<number | null, SettingLocation[]>();
    for (const l of alive) {
      const pid = l.parent_id != null && byId.has(l.parent_id) ? l.parent_id : null;
      m.set(pid, [...(m.get(pid) ?? []), l]);
    }
    for (const list of m.values()) list.sort((a, b) => a.name.localeCompare(b.name, "ru", { numeric: true }));
    return m;
  }, [alive, byId]);
  const roots = kidsOf.get(null) ?? NO_LOCATIONS;

  function chainOf(id: number): number[] {
    const chain = [id];
    const seen = new Set(chain);
    let cur = byId.get(id);
    while (cur?.parent_id != null && byId.has(cur.parent_id) && !seen.has(cur.parent_id)) {
      seen.add(cur.parent_id);
      chain.unshift(cur.parent_id);
      cur = byId.get(cur.parent_id);
    }
    return chain;
  }

  const groups = useMemo(() => {
    const out: Group[] = [];
    // Потомки места в порядке обхода — вложенные сразу под своим родителем.
    const descendants = (id: number) => {
      const rows: { loc: SettingLocation; path: string }[] = [];
      const walk = (pid: number, trail: string[]) => {
        for (const k of kidsOf.get(pid) ?? []) {
          rows.push({ loc: k, path: trail.join(" › ") });
          walk(k.id, [...trail, k.name]);
        }
      };
      walk(id, []);
      return rows;
    };
    for (const root of roots) {
      const firsts = kidsOf.get(root.id) ?? [];
      const loose = [root, ...firsts.filter((f) => (kidsOf.get(f.id) ?? []).length === 0)];
      for (const f of firsts) {
        if ((kidsOf.get(f.id) ?? []).length === 0) continue;
        out.push({ key: `g${f.id}`, head: f, root, rows: [{ loc: f, path: "" }, ...descendants(f.id)] });
      }
      out.push({ key: `r${root.id}`, head: null, root, rows: loose.map((loc) => ({ loc, path: "" })) });
    }
    return out;
  }, [roots, kidsOf]);

  const q = query.trim().toLocaleLowerCase("ru");
  const keep = (l: SettingLocation) =>
    (filter === "all" || (filter === "nodesc" ? !hasDesc(l) : !hasMap(l))) &&
    (!q || `${l.name} ${l.kind ?? ""}`.toLocaleLowerCase("ru").includes(q));
  // Отбор или поиск раскрывают все группы с совпадениями: иначе найденное спрятано.
  const narrowing = filter !== "all" || !!q;
  const totals = { all: alive.length, nodesc: alive.filter((l) => !hasDesc(l)).length, nomap: alive.filter((l) => !hasMap(l)).length };
  const selected = selectedId != null ? (byId.get(selectedId) ?? null) : null;

  function toggle(set: Set<string>, key: string, apply: (next: Set<string>) => void) {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    apply(next);
  }

  function select(id: number) {
    setSelectedId(id);
    // Выбранное снаружи (из карточки) — раскрыть его группу.
    const g = groups.find((x) => x.head?.id === id || x.rows.some((r) => r.loc.id === id));
    if (g && !open.has(g.key)) setOpen(new Set(open).add(g.key));
  }

  if (state.loading && locations.length === 0 && !state.error) {
    return (
      <div className="stack" aria-busy="true" aria-label="Загрузка реестра">
        <SkeletonBlock height={34} />
        <SkeletonBlock height={240} />
      </div>
    );
  }

  const chip = (id: Filter, label: string, n: number) => (
    <button
      type="button"
      className={`population__chip geo-reg__chip${filter === id ? " is-on" : ""}${id !== "all" && n > 0 ? " is-debt" : ""}`}
      aria-pressed={filter === id}
      onClick={() => setFilter(filter === id && id !== "all" ? "all" : id)}
    >
      {label} <b>{n}</b>
    </button>
  );

  return (
    <div className="stack geography-miller geo-reg">
      <div className="population__toolbar">
        {lead}
        <input
          type="search"
          className="population__search"
          placeholder="Место или тип…"
          aria-label="Найти место"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setQuery("")}
        />
        <span className="population__spacer" />
        <button
          type="button"
          className="population__create"
          title={selected && locationRoleOf(selected) !== "spot" ? `Новое место внутри «${selected.name}»` : "Новый корень мира"}
          onClick={() => setWizardParent(selected && locationRoleOf(selected) !== "spot" ? selected.id : null)}
        >
          + Место
        </button>
      </div>
      <div className="population__toolbar geo-reg__filters">
        <span className="miller-roots__label">Отбор</span>
        {chip("all", "Все", totals.all)}
        {chip("nodesc", "Без описания", totals.nodesc)}
        {chip("nomap", "Без карты", totals.nomap)}
      </div>

      {state.error && !state.data && <LoadErrorCard message={<>Не удалось загрузить географию: {state.error}</>} onRetry={state.reload} />}
      {wizardParent !== undefined && (
        <EntityWizard
          initialType="location"
          ctx={
            (wizardParent == null
              ? { settingId }
              : { settingId, defaults: { parentLocationId: wizardParent } }) as unknown as { settingId: number }
          }
          onClose={() => setWizardParent(undefined)}
          onCreated={() => setWizardParent(undefined)}
        />
      )}

      {alive.length === 0 ? (
        <EmptyState
          title="Пока пусто"
          hint="Создайте первую локацию — она станет корнем."
          action={
            <button className="primary" onClick={() => setWizardParent(null)}>
              Создать локацию
            </button>
          }
        />
      ) : (
        <div className="geo-reg__split">
          <div className="geo-reg__list" role="table" aria-label="Реестр мест">
            <div className="geo-reg__row geo-reg__cols" role="row">
              <span role="columnheader">Название</span>
              <span role="columnheader">Тип</span>
              <span role="columnheader">Карта</span>
              <span role="columnheader">Описание</span>
              <span role="columnheader">Кто здесь</span>
            </div>
            {groups.map((g) => {
              const rows = g.rows.filter((r) => keep(r.loc));
              if (narrowing && rows.length === 0) return null;
              const isOpen = narrowing || open.has(g.key);
              const debt = g.rows.filter((r) => !hasDesc(r.loc)).length;
              const shown = full.has(g.key) || narrowing ? rows : rows.slice(0, GROUP_LIMIT);
              const title = g.head ? g.head.name : roots.length > 1 ? `${g.root.name}: отдельные места` : "Отдельные места";
              const kind = g.head ? g.head.kind?.trim() || LOCATION_ROLE_LABELS[locationRoleOf(g.head)] : g.root.name;
              return (
                <section key={g.key} className="geo-reg__group" role="rowgroup">
                  <button
                    type="button"
                    className={`geo-reg__head${g.head && g.head.id === selectedId ? " is-selected" : ""}`}
                    aria-expanded={isOpen}
                    onClick={() => {
                      if (!narrowing) toggle(open, g.key, setOpen);
                      if (g.head) setSelectedId(g.head.id);
                    }}
                  >
                    <span className={`geo-reg__chev${isOpen ? " is-open" : ""}`} aria-hidden="true">›</span>
                    <span className="geo-reg__title">{title}</span>
                    <span className="geo-reg__meta">
                      {kind} · {g.head ? g.rows.length - 1 : g.rows.length}
                    </span>
                    {debt > 0 && <span className="geo-reg__debt">без описания {debt}</span>}
                  </button>
                  {isOpen &&
                    shown.map(({ loc, path }) => (
                      <button
                        key={loc.id}
                        type="button"
                        role="row"
                        className={`geo-reg__row${loc.id === selectedId ? " is-selected" : ""}`}
                        aria-current={loc.id === selectedId ? "true" : undefined}
                        onClick={() => setSelectedId(loc.id)}
                      >
                        <span className="geo-reg__name" role="cell">
                          <span>{loc.name}</span>
                          {path && <small>{path}</small>}
                        </span>
                        <span className="geo-reg__kind" role="cell">
                          {loc.kind?.trim() || LOCATION_ROLE_LABELS[locationRoleOf(loc)]}
                        </span>
                        <span role="cell">{hasMap(loc) ? <span className="geo-reg__yes" aria-label="есть">✓</span> : <span className="geo-reg__none">—</span>}</span>
                        <span role="cell">{hasDesc(loc) ? <span className="geo-reg__yes" aria-label="есть">✓</span> : <span className="geo-reg__no">нет</span>}</span>
                        <span role="cell">{counts[loc.id] ? counts[loc.id] : <span className="geo-reg__none">—</span>}</span>
                      </button>
                    ))}
                  {isOpen && shown.length < rows.length && (
                    <button type="button" className="geo-reg__more" onClick={() => toggle(full, g.key, setFull)}>
                      ещё {rows.length - shown.length} ›
                    </button>
                  )}
                </section>
              );
            })}
          </div>
          {selected && (
            <aside className="geo-reg__aside" aria-label={`Карточка: ${selected.name}`}>
              <div className="miller-card">
                <PlaceCard key={selected.id} locationId={selected.id} onPick={select} onAddChild={(id) => setWizardParent(id)} />
              </div>
              <button type="button" className="geo-reg__more" onClick={() => onOpenInColumns(chainOf(selected.id))}>
                В колонках ›
              </button>
            </aside>
          )}
        </div>
      )}
    </div>
  );
}
