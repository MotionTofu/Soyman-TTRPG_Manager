import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { SectionHeading } from "../components/SectionHeading";
import { CampaignCoverTile } from "../components/CampaignCoverTile";
import { EmptyState } from "../components/EmptyState";
import { CampaignWizard } from "../components/CampaignWizard";
import { CampaignGroupTabs } from "../components/CampaignGroupTabs";
import { CampaignGroupMembersModal } from "../components/CampaignGroupMembersModal";
import { NavIcon } from "../components/NavIcons";
import type { Campaign, CampaignGroup, Setting, System } from "../types";

export function CampaignsListPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [systems, setSystems] = useState<System[]>([]);
  const [settings, setSettings] = useState<Setting[]>([]);
  const [creating, setCreating] = useState(false);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [groups, setGroups] = useState<CampaignGroup[]>([]);
  const [groupMemberIds, setGroupMemberIds] = useState<Set<number>>(new Set());
  const [groupMembersModal, setGroupMembersModal] = useState<{ groupId: number; groupName: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  function openCreate() {
    setCreating(true);
  }

  async function loadCampaigns(signal?: AbortSignal) {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await api.get<Campaign[]>("/campaigns", signal ? { signal } : undefined);
      setCampaigns(data);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setLoadError(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }

  async function loadGroupMembers() {
    if (!activeTab || activeTab === "ungrouped") {
      setGroupMemberIds(new Set());
      return;
    }
    try {
      const members = await api.get<Campaign[]>(`/campaign-groups/${activeTab}/members`);
      setGroupMemberIds(new Set(members.map((m) => m.id)));
    } catch {
      setGroupMemberIds(new Set());
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    loadCampaigns(controller.signal);
    api.get<System[]>("/systems", { signal: controller.signal }).then(setSystems).catch(() => {});
    api.get<Setting[]>("/settings", { signal: controller.signal }).then(setSettings).catch(() => {});
    api.get<CampaignGroup[]>("/campaign-groups", { signal: controller.signal }).then(setGroups).catch(() => {});
    return () => controller.abort();
  }, []);

  useEffect(() => {
    loadGroupMembers();
  }, [activeTab]);

  function refresh() {
    void loadCampaigns();
    void loadGroupMembers();
  }

  const filtered = useMemo(() => {
    if (!activeTab) return campaigns;
    if (activeTab === "role:gm") return campaigns.filter((c) => c.role === "gm");
    if (activeTab === "role:player") return campaigns.filter((c) => c.role === "player");
    if (activeTab === "ungrouped") return campaigns.filter((c) => !groupMemberIds.has(c.id));
    return campaigns.filter((c) => groupMemberIds.has(c.id));
  }, [campaigns, activeTab, groupMemberIds]);

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <SectionHeading section="campaigns" compact>Кампании</SectionHeading>
        <button className="primary" onClick={openCreate}>
          + Новая кампания
        </button>
      </div>

      <CampaignGroupTabs
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onGroupsChanged={refresh}
      />

      {loadError && (
        <div className="card" style={{ borderLeft: "3px solid var(--status-cancelled)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <span>Не удалось загрузить кампании: {loadError}</span>
          <button className="primary" onClick={refresh}>Повторить</button>
        </div>
      )}

      {loading ? (
        <div className="grid-cards" aria-busy="true" aria-label="Загрузка кампаний">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card" style={{ height: 220, opacity: 0.45, background: "var(--bg-elevated)", animation: "search-skeleton-pulse 1.1s ease-in-out infinite alternate", animationDelay: `${i * 120}ms` }} />
          ))}
        </div>
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
        <div className="muted" style={{ padding: "8px 2px" }}>
          Нет кампаний в этой группе — <button style={{ padding: 0, border: "none", background: "none", color: "var(--accent)", textDecoration: "underline", cursor: "pointer" }} onClick={() => setActiveTab(null)}>показать все</button>
        </div>
      )}

      {!loading && !loadError && campaigns.length === 0 && (
        <EmptyState
          icon="skullDie"
          title="Пока тихо"
          hint="Ни одной кампании ещё нет — начните первую."
          action={
            <button className="primary" onClick={openCreate}>
              + Новая кампания
            </button>
          }
        />
      )}

      {creating && (
        <CampaignWizard
          systems={systems}
          settings={settings}
          onClose={() => setCreating(false)}
          onCreated={refresh}
        />
      )}

      {groupMembersModal && (
        <CampaignGroupMembersModal
          groupId={groupMembersModal.groupId}
          groupName={groupMembersModal.groupName}
          onClose={() => setGroupMembersModal(null)}
          onUpdated={refresh}
        />
      )}
    </div>
  );
}
