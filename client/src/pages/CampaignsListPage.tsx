import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { SectionHeading } from "../components/SectionHeading";
import { CampaignCoverTile } from "../components/CampaignCoverTile";
import { EmptyState } from "../components/EmptyState";
import { CampaignWizard } from "../components/CampaignWizard";
import type { Campaign, CampaignRole, Setting, System } from "../types";

export function CampaignsListPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [systems, setSystems] = useState<System[]>([]);
  const [settings, setSettings] = useState<Setting[]>([]);
  const [creating, setCreating] = useState(false);
  const [roleFilter, setRoleFilter] = useState<"all" | CampaignRole>("all");
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

  useEffect(() => {
    const controller = new AbortController();
    loadCampaigns(controller.signal);
    api.get<System[]>("/systems", { signal: controller.signal }).then(setSystems).catch(() => {});
    api.get<Setting[]>("/settings", { signal: controller.signal }).then(setSettings).catch(() => {});
    return () => controller.abort();
  }, []);

  function refresh() {
    void loadCampaigns();
  }

  const filtered = useMemo(
    () => campaigns.filter((c) => roleFilter === "all" || c.role === roleFilter),
    [campaigns, roleFilter],
  );

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <SectionHeading section="campaigns" compact>Кампании</SectionHeading>
        <button className="primary" onClick={openCreate}>
          + Новая кампания
        </button>
      </div>

      <div className="tabs" role="tablist" aria-label="Фильтр по роли">
        {([
          { value: "all", label: "Все" },
          { value: "gm", label: "Я мастер" },
          { value: "player", label: "Я игрок" },
        ] as const).map((f) => (
          <button
            key={f.value}
            role="tab"
            aria-selected={roleFilter === f.value}
            className={roleFilter === f.value ? "active" : ""}
            onClick={() => setRoleFilter(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>

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
        </div>
      )}

      {!loading && !loadError && filtered.length === 0 && campaigns.length > 0 && (
        <div className="muted" style={{ padding: "8px 2px" }}>
          Нет кампаний «{roleFilter === "gm" ? "Я мастер" : "Я игрок"}» — <button style={{ padding: 0, border: "none", background: "none", color: "var(--accent)", textDecoration: "underline", cursor: "pointer" }} onClick={() => setRoleFilter("all")}>показать все</button>
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
    </div>
  );
}
