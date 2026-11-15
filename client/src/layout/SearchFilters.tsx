import { useResource } from "../data/hooks";
import {
  CREATURE_LABELS, DEFAULT_SEARCH_FILTERS, FORMAT_LABELS, GROUPS, scopeLabel, searchFilterCount,
  type CreatureSource, type Format, type NamedId, type SearchFilterState, type SearchScope,
} from "./searchPanelModel";

export function SearchFilters({ id, value, onChange, scopes }: {
  id: string;
  value: SearchFilterState;
  onChange: (value: SearchFilterState) => void;
  scopes: SearchScope[];
}) {
  const systems = useResource<NamedId[]>(value.group === "rules" ? "/systems" : null).data ?? [];
  const sections = useResource<(NamedId & { system_id: number })[]>(value.group === "rules"
    ? `/search/sections${value.system ? `?system_id=${value.system}` : ""}` : null).data ?? [];
  const set = (patch: Partial<SearchFilterState>) => onChange({ ...value, ...patch });
  const tags: { label: string; clear: () => void }[] = [];
  if (value.scope) tags.push({ label: value.scope.name, clear: () => set({ scope: null }) });
  if (value.group === "creatures" && value.creatures !== "all") {
    tags.push({ label: CREATURE_LABELS[value.creatures], clear: () => set({ creatures: "all" }) });
  }
  if (value.group === "rules") {
    const system = systems.find(item => String(item.id) === value.system);
    const section = sections.find(item => String(item.id) === value.section);
    if (system) tags.push({ label: system.name, clear: () => set({ system: "", section: "" }) });
    if (section) tags.push({ label: section.name, clear: () => set({ section: "" }) });
  }
  if (value.group === "files" && value.textOnly) {
    tags.push({ label: "Текст книг", clear: () => set({ textOnly: false, format: "all" }) });
    if (value.format !== "all") tags.push({ label: FORMAT_LABELS[value.format], clear: () => set({ format: "all" }) });
  }
  const keyOf = (scope: SearchScope) => `${scope.kind}:${scope.id}`;
  const options = value.scope && !scopes.some(scope => keyOf(scope) === keyOf(value.scope!)) ? [...scopes, value.scope] : scopes;

  return <div className="side-search-filters" id={id}>
    <label>Где искать
      <select className="d-input" value={value.scope ? keyOf(value.scope) : ""} onChange={event => set({ scope: options.find(scope => keyOf(scope) === event.target.value) ?? null })}>
        <option value="">Везде</option>
        {options.map(scope => <option key={keyOf(scope)} value={keyOf(scope)}>{scopeLabel(scope)} · {scope.name}</option>)}
      </select>
    </label>
    <div className="side-search-groups" role="group" aria-label="Что искать">
      {GROUPS.map(([key, label]) => <button type="button" key={key} className={`d-chip${value.group === key ? " active" : ""}`}
        aria-pressed={value.group === key} onClick={() => set({ group: key })}>{label}</button>)}
    </div>
    {value.group === "creatures" && <div className="side-search-subfilters"><label>Источник
      <select className="d-input" value={value.creatures} onChange={event => set({ creatures: event.target.value as CreatureSource })}>
        {Object.entries(CREATURE_LABELS).map(([key, label]) => <option value={key} key={key}>{label}</option>)}
      </select>
    </label></div>}
    {value.group === "rules" && <div className="side-search-subfilters">
      <label>Система
        <select className="d-input" value={value.system} onChange={event => set({ system: event.target.value, section: "" })}>
          <option value="">Все системы</option>
          {systems.map(system => <option key={system.id} value={system.id}>{system.name}</option>)}
        </select>
      </label>
      <label>Раздел
        <select className="d-input" value={value.section} onChange={event => set({ section: event.target.value })}>
          <option value="">Все разделы</option>
          {value.system ? sections.map(section => <option key={section.id} value={section.id}>{section.name}</option>)
            : systems.map(system => {
              const rows = sections.filter(section => section.system_id === system.id);
              return rows.length > 0 && <optgroup key={system.id} label={system.name}>
                {rows.map(section => <option key={section.id} value={section.id}>{section.name}</option>)}
              </optgroup>;
            })}
        </select>
      </label>
    </div>}
    {value.group === "files" && <div className="side-search-subfilters">
      <label>Совпадение
        <select className="d-input" value={value.textOnly ? "text" : "all"} onChange={event => set({ textOnly: event.target.value === "text", format: "all" })}>
          <option value="all">Любое поле</option>
          <option value="text">Текст книг</option>
        </select>
      </label>
      {value.textOnly && <label>Формат
        <select className="d-input" value={value.format} onChange={event => set({ format: event.target.value as Format })}>
          {Object.entries(FORMAT_LABELS).map(([key, label]) => <option value={key} key={key}>{label}</option>)}
        </select>
      </label>}
    </div>}
    {searchFilterCount(value) > 0 && <div className="side-search-applied">
      <div className="side-search-tags">
        {tags.map(({ label, clear }) => <button type="button" key={label} className="d-chip side-search-tag"
          aria-label={`Убрать фильтр «${label}»`} onClick={clear}>{label} ×</button>)}
      </div>
      <button type="button" className="d-btn d-btn--sm d-btn--quiet side-search-reset" onClick={() => onChange(DEFAULT_SEARCH_FILTERS)}>Сбросить фильтры</button>
    </div>}
  </div>;
}
