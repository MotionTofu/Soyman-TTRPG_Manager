import { useEffect, useState } from "react";
import { useAfterWrite, useResource, write } from "../data/hooks";
import type { Setting } from "../types";
import { useAlert } from "../hooks/useConfirm";

interface GroupMembersModalProps {
  groupId: number;
  groupName: string;
  onClose: () => void;
  onUpdated: () => void;
}

export function GroupMembersModal({ groupId, groupName, onClose, onUpdated }: GroupMembersModalProps) {
  const all = useResource<Setting[]>("/settings");
  const members = useResource<Setting[]>(`/setting-groups/${groupId}/members`);
  const allSettings = all.data ?? [];
  const loading = all.loading || members.loading;
  // Отметки держатся здесь, чтобы галочка менялась сразу, а не после ответа.
  const [memberIds, setMemberIds] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (members.data) setMemberIds(new Set(members.data.map((m) => m.id)));
  }, [members.data]);
  const [saving, setSaving] = useState(false);
  const afterWrite = useAfterWrite();

  const [alertDialog, showAlert] = useAlert();

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
        await write.del(`/setting-groups/${groupId}/members?settingIds=${settingId}`);
      } else {
        await write.post(`/setting-groups/${groupId}/members`, { settingIds: [settingId] });
      }
      afterWrite([{ path: "/setting-groups" }]);
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
