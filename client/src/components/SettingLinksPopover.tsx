import { useState } from "react";
import { api } from "../api/client";

interface Props {
  ownerType: "resource" | "playlist";
  ownerId: number;
  // The resource's/playlist's single "home" setting_id, if any — shown
  // checked and disabled, since that membership isn't managed through this
  // popover (it's the row's actual scope, not an extra tag).
  homeSettingId: number | null;
  linkedSettingIds: number[];
  allSettings: { id: number; name: string }[];
  onChange: () => void;
}

// Small popover for the global Ресурсы library's "present in multiple
// settings" feature — toggling a playlist cascades server-side to all of
// its tracks (see POST/DELETE /playlists/:id/settings), so this component
// doesn't need to know that; it just calls the same two endpoint shapes for
// both owner types. Same absolute-positioned popover pattern as
// PlaylistNavMenu.tsx (.playlist-nav-menu), styled via .setting-links-popover.
export function SettingLinksPopover({ ownerType, ownerId, homeSettingId, linkedSettingIds, allSettings, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const linked = new Set(linkedSettingIds);

  async function toggle(settingId: number) {
    if (linked.has(settingId)) {
      await api.del(`/${ownerType}s/${ownerId}/settings/${settingId}`);
    } else {
      await api.post(`/${ownerType}s/${ownerId}/settings`, { setting_id: settingId });
    }
    onChange();
  }

  return (
    <span style={{ position: "relative" }}>
      <button
        type="button"
        className="comp-mini"
        onClick={() => setOpen((o) => !o)}
        title="Присутствие в сеттингах"
      >
        🔗{linkedSettingIds.length > 0 ? ` ${linkedSettingIds.length}` : ""}
      </button>
      {open && (
        <div className="setting-links-popover">
          {allSettings.length === 0 && <span className="muted">Сеттингов нет.</span>}
          {allSettings.map((s) => (
            <label key={s.id} className="row" style={{ gap: 6, whiteSpace: "nowrap" }}>
              <input
                type="checkbox"
                checked={s.id === homeSettingId || linked.has(s.id)}
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
