import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { LoadErrorCard } from "../components/Loadable";

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
  const [campaigns, setCampaigns] = useState<DiaryCampaign[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    api
      .get<DiaryCampaign[]>("/player/campaigns", { signal: controller.signal } as RequestInit)
      .then(setCampaigns)
      .catch((e: unknown) => {
        if ((e as Error).name === "AbortError") return;
        setLoadError(String(e instanceof Error ? e.message : e));
      });
    return () => controller.abort();
  }, []);

  return (
    <div className="stack">
      <Breadcrumbs items={[{ label: "Главная", to: "/" }, { label: "Дневники" }]} />
      {/* каркас в обход намеренно — страница не карточка сущности: свой вид, каркас для него ещё не построен */}
      <h1>Дневники</h1>
      {loadError && (
        <LoadErrorCard
          message={<>Не удалось загрузить дневники: {loadError}</>}
          onRetry={() => window.location.reload()}
        />
      )}
      {!loadError && campaigns === null && <p className="muted">Загрузка…</p>}
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
