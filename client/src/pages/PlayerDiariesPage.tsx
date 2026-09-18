import { Link } from "react-router-dom";
import { useResource } from "../data/hooks";
import { ListSkeleton, LoadErrorCard } from "../components/Loadable";

interface DiaryCampaign {
  id: number;
  name: string;
  system_id: number | null;
  system_name: string | null;
}

// Дневники игрока (Кабинет игрока, 2026-09-12, шаг 5): кампании из ростера —
// в каждой свой дневник (страница кампании). Источник — ростер, а не
// персонажи: игроку без чарника иначе не к чему привязаться (см.
// GET /player/campaigns). Заменяет PlayerCampaignsListPage, который выводил
// только кампании с персонажами.
export function PlayerDiariesPage() {
  // Тот же ключ, что у кабинета игрока: сигнал кампании (добавили в состав)
  // обновляет список без перезагрузки.
  const list = useResource<DiaryCampaign[]>("/player/campaigns");
  const campaigns = list.data ?? null;
  const loadError = list.error;

  return (
    // Крошки рисует оболочка (AppShell) для любого адреса — своя строка
    // здесь дублировала её слово в слово.
    <div className="stack">
      {/* каркас в обход намеренно — страница не карточка сущности: свой вид, каркас для него ещё не построен */}
      <h1>Дневники</h1>
      {loadError && (
        <LoadErrorCard
          message={<>Не удалось загрузить дневники: {loadError}</>}
          onRetry={list.reload}
        />
      )}
      {!loadError && campaigns === null && <ListSkeleton variant="paragraph" label="Загрузка дневников" />}
      {!loadError && campaigns !== null && campaigns.length === 0 && (
        <p className="muted">Вы пока не состоите ни в одной кампании — дневник появится, когда мастер добавит вас в состав.</p>
      )}
      {!loadError && campaigns !== null && campaigns.length > 0 && (
        <div className="stack" style={{ gap: 8 }}>
          {campaigns.map((c) => (
            <Link key={c.id} to={`/campaigns/${c.id}`} className="card row" style={{ textDecoration: "none", gap: 12 }}>
              <strong>{c.name}</strong>
              {c.system_name && <span className="muted">{c.system_name}</span>}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
