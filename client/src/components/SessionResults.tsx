import { SessionChronicleEvents } from "./chronicle/SessionChronicleEvents";
import { SessionMentionsButton } from "./SessionMentionsButton";
import { SessionNotesChat } from "./SessionNotesChat";
import { SessionOutcomesCard } from "./SessionPaperCards";
import { SessionRecordsReview } from "./records/SessionRecordsReview";
import type { SessionDetail } from "../types";
import "../session.css";

/**
 * Тело «Итогов» встречи: лента, оси «Что изменилось», записи встречи и
 * очередь черновиков, быстрая запись. Общее у вкладки сессии и листа 22
 * «После встречи» тетради кампании — одни и те же данные, а не копия.
 */
export function SessionResults({
  session,
  campaignId,
  settingId,
  isPlayer = false,
}: {
  session: SessionDetail;
  campaignId: number;
  settingId: number | null;
  isPlayer?: boolean;
}) {
  return (
    <>
      {/* Лента сессии (гриллинг 2026-09-28): те же сообщения, что Мастер
          писал в правой панели по ходу игры, — дописать и поправить
          можно и здесь. Игрокам не показывается. */}
      {/* Лента слева, «Что изменилось» справа (спека campaign-paper,
          Q45/Q50): оси заполняют после игры, глядя в ленту. */}
      <div className="session-results">
        <div className="card stack sp-notes">
          <div className="row sp-notes__head">
            <span className="sp-title">Лента сессии</span>
            <SessionMentionsButton
              planUrl={`/cross-links/plan-all?ownerKind=session&ownerId=${session.id}`}
              applyUrl={`/cross-links/apply-all?ownerKind=session&ownerId=${session.id}`}
            />
          </div>
          <SessionNotesChat sessionId={session.id} settingId={settingId} draftCampaignId={isPlayer ? undefined : campaignId} />
        </div>
        {!isPlayer && <SessionOutcomesCard session={session} />}
      </div>

      {/* Разбор встречи (ADR-0006, слой кампании): записи этой встречи и
          очередь черновиков. Оси «Что изменилось» выше остаются сводкой. */}
      {!isPlayer && <SessionChronicleEvents session={session} campaignId={campaignId} settingId={settingId} />}
      {!isPlayer && <SessionRecordsReview campaignId={campaignId} sessionId={session.id} settingId={settingId} />}
    </>
  );
}
