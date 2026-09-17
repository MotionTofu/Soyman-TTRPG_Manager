import { useEffect, useState } from "react";
import { useAction, write } from "../data/hooks";
import type { Affect } from "../data/entities";
import { labelled } from "../data/notices";
import { NavIcon } from "./NavIcons";

interface Props {
  ownerType: "resource" | "playlist";
  ownerId: number;
  // The resource's/playlist's single "home" setting_id, if any — shown
  // checked and disabled, since that membership isn't managed through this
  // popover (it's the row's actual scope, not an extra tag).
  homeSettingId: number | null;
  linkedSettingIds: number[];
  allSettings: { id: number; name: string }[];
  // Квадратная кнопка одного размера с соседями: счётчик сеттингов уходит
  // из подписи в угловой значок, иначе кнопка меняет ширину от числа
  // связей и колонка действий перестаёт стоять на одной вертикали.
  compact?: boolean;
}

// Small popover for the global Ресурсы library's "present in multiple
// settings" feature — toggling a playlist cascades server-side to all of
// its tracks (see POST/DELETE /playlists/:id/settings), so this component
// doesn't need to know that; it just calls the same two endpoint shapes for
// both owner types. Same absolute-positioned popover pattern as
// SoundSetNavMenu.tsx (.playlist-nav-menu), styled via .setting-links-popover.
export function SettingLinksPopover({ ownerType, ownerId, homeSettingId, linkedSettingIds, allSettings, compact = false }: Props) {
  const run = useAction();
  const [open, setOpen] = useState(false);
  // Галочка меняется сразу, до перечитки списка: иначе в эти доли секунды
  // повторный щелчок слал тот же запрос ещё раз. Пришли данные — отметки снова
  // берутся из них.
  const [pending, setPending] = useState<Record<number, boolean>>({});
  const linkedKey = linkedSettingIds.join(",");
  useEffect(() => setPending({}), [linkedKey]);
  const linked = new Set(linkedSettingIds);
  const isLinked = (settingId: number) => pending[settingId] ?? linked.has(settingId);

  async function toggle(settingId: number) {
    const unlink = isLinked(settingId);
    setPending((p) => ({ ...p, [settingId]: !unlink }));
    // Владелец (ресурс или плейлист) и сеттинг, в котором он появился или пропал.
    const owner: Affect = ownerType === "resource" ? { kind: "resource", id: ownerId } : { path: "/playlists" };
    const done = await run(
      labelled(unlink ? "Связь с сеттингом не снята" : "Связь с сеттингом не добавлена", () =>
        unlink
          ? write.del(`/${ownerType}s/${ownerId}/settings/${settingId}`)
          : write.post(`/${ownerType}s/${ownerId}/settings`, { setting_id: settingId })
      ),
      { affects: [owner, { kind: "setting", id: settingId }] }
    );
    if (done === undefined) {
      setPending((p) => {
        const next = { ...p };
        delete next[settingId];
        return next;
      });
    }
  }

  return (
    <span style={{ position: "relative" }}>
      <button
        type="button"
        className={compact ? "res-row__act" : "comp-mini"}
        onClick={() => setOpen((o) => !o)}
        title="Присутствие в сеттингах"
      >
        <NavIcon name="link" />
        {linkedSettingIds.length > 0 &&
          (compact ? (
            <span className="res-row__act-count">{linkedSettingIds.length}</span>
          ) : (
            ` ${linkedSettingIds.length}`
          ))}
      </button>
      {open && (
        <div className="setting-links-popover">
          {allSettings.length === 0 && <span className="muted">Сеттингов нет.</span>}
          {allSettings.map((s) => (
            <label key={s.id} className="row" style={{ gap: 6, whiteSpace: "nowrap" }}>
              <input
                type="checkbox"
                checked={s.id === homeSettingId || isLinked(s.id)}
                disabled={s.id === homeSettingId}
                onChange={() => toggle(s.id)}
              />
              {s.name}
              {s.id === homeSettingId && <span className="muted"> (основной)</span>}
            </label>
          ))}
        </div>
      )}
    </span>
  );
}
