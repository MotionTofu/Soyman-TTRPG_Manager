import { MentionText } from "../mentions/MentionText";
import type { ReaderEntry } from "../PlayerContentReader";
import type { SettingPlayerContent } from "../../types";

function formatDate(y: number, m: number, d: number): string {
  return `${d}.${m}.${y}`;
}

// Мир кампании записями читалки — один строитель на два экрана: страницу
// игрока (PlayerCampaignPage) и превью «Глазами игрока» у мастера. Строить
// превью своим способом значит врать при раздаче доступов, поэтому оба
// экрана зовут это, а не копируют разбор.
export interface SettingReaderGroups {
  key: string;
  label: string;
  entries: ReaderEntry[];
}

export function buildSettingReaderGroups(setting: SettingPlayerContent | null): SettingReaderGroups[] {
  if (!setting) return [];
  const groups: SettingReaderGroups[] = [];
  if (setting.locations.length > 0) {
    groups.push({
      key: "setting-locations",
      label: "Локации сеттинга",
      entries: setting.locations.map((l) => ({
        key: `setting-loc-${l.id}`,
        section: "Локации сеттинга",
        title: l.name,
        body: l.description ? (
          <div className="muted" style={{ whiteSpace: "pre-wrap" }}>
            <MentionText text={l.description} />
          </div>
        ) : null,
      })),
    });
  }
  if (setting.beings.length > 0 || setting.communities.length > 0) {
    groups.push({
      key: "setting-factions",
      label: "Личности и фракции",
      entries: [
        ...setting.beings.map((b) => ({
          key: `setting-being-${b.id}`,
          section: "Личности и фракции",
          title: b.name,
          body: b.history ? (
            <div className="muted" style={{ whiteSpace: "pre-wrap" }}>
              <MentionText text={b.history} />
            </div>
          ) : null,
        })),
        ...setting.communities.map((c) => ({
          key: `setting-community-${c.id}`,
          section: "Личности и фракции",
          title: c.name,
          body: c.description ? (
            <div className="muted" style={{ whiteSpace: "pre-wrap" }}>
              <MentionText text={c.description} />
            </div>
          ) : null,
        })),
      ],
    });
  }
  if (setting.chronicleEvents.length > 0) {
    groups.push({
      key: "setting-history",
      label: "История",
      entries: setting.chronicleEvents.map((e) => ({
        key: `setting-event-${e.id}`,
        section: "История",
        title: e.title,
        body: (
          <div className="stack" style={{ gap: 10 }}>
            <span className="muted">{formatDate(e.inworld_year, e.inworld_month, e.inworld_day)}</span>
            {e.description && (
              <div className="muted" style={{ whiteSpace: "pre-wrap" }}>
                <MentionText text={e.description} />
              </div>
            )}
          </div>
        ),
      })),
    });
  }
  return groups;
}
