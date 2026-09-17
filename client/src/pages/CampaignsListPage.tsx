import { useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { resourceQuery, useResource, write } from "../data/hooks";
import { afterWriteAnywhere } from "../data/imperative";
import { invalidateAffects } from "../data/entities";
import { campaignGroupAffects, campaignPaths } from "../data/campaigns";
import { ListSkeleton, LoadErrorCard } from "../components/Loadable";
import { ListPage } from "../components/ListPage";
import { CampaignCover, CampaignCoverTile } from "../components/CampaignCoverTile";
import { ContextMenu } from "../components/ContextMenu";
import { EmptyState } from "../components/EmptyState";
import { CampaignWizard } from "../components/CampaignWizard";
import { CampaignGroupMembersModal } from "../components/CampaignGroupMembersModal";
import { NavIcon } from "../components/NavIcons";
import { SectionBackground } from "../components/SectionBackground";
import { useAlert, useConfirm } from "../hooks/useConfirm";
import { useUndoDelete } from "../hooks/useUndoDelete";
import type { Campaign, CampaignGroup, Setting, System } from "../types";

// Две вкладки, которых нет у других списков: не группы, а взгляд на список по
// `campaigns.role` — «эту веду» против «в этой играю». Ключи совпадают с теми,
// по которым фильтрует `visible` ниже, и с проверкой на строке 153, где кнопка
// состава группы прячется у неизменяемых вкладок.
const CAMPAIGN_ROLE_TABS = [
  { id: "role:gm", label: "Я мастер" },
  { id: "role:player", label: "Я игрок" },
] as const;

// Предпросмотр кампании (Q48): лицо, сводка, связи, действия. Действий
// два, а не три: первое — «Открыть», под «…» — «Архивировать» с карточки.
// Третье появится вместе с карточкой, а не выдумывается здесь.
function CampaignPreview({
  campaign: c,
  onArchived,
}: {
  campaign: Campaign;
  onArchived: (id: number, name: string) => void;
}) {
  const navigate = useNavigate();
  const moreRef = useRef<HTMLButtonElement>(null);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);

  function openMenu() {
    const r = moreRef.current?.getBoundingClientRect();
    if (r) setMenuAt({ x: r.right, y: r.bottom });
  }

  return (
    <div className="stack">
      <div className="card campaign-tile">
        <CampaignCover campaign={c} />
      </div>
      <div className="card stack">
        <div className="entity-field-row">
          <span className="muted">Роль</span>
          <span>{c.role === "player" ? "Я игрок" : "Я мастер"}</span>
        </div>
        <div className="entity-field-row">
          <span className="muted">Ближайшая</span>
          <span>{c.next_planned_date ?? "нет запланированных"}</span>
        </div>
        <div className="entity-field-row">
          <span className="muted">Состав</span>
          <span>
            Игроков: {c.player_count ?? "—"} · Сессий: {c.held_sessions_count ?? "—"}
          </span>
        </div>
      </div>
      <div className="card stack">
        <span className="muted">Связи</span>
        {c.setting_id != null && (
          <Link to={`/settings/${c.setting_id}`}>Сеттинг: {c.setting_name ?? "—"}</Link>
        )}
        {c.system_id != null && (
          <Link to={`/systems/${c.system_id}`}>Система: {c.system_name ?? "—"}</Link>
        )}
        {c.setting_id == null && c.system_id == null && (
          <span className="muted">Ни с чем не связана.</span>
        )}
      </div>
      <div className="row" style={{ gap: 8 }}>
        <button className="primary" onClick={() => navigate(`/campaigns/${c.id}`)}>
          Открыть
        </button>
        <button
          ref={moreRef}
          type="button"
          aria-label="Ещё действия"
          aria-haspopup="menu"
          onClick={openMenu}
        >
          …
        </button>
      </div>
      {menuAt && (
        <ContextMenu
          x={menuAt.x}
          y={menuAt.y}
          items={[
            {
              label: "Архивировать",
              danger: true,
              onClick: () => {
                setMenuAt(null);
                onArchived(c.id, c.name);
              },
            },
          ]}
          onClose={() => setMenuAt(null)}
        />
      )}
    </div>
  );
}

const NO_CAMPAIGNS: Campaign[] = [];
const NO_SYSTEMS: System[] = [];
const NO_SETTINGS: Setting[] = [];
const NO_GROUPS: CampaignGroup[] = [];
// Архивирование и возврат: списки кампаний везде (и счётчики групп) и страница архива.
const ARCHIVE_AFFECTS = [{ kind: "campaign" as const }, { path: "/campaign-groups" }, { path: "/archive" }];

export function CampaignsListPage() {
  const client = useQueryClient();
  const campaignsState = useResource<Campaign[]>(campaignPaths.list());
  const campaigns = campaignsState.data ?? NO_CAMPAIGNS;
  const loading = campaignsState.loading;
  const loadError = campaignsState.error;
  const systems = useResource<System[]>(campaignPaths.systems()).data ?? NO_SYSTEMS;
  const settings = useResource<Setting[]>(campaignPaths.settings()).data ?? NO_SETTINGS;
  const [creating, setCreating] = useState(false);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const groups = useResource<CampaignGroup[]>(campaignPaths.groups()).data ?? NO_GROUPS;
  // Счётчики групп в левой панели и состав открытой группы — одни и те же
  // запросы составов, под одним ключом с окном «добавить в группу».
  const memberQueries = useQueries({
    queries: groups.map((g) => resourceQuery<Campaign[]>(campaignPaths.groupMembers(g.id))),
  });
  const groupCounts: Record<number, number> = {};
  groups.forEach((g, i) => {
    const members = memberQueries[i]?.data;
    if (members) groupCounts[g.id] = members.length;
  });
  const activeMembers = memberQueries[groups.findIndex((g) => String(g.id) === activeTab)]?.data;
  const groupMemberIds = useMemo(() => new Set((activeMembers ?? []).map((m) => m.id)), [activeMembers]);
  const [groupMembersModal, setGroupMembersModal] = useState<{ groupId: number; groupName: string } | null>(null);
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmDialog, confirm] = useConfirm();
  const [alertDialog, showAlert] = useAlert();
  const { deleteWithUndo } = useUndoDelete();

  function openCreate() {
    setCreating(true);
  }

  // Группы правит каркас списка (ListPage) мимо слоя — после его правки
  // перечитываются группы и их составы.
  function refreshGroups() {
    void invalidateAffects(client, campaignGroupAffects());
  }

  async function archiveCampaign(id: number, name: string) {
    const ok = await confirm({
      title: "Архивировать кампанию?",
      message: "Отправить кампанию в архив? Она пропадёт из основных разделов.",
      confirmLabel: "Архивировать",
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteWithUndo({
        entityName: name,
        deleteFn: async () => {
          await write.del(`/campaigns/${id}`);
          afterWriteAnywhere(ARCHIVE_AFFECTS);
        },
        restoreFn: async () => {
          await write.put(`/campaigns/${id}/restore`);
          afterWriteAnywhere(ARCHIVE_AFFECTS);
        },
      });
    } catch (e) {
      showAlert(`Не удалось архивировать «${name}»: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    setSelectedId(null);
  }

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const byTab = (() => {
      if (!activeTab) return campaigns;
      if (activeTab === "role:gm") return campaigns.filter((c) => c.role === "gm");
      if (activeTab === "role:player") return campaigns.filter((c) => c.role === "player");
      if (activeTab === "ungrouped") return campaigns.filter((c) => !groupMemberIds.has(c.id));
      return campaigns.filter((c) => groupMemberIds.has(c.id));
    })();
    if (!qq) return byTab;
    return byTab.filter(
      (c) =>
        c.name.toLowerCase().includes(qq) ||
        (c.system_name ?? "").toLowerCase().includes(qq) ||
        (c.setting_name ?? "").toLowerCase().includes(qq)
    );
  }, [campaigns, activeTab, groupMemberIds, q]);

  const selected = campaigns.find((c) => String(c.id) === selectedId) ?? null;

  return (
    <div className="stack" style={{ position: "relative" }}>
      <SectionBackground />
      <ListPage
        headingSection="campaigns"
        title="Кампании"
        extraTabs={CAMPAIGN_ROLE_TABS}
        groups={groups.map((g) => ({ id: String(g.id), label: g.name, count: groupCounts[g.id] }))}
        groupsEndpoint="/campaign-groups"
        groupsDeleteNote="Кампании не будут удалены — они останутся в разделе «Все кампании»."
        onGroupsChanged={refreshGroups}
        createLabel="+ Новая кампания"
        onCreate={openCreate}
        activeGroup={activeTab}
        onGroupChange={setActiveTab}
        search={q}
        onSearch={setQ}
        searchPlaceholder="Поиск по имени, системе, сеттингу…"
        searchLabel="Поиск по кампаниям"
        filteredCount={filtered.length}
        totalCount={campaigns.length}
        onResetSearch={() => setQ("")}
        selectedId={selected ? selectedId : null}
        onSelect={setSelectedId}
        preview={
          selected && (
            <CampaignPreview campaign={selected} onArchived={(id, name) => void archiveCampaign(id, name)} />
          )
        }
      >
        {loadError && (
          <LoadErrorCard
            message={<>Не удалось загрузить кампании: {loadError}</>}
            onRetry={campaignsState.reload}
          />
        )}

        {loading ? (
          <ListSkeleton variant="tiles" label="Загрузка кампаний" />
        ) : (
          <div className="grid-cards">
            {filtered.map((c) => (
              <CampaignCoverTile key={c.id} campaign={c} onSelect={(cc) => setSelectedId(String(cc.id))} />
            ))}
          {activeTab !== null && activeTab !== "ungrouped" && activeTab !== "role:gm" && activeTab !== "role:player" && (
            <button
              className="card campaign-tile setting-group-empty-add"
              onClick={() => {
                const g = groups.find((gr) => gr.id === Number(activeTab));
                if (g) setGroupMembersModal({ groupId: g.id, groupName: g.name });
              }}
            >
              <div className="campaign-tile-cover cover-halftone">
                <div className="cover-art cover-art-fallback zine-grain" aria-hidden="true" />
                <div className="campaign-tile-scrim" />
                <span className="group-add-icon"><NavIcon name="adventurers" /></span>
                <h3 className="campaign-tile-name">+</h3>
              </div>
              <div className="campaign-tile-meta">
                <div className="campaign-tile-system muted">нажми, чтобы добавить кампанию в группу</div>
              </div>
            </button>
          )}
        </div>
      )}

      {!loading && !loadError && filtered.length === 0 && campaigns.length > 0 && (
        <EmptyState kind="search"
          title="Ничего не найдено"
          hint={q.trim() ? `По «${q.trim()}» ничего нет.` : "Нет кампаний в этой группе."}
          action={
            <div className="row" style={{ gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
              {q.trim() && <button onClick={() => setQ("")}>Сбросить поиск</button>}
              <button onClick={() => setActiveTab(null)}>Показать все</button>
            </div>
          }
        />
      )}

      {!loading && !loadError && campaigns.length === 0 && (
        <EmptyState
          title="Пока тихо"
          hint="Ни одной кампании ещё нет — начните первую."
          action={
            <button className="primary" onClick={openCreate}>
              + Новая кампания
            </button>
          }
        />
      )}

      </ListPage>

      {creating && (
        <CampaignWizard
          systems={systems}
          settings={settings}
          onClose={() => setCreating(false)}
          onCreated={(created) => {
            // Q47: новое становится выбранным — открывается его предпросмотр.
            // Визард не знает групп, поэтому смотрим «Все», иначе новое
            // может оказаться за фильтром и выбрать будет нечего.
            setActiveTab(null);
            if (created) setSelectedId(String(created.id));
          }}
        />
      )}

      {groupMembersModal && (
        <CampaignGroupMembersModal
          groupId={groupMembersModal.groupId}
          groupName={groupMembersModal.groupName}
          onClose={() => setGroupMembersModal(null)}
          onUpdated={() => {}}
        />
      )}
      {confirmDialog}
      {alertDialog}
    </div>
  );
}
