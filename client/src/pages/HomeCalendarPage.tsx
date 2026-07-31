import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { MonthCalendar, type CalendarEvent } from "../components/MonthCalendar";
import { UpcomingSessionsNotice } from "../components/UpcomingSessionsNotice";
import { ContextMenu, type ContextMenuItem } from "../components/ContextMenu";
import { Modal } from "../components/Modal";
import { copySessionPrep } from "../sessionCopy";
import { SectionHeading } from "../components/SectionHeading";
import { UpdateChecker } from "../components/UpdateChecker";
import { hasElectronAPI } from "../electronApi";
import { loadHideFinance } from "../financePrivacy";
import type { AppSettings, Campaign, SessionSummary } from "../types";

interface FinanceSummary {
  earned: number;
  heldSessions: number;
  playedSessions: number;
  campaigns: number;
}

export function HomeCalendarPage() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [finance, setFinance] = useState<FinanceSummary | null>(null);
  const [bgUrl, setBgUrl] = useState<string | null>(null);
  const [homeBgUrl, setHomeBgUrl] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const [createModal, setCreateModal] = useState<{
    date: string;
    campaignId: string;
    startTime: string;
    copyFromSessionId: string;
  } | null>(null);
  const [oneshotSessions, setOneshotSessions] = useState<SessionSummary[]>([]);
  const navigate = useNavigate();

  function refreshSessions() {
    api.get<SessionSummary[]>("/calendar").then(setSessions);
  }

  useEffect(() => {
    refreshSessions();
    api.get<FinanceSummary>("/finance/summary").then(setFinance);
    api.get<AppSettings>("/app-settings").then((s) => setHomeBgUrl(s.home_background_url));
    api.get<Campaign[]>("/campaigns").then(setCampaigns);
  }, []);

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    const nearest = sessions
      .filter((s) => s.status === "planned" && s.date >= today)
      .sort((a, b) => (a.date < b.date ? -1 : 1))[0];
    if (!nearest) {
      setBgUrl(null);
      return;
    }
    api.get<Campaign>(`/campaigns/${nearest.campaign_id}`).then((c) => setBgUrl(c.background_image_url ?? null));
  }, [sessions]);

  const events: CalendarEvent[] = sessions.map((s) => ({
    id: s.id,
    date: s.date,
    status: s.status,
    paymentType: s.effective_payment_type,
    campaignRole: s.campaign_role,
    label: s.campaign_name ?? "Сессия",
    startTime: s.start_time,
  }));

  function openCreateModal(date: string) {
    setCreateModal({
      date,
      campaignId: campaigns[0] ? String(campaigns[0].id) : "",
      startTime: "",
      copyFromSessionId: "",
    });
  }

  const selectedCampaign = createModal
    ? campaigns.find((c) => c.id === Number(createModal.campaignId))
    : undefined;

  useEffect(() => {
    if (!createModal?.campaignId || selectedCampaign?.type !== "oneshot") {
      setOneshotSessions([]);
      return;
    }
    api.get<SessionSummary[]>(`/campaigns/${createModal.campaignId}/sessions`).then(setOneshotSessions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createModal?.campaignId, selectedCampaign?.type]);

  async function createSessionFromModal() {
    if (!createModal || !createModal.campaignId) return;
    const created = await api.post<{ id: number }>("/sessions", {
      campaign_id: Number(createModal.campaignId),
      date: createModal.date,
      start_time: createModal.startTime || null,
    });
    if (createModal.copyFromSessionId) {
      await copySessionPrep(Number(createModal.copyFromSessionId), created.id);
    }
    setCreateModal(null);
    refreshSessions();
  }

  function eventMenuItems(event: CalendarEvent): ContextMenuItem[] {
    return [
      {
        label: "Перейти в пульт управления сессией",
        onClick: () => navigate(`/sessions/${event.id}/live`),
      },
      {
        label: "Статус: Запланировано",
        onClick: async () => {
          await api.put(`/sessions/${event.id}`, { status: "planned" });
          refreshSessions();
        },
      },
      {
        label: "Статус: Состоялась",
        onClick: async () => {
          await api.put(`/sessions/${event.id}`, { status: "held" });
          refreshSessions();
        },
      },
      {
        label: "Статус: Отмена",
        onClick: async () => {
          await api.put(`/sessions/${event.id}`, { status: "cancelled" });
          refreshSessions();
        },
      },
      {
        label: "Удалить (в архив)",
        danger: true,
        onClick: async () => {
          await api.del(`/sessions/${event.id}`);
          refreshSessions();
        },
      },
      {
        label: "+ Добавить сессию",
        onClick: () => openCreateModal(event.date),
      },
    ];
  }

  return (
    <div className="stack" style={{ position: "relative" }}>
      {(homeBgUrl ?? bgUrl) && (
        <div
          className="campaign-bg-layer"
          style={{ backgroundImage: `url("${homeBgUrl ?? bgUrl}")` }}
        />
      )}
      <SectionHeading>Главная</SectionHeading>

      {hasElectronAPI() && (
        <div className="card stack">
          <strong className="entry-title">Обновления</strong>
          <UpdateChecker />
        </div>
      )}

      {finance && (
        <div className="card finance-summary-card">
          {!loadHideFinance() && (
            <div className="stat">
              <span className="muted">Заработано всего</span>
              <span className="value">{finance.earned} ₽</span>
            </div>
          )}
          <div className="stat">
            <span className="muted">Сессий проведено</span>
            <span className="value">{finance.heldSessions}</span>
          </div>
          <div className="stat">
            <span className="muted">Сессий сыграно</span>
            <span className="value">{finance.playedSessions}</span>
          </div>
          <div className="stat">
            <span className="muted">Активных кампаний</span>
            <span className="value">{finance.campaigns}</span>
          </div>
        </div>
      )}

      <p className="muted page-subtitle">
        Сессии всех кампаний. Кликните по отметке, чтобы открыть сессию. Правый клик — меню
        (в том числе добавление новой сессии).
      </p>
      <MonthCalendar
        events={events}
        onDayClick={() => {}}
        onEventClick={(e) => navigate(`/sessions/${e.id}`)}
        onEventContextMenu={(event, x, y) => setMenu({ x, y, items: eventMenuItems(event) })}
        onDayContextMenu={(date, x, y) =>
          setMenu({ x, y, items: [{ label: "+ Добавить сессию", onClick: () => openCreateModal(date) }] })
        }
      />

      <UpcomingSessionsNotice sessions={sessions} />

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
      )}

      {createModal && (
        <Modal onClose={() => setCreateModal(null)} closeOnBackdropClick={false}>
          <div className="stack">
            <h3 style={{ margin: 0 }}>Новая сессия</h3>
            <label>
              Кампания
              <select
                value={createModal.campaignId}
                onChange={(e) => setCreateModal({ ...createModal, campaignId: e.target.value })}
              >
                <option value="">—</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Дата
              <input
                type="date"
                value={createModal.date}
                onChange={(e) => setCreateModal({ ...createModal, date: e.target.value })}
              />
            </label>
            <label>
              Время начала (необязательно)
              <input
                type="time"
                value={createModal.startTime}
                onChange={(e) => setCreateModal({ ...createModal, startTime: e.target.value })}
              />
            </label>
            {selectedCampaign?.type === "oneshot" && oneshotSessions.length > 0 && (
              <label>
                Скопировать подготовку из прогона (необязательно)
                <select
                  value={createModal.copyFromSessionId}
                  onChange={(e) => setCreateModal({ ...createModal, copyFromSessionId: e.target.value })}
                >
                  <option value="">Не копировать</option>
                  {oneshotSessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.date}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="row">
              <button className="primary" onClick={createSessionFromModal} disabled={!createModal.campaignId}>
                Создать
              </button>
              <button onClick={() => setCreateModal(null)}>Отмена</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
