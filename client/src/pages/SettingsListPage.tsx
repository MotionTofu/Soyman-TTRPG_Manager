import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { MentionText } from "../components/mentions/MentionText";
import { SettingWizard } from "../components/SettingWizard";
import { SettingGroupTabs } from "../components/SettingGroupTabs";
import { GroupMembersModal } from "../components/GroupMembersModal";
import { SectionHeading } from "../components/SectionHeading";
import { EmptyState } from "../components/EmptyState";
import { SectionBackground } from "../components/SectionBackground";
import { ZineGraphic } from "../components/ZineGraphics";
import { GENRE_CATEGORIES } from "../genreData";
import { safeBackgroundImage, isSafeImageUrl } from "../utils/safeUrl";
import { useAuthenticatedFileUrl } from "../utils/fileUrl";
import { NavIcon } from "../components/NavIcons";

import type { Setting, SettingGroup } from "../types";

function SettingCoverTile({ setting: s }: { setting: Setting }) {
  const rawUrl = s.thumbnail_image_url ?? s.background_image_url ?? null;
  const imageUrl = rawUrl && isSafeImageUrl(rawUrl) ? rawUrl : null;
  const authBlob = useAuthenticatedFileUrl(imageUrl);
  const bg = imageUrl?.startsWith("/files/")
    ? (authBlob ? `url("${authBlob}")` : undefined)
    : safeBackgroundImage(imageUrl);

  const genres = s.genres ?? [];

  return (
    <Link to={`/settings/${s.id}`} className="card campaign-tile">
      <div className="campaign-tile-cover cover-halftone">
        {bg ? (
          <div className="cover-art cover-photo">
            <div className="cover-art-image" style={{ backgroundImage: bg }} aria-hidden="true" />
          </div>
        ) : (
          <div className="cover-art cover-art-fallback zine-grain" aria-hidden="true" />
        )}
        <div className="campaign-tile-scrim" />
        <h3 className="campaign-tile-name">{s.name}</h3>
      </div>
      <div className="campaign-tile-meta">
        <div className="campaign-tile-system">
          {s.description ? <MentionText text={s.description} /> : "без описания"}
        </div>
        {genres.length > 0 && (
          <div className="genre-chips">
            {genres.map((g, i) => {
              const cat = GENRE_CATEGORIES.find((c) => c.name === g.genre);
              return (
                <span
                  key={i}
                  className="genre-chip"
                  style={{ "--genre-color": cat?.color ?? "#888" } as React.CSSProperties}
                >
                  {cat && <ZineGraphic name={cat.icon} className="genre-chip-icon" />}
                  {g.subgenre ?? g.genre}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </Link>
  );
}

export function SettingsListPage() {
  const navigate = useNavigate();
  const [settings, setSettings] = useState<Setting[]>([]);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [groups, setGroups] = useState<SettingGroup[]>([]);
  const [groupMemberships, setGroupMemberships] = useState<Record<number, number[]>>({});
  const [groupMembersModal, setGroupMembersModal] = useState<{ groupId: number; groupName: string } | null>(null);

  async function loadSettings(signal?: AbortSignal) {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await api.get<Setting[]>("/settings", signal ? { signal } : undefined);
      setSettings(data);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setLoadError(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }

  async function loadGroupMemberships(signal?: AbortSignal) {
    try {
      const fetchedGroups = await api.get<SettingGroup[]>("/setting-groups", signal ? { signal } : undefined);
      setGroups(fetchedGroups);
      const memberships: Record<number, number[]> = {};
      for (const g of fetchedGroups) {
        const members = await api.get<Setting[]>(
          `/setting-groups/${g.id}/members`,
          signal ? { signal } : undefined
        );
        for (const m of members) {
          if (!memberships[m.id]) memberships[m.id] = [];
          memberships[m.id].push(g.id);
        }
      }
      setGroupMemberships(memberships);
    } catch {
      // silent
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    loadSettings(controller.signal);
    loadGroupMemberships(controller.signal);
    return () => controller.abort();
  }, []);

  function refresh() {
    void loadSettings();
    void loadGroupMemberships();
  }

  useEffect(() => () => { if (creating) setCreating(false); }, [creating]);

  const filteredSettings = (() => {
    if (activeTab === null) return settings;
    if (activeTab === "ungrouped") {
      return settings.filter((s) => !groupMemberships[s.id]?.length);
    }
    const groupId = Number(activeTab);
    return settings.filter((s) => groupMemberships[s.id]?.includes(groupId));
  })();

  return (
    <div className="stack" style={{ position: "relative" }}>
      <SectionBackground />
      <div className="page-header-row row">
        <SectionHeading section="settings" compact>Сеттинги</SectionHeading>
        <div className="row">
          <button onClick={() => navigate("/import")}>Импорт приключения</button>
          <button className="primary" onClick={() => setCreating(true)}>
            + Новый сеттинг
          </button>
        </div>
      </div>

      <SettingGroupTabs
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onGroupsChanged={refresh}
      />

      {loadError && (
        <div className="card" style={{ borderLeft: "3px solid var(--status-cancelled)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <span>Не удалось загрузить сеттинги: {loadError}</span>
          <button className="primary" onClick={refresh}>Повторить</button>
        </div>
      )}

      {loading ? (
        <div className="grid-cards" aria-busy="true" aria-label="Загрузка сеттингов">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card" style={{ height: 220, opacity: 0.45, background: "var(--bg-elevated)", animation: "search-skeleton-pulse 1.1s ease-in-out infinite alternate", animationDelay: `${i * 120}ms` }} />
          ))}
        </div>
      ) : (
        <div className="grid-cards">
          {filteredSettings.map((s) => (
            <SettingCoverTile key={s.id} setting={s} />
          ))}
          {activeTab !== null && activeTab !== "ungrouped" && (
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
                <span className="group-add-icon"><NavIcon name="galaxy" /></span>
                <h3 className="campaign-tile-name">+</h3>
              </div>
              <div className="campaign-tile-meta">
                <div className="campaign-tile-system muted">нажми, чтобы добавить сеттинг в группу</div>
              </div>
            </button>
          )}
        </div>
      )}

      {!loading && !loadError && settings.length === 0 && (
        <EmptyState
          icon="anarchyStar"
          title="Мир не начерчен"
          hint="Ни одного сеттинга ещё нет — создайте первый."
          action={
            <button className="primary" onClick={() => setCreating(true)}>
              + Новый сеттинг
            </button>
          }
        />
      )}

      {creating && <SettingWizard onClose={() => { setCreating(false); refresh(); }} />}

      {groupMembersModal && (
        <GroupMembersModal
          groupId={groupMembersModal.groupId}
          groupName={groupMembersModal.groupName}
          onClose={() => setGroupMembersModal(null)}
          onUpdated={refresh}
        />
      )}
    </div>
  );
}
