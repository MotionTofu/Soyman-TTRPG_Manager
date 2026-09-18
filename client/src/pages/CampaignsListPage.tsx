import { useMemo, useState } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { resourceQuery, useResource } from "../data/hooks";
import { invalidateAffects } from "../data/entities";
import { campaignGroupAffects, campaignPaths } from "../data/campaigns";
import { ListSkeleton, LoadErrorCard } from "../components/Loadable";
import { ListPage } from "../components/ListPage";
import { CampaignCoverTile } from "../components/CampaignCoverTile";
import { EmptyState } from "../components/EmptyState";
import { CampaignWizard } from "../components/CampaignWizard";
import { CampaignGroupMembersModal } from "../components/CampaignGroupMembersModal";
import { NavIcon } from "../components/NavIcons";
import { SectionBackground } from "../components/SectionBackground";
import type { Campaign, CampaignGroup, Setting, System } from "../types";

// Две вкладки, которых нет у других списков: не группы, а взгляд на список по
// `campaigns.role` — «эту веду» против «в этой играю». Ключи совпадают с теми,
// по которым фильтрует `visible` ниже, и с проверкой на строке 153, где кнопка
// состава группы прячется у неизменяемых вкладок.
const CAMPAIGN_ROLE_TABS = [
  { id: "role:gm", label: "Я мастер" },
  { id: "role:player", label: "Я игрок" },
] as const;

const NO_CAMPAIGNS: Campaign[] = [];
const NO_SYSTEMS: System[] = [];
const NO_SETTINGS: Setting[] = [];
const NO_GROUPS: CampaignGroup[] = [];

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
  // Состав открытой группы и «Вне групп» — одни и те же
  // запросы составов, под одним ключом с окном «добавить в группу».
  const memberQueries = useQueries({
    queries: groups.map((g) => resourceQuery<Campaign[]>(campaignPaths.groupMembers(g.id))),
  });
  const activeMembers = memberQueries[groups.findIndex((g) => String(g.id) === activeTab)]?.data;
  const groupMemberIds = useMemo(() => new Set((activeMembers ?? []).map((m) => m.id)), [activeMembers]);
  // «Вне групп» — всё, чего нет ни в одной группе (F-43: раньше состав
  // здесь был пуст, и вкладка показывала всё подряд). Пока хоть один состав
  // не пришёл, вычитать не из чего — ждём, а не показываем лишнее.
  const allMembersKnown = memberQueries.every((mq) => mq.data != null);
  const [groupMembersModal, setGroupMembersModal] = useState<{ groupId: number; groupName: string } | null>(null);
  const [q, setQ] = useState("");

  function openCreate() {
    setCreating(true);
  }

  // Группы правит каркас списка (ListPage) мимо слоя — после его правки
  // перечитываются группы и их составы.
  function refreshGroups() {
    void invalidateAffects(client, campaignGroupAffects());
  }

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const byTab = (() => {
      if (!activeTab) return campaigns;
      if (activeTab === "role:gm") return campaigns.filter((c) => c.role === "gm");
      if (activeTab === "role:player") return campaigns.filter((c) => c.role === "player");
      if (activeTab === "ungrouped") {
        if (!allMembersKnown) return [];
        const grouped = new Set<number>();
        for (const mq of memberQueries) for (const m of mq.data ?? []) grouped.add(m.id);
        return campaigns.filter((c) => !grouped.has(c.id));
      }
      return campaigns.filter((c) => groupMemberIds.has(c.id));
    })();
    if (!qq) return byTab;
    return byTab.filter(
      (c) =>
        c.name.toLowerCase().includes(qq) ||
        (c.system_name ?? "").toLowerCase().includes(qq) ||
        (c.setting_name ?? "").toLowerCase().includes(qq)
    );
  }, [campaigns, activeTab, groupMemberIds, memberQueries, allMembersKnown, q]);


  return (
    <div className="stack" style={{ position: "relative" }}>
      <SectionBackground />
      <ListPage
        headingSection="campaigns"
        title="Кампании"
        extraTabs={CAMPAIGN_ROLE_TABS}
        groups={groups.map((g) => ({ id: String(g.id), label: g.name }))}
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
              <CampaignCoverTile key={c.id} campaign={c} />
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
    </div>
  );
}
