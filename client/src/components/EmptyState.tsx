// Reusable empty-state block for the main entity list pages (ticket 16):
// mascot graphic + a short Display-voice slogan + one action button, instead
// of a bare "Пока нет ..." muted paragraph. See docs/design-system-punk-zine.md
// §8 ("Пустое состояние: Маскот + слоган Display-шрифтом + одна кнопка. Не
// «нет данных»") and §10.3.
//
// The mascot here is always one of ZineGraphics's abstract line-art marks —
// never a generated/photographic image of the user's actual content. Where
// a real user image belongs (avatar, campaign cover), keep the existing
// honest upload placeholder instead of reaching for this component.
import type { ReactNode } from "react";
import { ZineGraphic, type ZineGraphicName } from "./ZineGraphics";

export function EmptyState({
  icon = "skullDie",
  title,
  hint,
  action,
}: {
  /** Which ZineGraphics mark to use as the mascot. Defaults to the skull+die motif. */
  icon?: ZineGraphicName;
  /** Short Display-voice slogan — this is the headline, not a "no data" caption. */
  title: string;
  /** Optional one-line supporting text under the slogan. */
  hint?: string;
  /** The single allowed action (e.g. a "Create your first X" button). */
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <ZineGraphic name={icon} className="empty-state-icon zine-rotate-r" />
      <h2 className="empty-state-title">{title}</h2>
      {hint && <p className="empty-state-hint muted">{hint}</p>}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}
