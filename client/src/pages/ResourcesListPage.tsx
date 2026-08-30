import { useEffect, useState } from "react";
import { api } from "../api/client";
import { ResourceRow } from "../components/ResourceRow";
import { TemplatesTab } from "../components/TemplatesTab";
import { SoundLibraryTab } from "../components/SoundLibraryTab";
import { SoundSetsTab } from "../components/SoundSetsTab";
import { SectionHeading } from "../components/SectionHeading";
import { EmptyState } from "../components/EmptyState";
import { NavIcon } from "../components/NavIcons";
import { SectionBackground } from "../components/SectionBackground";
import { RESOURCE_CATEGORIES, guessResourceCategory, type ResourceCategory } from "../resourceCategories";
import type { Campaign, Resource, Setting } from "../types";

const TEMPLATE_TYPE = "statblock_template";
type SortMode = "az" | "size" | "date";

function categoryOf(r: Resource): ResourceCategory {
  if (r.category && RESOURCE_CATEGORIES.some((c) => c.key === r.category)) return r.category as ResourceCategory;
  return guessResourceCategory(r.file_url || r.link_url || r.name);
}

function sortResources(list: Resource[], mode: SortMode): Resource[] {
  const arr = [...list];
  if (mode === "az") arr.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  else if (mode === "size") arr.sort((a, b) => (b.size_bytes ?? -1) - (a.size_bytes ?? -1));
  else arr.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  return arr;
}

export function ResourcesListPage() {
  const [section, setSection] = useState<"all" | "sound" | "sets" | "templates">("all");
  const [resources, setResources] = useState<Resource[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [settings, setSettings] = useState<Setting[]>([]);
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("az");
  const [campaignFilter, setCampaignFilter] = useState<number | null>(null);
  const [settingFilter, setSettingFilter] = useState<number | null>(null);
  // Форма добавления свёрнута: она нужна раз в сессию, а места занимала
  // целую карточку в шапке постоянно. Фильтры на узком экране прячутся за
  // одну кнопку — там весь ряд управления в строку не помещается.
  const [addOpen, setAddOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [name, setName] = useState("");
  const [type, setType] = useState("note");
  const [tags, setTags] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [linkUrl, setLinkUrl] = useState("");

  function refresh() {
    // No `scope` param — this is the app-wide aggregate: every resource
    // regardless of which session/setting/campaign/system owns it (see
    // resources.ts's GET / handler, which already supports this mode).
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    api.get<Resource[]>(`/resources?${params.toString()}`).then((all) =>
      setResources(all.filter((r) => r.type !== TEMPLATE_TYPE))
    );
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(refresh, [query]);

  useEffect(() => {
    api.get<Campaign[]>("/campaigns").then(setCampaigns);
    api.get<Setting[]>("/settings").then(setSettings);
  }, []);

  async function create() {
    if (!name.trim()) return;
    const form = new FormData();
    form.append("name", name);
    form.append("scope", "global");
    form.append("type", type);
    form.append("tags", tags);
    if (file) form.append("file", file);
    if (linkUrl) form.append("link_url", linkUrl);
    await api.post("/resources", form);
    setAddOpen(false);
    setName("");
    setTags("");
    setFile(null);
    setLinkUrl("");
    refresh();
  }

  async function archiveResource(id: number) {
    await api.del(`/resources/${id}`);
    refresh();
  }

  const filteredResources = resources.filter((r) => {
    if (campaignFilter && r.campaign_id !== campaignFilter) return false;
    if (settingFilter && r.setting_id !== settingFilter && !(r.also_in_settings ?? []).includes(settingFilter)) {
      return false;
    }
    return true;
  });
  // Звук из общего списка убран: у него есть свои вкладки «Звук» и
  // «Аудио-наборы», где он показан по ролям, а здесь он только разбавлял
  // карты и справочники строчками без иконок.
  const groups = RESOURCE_CATEGORIES.filter((c) => c.key !== "audio").map((c) => ({
    ...c,
    items: sortResources(
      filteredResources.filter((r) => categoryOf(r) === c.key),
      sortMode
    ),
  })).filter((g) => g.items.length > 0);

  const activeFilters = (campaignFilter ? 1 : 0) + (settingFilter ? 1 : 0);

  return (
    <div className="stack" style={{ position: "relative" }}>
      <SectionBackground />
      <SectionHeading section="resources">Ресурсы</SectionHeading>

      <div className="tabs">
        <button className={section === "all" ? "active" : ""} onClick={() => setSection("all")}>
          Все
        </button>
        <button className={section === "sound" ? "active" : ""} onClick={() => setSection("sound")}>
          Звук
        </button>
        <button className={section === "sets" ? "active" : ""} onClick={() => setSection("sets")}>
          Аудио-наборы
        </button>
        <button
          className={section === "templates" ? "active" : ""}
          onClick={() => setSection("templates")}
        >
          Шаблоны
        </button>
      </div>

      {section === "all" ? (
        <>
          {/* Одна полоса вместо четырёх ярусов: поиск, сортировка, фильтры и
              добавление — это один инструмент вкладки, а стояли они друг под
              другом и съедали пол-экрана до первого ресурса. */}
          <div className="res-toolbar">
            <input
              className="res-toolbar__search"
              placeholder="Поиск по названию…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />

            <div className="seg res-toolbar__sort" role="group" aria-label="Сортировка">
              <button
                type="button"
                className={sortMode === "az" ? "is-active" : ""}
                onClick={() => setSortMode("az")}
              >
                А-Я
              </button>
              <button
                type="button"
                className={sortMode === "size" ? "is-active" : ""}
                onClick={() => setSortMode("size")}
              >
                Размер
              </button>
              <button
                type="button"
                className={sortMode === "date" ? "is-active" : ""}
                onClick={() => setSortMode("date")}
              >
                Дата
              </button>
            </div>

            {/* Кнопка видна только на узком экране — на широком фильтры стоят
                в полосе сами. Счётчик показывает, сколько их включено, чтобы
                свёрнутый фильтр не врал пустотой. */}
            <button
              type="button"
              className={`res-toolbar__filters-toggle${filtersOpen ? " is-active" : ""}`}
              onClick={() => setFiltersOpen((v) => !v)}
            >
              Фильтры
              {activeFilters > 0 && <span className="res-toolbar__filters-count">{activeFilters}</span>}
            </button>

            <div className={`res-toolbar__filters${filtersOpen ? " is-open" : ""}`}>
              <label>
                <span className="res-toolbar__filter-label">Кампания</span>
                <select
                  value={campaignFilter ?? ""}
                  onChange={(e) => setCampaignFilter(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">Все</option>
                  {campaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="res-toolbar__filter-label">Сеттинг</span>
                <select
                  value={settingFilter ?? ""}
                  onChange={(e) => setSettingFilter(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">Все</option>
                  {settings.map((st) => (
                    <option key={st.id} value={st.id}>
                      {st.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <button
              type="button"
              className={`primary res-toolbar__add${addOpen ? " is-active" : ""}`}
              onClick={() => setAddOpen((v) => !v)}
            >
              {addOpen ? "Отмена" : "+ Добавить"}
            </button>
          </div>

          {addOpen && (
            <div className="card res-add">
              <input placeholder="Название" value={name} onChange={(e) => setName(e.target.value)} />
              <select value={type} onChange={(e) => setType(e.target.value)}>
                <option value="note">Заметка</option>
                <option value="item">Предмет</option>
                <option value="map">Карта</option>
              </select>
              <input
                placeholder="Теги через запятую"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
              />
              <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              <input
                placeholder="…или ссылка (вместо файла)"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
              />
              <button className="primary" onClick={create}>
                Добавить
              </button>
            </div>
          )}

          {groups.length === 0 && (
            <EmptyState
              icon="barcode"
              title="Полки пусты"
              hint={
                query || campaignFilter || settingFilter
                  ? "Ничего не найдено — попробуйте другой запрос или снимите фильтры."
                  : "Ни одного ресурса ещё не добавлено — загрузите первый выше."
              }
              action={
                (query || campaignFilter || settingFilter) ? (
                  <button
                    onClick={() => {
                      setQuery("");
                      setCampaignFilter(null);
                      setSettingFilter(null);
                    }}
                  >
                    Сбросить фильтры
                  </button>
                ) : undefined
              }
            />
          )}

          {groups.map((g) => (
            <details key={g.key} className="card res-group">
              <summary className="res-group__band">
                <NavIcon name="chevron" className="chevron-icon" />
                <NavIcon name={g.icon} className="res-group__icon" />
                <span className="res-group__title">{g.label}</span>
                <span className="res-group__count">{g.items.length}</span>
              </summary>
              <div className="res-group__body">
                {g.items.map((r) => (
                  <ResourceRow
                    key={r.id}
                    resource={r}
                    onChange={refresh}
                    onArchive={archiveResource}
                    allSettings={settings}
                  />
                ))}
              </div>
            </details>
          ))}

        </>
      ) : section === "sound" ? (
        <SoundLibraryTab />
      ) : section === "sets" ? (
        <SoundSetsTab />
      ) : (
        <>
          <p className="muted">
            Общие шаблоны — не привязанные ни к одной системе. Шаблоны конкретной системы теперь
            живут на странице этой системы, во вкладке «Шаблоны».
          </p>
          <TemplatesTab />
        </>
      )}
    </div>
  );
}
