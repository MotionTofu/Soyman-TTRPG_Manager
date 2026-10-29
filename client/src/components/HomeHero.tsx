import { Link } from "react-router-dom";
import { useEntity, useResource } from "../data/hooks";
import { campaignPaths } from "../data/campaigns";
import { loadHideFinance } from "../financePrivacy";
import { formatNearestDate } from "../nearestDate";
import { plural } from "../sceneKinds";
import { SESSION_PASSPORT_FIELDS } from "./sessionPaperFields";
import type { Campaign, CampaignDebt, SessionDetail, SessionSummary } from "../types";

/**
 * Герой главной — ближайшая игра (макет «Д», холст v30 «Roll-Home»;
 * docs/design-system.md §6.8): название и факты слева, обложка справа.
 *
 * Ведёт готовить сессию, а не в пульт: в пульт есть кнопка в навигационном
 * виджете из любой точки приложения. «Открыть кампанию» — вторая, обычная
 * кнопка: кислота у одной (§5), спора за взгляд нет.
 *
 * «Паспорт вечера: заполнено N из M» — счёт заполненных полей, а не оценка
 * готовности: судить, готов ли Мастер, приложение по-прежнему не берётся
 * (пустые заметки ещё не значат неготовность). Реестр отступлений, О-9.
 */
export function HomeHero({
  session,
  campaign,
  cover,
  started,
  onHeld,
}: {
  session: SessionSummary;
  campaign: Campaign | undefined;
  /** CSS-значение background-image обложки или undefined. */
  cover: string | undefined;
  /** Время игры наступило — можно отметить «Состоялась». */
  started: boolean;
  onHeld: () => void;
}) {
  const gm = session.campaign_role !== "player";
  const detail = useEntity<SessionDetail>("session", gm ? session.id : null).data;
  const hideFinance = loadHideFinance();
  const debts = useResource<CampaignDebt[]>(gm && !hideFinance ? campaignPaths.debts(session.campaign_id) : null).data;

  const values: Record<string, string> = detail ? { ...(detail.passport ?? {}), idea_notes: detail.idea_notes ?? "" } : {};
  const filled = SESSION_PASSPORT_FIELDS.filter((f) => values[f.key]?.trim()).length;
  const owed = debts?.reduce((sum, d) => sum + d.owed, 0) ?? 0;
  const label = session.session_number ? `Сессия №${session.session_number}` : "Сессия";

  return (
    <section className="home-hero2 d-focal" aria-label={`Ближайшая сессия: ${session.campaign_name}`}>
      <div className="home-hero2__text">
        <p className="d-mono home-hero2__eyebrow">Ближайшая сессия · {formatNearestDate(session.date)}</p>
        <h1 className="home-hero2__title">{session.campaign_name}</h1>
        <p className="home-hero2__sub">
          {[label, session.title, session.start_time].filter(Boolean).join(" · ")}
        </p>
        <dl className="home-hero2__facts">
          {campaign?.system_name && (
            <div>
              <dt>Система</dt>
              <dd>
                {campaign.system_name}
                {campaign.player_count ? ` · ${campaign.player_count} ${plural(campaign.player_count, "игрок", "игрока", "игроков")}` : ""}
              </dd>
            </div>
          )}
          {gm && detail && (
            <div>
              <dt>Паспорт вечера</dt>
              <dd>заполнено {filled} из {SESSION_PASSPORT_FIELDS.length}</dd>
            </div>
          )}
          {debts && debts.length > 0 && (
            <div>
              <dt>Должники</dt>
              <dd>
                {debts.length} {plural(debts.length, "игрок", "игрока", "игроков")} · {owed} {campaign?.currency ?? ""}
              </dd>
            </div>
          )}
        </dl>
        <div className="home-hero2__actions">
          <Link className="d-btn d-btn--primary" to={`/sessions/${session.id}`}>
            Готовить {session.session_number ? `сессию №${session.session_number}` : "сессию"}
          </Link>
          <Link className="d-btn" to={`/campaigns/${session.campaign_id}`}>
            Открыть кампанию
          </Link>
          {started && (
            <button
              type="button"
              className="d-btn"
              title="Разобрать игру: кто пришёл, кто заплатил, что случилось"
              onClick={onHeld}
            >
              Состоялась
            </button>
          )}
        </div>
      </div>
      <Link className="home-hero2__cover" to={`/campaigns/${session.campaign_id}`} tabIndex={-1} aria-hidden="true">
        {cover ? (
          <span className="home-hero2__cover-image cover-art cover-photo">
            <span className="cover-art-image" style={{ backgroundImage: cover }} />
          </span>
        ) : (
          <span className="home-hero2__cover-empty">{campaign?.system_name || "Обложка"}</span>
        )}
      </Link>
    </section>
  );
}
