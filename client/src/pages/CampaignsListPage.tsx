import { useMemo, useState } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { resourceQuery, useResource, useAction, write } from "../data/hooks";
import { invalidateAffects } from "../data/entities";
import { campaignGroupAffects, campaignFieldsAffects, campaignPaths } from "../data/campaigns";
import { ListSkeleton, LoadErrorCard } from "../components/Loadable";
import { ListPage } from "../components/ListPage";
import type { ContextMenuItem } from "../components/ContextMenu";
import { usePrompt } from "../hooks/useConfirm";
import { EmptyState } from "../components/EmptyState";
import { CampaignWizard } from "../components/CampaignWizard";
import { GroupMembersModal, removeFromGroupItem } from "../components/GroupMembersModal";
import { SectionBackground } from "../components/SectionBackground";
import { RegAddRow, RegAddTile, RegArchive, RegMeta, RegRow, RegSection, RegTable, RegTile, RegTiles, useListView, type RegColumn } from "../components/ListRegistry";
import { formatNearestDate } from "../nearestDate";
import { parseDateKey } from "../utils/date";
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
  const run = useAction();
  const [promptDialog, prompt] = usePrompt();
  const [view, setView] = useListView("campaigns");
  function menuFor(campaign: Campaign): ContextMenuItem[] {
    const items: ContextMenuItem[] = campaign.folder_missing ? [] : [{ label: "Переименовать", onClick: async () => {
      const name = (await prompt({ title: "Переименовать кампанию", message: "Название", defaultValue: campaign.name, confirmLabel: "Сохранить" }))?.trim();
      if (!name || name === campaign.name) return;
      await run(() => write.put(campaignPaths.detail(campaign.id), { name }), { affects: campaignFieldsAffects(campaign.id), retry: false });
    } }];
    if (currentGroup) items.push(removeFromGroupItem("campaign", currentGroup, campaign.id, run));
    return items;
  }
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
  // Порядок (Q16): активные — по ближайшей игре (без даты — в конце, по
  // имени), на паузе и завершённые — свежие сверху по последней игре.
  const byName = (a: Campaign, b: Campaign) => a.name.localeCompare(b.name, "ru");
  const byLast = (a: Campaign, b: Campaign) => (b.last_played_date ?? "").localeCompare(a.last_played_date ?? "") || byName(a, b);
  const active = filtered
    .filter((c) => c.status !== "paused" && c.status !== "completed")
    .sort((a, b) => (a.next_planned_date ?? "\uffff").localeCompare(b.next_planned_date ?? "\uffff") || byName(a, b));
  const paused = filtered.filter((c) => c.status === "paused").sort(byLast);
  const completed = filtered.filter((c) => c.status === "completed").sort(byLast);
  const currentGroup = activeTab !== null && /^\d+$/.test(activeTab) ? groups.find((g) => g.id === Number(activeTab)) : undefined;
  const addToGroup = currentGroup ? () => setGroupMembersModal({ groupId: currentGroup.id, groupName: currentGroup.name }) : undefined;


  return (
    <div className="stack" style={{ position: "relative" }}>
      <SectionBackground />
      {promptDialog}
      <ListPage
        headingSection="campaigns"
        title="Кампании"
        ds
        extraTabs={CAMPAIGN_ROLE_TABS.map((t) => ({ ...t, count: campaigns.filter((c) => `role:${c.role}` === t.id).length }))}
        groups={groups.map((g, i) => ({ id: String(g.id), label: g.name, count: memberQueries[i]?.data?.length }))}
        groupsEndpoint="/campaign-groups"
        groupsDeleteNote="Кампании не будут удалены — они останутся в разделе «Все кампании»."
        onGroupsChanged={refreshGroups}
        createLabel="+ Новая кампания"
        onCreate={openCreate}
        activeGroup={activeTab}
        onGroupChange={setActiveTab}
        search={q}
        onSearch={setQ}
        searchPlaceholder="Поиск по названию, системе, сеттингу…"
        searchLabel="Поиск по кампаниям"
        filteredCount={filtered.length}
        totalCount={campaigns.length}
        onResetSearch={() => setQ("")}
        view={view}
        onViewChange={setView}
      >
        {loadError && (
          <LoadErrorCard
            message={<>Не удалось загрузить кампании: {loadError}</>}
            onRetry={campaignsState.reload}
          />
        )}

        {loading ? (
          <ListSkeleton variant="tiles" label="Загрузка кампаний" />
        ) : view === "tiles" ? (
          <>
            {/* Q10: в «Плитках» активные — плитками, на паузе и завершённые —
                строками. Пустой раздел не рисуется (кроме открытой группы:
                в ней последняя плитка — «+ Кампанию в группу»). */}
            {(active.length > 0 || addToGroup) && (
              <RegSection title="Активные" count={active.length}>
                <RegTiles>
                  {active.map((c) => <CampaignTile key={c.id} campaign={c} menu={menuFor(c)} />)}
                  {addToGroup && <RegAddTile label="+ Кампанию в группу" onClick={addToGroup} />}
                </RegTiles>
              </RegSection>
            )}
            {paused.length > 0 && <CampaignTable title="На паузе" list={paused} menuFor={menuFor} />}
            {completed.length > 0 && <CampaignTable title="Завершённые" list={completed} menuFor={menuFor} />}
          </>
        ) : (
          <>
            {active.length > 0 && <CampaignTable title="Активные" list={active} menuFor={menuFor} />}
            {paused.length > 0 && <CampaignTable title="На паузе" list={paused} menuFor={menuFor} />}
            {completed.length > 0 && <CampaignTable title="Завершённые" list={completed} menuFor={menuFor} />}
            {addToGroup && <RegAddRow label="+ Кампанию в группу" onClick={addToGroup} />}
          </>
        )}

      {!loading && !loadError && filtered.length === 0 && campaigns.length > 0 && !addToGroup && (
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

      <RegArchive type="campaign" basePath="/campaigns" affects={[{ kind: "campaign" }]} />
      </ListPage>

      {creating && (
        <CampaignWizard
          systems={systems}
          settings={settings}
          onClose={() => setCreating(false)}
        />
      )}

      {groupMembersModal && (
        <GroupMembersModal
          kind="campaign"
          groupId={groupMembersModal.groupId}
          groupName={groupMembersModal.groupName}
          onClose={() => setGroupMembersModal(null)}
          onUpdated={() => {}}
        />
      )}
    </div>
  );
}

const monthYear = new Intl.DateTimeFormat("ru", { month: "long", year: "numeric" });
const monthOf = (key: string) => monthYear.format(parseDateKey(key)).replace(" г.", "");

// Плитка: обложка с плашкой системы, ближайшая игра машинописью.
function CampaignTile({ campaign: c, menu }: { campaign: Campaign; menu: ContextMenuItem[] }) {
  return (
    <RegTile
      entity={{ type: "campaign", id: c.id, name: c.name }}
      to={`/campaigns/${c.id}`}
      image={c.thumbnail_image_url ?? c.background_image_url}
      plate={c.system_name}
      menu={menu}
      title={c.folder_missing ? "Папки кампании нет в хранилище" : undefined}
    >
      <RegMeta none={!c.next_planned_date}>
        {c.next_planned_date ? `${formatNearestDate(c.next_planned_date)} · сессия №${(c.held_sessions_count ?? 0) + 1}` : "нет запланированных"}
      </RegMeta>
    </RegTile>
  );
}

// «Список» (Q8): Название · Система · Сеттинг · Сыграно · Ближайшая/последняя.
// На телефоне — название, дата и ⋯ (Q15).
const CAMPAIGN_COLUMNS: RegColumn[] = [
  { label: "Название", width: "minmax(0, 1.6fr)" },
  { label: "Система", width: "minmax(0, 0.9fr)" },
  { label: "Сеттинг", width: "minmax(0, 1fr)" },
  { label: "Сыграно", width: "80px" },
  { label: "Ближайшая · последняя", width: "minmax(130px, 0.9fr)", phone: true },
];

function whenCell(c: Campaign) {
  if (c.status !== "paused" && c.status !== "completed") {
    return c.next_planned_date
      ? <span className="d-mono">{formatNearestDate(c.next_planned_date)} · №{(c.held_sessions_count ?? 0) + 1}</span>
      : <span className="d-mono is-none">не запланирована</span>;
  }
  return c.last_played_date ? <span className="d-mono">{monthOf(c.last_played_date)}</span> : <span className="d-mono is-none">—</span>;
}

function CampaignTable({ title, list, menuFor }: { title: string; list: Campaign[]; menuFor: (campaign: Campaign) => ContextMenuItem[] }) {
  return (
    <RegSection title={title} count={list.length}>
      <RegTable columns={CAMPAIGN_COLUMNS} label={title}>
        {list.map((c) => (
          <RegRow
            key={c.id}
            entity={{ type: "campaign", id: c.id, name: c.name }}
            to={`/campaigns/${c.id}`}
            columns={CAMPAIGN_COLUMNS}
            menu={menuFor(c)}
            cells={[
              <span className="d-mono">{c.system_name ?? "—"}</span>,
              c.setting_name ?? "—",
              <span className="d-mono">{c.type === "oneshot" ? "ваншот" : c.held_sessions_count ?? 0}</span>,
              whenCell(c),
            ]}
          />
        ))}
      </RegTable>
    </RegSection>
  );
}
