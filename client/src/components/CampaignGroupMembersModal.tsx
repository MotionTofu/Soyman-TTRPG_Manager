import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { Campaign } from "../types";

interface CampaignGroupMembersModalProps {
  groupId: number;
  groupName: string;
  onClose: () => void;
  onUpdated: () => void;
}

export function CampaignGroupMembersModal({ groupId, groupName, onClose, onUpdated }: CampaignGroupMembersModalProps) {
  const [allCampaigns, setAllCampaigns] = useState<Campaign[]>([]);
  const [memberIds, setMemberIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const [all, members] = await Promise.all([
          api.get<Campaign[]>("/campaigns", { signal: controller.signal }),
          api.get<Campaign[]>(`/campaign-groups/${groupId}/members`, { signal: controller.signal }),
        ]);
        setAllCampaigns(all);
        setMemberIds(new Set(members.map((m) => m.id)));
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    }
    load();
    return () => controller.abort();
  }, [groupId]);

  async function toggle(campaignId: number) {
    const next = new Set(memberIds);
    const wasIn = next.has(campaignId);
    if (wasIn) {
      next.delete(campaignId);
    } else {
      next.add(campaignId);
    }
    setMemberIds(next);

    setSaving(true);
    try {
      if (wasIn) {
        await api.del(`/campaign-groups/${groupId}/members?campaignIds=${campaignId}`);
      } else {
        await api.post(`/campaign-groups/${groupId}/members`, { campaignIds: [campaignId] });
      }
      onUpdated();
    } catch (e) {
      // revert on error
      setMemberIds((prev) => {
        const revert = new Set(prev);
        if (wasIn) revert.add(campaignId);
        else revert.delete(campaignId);
        return revert;
      });
      alert(String(e instanceof Error ? e.message : e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480, width: "100%" }}>
        <h3 style={{ marginBottom: 12 }}>{groupName}</h3>
        <p style={{ color: "var(--muted)", fontSize: "var(--fs-meta)", marginBottom: 12 }}>
          Отметьте кампании, которые входят в группу:
        </p>

        {loading ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>Загрузка…</div>
        ) : allCampaigns.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>Нет кампаний</div>
        ) : (
          <div className="group-members-list" style={{ maxHeight: 400, overflowY: "auto" }}>
            {allCampaigns.map((c) => (
              <label
                key={c.id}
                className="group-members-item"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 0",
                  cursor: "pointer",
                  opacity: saving ? 0.6 : 1,
                }}
              >
                <input
                  type="checkbox"
                  checked={memberIds.has(c.id)}
                  onChange={() => toggle(c.id)}
                  disabled={saving}
                />
                <span>{c.name}</span>
              </label>
            ))}
          </div>
        )}

        <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-start" }}>
          <button onClick={onClose}>Готово</button>
        </div>
      </div>
    </div>
  );
}
