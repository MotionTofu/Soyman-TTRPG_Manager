import { memo, useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { MentionText } from "./mentions/MentionText";
import type { CampaignGrouped, StorySecret } from "../types";

export const SECRET_KINDS = [
  { key: "secret", label: "Тайна" },
  { key: "clue", label: "Улика" },
  { key: "thread", label: "Нить" },
] as const;

export const SECRET_KIND_LABELS: Record<string, string> = Object.fromEntries(
  SECRET_KINDS.map((k) => [k.key, k.label])
);

// Раздел «Тайны и зацепки» кампании: тайны, улики и нити привязанных
// приключений плюс собственные записи кампании — одной моделью. Раньше это
// были две разные сущности (тайны приключений и записи трекера), из-за чего
// у собственной тайны не было ни вида, ни привязки к приключению.
export function CampaignSecrets({
  campaignId,
  settingId,
}: {
  campaignId: number;
  settingId: number | null;
}) {
  const [data, setData] = useState<CampaignGrouped<StorySecret>>({ groups: [], own: [] });

  // Стабильная ссылка обязательна: refresh уезжает в строки через onRemove, и
  // новая функция на каждый рендер сводила бы memo на строке к нулю — именно
  // из-за этого отметка одной тайны перерисовывала все.
  const refresh = useCallback(() => {
    api
      .get<CampaignGrouped<StorySecret>>(`/story/campaign-secrets?campaign_id=${campaignId}`)
      .then(setData);
  }, [campaignId]);
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Как и у вех: отметка «раскрыто» правит одну строку на месте, а не
  // перечитывает весь раздел. Записи, которых правка не касается, сохраняют
  // ссылочное равенство — вместе с memo на строке это значит, что React
  // перерисует ровно одну из них, а не весь раздел. Без этого коммит трогал
  // каждую запись, и на длинных текстах тайн клик занимал секунды.
  const applyRevealed = useCallback((id: number, revealed: boolean) => {
    // Списки, в которых ничего не поменялось, возвращаются той же ссылкой —
    // тогда memo отсекает и группу целиком, а не только строку.
    const patchList = (list: StorySecret[]) => {
      const i = list.findIndex((x) => x.id === id);
      if (i === -1) return list;
      const next = list.slice();
      next[i] = { ...list[i], state: { revealed: revealed ? 1 : 0, note: list[i].state?.note ?? "" } };
      return next;
    };
    setData((prev) => ({
      own: patchList(prev.own),
      groups: prev.groups.map((g) => {
        const items = patchList(g.items);
        return items === g.items ? g : { ...g, items };
      }),
    }));
  }, []);

  const total = data.own.length + data.groups.reduce((n, g) => n + g.items.length, 0);
  // Пустая корзина «Сцены вне приключений» в этом разделе — чистый шум:
  // вехи и тайны в неё не кладут.
  const visibleGroups = data.groups.filter((g) => g.arc.is_default !== 1 || g.items.length > 0);

  return (
    <div className="stack">
      <p className="muted">
        Отметка «раскрыто» относится только к этой кампании — и открывает запись игрокам. Тексты
        тайн приключения правятся в сеттинге; свои можно завести здесь.
      </p>

      <SecretGroup
        title="Тайны кампании"
        items={data.own}
        arcId={null}
        campaignId={campaignId}
        onChange={refresh}
        onRevealed={applyRevealed}
      />
      {settingId != null &&
        visibleGroups.map((g) => (
          <SecretGroup
            key={g.arc.id}
            title={g.arc.name}
            items={g.items}
            arcId={g.arc.id}
            campaignId={campaignId}
            onChange={refresh}
            onRevealed={applyRevealed}
          />
        ))}
      {total === 0 && <p className="muted">Пока пусто.</p>}
    </div>
  );
}

const SecretGroup = memo(function SecretGroup({
  title,
  items,
  arcId,
  campaignId,
  onChange,
  onRevealed,
}: {
  title: string;
  items: StorySecret[];
  arcId: number | null;
  campaignId: number;
  onChange: () => void;
  onRevealed: (id: number, revealed: boolean) => void;
}) {
  const toggle = useCallback(
    (s: StorySecret, revealed: boolean) => {
      onRevealed(s.id, revealed);
      void api.put(`/story/secrets/${s.id}/state`, { campaign_id: campaignId, revealed });
    },
    [campaignId, onRevealed]
  );

  const remove = useCallback(
    async (s: StorySecret) => {
      if (!confirm(`Удалить «${s.title}»?`)) return;
      await api.del(`/story/secrets/${s.id}`);
      onChange();
    },
    [onChange]
  );

  const revealed = items.filter((s) => s.state?.revealed === 1).length;

  return (
    <details className="card res-group">
      <summary className="res-group__band">
        <span className="res-group__title">{title}</span>
        <span className="res-group__count">раскрыто {revealed} из {items.length}</span>
      </summary>
      <div className="res-group__body" style={{ padding: 12, gap: 8, display: "flex", flexDirection: "column" }}>
        {items.map((s) => (
          <SecretRow key={s.id} secret={s} onToggle={toggle} onRemove={remove} />
        ))}
        {/* §1.11a — как и у вех: приглашение здесь уже есть, это форма ниже. */}
        <AddSecretForm arcId={arcId} campaignId={campaignId} onChange={onChange} />
      </div>
    </details>
  );
});

// Строка вынесена в memo не для красоты: разбор разметки в тексте тайны стоит
// заметно, и без memo отметка одной записи перерисовывала их все.
const SecretRow = memo(function SecretRow({
  secret,
  onToggle,
  onRemove,
}: {
  secret: StorySecret;
  onToggle: (s: StorySecret, revealed: boolean) => void;
  onRemove: (s: StorySecret) => void;
}) {
  return (
    <div className="row" style={{ justifyContent: "space-between" }}>
      <span>
        <input
          type="checkbox"
          checked={secret.state?.revealed === 1}
          onChange={(e) => onToggle(secret, e.target.checked)}
        />{" "}
        <strong>{secret.title}</strong>
        <span className="muted"> · {SECRET_KIND_LABELS[secret.kind] ?? secret.kind}</span>
        {secret.campaign_id && <span className="badge tag"> запись кампании</span>}
        {secret.content && (
          <div className="muted">
            <MentionText text={secret.content} />
          </div>
        )}
      </span>
      {/* Тайна приключения принадлежит сеттингу — её видят все его кампании,
          поэтому удалять её отсюда нельзя. */}
      {!!secret.campaign_id && (
        <button className="danger" onClick={() => onRemove(secret)}>
          ✕
        </button>
      )}
    </div>
  );
});

// Форма живёт отдельно от списка: её поля не должны переписываться каждый
// раз, когда в группе меняется счётчик раскрытых.
const AddSecretForm = memo(function AddSecretForm({
  arcId,
  campaignId,
  onChange,
}: {
  arcId: number | null;
  campaignId: number;
  onChange: () => void;
}) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [kind, setKind] = useState<string>("secret");

  async function add() {
    if (!title.trim()) return;
    await api.post("/story/secrets", {
      campaign_id: campaignId,
      arc_id: arcId,
      kind,
      title,
      content,
    });
    setTitle("");
    setContent("");
    onChange();
  }

  return (
    <div className="row">
      <select value={kind} onChange={(e) => setKind(e.target.value)}>
        {SECRET_KINDS.map((k) => (
          <option key={k.key} value={k.key}>
            {k.label}
          </option>
        ))}
      </select>
      <input placeholder="Название" value={title} onChange={(e) => setTitle(e.target.value)} />
      <input placeholder="Содержание" value={content} onChange={(e) => setContent(e.target.value)} />
      <button className="primary" onClick={add}>
        + Своя запись
      </button>
    </div>
  );
});
