import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { MiniCalendar, type MiniEvent } from "../components/MiniCalendar";
import { ContextMenu, type ContextMenuItem } from "../components/ContextMenu";
import { Modal } from "../components/Modal";
import { copySessionPrep } from "../sessionCopy";
import { SectionHeading } from "../components/SectionHeading";
import { CampaignCoverTile } from "../components/CampaignCoverTile";
import { EmptyState } from "../components/EmptyState";
import { HomeArticleCard } from "../components/HomeArticleCard";
import { loadHideFinance } from "../financePrivacy";
import { formatNearestDate } from "../nearestDate";
import { formatCompactNumber } from "../formatNumber";
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
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    title?: string;
    items: ContextMenuItem[];
  } | null>(null);
  const [createModal, setCreateModal] = useState<{
    date: string;
    campaignId: string;
    startTime: string;
    copyFromSessionId: string;
  } | null>(null);
  const [oneshotSessions, setOneshotSessions] = useState<SessionSummary[]>([]);
  const [initialLoad, setInitialLoad] = useState(false);
  const [calendarRefresh, setCalendarRefresh] = useState(0);
  const navigate = useNavigate();

  function refreshSessions() {
    api.get<SessionSummary[]>("/calendar").then(setSessions);
    setCalendarRefresh((n) => n + 1);
  }

  useEffect(() => {
    Promise.allSettled([
      api.get<SessionSummary[]>("/calendar").then(setSessions),
      api.get<FinanceSummary>("/finance/summary").then(setFinance),
      api.get<AppSettings>("/app-settings").then((s) => setHomeBgUrl(s.home_background_url)),
      api.get<Campaign[]>("/campaigns").then(setCampaigns),
    ]).finally(() => setInitialLoad(true));
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

  const today = new Date().toISOString().slice(0, 10);
  const nearestSession = sessions
    .filter((s) => s.status === "planned" && s.date >= today)
    .sort((a, b) => (a.date < b.date ? -1 : 1))[0];

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

  function eventMenuItems(event: MiniEvent): ContextMenuItem[] {
    return [
      {
        label: "Перейти в пульт управления сессией",
        onClick: () => navigate(`/sessions/${event.id}/live`),
      },
      {
        label: "Статус",
        children: [
          {
            label: "Запланировано",
            onClick: async () => {
              await api.put(`/sessions/${event.id}`, { status: "planned" });
              refreshSessions();
            },
          },
          {
            label: "Состоялась",
            onClick: async () => {
              await api.put(`/sessions/${event.id}`, { status: "held" });
              refreshSessions();
            },
          },
          {
            label: "Отмена",
            onClick: async () => {
              await api.put(`/sessions/${event.id}`, { status: "cancelled" });
              refreshSessions();
            },
          },
        ],
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

  if (!initialLoad) return <p className="muted">Загрузка…</p>;

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

  return (
    <div className="stack" style={{ position: "relative" }}>
      {/* Фоновый слой — только если владелец задал СВОЙ фон главной. Раньше,
          когда своего фона не было, сюда подставлялась обложка ближайшей
          кампании — та же самая картинка, что и на герое, призраком на 15 %
          позади всей страницы: один арт работал дважды.

          Заголовка «Главная» здесь больше нет: имя экрана на экране по
          умолчанию — служебная надпись, а представляет страницу герой. */}
      {homeBgUrl && (
        <div className="campaign-bg-layer cover-photo">
          <div className="cover-art-image" style={{ backgroundImage: `url("${homeBgUrl}")` }} />
        </div>
      )}

      <div className="home-layout">
        <div className="home-main">
          {/* Hero — nearest upcoming session's campaign, full-bleed cover. */}
          {nearestSession ? (
            // Ведёт в карточку сессии, а не в пульт: с главной ныряют
            // ГОТОВИТЬ ближайшую игру. Кнопка в пульт есть в навигационном
            // виджете из любой точки приложения.
            <Link to={`/sessions/${nearestSession.id}`} className="card home-hero">
              <div className="home-hero-cover cover-halftone">
                {bgUrl ? (
                  <div className="cover-art cover-photo">
                    <div className="cover-art-image" style={{ backgroundImage: `url("${bgUrl}")` }} />
                  </div>
                ) : (
                  <div className="cover-art cover-art-fallback zine-grain" />
                )}
                <div className="home-hero-scrim" />
                <div className="home-hero-content">
                  <span className="home-hero-eyebrow">Ближайшая сессия</span>
                  <h2 className="home-hero-title">{nearestSession.campaign_name}</h2>
                  {nearestSession.title && (
                    <span className="home-hero-session">{nearestSession.title}</span>
                  )}
                  {/* Номер, дата и время — факты, а не выдуманная метрика
                      готовности: индикатор «начата ли подготовка» приложение
                      считало бы за мастера и врал бы (пустые заметки ещё не
                      значат неготовность), а раз соврёт — ему перестанут
                      верить. */}
                  <span className="home-hero-date">
                    {[
                      nearestSession.session_number ? `Сессия №${nearestSession.session_number}` : null,
                      formatNearestDate(nearestSession.date),
                      nearestSession.start_time,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
              </div>
            </Link>
          ) : (
            <div className="card home-hero home-hero-empty">
              <EmptyState
                icon="issueStamp"
                title="Сессий пока не запланировано"
                hint="Ближайшая сессия появится здесь, как только вы её создадите."
                action={
                  <button className="primary" onClick={() => openCreateModal(today)}>
                    + Создать сессию
                  </button>
                }
              />
            </div>
          )}

          {/* Tiles — quick campaign row. */}
          {/* Блок, которому нечего показать, не показывает пустоту — он не
              показывается вовсе. Пустое состояние оставлено только герою:
              он главный блок экрана и обязан объяснить, что здесь будет. */}
          {campaigns.length > 0 && (
            <div className="home-section home-section-campaigns">
              <SectionHeading level="section" icon="campaigns" action={{ label: "все кампании", to: "/campaigns" }}>
                Кампании
              </SectionHeading>
              <div className="home-tiles">
                {campaigns.slice(0, 4).map((c) => (
                  <CampaignCoverTile key={c.id} campaign={c} />
                ))}
              </div>
            </div>
          )}

          {/* Случайная статья из справочника — «Напомню!». Сама не
              отрисуется, пока справочники пусты. */}
          <div className="home-section-article">
            <HomeArticleCard />
          </div>
        </div>

        {/* Рельс. Дизайн-ревизия вынесла отсюда два блока.

            «Обновления» — обслуживание приложения, а не владения мастера:
            переехали в «О программе», в навигации осталась точка.

            «Ближайшие сессии» — дубль героя дословно: виджет выводил до трёх
            сессий, каждую подписывал «Ближайшая сессия:», и первой строкой
            всегда шло то, что уже стоит героем во всю ширину. */}
        <div className="home-rail">
          {finance && (
            <div className="card stack home-rail-stats">
              <SectionHeading level="section" icon="graph">
                Сводка
              </SectionHeading>
              {/* Плашки, а не кости: на главной силуэт кости выбивался из
                  ряда прямоугольных блоков вокруг. Кость осталась там, где
                  она значит бросок, — в характеристиках существ. */}
              <div className="finance-summary-card">
                {!loadHideFinance() && (
                  <div
                    className="stat-plate stat-plate-lead"
                    title={`${finance.earned.toLocaleString("ru-RU")} ₽`}
                  >
                    <span className="stat-plate-value">
                      {formatCompactNumber(finance.earned)}
                      <span className="stat-plate-unit">₽</span>
                    </span>
                    <span className="stat-plate-label">Заработано всего</span>
                  </div>
                )}
                <div className="finance-summary-row">
                  <div className="stat-plate">
                    <span className="stat-plate-value">{finance.heldSessions}</span>
                    <span className="stat-plate-label">Сессий проведено</span>
                  </div>
                  <div className="stat-plate">
                    <span className="stat-plate-value">{finance.playedSessions}</span>
                    <span className="stat-plate-label">Сессий сыграно</span>
                  </div>
                  <div className="stat-plate">
                    <span className="stat-plate-value">{finance.campaigns}</span>
                    <span className="stat-plate-label">Кампании в работе</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="card stack home-rail-calendar">
            <SectionHeading level="section" icon="calendar">
              Календарь
            </SectionHeading>
            <MiniCalendar
              refreshKey={calendarRefresh}
              // Клетка календаря показывает только число, поэтому меню
              // само называет игру, к которой относятся его пункты: иначе
              // «Удалить (в архив)» в дне с игрой — действие вслепую.
              onEventContextMenu={(event, x, y) =>
                setMenu({ x, y, title: event.campaignName ?? "Сессия", items: eventMenuItems(event) })
              }
              onDayContextMenu={(date, x, y) =>
                setMenu({ x, y, items: [{ label: "+ Добавить сессию", onClick: () => openCreateModal(date) }] })
              }
            />
          </div>
        </div>
      </div>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} title={menu.title} items={menu.items} onClose={() => setMenu(null)} />
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
