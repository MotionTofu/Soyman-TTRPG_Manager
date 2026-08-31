import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { MiniCalendar, type MiniEvent } from "../components/MiniCalendar";
import { ContextMenu, type ContextMenuItem } from "../components/ContextMenu";
import { Modal } from "../components/Modal";
import { copySessionPrep } from "../sessionCopy";
import { SectionHeading } from "../components/SectionHeading";
import { CampaignCoverTile } from "../components/CampaignCoverTile";
import { CreateCampaignTile } from "../components/CreateCampaignTile";
import { OnboardingHero } from "../components/OnboardingHero";
import { HomeArticleCard } from "../components/HomeArticleCard";
import { loadHideFinance } from "../financePrivacy";
import { formatNearestDate } from "../nearestDate";
import { formatCompactNumber } from "../formatNumber";
import { parseDateKey, toLocalDateKey } from "../utils/date";
import { safeBackgroundImage } from "../utils/safeUrl";
import { useAuthenticatedFileUrl } from "../utils/fileUrl";
import { LocalClock } from "../components/LocalClock";
import type { AppSettings, Campaign, Player, SessionSummary, Setting, System } from "../types";

interface FinanceSummary {
  earned: number;
  heldSessions: number;
  playedSessions: number;
  campaigns: number;
}

export function HomeCalendarPage() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [systems, setSystems] = useState<System[]>([]);
  const [settings, setSettings] = useState<Setting[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
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
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const navigate = useNavigate();

  function refreshSessions() {
    api.get<SessionSummary[]>("/calendar").then((data) => { setCalendarError(null); setSessions(data); }).catch((e) => { if ((e as Error).name !== "AbortError") setCalendarError(String(e)); });
  }

  const miniEvents: MiniEvent[] = sessions.map((s) => ({
    id: s.id,
    date: s.date,
    status: s.status,
    campaignId: s.campaign_id,
    campaignName: s.campaign_name,
    startTime: s.start_time,
  }));

  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [campaignsError, setCampaignsError] = useState<string | null>(null);
  const loadIdRef = useRef(0);

  function loadInitial() {
    const cur = ++loadIdRef.current;
    setCalendarError(null);
    setCampaignsError(null);
    setInitialLoad(false);
    const guarded = <T,>(fn: (v: T) => void) => (v: T) => { if (loadIdRef.current === cur) fn(v); };
    Promise.allSettled([
      api.get<SessionSummary[]>("/calendar").then(guarded(setSessions)).catch((e) => { if ((e as Error).name !== "AbortError" && loadIdRef.current === cur) setCalendarError(String(e)); throw e; }),
      api.get<FinanceSummary>("/finance/summary").then(guarded(setFinance)).catch(() => {}),
      api.get<AppSettings>("/app-settings").then((s) => { if (loadIdRef.current === cur) setHomeBgUrl(s.home_background_url); }).catch(() => {}),
      api.get<Campaign[]>("/campaigns").then(guarded(setCampaigns)).catch((e) => { if ((e as Error).name !== "AbortError" && loadIdRef.current === cur) setCampaignsError(String(e)); throw e; }),
      api.get<System[]>("/systems").then(guarded(setSystems)).catch(() => {}),
      api.get<Setting[]>("/settings").then(guarded(setSettings)).catch(() => {}),
      api.get<Player[]>("/players").then(guarded(setPlayers)).catch(() => {}),
    ]).finally(() => { if (loadIdRef.current === cur) setInitialLoad(true); });
  }

  useEffect(() => {
    loadInitial();
    return () => { loadIdRef.current++; };
  }, []);

  const authHomeBgBlob = useAuthenticatedFileUrl(homeBgUrl);
  const authBgBlob = useAuthenticatedFileUrl(bgUrl);

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let id: number | undefined;
    const start = () => { id = window.setInterval(() => setNow(new Date()), 60000); };
    const stop = () => { if (id !== undefined) { clearInterval(id); id = undefined; } };
    const onVis = () => {
      if (document.visibilityState === "visible") {
        setNow(new Date());
        if (id === undefined) start();
      } else {
        stop();
      }
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVis);
    return () => { stop(); document.removeEventListener("visibilitychange", onVis); };
  }, []);
  const today = toLocalDateKey(now);
  const nearestSession = (() => {
    const planned = sessions
      .filter((s) => s.status === "planned")
      .map((s) => {
        const d = parseDateKey(s.date);
        const [h, m] = (s.start_time ?? "00:00").split(":").map(Number);
        d.setHours(h, m, 0, 0);
        return { s, dt: d };
      })
      .sort((a, b) => a.dt.getTime() - b.dt.getTime());
    // Текущая сегодня (последняя с dt <= now) как в кокпите, иначе ближайшая будущая
    let current: SessionSummary | null = null;
    for (const { s, dt } of planned) {
      if (s.date === today && dt.getTime() <= now.getTime()) current = s;
    }
    if (current) return current;
    return planned.find(({ dt }) => dt.getTime() > now.getTime())?.s ?? null;
  })();

  function bgStyle(url: string | null, blob: string | null): string | undefined {
    if (!url) return undefined;
    if (url.startsWith("/files/")) return blob ? `url("${blob}")` : undefined;
    return safeBackgroundImage(url);
  }

  useEffect(() => {
    if (!nearestSession) {
      setBgUrl(null);
      return;
    }
    const campaign = campaigns.find((c) => c.id === nearestSession.campaign_id);
    if (campaign) {
      setBgUrl(campaign.background_image_url ?? null);
      return;
    }
    const controller = new AbortController();
    api.get<Campaign>(`/campaigns/${nearestSession.campaign_id}`, { signal: controller.signal } as RequestInit).then((c) => setBgUrl(c.background_image_url ?? null)).catch(() => { if (!controller.signal.aborted) setBgUrl(null); });
    return () => controller.abort();
  }, [nearestSession, campaigns]);

  function openCreateModal(date: string) {
    setCreateError(null);
    setCreating(false);
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
    const controller = new AbortController();
    api.get<SessionSummary[]>(`/campaigns/${createModal.campaignId}/sessions`, { signal: controller.signal } as RequestInit).then(setOneshotSessions).catch(() => { if (!controller.signal.aborted) setOneshotSessions([]); });
    return () => controller.abort();
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

  if (!initialLoad) return <div className="stack" style={{ padding: 24 }}><div className="card" style={{ height: 260, background: "var(--bg-elevated)" }} /><div className="card" style={{ height: 340, background: "var(--bg-elevated)" }} /></div>;

  async function createSessionFromModal() {
    if (!createModal || !createModal.campaignId || creating) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(createModal.date)) {
      setCreateError("Неверная дата — используйте формат ГГГГ-ММ-ДД");
      return;
    }
    {
      const [y, m, d] = createModal.date.split("-").map(Number);
      const parsed = parseDateKey(createModal.date);
      if (parsed.getFullYear() !== y || parsed.getMonth() !== m - 1 || parsed.getDate() !== d) {
        setCreateError("Неверная дата — такого дня не существует");
        return;
      }
    }
    setCreating(true);
    setCreateError(null);
    try {
      const created = await api.post<{ id: number }>("/sessions", {
        campaign_id: Number(createModal.campaignId),
        date: createModal.date,
        start_time: createModal.startTime || null,
      });
      if (createModal.copyFromSessionId) {
        try {
          await copySessionPrep(Number(createModal.copyFromSessionId), created.id);
        } catch (e) {
          setCreateError(`Сессия создана, но копирование подготовки не удалось: ${String(e)}`);
          refreshSessions();
          return;
        }
      }
      setCreateModal(null);
      refreshSessions();
    } catch (e) {
      setCreateError(String(e));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="stack" style={{ position: "relative" }}>
      {/* Фоновый слой — только если владелец задал СВОЙ фон главной. Раньше,
          когда своего фона не было, сюда подставлялась обложка ближайшей
          кампании — та же самая картинка, что и на герое, призраком на 15 %
          позади всей страницы: один арт работал дважды.

          Заголовка «Главная» здесь больше нет: имя экрана на экране по
          умолчанию — служебная надпись, а представляет страницу герой. */}
      {bgStyle(homeBgUrl, authHomeBgBlob) && (
        <div className="campaign-bg-layer cover-photo">
          <div className="cover-art-image" style={{ backgroundImage: bgStyle(homeBgUrl, authHomeBgBlob) }} />
        </div>
      )}

      {(calendarError || campaignsError) && (
        <div className="card" style={{ borderLeft: "3px solid var(--status-cancelled)", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <span>Не удалось загрузить: {[calendarError, campaignsError].filter(Boolean).join(" · ")}</span>
          <button onClick={loadInitial}>Повторить</button>
        </div>
      )}

      <div className="home-layout">
        <div className="home-main">
          {/* Hero — nearest upcoming session's campaign, full-bleed cover. */}
          {nearestSession ? (
            // Ведёт в карточку сессии, а не в пульт: с главной ныряют
            // ГОТОВИТЬ ближайшую игру. Кнопка в пульт есть в навигационном
            // виджете из любой точки приложения.
            <Link
              to={`/sessions/${nearestSession.id}`}
              className="card home-hero"
              aria-label={`Ближайшая сессия: ${nearestSession.campaign_name}${nearestSession.title ? `, ${nearestSession.title}` : ""}`}
            >
              <div className="home-hero-cover cover-halftone">
                {bgStyle(bgUrl, authBgBlob) ? (
                  <div className="cover-art cover-photo">
                    <div className="cover-art-image" style={{ backgroundImage: bgStyle(bgUrl, authBgBlob) }} />
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
            <OnboardingHero
              systems={systems}
              settings={settings}
              campaigns={campaigns}
              players={players}
              onRefresh={loadInitial}
            />
          )}

          {/* Tiles — quick campaign row. */}
          {/* Пустое состояние: вместо скрытия entire блока показываем
              плитку создания — она служит и CTA, и объяснением, что тут будет. */}
          <div className="home-section home-section-campaigns">
            <SectionHeading level="section" icon="campaigns" action={{ label: "все кампании", to: "/campaigns" }}>
              Кампании
            </SectionHeading>
            <div className="home-tiles">
              {campaigns.slice(0, 3).map((c) => (
                <CampaignCoverTile key={c.id} campaign={c} />
              ))}
              <CreateCampaignTile />
            </div>
          </div>

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
            <SectionHeading level="section" icon="calendar" right={<LocalClock />}>
              Календарь
            </SectionHeading>
            <MiniCalendar
              events={miniEvents}
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
              {campaigns.length === 0 && <span className="muted" style={{ fontSize: 12 }}>Сначала создайте кампанию в разделе «Кампании»</span>}
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
            {createError && <div className="card" style={{ borderLeft: "3px solid var(--status-cancelled)", color: "var(--status-cancelled-fg)" }}>{createError}</div>}
            <div className="row">
              <button className="primary" onClick={createSessionFromModal} disabled={!createModal.campaignId || creating}>
                {creating ? "Создаю…" : "Создать"}
              </button>
              <button onClick={() => setCreateModal(null)} disabled={creating}>Отмена</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
