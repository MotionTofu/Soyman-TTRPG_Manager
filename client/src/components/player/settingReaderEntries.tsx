import { MentionText } from "../mentions/MentionText";
import type { ReaderEntry } from "../PlayerContentReader";
import type { SettingPlayerContent, VisibleCampaignContent } from "../../types";

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

/** Открытое старой галочкой «Видно игрокам» — главы локаций и существ и
 *  события хроники. Это тоже сеттинг, и по границе вкладок (F-52, решение
 *  2026-09-18: сеттинг — в «Мир», написанное Мастером по ходу кампании — в
 *  «От мастера») оно живёт здесь, рядом с выданным, а не отдельной
 *  «Хроникой мира» во второй вкладке. */
export type FlaggedSettingContent = Pick<VisibleCampaignContent, "locationArticles" | "beingArticles" | "chronicleEvents">;

export function buildSettingReaderGroups(
  setting: SettingPlayerContent | null,
  flagged?: FlaggedSettingContent | null
): SettingReaderGroups[] {
  const locations = setting?.locations ?? [];
  const beings = setting?.beings ?? [];
  const communities = setting?.communities ?? [];
  const locationArticles = flagged?.locationArticles ?? [];
  const beingArticles = flagged?.beingArticles ?? [];
  // Одно событие бывает открыто и выдачей, и галочкой — показывается раз.
  const granted = setting?.chronicleEvents ?? [];
  const grantedIds = new Set(granted.map((e) => e.id));
  // Сначала новое, как в хронике Мастера: выдача приходит без порядка.
  const events = [...granted, ...(flagged?.chronicleEvents ?? []).filter((e) => !grantedIds.has(e.id))].sort(
    (a, b) => b.inworld_year - a.inworld_year || b.inworld_month - a.inworld_month || b.inworld_day - a.inworld_day
  );
  const groups: SettingReaderGroups[] = [];
  if (locations.length > 0 || locationArticles.length > 0) {
    groups.push({
      key: "setting-locations",
      label: "Локации сеттинга",
      entries: [
        ...locations.map((l) => ({
          key: `setting-loc-${l.id}`,
          section: "Локации сеттинга",
          title: l.name,
          body: l.description ? (
            <div className="muted" style={{ whiteSpace: "pre-wrap" }}>
              <MentionText text={l.description} />
            </div>
          ) : null,
        })),
        ...locationArticles.map((a) => ({
          key: `loc-${a.id}`,
          section: "Локации сеттинга",
          title: a.title ? `${a.location_name} — ${a.title}` : a.location_name ?? "Локация",
          body: (
            <div className="muted" style={{ whiteSpace: "pre-wrap" }}>
              <MentionText text={a.content} />
            </div>
          ),
        })),
      ],
    });
  }
  if (beings.length > 0 || communities.length > 0 || beingArticles.length > 0) {
    groups.push({
      key: "setting-factions",
      label: "Личности и фракции",
      entries: [
        ...beings.map((b) => ({
          key: `setting-being-${b.id}`,
          section: "Личности и фракции",
          title: b.name,
          body: b.history ? (
            <div className="muted" style={{ whiteSpace: "pre-wrap" }}>
              <MentionText text={b.history} />
            </div>
          ) : null,
        })),
        ...communities.map((c) => ({
          key: `setting-community-${c.id}`,
          section: "Личности и фракции",
          title: c.name,
          body: c.description ? (
            <div className="muted" style={{ whiteSpace: "pre-wrap" }}>
              <MentionText text={c.description} />
            </div>
          ) : null,
        })),
        ...beingArticles.map((a) => ({
          key: `being-${a.id}`,
          section: "Личности и фракции",
          title: a.title ? `${a.being_name} — ${a.title}` : a.being_name ?? "НПЦ",
          body: (
            <div className="muted" style={{ whiteSpace: "pre-wrap" }}>
              <MentionText text={a.content} />
            </div>
          ),
        })),
      ],
    });
  }
  if (events.length > 0) {
    groups.push({
      key: "setting-history",
      label: "История",
      entries: events.map((e) => ({
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
