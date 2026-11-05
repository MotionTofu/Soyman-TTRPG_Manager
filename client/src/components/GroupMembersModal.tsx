import { useEffect, useState } from "react";
import { useAfterWrite, useResource, write } from "../data/hooks";
import { useAlert } from "../hooks/useConfirm";
import { Modal } from "./Modal";
import type { ContextMenuItem } from "./ContextMenu";
import type { Affect } from "../data/entities";
import "./list-registry.css";

// Одно окно состава группы на все четыре реестра (Q12 гриллинга 2026-11-05;
// раньше — четыре копии, различавшиеся адресом и словом). Адреса устроены
// одинаково: список `/<kind>s`, группы `/<kind>-groups`, состав —
// `/<kind>-groups/:id/members` с полем `<kind>Ids`.
export type GroupKind = "campaign" | "setting" | "player" | "system";

const WORDS: Record<GroupKind, { many: string; none: string }> = {
  campaign: { many: "кампании", none: "Нет кампаний" },
  setting: { many: "сеттинги", none: "Нет сеттингов" },
  player: { many: "игроков", none: "Нет игроков" },
  system: { many: "системы", none: "Нет систем" },
};

interface Props {
  kind: GroupKind;
  groupId: number;
  groupName: string;
  onClose: () => void;
  onUpdated?: () => void;
}

export function GroupMembersModal({ kind, groupId, groupName, onClose, onUpdated }: Props) {
  const groupsPath = `/${kind}-groups`;
  const all = useResource<{ id: number; name: string }[]>(`/${kind}s`);
  const members = useResource<{ id: number }[]>(`${groupsPath}/${groupId}/members`);
  const items = all.data ?? [];
  const loading = all.loading || members.loading;
  // Отметки держатся здесь, чтобы галочка менялась сразу, а не после ответа.
  const [memberIds, setMemberIds] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (members.data) setMemberIds(new Set(members.data.map((m) => m.id)));
  }, [members.data]);
  const [saving, setSaving] = useState(false);
  const afterWrite = useAfterWrite();
  const [alertDialog, showAlert] = useAlert();

  async function toggle(id: number) {
    const wasIn = memberIds.has(id);
    const next = new Set(memberIds);
    if (wasIn) next.delete(id);
    else next.add(id);
    setMemberIds(next);
    setSaving(true);
    try {
      if (wasIn) await write.del(`${groupsPath}/${groupId}/members?${kind}Ids=${id}`);
      else await write.post(`${groupsPath}/${groupId}/members`, { [`${kind}Ids`]: [id] });
      afterWrite([{ path: groupsPath }]);
      onUpdated?.();
    } catch (e) {
      setMemberIds((prev) => {
        const revert = new Set(prev);
        if (wasIn) revert.add(id);
        else revert.delete(id);
        return revert;
      });
      showAlert(String(e instanceof Error ? e.message : e));
    } finally {
      setSaving(false);
    }
  }

  const words = WORDS[kind];
  return (
    <Modal onClose={onClose} ariaLabel={`Состав группы «${groupName}»`} className="group-members-modal">
      <h2>{groupName}</h2>
      <p className="muted">Отметьте {words.many}, которые входят в группу:</p>
      {loading ? (
        <p className="muted">Загрузка…</p>
      ) : items.length === 0 ? (
        <p className="muted">{words.none}</p>
      ) : (
        <div className="group-members-list">
          {items.map((item) => (
            <label key={item.id} className="group-members-item">
              <input type="checkbox" className="d-check" checked={memberIds.has(item.id)} onChange={() => void toggle(item.id)} disabled={saving} />
              <span>{item.name}</span>
            </label>
          ))}
        </div>
      )}
      <div className="modal-footer row">
        <button type="button" className="d-btn" onClick={onClose}>Готово</button>
      </div>
      {alertDialog}
    </Modal>
  );
}

/** Пункт ⋯ записи в открытой группе (Q12): убрать из неё, не открывая окна состава. */
export function removeFromGroupItem(
  kind: GroupKind,
  group: { id: number; name: string },
  id: number,
  run: <R>(action: () => Promise<R>, options: { affects: Affect[] }) => Promise<R | undefined>,
): ContextMenuItem {
  return {
    label: `Убрать из группы «${group.name}»`,
    onClick: () => void run(() => write.del(`/${kind}-groups/${group.id}/members?${kind}Ids=${id}`).then(() => true), { affects: [{ path: `/${kind}-groups` }] }),
  };
}
