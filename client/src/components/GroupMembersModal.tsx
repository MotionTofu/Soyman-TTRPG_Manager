import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { Setting } from "../types";
import { useAlert } from "../hooks/useConfirm";

interface GroupMembersModalProps {
  groupId: number;
  groupName: string;
  onClose: () => void;
  onUpdated: () => void;
}

export function GroupMembersModal({ groupId, groupName, onClose, onUpdated }: GroupMembersModalProps) {
  const [allSettings, setAllSettings] = useState<Setting[]>([]);
  const [memberIds, setMemberIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [alertDialog, showAlert] = useAlert();

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const [all, members] = await Promise.all([
          api.get<Setting[]>("/settings", { signal: controller.signal }),
          api.get<Setting[]>(`/setting-groups/${groupId}/members`, { signal: controller.signal }),
        ]);
        setAllSettings(all);
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

  async function toggle(settingId: number) {
    const next = new Set(memberIds);
    const wasIn = next.has(settingId);
    if (wasIn) {
      next.delete(settingId);
    } else {
      next.add(settingId);
    }
    setMemberIds(next);

    setSaving(true);
    try {
      if (wasIn) {
        await api.del(`/setting-groups/${groupId}/members?settingIds=${settingId}`);
      } else {
        await api.post(`/setting-groups/${groupId}/members`, { settingIds: [settingId] });
      }
      onUpdated();
    } catch (e) {
      // revert on error
      setMemberIds((prev) => {
        const revert = new Set(prev);
        if (wasIn) revert.add(settingId);
        else revert.delete(settingId);
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
          Отметьте сеттинги, которые входят в группу:
        </p>

        {loading ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>Загрузка…</div>
        ) : allSettings.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>Нет сеттингов</div>
        ) : (
          <div className="group-members-list" style={{ maxHeight: 400, overflowY: "auto" }}>
            {allSettings.map((s) => (
              <label
                key={s.id}
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
                  checked={memberIds.has(s.id)}
                  onChange={() => toggle(s.id)}
                  disabled={saving}
                />
                <span>{s.name}</span>
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
