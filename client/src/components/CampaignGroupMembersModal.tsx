import { useEffect, useState } from "react";
import { useAfterWrite, useResource, write } from "../data/hooks";
import { campaignGroupAffects, campaignPaths } from "../data/campaigns";
import type { Campaign } from "../types";
import { useAlert } from "../hooks/useConfirm";

interface CampaignGroupMembersModalProps {
  groupId: number;
  groupName: string;
  onClose: () => void;
  onUpdated: () => void;
}

export function CampaignGroupMembersModal({ groupId, groupName, onClose, onUpdated }: CampaignGroupMembersModalProps) {
  const all = useResource<Campaign[]>(campaignPaths.list());
  const members = useResource<Campaign[]>(campaignPaths.groupMembers(groupId));
  const allCampaigns = all.data ?? [];
  const loading = all.loading || members.loading;
  // Отметки держатся здесь, чтобы галочка менялась сразу, а не после ответа.
  const [memberIds, setMemberIds] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (members.data) setMemberIds(new Set(members.data.map((m) => m.id)));
  }, [members.data]);
  const [saving, setSaving] = useState(false);
  const afterWrite = useAfterWrite();

  const [alertDialog, showAlert] = useAlert();

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
        await write.del(`/campaign-groups/${groupId}/members?campaignIds=${campaignId}`);
      } else {
        await write.post(`/campaign-groups/${groupId}/members`, { campaignIds: [campaignId] });
      }
      afterWrite(campaignGroupAffects());
      onUpdated();
    } catch (e) {
      // revert on error
      setMemberIds((prev) => {
        const revert = new Set(prev);
        if (wasIn) revert.add(campaignId);
        else revert.delete(campaignId);
        return revert;
      });
      showAlert(String(e instanceof Error ? e.message : e));
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
      {alertDialog}
    </div>
  );
}
