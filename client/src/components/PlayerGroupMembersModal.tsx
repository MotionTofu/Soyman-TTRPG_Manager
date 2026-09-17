import { useEffect, useState } from "react";
import { useAfterWrite, useResource, write } from "../data/hooks";
import type { Player } from "../types";
import { useAlert } from "../hooks/useConfirm";

interface PlayerGroupMembersModalProps {
  groupId: number;
  groupName: string;
  onClose: () => void;
  onUpdated: () => void;
}

export function PlayerGroupMembersModal({ groupId, groupName, onClose, onUpdated }: PlayerGroupMembersModalProps) {
  const all = useResource<Player[]>("/players");
  const members = useResource<Player[]>(`/player-groups/${groupId}/members`);
  const allPlayers = all.data ?? [];
  const loading = all.loading || members.loading;
  // Отметки держатся здесь, чтобы галочка менялась сразу, а не после ответа.
  const [memberIds, setMemberIds] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (members.data) setMemberIds(new Set(members.data.map((m) => m.id)));
  }, [members.data]);
  const [saving, setSaving] = useState(false);
  const afterWrite = useAfterWrite();

  const [alertDialog, showAlert] = useAlert();

  async function toggle(playerId: number) {
    const next = new Set(memberIds);
    const wasIn = next.has(playerId);
    if (wasIn) {
      next.delete(playerId);
    } else {
      next.add(playerId);
    }
    setMemberIds(next);

    setSaving(true);
    try {
      if (wasIn) {
        await write.del(`/player-groups/${groupId}/members?playerIds=${playerId}`);
      } else {
        await write.post(`/player-groups/${groupId}/members`, { playerIds: [playerId] });
      }
      afterWrite([{ path: "/player-groups" }]);
      onUpdated();
    } catch (e) {
      // revert on error
      setMemberIds((prev) => {
        const revert = new Set(prev);
        if (wasIn) revert.add(playerId);
        else revert.delete(playerId);
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
          Отметьте игроков, которые входят в группу:
        </p>

        {loading ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>Загрузка…</div>
        ) : allPlayers.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>Нет игроков</div>
        ) : (
          <div className="group-members-list" style={{ maxHeight: 400, overflowY: "auto" }}>
            {allPlayers.map((p) => (
              <label
                key={p.id}
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
                  checked={memberIds.has(p.id)}
                  onChange={() => toggle(p.id)}
                  disabled={saving}
                />
                <span>{p.name}</span>
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
