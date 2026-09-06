import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { Breadcrumbs } from "../components/Breadcrumbs";

interface SheetSummary {
  format: string;
  race: string;
  class: string;
  subclass: string;
  level: number;
}

interface MyCharacter {
  id: number;
  character_name: string;
  campaign_id: number | null;
  campaign_name: string | null;
  sheet: SheetSummary | null;
}

// Подпись кнопки: для D&D — вид · класс [подкласс] · уровень, для остальных
// систем и без чарника — кампания. Имя рядом, как везде.
function characterSubtitle(c: MyCharacter): string {
  const s = c.sheet;
  if (s && s.format === "dnd_character" && (s.race || s.class || s.level)) {
    const cls = [s.class, s.subclass ? `[${s.subclass}]` : ""].filter(Boolean).join(" ");
    return [s.race, [cls, s.level > 0 ? `${s.level} ур.` : ""].filter(Boolean).join(" ")].filter(Boolean).join(" · ");
  }
  return c.campaign_name ?? "без кампании";
}

interface MyCampaign {
  id: number;
  name: string;
  system_id: number | null;
  system_name: string | null;
}

interface NameOnly {
  id: number;
  name: string;
}

// Чарники игрока: все его персонажи на этом сервере + создание нового.
// Создание идёт от кампании (первый шаг), потом система (по умолчанию —
// кампании), потом имя: меньше неинтуитивных кликов, чем «создай в пустоте,
// а Мастер потом привяжет». После создания — сразу в визард (?newSheet=1).
export function PlayerSheetsPage() {
  const navigate = useNavigate();
  const [characters, setCharacters] = useState<MyCharacter[] | null>(null);
  const [listError, setListError] = useState("");
  const [creating, setCreating] = useState(false);
  const [campaigns, setCampaigns] = useState<MyCampaign[] | null>(null);
  const [systems, setSystems] = useState<NameOnly[] | null>(null);
  const [campaignId, setCampaignId] = useState("");
  const [systemId, setSystemId] = useState("");
  const [name, setName] = useState("");
  const [createError, setCreateError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    api
      .get<{ characters: MyCharacter[] }>("/player/me", { signal: ac.signal } as RequestInit)
      .then((me) => setCharacters(me.characters))
      .catch((e) => {
        if ((e as Error).name !== "AbortError") setListError(String(e));
      });
    return () => ac.abort();
  }, []);

  function startCreate() {
    setCreating(true);
    setCreateError("");
    setCampaignId("");
    setSystemId("");
    setName("");
    if (campaigns === null) {
      api
        .get<MyCampaign[]>("/player/campaigns")
        .then(setCampaigns)
        .catch(() => setCampaigns([]));
    }
    if (systems === null) {
      api
        .get<NameOnly[]>("/player/systems")
        .then(setSystems)
        .catch(() => setSystems([]));
    }
  }

  // Система кампании — умолчание: менять нужно редко, а выбирать каждый раз
  // заставляло думать ни о чём.
  function pickCampaign(id: string) {
    setCampaignId(id);
    if (!id) {
      setSystemId("");
      return;
    }
    const camp = campaigns?.find((c) => c.id === Number(id));
    setSystemId(camp?.system_id ? String(camp.system_id) : "");
  }

  async function create(goSheet: boolean) {
    if (!name.trim()) {
      setCreateError("Назовите персонажа.");
      return;
    }
    setSaving(true);
    setCreateError("");
    try {
      const created = await api.post<{ id: number }>("/player/characters", {
        character_name: name.trim(),
        campaign_id: campaignId ? Number(campaignId) : null,
        system_id: systemId ? Number(systemId) : null,
      });
      // Выбор лучше навязывания: кому профиль (досье, заметки), кому сразу
      // чарник. Визард откроется и там, и там (?newSheet=1).
      navigate(goSheet ? `/characters/${created.id}/sheet?newSheet=1` : `/characters/${created.id}?tab=statblock&newSheet=1`);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="stack">
      <Breadcrumbs items={[{ label: "Главная", to: "/" }, { label: "Чарники" }]} />
      <h1>Чарники</h1>
      {listError && <p className="error">Не загрузилось: {listError}</p>}
      {characters === null && !listError && <p className="muted">Загрузка…</p>}
      {characters !== null && characters.length === 0 && !creating && (
        <p className="muted">Чарников пока нет — заведите первого.</p>
      )}
      {characters !== null && characters.length > 0 && (
        <div className="stack" style={{ gap: 8 }}>
          {characters.map((c) => (
            <Link key={c.id} to={`/characters/${c.id}`} className="card row" style={{ textDecoration: "none", gap: 12 }}>
              <strong>{c.character_name}</strong>
              <span className="muted">{characterSubtitle(c)}</span>
            </Link>
          ))}
        </div>
      )}
      {!creating ? (
        <button type="button" className="primary" onClick={startCreate} style={{ alignSelf: "flex-start" }}>
          + Новый чарник
        </button>
      ) : (
        <div className="card stack">
          <strong>Новый чарник</strong>
          <label>
            Кампания
            <select value={campaignId} onChange={(e) => pickCampaign(e.target.value)}>
              <option value="">Без кампании</option>
              {(campaigns ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Система
            <select value={systemId} onChange={(e) => setSystemId(e.target.value)}>
              <option value="">Без системы</option>
              {(systems ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Имя персонажа
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Как зовут?"
              onKeyDown={(e) => {
                if (e.key === "Enter") void create(true);
              }}
            />
          </label>
          {createError && <p className="error">{createError}</p>}
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="primary" disabled={saving} onClick={() => void create(false)}>
              {saving ? "Создаю…" : "В профиль"}
            </button>
            <button type="button" disabled={saving} onClick={() => void create(true)}>
              Сразу в чарник
            </button>
            <button type="button" onClick={() => setCreating(false)} disabled={saving}>
              Отмена
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
