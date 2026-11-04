import { useMemo, useState } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { resourceQuery, useResource, useAction, write } from "../data/hooks";
import { invalidateAffects } from "../data/entities";
import { campaignGroupAffects, campaignFieldsAffects, campaignPaths } from "../data/campaigns";
import { ListSkeleton, LoadErrorCard } from "../components/Loadable";
import { ListPage } from "../components/ListPage";
import { EntityMenuButton } from "../components/PageContextMenu";
import { entityMark, openEntityMenu } from "../pageMenu";
import type { ContextMenuItem } from "../components/ContextMenu";
import { usePrompt } from "../hooks/useConfirm";
import { Link } from "react-router-dom";
import { EmptyState } from "../components/EmptyState";
import { CampaignWizard } from "../components/CampaignWizard";
import { CampaignGroupMembersModal } from "../components/CampaignGroupMembersModal";
import { SectionBackground } from "../components/SectionBackground";
import { safeBackgroundImage, isSafeImageUrl } from "../utils/safeUrl";
import { useAuthenticatedFileUrl } from "../utils/fileUrl";
import { formatNearestDate } from "../nearestDate";
import { parseDateKey } from "../utils/date";
import type { Campaign, CampaignGroup, Setting, System } from "../types";
import "./campaigns-list.css";

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
  function menuFor(campaign: Campaign): ContextMenuItem[] {
    return campaign.folder_missing ? [] : [{ label: "Переименовать", onClick: async () => {
      const name = (await prompt({ title: "Переименовать кампанию", message: "Название", defaultValue: campaign.name, confirmLabel: "Сохранить" }))?.trim();
      if (!name || name === campaign.name) return;
      await run(() => write.put(campaignPaths.detail(campaign.id), { name }), { affects: campaignFieldsAffects(campaign.id), retry: false });
    } }];
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
  const active = filtered.filter((c) => c.status !== "paused" && c.status !== "completed");
  const paused = filtered.filter((c) => c.status === "paused");
  // Завершённые — свежие сверху, по последней игре.
  const completed = filtered
    .filter((c) => c.status === "completed")
    .sort((a, b) => (b.last_played_date ?? "").localeCompare(a.last_played_date ?? ""));


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
          <>
            {/* Макет Camp-List: активные — плитками с обложкой, на паузе и
                завершённые — строками. Пустой раздел не рисуется. */}
            {active.length > 0 && (
              <section>
                <div className="d-gh">
                  <h3 className="d-plate">Активные</h3>
                  <span className="d-note">{active.length}</span>
                </div>
                <div className="campaign-dtiles">
                  {active.map((c) => (
                    <CampaignDTile key={c.id} campaign={c} menuFor={menuFor} />
                  ))}
                </div>
              </section>
            )}
            {paused.length > 0 && <CampaignRows title="На паузе" list={paused} menuFor={menuFor} />}
            {completed.length > 0 && <CampaignRows title="Завершённые" list={completed} menuFor={menuFor} />}
            {activeTab !== null && activeTab !== "ungrouped" && activeTab !== "role:gm" && activeTab !== "role:player" && (
              <button
                type="button"
                className="d-btn d-btn--sm campaign-dtiles__add"
                onClick={() => {
                  const g = groups.find((gr) => gr.id === Number(activeTab));
                  if (g) setGroupMembersModal({ groupId: g.id, groupName: g.name });
                }}
              >
                + Кампанию в группу
              </button>
            )}
          </>
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

const monthYear = new Intl.DateTimeFormat("ru", { month: "long", year: "numeric" });

// Плитка «Д»: обложка с плашкой системы, имя Oswald, ближайшая игра
// машинописью. Обложка — как у CampaignCoverTile (тот остаётся на Главной).
function CampaignDTile({ campaign: c, menuFor }: { campaign: Campaign; menuFor: (campaign: Campaign) => ContextMenuItem[] }) {
  const rawUrl = c.thumbnail_image_url ?? c.background_image_url ?? null;
  const imageUrl = rawUrl && isSafeImageUrl(rawUrl) ? rawUrl : null;
  const authBlob = useAuthenticatedFileUrl(imageUrl);
  const bg = imageUrl?.startsWith("/files/") ? (authBlob ? `url("${authBlob}")` : undefined) : safeBackgroundImage(imageUrl);
  const next = c.next_planned_date
    ? `${formatNearestDate(c.next_planned_date)} · сессия №${(c.held_sessions_count ?? 0) + 1}`
    : "нет запланированных";
  return (
    <article className="campaign-dtile" {...entityMark("campaign", c.id, c.name)} onContextMenu={(event) => { if (event.shiftKey) return; event.preventDefault(); openEntityMenu({ type: "campaign", id: c.id, name: c.name }, event.clientX, event.clientY, menuFor(c)); }}>
    <Link to={`/campaigns/${c.id}`} className="campaign-dtile__link" title={c.folder_missing ? "Папки кампании нет в хранилище" : undefined}>
      {/* инлайн-стиль намеренно — обложка кампании: адрес картинки приходит из данных */}
      <span className={`campaign-dtile__cover${bg ? "" : " is-empty"}`} style={bg ? { backgroundImage: bg } : undefined}>
        {c.system_name && <span className="d-plate">{c.system_name}</span>}
      </span>
      <span className="campaign-dtile__body">
        <b>{c.name}</b>
        <span className="d-mono">{next}</span>
      </span>
    </Link>
    <EntityMenuButton entity={{ type: "campaign", id: c.id, name: c.name }} local={menuFor(c)} />
    </article>
  );
}

function CampaignRows({ title, list, menuFor }: { title: string; list: Campaign[]; menuFor: (campaign: Campaign) => ContextMenuItem[] }) {
  return (
    <section>
      <div className="d-gh">
        <h3 className="d-plate">{title}</h3>
        <span className="d-note">{list.length}</span>
      </div>
      <ul className="campaign-drows">
        {list.map((c) => (
          <li key={c.id} {...entityMark("campaign", c.id, c.name)} onContextMenu={(event) => { if (event.shiftKey) return; event.preventDefault(); openEntityMenu({ type: "campaign", id: c.id, name: c.name }, event.clientX, event.clientY, menuFor(c)); }}>
            <Link to={`/campaigns/${c.id}`}>{c.name}</Link>
            <span className="d-mono">{c.system_name ?? "—"}</span>
            <span className="d-mono">{c.type === "oneshot" ? "ваншот" : `сыграно ${c.held_sessions_count ?? 0}`}</span>
            <span className="d-mono">{c.last_played_date ? monthYear.format(parseDateKey(c.last_played_date)).replace(" г.", "") : ""}</span>
            <EntityMenuButton entity={{ type: "campaign", id: c.id, name: c.name }} local={menuFor(c)} />
          </li>
        ))}
      </ul>
    </section>
  );
}
