import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAction, useAfterWrite, useEntity, useResource, write } from "../data/hooks";
import { invalidateAffects, type Affect } from "../data/entities";
import { labelled } from "../data/notices";
import { sessionMoneyAffects } from "../data/sessions";
import { MiniCalendar, type MiniEvent } from "../components/MiniCalendar";
import { ContextMenu, type ContextMenuItem } from "../components/ContextMenu";
import { Modal } from "../components/Modal";
import { SessionOutcomeModal } from "../components/SessionOutcomeModal";
import { copySessionPrep } from "../sessionCopy";
import { SectionHeading } from "../components/SectionHeading";
import { CampaignCoverTile } from "../components/CampaignCoverTile";
import { CreateCampaignTile } from "../components/CreateCampaignTile";
import { OnboardingHero } from "../components/OnboardingHero";
import { HomeArticleCard } from "../components/HomeArticleCard";
import { loadHideFinance } from "../financePrivacy";
import { formatNearestDate } from "../nearestDate";
import { sessionLabel } from "../sessionLabel";
import { formatCompactNumber } from "../formatNumber";
import { parseDateKey, toLocalDateKey } from "../utils/date";
import { safeBackgroundImage } from "../utils/safeUrl";
import { useAuthenticatedFileUrl } from "../utils/fileUrl";
import { LocalClock } from "../components/LocalClock";
import { LoadErrorCard } from "../components/Loadable";
import type { AppSettings, Campaign, Player, SessionSummary, Setting, System } from "../types";

interface FinanceSummary {
  earned: number;
  heldSessions: number;
  playedSessions: number;
  campaigns: number;
}

const NO_SESSIONS: SessionSummary[] = [];
const NO_CAMPAIGNS: Campaign[] = [];
const NO_SYSTEMS: System[] = [];
const NO_SETTINGS: Setting[] = [];
const NO_PLAYERS: Player[] = [];

/**
 * Сессия изменилась с главной: сверх самой сессии и её кампании — календарь
 * всех кампаний и сводка денег. Общего правила «сессия задевает календарь» нет
 * намеренно: шаг хода в бою тянул бы календарь (группа «остальное», часть 1).
 */
function homeSessionAffects(sessionId: number, campaignId: number): Affect[] {
  return [...sessionMoneyAffects(sessionId, campaignId), { path: "/calendar" }, { path: "/finance" }];
}

export function HomeCalendarPage() {
  const client = useQueryClient();
  const run = useAction();
  const afterWrite = useAfterWrite();
  const calendar = useResource<SessionSummary[]>("/calendar");
  const sessions = calendar.data ?? NO_SESSIONS;
  const campaignsState = useResource<Campaign[]>("/campaigns");
  const campaigns = campaignsState.data ?? NO_CAMPAIGNS;
  const systemsState = useResource<System[]>("/systems");
  const systems = systemsState.data ?? NO_SYSTEMS;
  const settingsState = useResource<Setting[]>("/settings");
  const settings = settingsState.data ?? NO_SETTINGS;
  const playersState = useResource<Player[]>("/players");
  const players = playersState.data ?? NO_PLAYERS;
  // 3.2 — Сводка и фон лениво, после того как герой уже отрисован.
  const [lazyReady, setLazyReady] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setLazyReady(true), 400);
    return () => window.clearTimeout(id);
  }, []);
  const finance = useResource<FinanceSummary>(lazyReady ? "/finance/summary" : null).data ?? null;
  const homeBgUrl = useResource<AppSettings>(lazyReady ? "/app-settings" : null).data?.home_background_url ?? null;
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
  const [financeSessionId, setFinanceSessionId] = useState<number | null>(null);
  // Герой и онбординг решают по всем пяти спискам — до их прихода скелет.
  const initialLoad = ![calendar, campaignsState, systemsState, settingsState, playersState].some((q) => q.loading);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const navigate = useNavigate();

  const miniEvents: MiniEvent[] = sessions.map((s) => ({
    id: s.id,
    date: s.date,
    status: s.status,
    campaignId: s.campaign_id,
    campaignName: s.campaign_name,
    startTime: s.start_time,
    campaignRole: s.campaign_role,
  }));

  const calendarError = calendar.error;
  const campaignsError = campaignsState.error;

  function retryLoad() {
    calendar.reload();
    campaignsState.reload();
  }

  const authHomeBgBlob = useAuthenticatedFileUrl(homeBgUrl);

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

  // Прошедшие, но не разобранные игры: статус всё ещё «запланирована», а время
  // начала уже позади. Такая сессия проваливалась в тишину — в героя она не
  // попадает (он смотрит вперёд), в «заработано» тоже (оно считает только
  // held), и напомнить о ней было некому. Учитывается именно время начала:
  // вечерняя игра сегодня в 19:00 не просрочена в 15:00.
  const overdueSessions = sessions
    .filter((s) => s.status === "planned")
    .map((s) => {
      const d = parseDateKey(s.date);
      const [h, m] = (s.start_time ?? "00:00").split(":").map(Number);
      d.setHours(h, m, 0, 0);
      return { s, dt: d };
    })
    .filter(({ dt }) => dt.getTime() < now.getTime())
    .sort((a, b) => a.dt.getTime() - b.dt.getTime())
    .map(({ s }) => s);

  // Кнопка «Состоялась» на герое появляется, только когда время игры уже
  // наступило: на игре, до которой шесть дней, она была бы приглашением к
  // ошибке в один клик.
  const heroStarted = (() => {
    if (!nearestSession) return false;
    const d = parseDateKey(nearestSession.date);
    const [h, m] = (nearestSession.start_time ?? "00:00").split(":").map(Number);
    d.setHours(h, m, 0, 0);
    return d.getTime() <= now.getTime();
  })();

  function bgStyle(url: string | null, blob: string | null): string | undefined {
    if (!url) return undefined;
    if (url.startsWith("/files/")) return blob ? `url("${blob}")` : undefined;
    return safeBackgroundImage(url);
  }

  // Обложка кампании ближайшей игры: из списка, а если кампании в нём нет
  // (игра в чужой кампании) — её карточкой.
  const nearestInList = nearestSession ? campaigns.find((c) => c.id === nearestSession.campaign_id) : undefined;
  const nearestCard = useEntity<Campaign>("campaign", nearestSession && !nearestInList ? nearestSession.campaign_id : null).data;
  const bgUrl = nearestSession ? ((nearestInList ?? nearestCard)?.background_image_url ?? null) : null;
  const authBgBlob = useAuthenticatedFileUrl(bgUrl);

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

  const oneshotSessions =
    useResource<SessionSummary[]>(
      createModal?.campaignId && selectedCampaign?.type === "oneshot" ? `/campaigns/${createModal.campaignId}/sessions` : null
    ).data ?? NO_SESSIONS;

  function setStatus(event: MiniEvent, status: SessionSummary["status"]) {
    return run(labelled("Статус сессии", () => write.put(`/sessions/${event.id}`, { status })), {
      affects: homeSessionAffects(event.id, event.campaignId),
    });
  }

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
                  await setStatus(event, "planned");
                },
              },
              {
                label: "Состоялась",
                onClick: async () => {
                  await setStatus(event, "held");
                },
              },
              // Отменить существующую игру было нечем: статус cancelled в схеме
              // есть и подписан «Отменена», но выставить его можно было только
              // при создании — оставалось удалить сессию в архив, стерев то,
              // что в феврале трижды срывались.
              {
                label: "Отменена",
                onClick: async () => {
                  await setStatus(event, "cancelled");
                },
              },
            ],
          },
      ...(event.campaignRole === "gm" ? [{
        label: "Разобрать игру",
        onClick: () => setFinanceSessionId(event.id),
      }] : []),
      {
        label: "Удалить (в архив)",
        danger: true,
        onClick: async () => {
          await run(labelled("Сессия не удалена", () => write.del(`/sessions/${event.id}`)), {
            affects: [...homeSessionAffects(event.id, event.campaignId), { path: "/archive" }],
          });
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
      const campaignId = Number(createModal.campaignId);
      const created = await write.post<{ id: number }>("/sessions", {
        campaign_id: Number(createModal.campaignId),
        date: createModal.date,
        start_time: createModal.startTime || null,
      });
      if (createModal.copyFromSessionId) {
        try {
          await copySessionPrep(Number(createModal.copyFromSessionId), created.id);
        } catch (e) {
          setCreateError(`Сессия создана, но копирование подготовки не удалось: ${String(e)}`);
          afterWrite(homeSessionAffects(created.id, campaignId));
          return;
        }
      }
      setCreateModal(null);
      afterWrite(homeSessionAffects(created.id, campaignId));
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
        <LoadErrorCard
          message={<>Не удалось загрузить: {[calendarError, campaignsError].filter(Boolean).join(" · ")}</>}
          onRetry={retryLoad}
        />
      )}

      <div className="home-layout">
        <div className="home-main">
          {/* P1 D-02: дубль EmptyState «Начни с хранилища» убран — единый OnboardingHero покрывает §1.11 */}
          {initialLoad && !nearestSession && campaigns.length === 0 && sessionStorage.getItem("justCreated") && (
            <div className="card" style={{ background: "var(--paper)", border: "1px solid var(--line)", padding: "10px 12px", borderLeft: "3px solid var(--accent)" }}>
              <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-micro)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>Добро пожаловать, Мастер!</span>
              <span className="muted" style={{ marginLeft: 8, fontSize: "var(--fs-meta)" }}>Начни с Системы — первый шаг ниже.</span>
            </div>
          )}
          {/* Hero — nearest upcoming session's campaign, full-bleed cover. */}
          {nearestSession ? (
            // Ведёт в карточку сессии, а не в пульт: с главной ныряют
            // ГОТОВИТЬ ближайшую игру. Кнопка в пульт есть в навигационном
            // виджете из любой точки приложения — второй кнопкой поверх героя
            // она спорила бы с этим обещанием.
            //
            // «Состоялась» лежит РЯДОМ со ссылкой, а не внутри неё: <button>
            // внутри <a> — невалидная вложенность, и клик по кнопке уводил бы
            // заодно на страницу сессии. Обёртка позиционирует её поверх.
            <div className="home-hero-wrap">
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
            {heroStarted && (
              <button
                type="button"
                className="home-hero-held"
                title="Разобрать игру: кто пришёл, кто заплатил, что случилось"
                onClick={(e) => { e.stopPropagation(); setFinanceSessionId(nearestSession.id); }}
              >
                Состоялась
              </button>
            )}
            </div>
          ) : (
            <OnboardingHero
              systems={systems}
              settings={settings}
              campaigns={campaigns}
              players={players}
              sessionsCount={sessions.length}
              onRefresh={() =>
                void invalidateAffects(client, [
                  { path: "/calendar" },
                  { kind: "campaign", card: true },
                  { kind: "system", card: true },
                  { kind: "setting", card: true },
                  { kind: "player" },
                ])
              }
            />
          )}

          {/* Неразобранные игры. Стоит под героем, а не над ним: ближайшая игра
              важнее — за ней сюда и приходят, — а бухгалтерия не должна вставать
              между Мастером и подготовкой. Список строками, а не одной строкой
              со счётчиком: это разные кампании и разные вечера, и Мастер сам
              решает, с какой начать и где бросить. */}
          {overdueSessions.length > 0 && (
            <div className="card stack home-overdue" style={{ gap: 8 }}>
              <SectionHeading level="section" icon="calendar">
                Игры прошли, но не отмечены
              </SectionHeading>
              {overdueSessions.map((s) => (
                <div key={s.id} className="row home-overdue-row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <div className="stack" style={{ gap: 2, minWidth: 0 }}>
                    <Link to={`/sessions/${s.id}`}>
                      <strong>{s.campaign_name ?? "Кампания"}</strong>
                    </Link>
                    <span className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }}>
                      {sessionLabel(s)} · {formatNearestDate(s.date)}
                      {s.start_time ? ` · ${s.start_time}` : ""}
                    </span>
                  </div>
                  <button className="primary" onClick={() => setFinanceSessionId(s.id)}>
                    Разобрать
                  </button>
                </div>
              ))}
            </div>
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
          {/* 2.2 §1.11: на пустой БД «Сводка» — кладбище нулей — не показываем */}
          {finance && campaigns.length > 0 && (
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

          {/* 2.2 календарь до первой кампании не нужен — сессии некуда вязать */}
          {campaigns.length > 0 && (
            <div className="card stack home-rail-calendar">
              <SectionHeading level="section" icon="calendar" right={<LocalClock />}>
                Календарь
              </SectionHeading>
              <MiniCalendar
                events={miniEvents}
                onDayClick={(date) => openCreateModal(date)}
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
          )}
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
              {campaigns.length === 0 && <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>Сначала создайте кампанию в разделе «Кампании»</span>}
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
            {createError && <LoadErrorCard message={createError} />}
            <div className="row">
              <button className="primary" onClick={createSessionFromModal} disabled={!createModal.campaignId || creating}>
                {creating ? "Создаю…" : "Создать"}
              </button>
              <button onClick={() => setCreateModal(null)} disabled={creating}>Отмена</button>
            </div>
          </div>
        </Modal>
      )}

      {financeSessionId && (
        <SessionOutcomeModal
          sessionId={financeSessionId}
          onClose={() => setFinanceSessionId(null)}
          onSaved={() => afterWrite([{ path: "/calendar" }, { path: "/finance" }])}
        />
      )}
    </div>
  );
}
