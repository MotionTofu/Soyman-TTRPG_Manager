import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { Player } from "../types";

interface PlayerGroupMembersModalProps {
  groupId: number;
  groupName: string;
  onClose: () => void;
  onUpdated: () => void;
}

export function PlayerGroupMembersModal({ groupId, groupName, onClose, onUpdated }: PlayerGroupMembersModalProps) {
  const [allPlayers, setAllPlayers] = useState<Player[]>([]);
  const [memberIds, setMemberIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const [all, members] = await Promise.all([
          api.get<Player[]>("/players", { signal: controller.signal }),
          api.get<Player[]>(`/player-groups/${groupId}/members`, { signal: controller.signal }),
        ]);
        setAllPlayers(all);
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
        await api.del(`/player-groups/${groupId}/members?playerIds=${playerId}`);
      } else {
        await api.post(`/player-groups/${groupId}/members`, { playerIds: [playerId] });
      }
      onUpdated();
    } catch (e) {
      // revert on error
      setMemberIds((prev) => {
        const revert = new Set(prev);
        if (wasIn) revert.add(playerId);
        else revert.delete(playerId);
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
    </div>
  );
}
