import { useRef, useState } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { resourceQuery, useAction, useResource } from "../data/hooks";
import { invalidateAffects } from "../data/entities";
import { SettingWizard } from "../components/SettingWizard";
import { GroupMembersModal, removeFromGroupItem } from "../components/GroupMembersModal";
import { ListSkeleton, LoadErrorCard } from "../components/Loadable";
import { EmptyState } from "../components/EmptyState";
import { SectionBackground } from "../components/SectionBackground";
import { GENRE_CATEGORIES } from "../genreData";
import { ListPage } from "../components/ListPage";
import { RegAddRow, RegAddTile, RegArchive, RegMeta, RegRow, RegTable, RegTile, RegTiles, useListView, type RegColumn } from "../components/ListRegistry";
import type { ContextMenuItem } from "../components/ContextMenu";
import { useConfirm } from "../hooks/useConfirm";
import { importSettingFile } from "../components/setting/importSetting";
import { plural } from "../sceneKinds";
import "./setting-profile.css";

import type { Campaign, Setting, SettingGroup } from "../types";

// Список сеттингов — шаблон «Реестр» (доски Reg-List, гриллинг 2026-11-05):
// группы сегментом, поиск, жанры строкой фильтров, плитки одного размера,
// под «Все» — сплошь, без плашек групп (Q9), архив строкой внизу.

function campaignsLine(list: Campaign[] | undefined): string {
  if (!list?.length) return "нет кампаний";
  const live = list.filter((c) => c.status === "active").length;
  return `${list.length} ${plural(list.length, "кампания", "кампании", "кампаний")}${live ? ` · идёт ${live}` : ""}`;
}

const genreLabels = (s: Setting) => (s.genres ?? []).map((g) => g.subgenre ?? g.genre);

function Genres({ setting }: { setting: Setting }) {
  const labels = genreLabels(setting);
  if (!labels.length) return null;
  return (
    <div className="reg-tile__chips">
      {labels.map((g, i) => <span key={i} className="set-gch">{g}</span>)}
    </div>
  );
}

// «Список» (Q8): Название · Жанры · Кампаний; на телефоне — жанры (Q15).
const SETTING_COLUMNS: RegColumn[] = [
  { label: "Название", width: "minmax(0, 1.4fr)" },
  { label: "Жанры", width: "minmax(0, 1.4fr)", phone: true },
  { label: "Кампаний", width: "minmax(0, 1fr)" },
];

const NO_SETTINGS: Setting[] = [];
const NO_GROUPS: SettingGroup[] = [];
const NO_CAMPAIGNS: Campaign[] = [];
/** Группы сеттингов: список групп и их составы — под одним префиксом. */
const GROUP_AFFECTS = [{ path: "/setting-groups" }];

export function SettingsListPage() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const run = useAction();
  const [confirmDialog, confirm] = useConfirm();
  const importRef = useRef<HTMLInputElement>(null);
  const settingsState = useResource<Setting[]>("/settings");
  const settings = settingsState.data ?? NO_SETTINGS;
  const loading = settingsState.loading;
  const loadError = settingsState.error;
  const [creating, setCreating] = useState(false);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const groups = useResource<SettingGroup[]>("/setting-groups").data ?? NO_GROUPS;
  const campaigns = useResource<Campaign[]>("/campaigns").data ?? NO_CAMPAIGNS;
  const [view, setView] = useListView("settings");
  const [q, setQ] = useState("");
  // Составы групп — параллельно, под ключом окна «добавить в группу».
  const memberQueries = useQueries({
    queries: groups.map((g) => resourceQuery<Setting[]>(`/setting-groups/${g.id}/members`)),
  });
  const groupMemberships: Record<number, number[]> = {};
  groups.forEach((g, i) => {
    for (const m of memberQueries[i]?.data ?? []) {
      if (!groupMemberships[m.id]) groupMemberships[m.id] = [];
      groupMemberships[m.id].push(g.id);
    }
  });
  const [groupMembersModal, setGroupMembersModal] = useState<{ groupId: number; groupName: string } | null>(null);
  const [genreFilter, setGenreFilter] = useState<string | null>(null);

  const bySetting = new Map<number, Campaign[]>();
  for (const c of campaigns) {
    if (c.setting_id == null || c.archived_at) continue;
    bySetting.set(c.setting_id, [...(bySetting.get(c.setting_id) ?? []), c]);
  }

  // Группы правит каркас списка (ListPage) — после его правки перечитываются
  // группы и их составы.
  function refreshGroups() {
    void invalidateAffects(client, GROUP_AFFECTS);
  }

  async function importFile(file: File) {
    const created = await importSettingFile(file, confirm, run);
    if (created) navigate(`/settings/${created.id}`);
  }

  const inGroup = (s: Setting, id: number) => !!groupMemberships[s.id]?.includes(id);
  const qq = q.trim().toLowerCase();
  const filteredSettings = settings
    .filter((s) => !genreFilter || s.genres?.some((g) => g.genre === genreFilter))
    .filter((s) => (activeTab === null ? true : activeTab === "ungrouped" ? !groupMemberships[s.id]?.length : inGroup(s, Number(activeTab))))
    .filter((s) => !qq || s.name.toLowerCase().includes(qq) || genreLabels(s).some((g) => g.toLowerCase().includes(qq)))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));

  const groupCount = (id: string) =>
    id === "ungrouped" ? settings.filter((s) => !groupMemberships[s.id]?.length).length : settings.filter((s) => inGroup(s, Number(id))).length;

  const currentGroup = activeTab !== null && activeTab !== "ungrouped" ? groups.find((g) => g.id === Number(activeTab)) : undefined;
  const addToGroup = currentGroup ? () => setGroupMembersModal({ groupId: currentGroup.id, groupName: currentGroup.name }) : undefined;
  const menuFor = (s: Setting): ContextMenuItem[] => (currentGroup ? [removeFromGroupItem("setting", currentGroup, s.id, run)] : []);
  const filtersOn = !!qq || !!genreFilter;

  return (
    <div className="stack settings-list" style={{ position: "relative" }}>
      <SectionBackground />
      {confirmDialog}
      <input
        ref={importRef}
        type="file"
        accept="application/json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void importFile(f);
        }}
      />
      <ListPage
        ds
        headingSection="settings"
        title="Сеттинги"
        groups={groups.map((g) => ({ id: String(g.id), label: g.name, count: groupCount(String(g.id)) }))}
        groupsEndpoint="/setting-groups"
        groupsDeleteNote="Сеттинги не будут удалены — они останутся в разделе «Все сеттинги»."
        onGroupsChanged={refreshGroups}
        actions={
          <button type="button" className="d-btn" onClick={() => importRef.current?.click()}>
            Импорт
          </button>
        }
        createLabel="+ Новый сеттинг"
        onCreate={() => setCreating(true)}
        activeGroup={activeTab}
        onGroupChange={setActiveTab}
        search={q}
        onSearch={setQ}
        searchPlaceholder="Поиск по названию, жанру…"
        searchLabel="Поиск по сеттингам"
        showReset={filtersOn}
        onResetSearch={() => { setQ(""); setGenreFilter(null); }}
        filteredCount={filteredSettings.length}
        totalCount={settings.length}
        view={view}
        onViewChange={setView}
        filters={<div className="set-list__genres" role="group" aria-label="Жанр">
          <span className="d-mono">жанр</span>
          {GENRE_CATEGORIES.map((cat) => (
            <button
              key={cat.name}
              type="button"
              className={`set-gch${genreFilter === cat.name ? " is-on" : ""}`}
              aria-pressed={genreFilter === cat.name}
              onClick={() => setGenreFilter(genreFilter === cat.name ? null : cat.name)}
            >
              {cat.name}
            </button>
          ))}
        </div>}
      >

        {loadError && <LoadErrorCard message={<>Не удалось загрузить сеттинги: {loadError}</>} onRetry={settingsState.reload} />}

        {loading ? (
          <ListSkeleton variant="tiles" label="Загрузка сеттингов" />
        ) : view === "tiles" ? (
          (filteredSettings.length > 0 || addToGroup) && (
            <RegTiles>
              {filteredSettings.map((s) => (
                <RegTile key={s.id} entity={{ type: "setting", id: s.id, name: s.name }} to={`/settings/${s.id}`}
                  image={s.thumbnail_image_url ?? s.background_image_url} menu={menuFor(s)}>
                  <Genres setting={s} />
                  <RegMeta none={!bySetting.get(s.id)?.length}>{campaignsLine(bySetting.get(s.id))}</RegMeta>
                </RegTile>
              ))}
              {addToGroup && <RegAddTile label="+ Сеттинг в группу" onClick={addToGroup} />}
            </RegTiles>
          )
        ) : (
          <>
            {filteredSettings.length > 0 && (
              <RegTable columns={SETTING_COLUMNS} label="Сеттинги">
                {filteredSettings.map((s) => (
                  <RegRow key={s.id} entity={{ type: "setting", id: s.id, name: s.name }} to={`/settings/${s.id}`}
                    columns={SETTING_COLUMNS} menu={menuFor(s)}
                    cells={[
                      genreLabels(s).join(", ") || <span className="is-none">—</span>,
                      <span className="d-mono">{campaignsLine(bySetting.get(s.id))}</span>,
                    ]} />
                ))}
              </RegTable>
            )}
            {addToGroup && <RegAddRow label="+ Сеттинг в группу" onClick={addToGroup} />}
          </>
        )}

        {!loading && !loadError && filteredSettings.length === 0 && settings.length > 0 && !currentGroup && (
          <EmptyState
            kind="search"
            title="Ничего не найдено"
            hint={qq ? `По «${q.trim()}» ничего нет.` : genreFilter ? `Нет сеттингов с жанром «${genreFilter}».` : "Нет сеттингов в этой группе."}
            action={filtersOn ? <button className="d-btn" onClick={() => { setQ(""); setGenreFilter(null); }}>Сбросить</button> : undefined}
          />
        )}

        {!loading && !loadError && settings.length === 0 && (
          <EmptyState
            title="Мир не начерчен"
            hint="Ни одного сеттинга ещё нет — создайте первый."
            action={
              <button className="d-btn" onClick={() => setCreating(true)}>
                + Новый сеттинг
              </button>
            }
          />
        )}

        <RegArchive type="setting" basePath="/settings" affects={[{ kind: "setting" }]} />
      </ListPage>

      {creating && <SettingWizard onClose={() => setCreating(false)} />}

      {groupMembersModal && (
        <GroupMembersModal
          kind="setting"
          groupId={groupMembersModal.groupId}
          groupName={groupMembersModal.groupName}
          onClose={() => setGroupMembersModal(null)}
          onUpdated={refreshGroups}
        />
      )}
    </div>
  );
}
