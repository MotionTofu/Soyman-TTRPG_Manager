import { useEffect, useState } from "react";
import { api } from "../api/client";
import { ResourceCard } from "../components/ResourceCard";
import { SettingLinksPopover } from "../components/SettingLinksPopover";
import { TemplatesTab } from "../components/TemplatesTab";
import { SoundLibraryTab } from "../components/SoundLibraryTab";
import { SoundSetsTab } from "../components/SoundSetsTab";
import { SectionHeading } from "../components/SectionHeading";
import { EmptyState } from "../components/EmptyState";
import { NavIcon } from "../components/NavIcons";
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

  return (
    <div className="stack">
      <SectionHeading section="resources">Ресурсы</SectionHeading>
      <p className="muted">
        Библиотека всего, что есть в приложении — статблоки, лут, справочные материалы. Звук живёт
        в своих вкладках.
      </p>

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
          <div className="card row">
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

          <input
            placeholder="Поиск по названию…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          <div className="row sort-toggle" style={{ gap: 4 }}>
            <span className="muted">Сортировка:</span>
            <button className={sortMode === "az" ? "active-sort" : ""} onClick={() => setSortMode("az")}>
              А-Я
            </button>
            <button className={sortMode === "size" ? "active-sort" : ""} onClick={() => setSortMode("size")}>
              Размер
            </button>
            <button className={sortMode === "date" ? "active-sort" : ""} onClick={() => setSortMode("date")}>
              Дата добавления
            </button>
          </div>

          <div className="row" style={{ gap: 12 }}>
            <label className="row" style={{ gap: 4 }}>
              Кампания:
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
            <label className="row" style={{ gap: 4 }}>
              Сеттинг:
              <select
                value={settingFilter ?? ""}
                onChange={(e) => setSettingFilter(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">Все</option>
                {settings.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

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
            <details key={g.key} className="card stack">
              <summary className="chevron-summary">
                <NavIcon name="chevron" className="chevron-icon" />
                <strong className="entry-title">
                  <NavIcon name={g.icon} /> {g.label}
                </strong>{" "}
                <span className="muted">({g.items.length})</span>
              </summary>
              <div className="grid-cards mode-list">
                {g.items.map((r) => (
                  <ResourceCard
                    key={r.id}
                    resource={r}
                    onChange={refresh}
                    onArchive={archiveResource}
                    extraActions={
                      <SettingLinksPopover
                        ownerType="resource"
                        ownerId={r.id}
                        homeSettingId={r.setting_id}
                        linkedSettingIds={r.also_in_settings ?? []}
                        allSettings={settings}
                        onChange={refresh}
                      />
                    }
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
