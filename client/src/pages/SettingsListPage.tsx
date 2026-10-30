import { useRef, useState } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { resourceQuery, useAction, useResource, write } from "../data/hooks";
import { invalidateAffects } from "../data/entities";
import { SettingWizard } from "../components/SettingWizard";
import { GroupMembersModal } from "../components/GroupMembersModal";
import { ListSkeleton, LoadErrorCard } from "../components/Loadable";
import { EmptyState } from "../components/EmptyState";
import { SectionBackground } from "../components/SectionBackground";
import { GENRE_CATEGORIES } from "../genreData";
import { safeBackgroundImage, isSafeImageUrl } from "../utils/safeUrl";
import { useAuthenticatedFileUrl } from "../utils/fileUrl";
import { ListPage } from "../components/ListPage";
import { useConfirm } from "../hooks/useConfirm";
import { importSettingFile } from "../components/setting/importSetting";
import { plural } from "../sceneKinds";
import "./setting-profile.css";

import type { Campaign, Setting, SettingGroup } from "../types";

// Список сеттингов в «Д» (макет Set-List, блок «Сеттинги» 2026-10-30):
// группы сегментом, жанры чипами-фильтрами, плитки с обложкой, при «Все» —
// по группам плашками, архив строками внизу свёрнут.

function campaignsLine(list: Campaign[] | undefined): string {
  if (!list?.length) return "нет кампаний";
  const live = list.filter((c) => c.status === "active").length;
  return `${list.length} ${plural(list.length, "кампания", "кампании", "кампаний")}${live ? ` · идёт ${live}` : ""}`;
}

function SettingCoverTile({ setting: s, campaigns }: { setting: Setting; campaigns: Campaign[] | undefined }) {
  const rawUrl = s.thumbnail_image_url ?? s.background_image_url ?? null;
  const imageUrl = rawUrl && isSafeImageUrl(rawUrl) ? rawUrl : null;
  const authBlob = useAuthenticatedFileUrl(imageUrl);
  const bg = imageUrl?.startsWith("/files/") ? (authBlob ? `url("${authBlob}")` : undefined) : safeBackgroundImage(imageUrl);
  const line = campaignsLine(campaigns);

  return (
    <Link to={`/settings/${s.id}`} className="set-tile">
      <div className={`set-tile__cover${bg ? "" : " is-empty"}`} style={bg ? { backgroundImage: bg } : undefined}>
        {!bg && <span aria-hidden="true">{s.name.slice(0, 1)}</span>}
      </div>
      <div className="set-tile__body">
        <b>{s.name}</b>
        {!!s.genres?.length && (
          <div className="set-tile__genres">
            {s.genres.map((g, i) => (
              <span key={i} className="set-gch">
                {g.subgenre ?? g.genre}
              </span>
            ))}
          </div>
        )}
        <span className={`set-tile__meta${campaigns?.length ? "" : " is-none"}`}>{line}</span>
      </div>
    </Link>
  );
}

interface ArchivedItem {
  type: string;
  id: number;
  title: string;
  archived_at: string;
}

const NO_SETTINGS: Setting[] = [];
const NO_GROUPS: SettingGroup[] = [];
const NO_CAMPAIGNS: Campaign[] = [];
const NO_ARCHIVE: ArchivedItem[] = [];
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
  const [archiveOpen, setArchiveOpen] = useState(false);
  const archived = (useResource<ArchivedItem[]>("/archive").data ?? NO_ARCHIVE).filter((a) => a.type === "setting");
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

  async function restore(id: number) {
    await run(() => write.put(`/settings/${id}/restore`).then(() => true), { affects: [{ kind: "setting" }, { path: "/archive" }] });
  }

  const inGroup = (s: Setting, id: number) => !!groupMemberships[s.id]?.includes(id);
  const byGenre = genreFilter ? settings.filter((s) => s.genres?.some((g) => g.genre === genreFilter)) : settings;
  const filteredSettings =
    activeTab === null
      ? byGenre
      : activeTab === "ungrouped"
        ? byGenre.filter((s) => !groupMemberships[s.id]?.length)
        : byGenre.filter((s) => inGroup(s, Number(activeTab)));

  const groupCount = (id: string) =>
    id === "ungrouped" ? settings.filter((s) => !groupMemberships[s.id]?.length).length : settings.filter((s) => inGroup(s, Number(id))).length;

  function addTile(g: SettingGroup) {
    return (
      <button type="button" className="set-tile set-tile--add" onClick={() => setGroupMembersModal({ groupId: g.id, groupName: g.name })}>
        + Сеттинг в группу
      </button>
    );
  }

  function tiles(list: Setting[], group?: SettingGroup) {
    return (
      <div className="set-tiles">
        {list.map((s) => (
          <SettingCoverTile key={s.id} setting={s} campaigns={bySetting.get(s.id)} />
        ))}
        {group && addTile(group)}
      </div>
    );
  }

  // «Все» при заведённых группах — по группам плашками (макет), сеттинг из
  // двух групп стоит в обеих; без групп и в группе — одна сетка.
  const sections =
    activeTab === null && groups.length > 0
      ? [
          ...groups.map((g) => ({ key: String(g.id), label: g.name, group: g, list: filteredSettings.filter((s) => inGroup(s, g.id)) })),
          { key: "ungrouped", label: "Вне групп", group: undefined, list: filteredSettings.filter((s) => !groupMemberships[s.id]?.length) },
        ].filter((x) => x.list.length > 0 || (x.group && !genreFilter))
      : null;
  const currentGroup = activeTab !== null && activeTab !== "ungrouped" ? groups.find((g) => g.id === Number(activeTab)) : undefined;

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
        search=""
        onSearch={() => undefined}
        onResetSearch={() => undefined}
        filteredCount={filteredSettings.length}
        totalCount={settings.length}
        hideToolbar
      >
        <span className="d-mono set-list__count">
          {filteredSettings.length} / {settings.length}
        </span>
        <div className="set-list__genres" role="group" aria-label="Жанр">
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
        </div>

        {loadError && <LoadErrorCard message={<>Не удалось загрузить сеттинги: {loadError}</>} onRetry={settingsState.reload} />}

        {loading ? (
          <ListSkeleton variant="tiles" label="Загрузка сеттингов" />
        ) : sections ? (
          sections.map((x) => (
            <section key={x.key} className="set-list__group" aria-label={x.label}>
              <div className="d-plate-row">
                <h2 className="d-plate">{x.label}</h2>
                <span className="d-note">{x.list.length}</span>
              </div>
              {tiles(x.list, x.group)}
            </section>
          ))
        ) : (
          filteredSettings.length > 0 || currentGroup ? tiles(filteredSettings, currentGroup) : null
        )}

        {!loading && !loadError && filteredSettings.length === 0 && settings.length > 0 && !currentGroup && (
          <EmptyState
            kind="search"
            title="Ничего не найдено"
            hint={genreFilter ? `Нет сеттингов с жанром «${genreFilter}».` : "Ничего не найдено."}
            action={genreFilter ? <button className="d-btn" onClick={() => setGenreFilter(null)}>Сбросить жанр</button> : undefined}
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

        {archived.length > 0 && (
          <section className="set-arch" aria-label="Архив">
            <button type="button" className="set-arch__head" aria-expanded={archiveOpen} onClick={() => setArchiveOpen((v) => !v)}>
              <b>Архив</b>
              <span className="d-note">{archived.length}</span>
              <span className="d-mono">{archiveOpen ? "Скрыть ‹" : "Показать ›"}</span>
            </button>
            {archiveOpen && (
              <ul className="set-arch__rows">
                {archived.map((a) => (
                  <li key={a.id}>
                    <span>{a.title}</span>
                    <span className="d-note">в архиве с {a.archived_at.slice(0, 10).split("-").reverse().join(".")}</span>
                    <button type="button" className="d-btn d-btn--sm" onClick={() => void restore(a.id)}>
                      Вернуть
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </ListPage>

      {creating && <SettingWizard onClose={() => setCreating(false)} />}

      {groupMembersModal && (
        <GroupMembersModal
          groupId={groupMembersModal.groupId}
          groupName={groupMembersModal.groupName}
          onClose={() => setGroupMembersModal(null)}
          onUpdated={refreshGroups}
        />
      )}
    </div>
  );
}
