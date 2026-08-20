import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useSoundEngineOptional } from "../sound/engine";
import { NavIcon } from "./NavIcons";
import type { SoundSetSummary } from "../sound/types";
import type { Campaign, Setting } from "../types";

interface Props {
  onClose: () => void;
}

// Всплывающий список из нижней панели. Раньше это были плейлисты — теперь
// наборы: плейлист остался только боевой темой, а включают за столом именно
// набор. Группировка по сеттингу и кампании — не иерархия владения (набор
// глобальный), а способ не искать «Таверну» среди сорока чужих строчек.
export function SoundSetNavMenu({ onClose }: Props) {
  const engine = useSoundEngineOptional();
  const [sets, setSets] = useState<SoundSetSummary[]>([]);
  const [settings, setSettings] = useState<Setting[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);

  useEffect(() => {
    api.get<SoundSetSummary[]>("/sound-sets").then(setSets).catch(() => setSets([]));
    api.get<Setting[]>("/settings").then(setSettings).catch(() => setSettings([]));
    api.get<Campaign[]>("/campaigns").then(setCampaigns).catch(() => setCampaigns([]));
  }, []);

  function groupOf(s: SoundSetSummary): string {
    if (s.campaign_id) {
      return campaigns.find((c) => c.id === s.campaign_id)?.name ?? "Кампания";
    }
    if (s.setting_id) {
      return settings.find((x) => x.id === s.setting_id)?.name ?? "Сеттинг";
    }
    return "Без привязки";
  }

  const groups = new Map<string, SoundSetSummary[]>();
  for (const s of sets) {
    const key = groupOf(s);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }

  const playing = engine?.state.setId ?? null;

  return (
    <div className="playlist-nav-menu">
      {sets.length === 0 && (
        <div className="muted" style={{ padding: 8 }}>
          Наборов пока нет — их собирают в Ресурсах, вкладка «Аудио-наборы».
        </div>
      )}
      {[...groups.entries()].map(([name, items]) => (
        <details key={name} open className="playlist-nav-group">
          <summary>{name}</summary>
          {items.map((s) => (
            <button
              key={s.id}
              type="button"
              className="playlist-nav-item"
              disabled={!engine}
              onClick={() => {
                engine?.setSet(s.id);
                onClose();
              }}
            >
              <NavIcon name="player" /> {s.name} ({s.track_count})
              {s.id === playing ? " · играет" : ""}
            </button>
          ))}
        </details>
      ))}
    </div>
  );
}
