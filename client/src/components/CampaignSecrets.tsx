import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAction, useResource, write } from "../data/hooks";
import { dataKeys } from "../data/entities";
import { campaignPaths, secretAffects } from "../data/campaigns";
import { labelled } from "../data/notices";
import { MentionText } from "./mentions/MentionText";
import type { CampaignGrouped, StorySecret } from "../types";
import { useConfirm } from "../hooks/useConfirm";

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
export interface SecretsNavStats {
  own: { total: number; done: number };
  groups: { id: number; name: string; total: number; done: number }[];
}

const EMPTY: CampaignGrouped<StorySecret> = { groups: [], own: [] };

export function CampaignSecrets({
  campaignId,
  settingId,
  groupId,
  onStats,
}: {
  campaignId: number;
  settingId: number | null;
  // Master–Detail: показать одну группу ("own" — записи кампании, иначе
  // id приключения). Не задано — все группы, как раньше.
  groupId?: string | null;
  onStats?: (s: SecretsNavStats) => void;
}) {
  const path = campaignPaths.secrets(campaignId);
  const data = useResource<CampaignGrouped<StorySecret>>(path).data ?? EMPTY;
  const client = useQueryClient();

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
    client.setQueryData<CampaignGrouped<StorySecret>>(dataKeys.resource(path), (prev) =>
      prev && {
        own: patchList(prev.own),
        groups: prev.groups.map((g) => {
          const items = patchList(g.items);
          return items === g.items ? g : { ...g, items };
        }),
      }
    );
  }, [client, path]);

  const total = data.own.length + data.groups.reduce((n, g) => n + g.items.length, 0);
  // Пустая корзина «Сцены вне приключений» в этом разделе — чистый шум:
  // вехи и тайны в неё не кладут.
  const visibleGroups = useMemo(
    () => data.groups.filter((g) => g.arc.is_default !== 1 || g.items.length > 0),
    [data.groups]
  );

  // Счётчики для левой навигации Master–Detail.
  useEffect(() => {
    if (!onStats) return;
    const doneOf = (items: StorySecret[]) => items.filter((x) => x.state?.revealed === 1).length;
    onStats({
      own: { total: data.own.length, done: doneOf(data.own) },
      groups: visibleGroups.map((g) => ({ id: g.arc.id, name: g.arc.name, total: g.items.length, done: doneOf(g.items) })),
    });
  }, [data, visibleGroups, onStats]);

  const showOwn = groupId == null || groupId === "own";
  const showGroups = visibleGroups.filter((g) => groupId == null || groupId === String(g.arc.id));

  return (
    <div className="stack">
      <p className="muted">
        Отметка «раскрыто» относится только к этой кампании — и открывает запись игрокам. Тексты
        тайн приключения правятся в сеттинге; свои можно завести здесь.
      </p>

      {showOwn && (
        <SecretGroup
          title="Тайны кампании"
          items={data.own}
          arcId={null}
          campaignId={campaignId}
          onRevealed={applyRevealed}
        />
      )}
      {settingId != null &&
        showGroups.map((g) => (
          <SecretGroup
            key={g.arc.id}
            title={g.arc.name}
            items={g.items}
            arcId={g.arc.id}
            campaignId={campaignId}
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
  onRevealed,
}: {
  title: string;
  items: StorySecret[];
  arcId: number | null;
  campaignId: number;
  onRevealed: (id: number, revealed: boolean) => void;
}) {
  const [confirmDialog, confirm] = useConfirm();
  const run = useAction();
  // Галочка меняется сразу; при отказе возвращается и появляется плашка.
  // Раньше отказ проходил молча, и галочка показывала несохранённое.
  const toggle = useCallback(
    async (s: StorySecret, revealed: boolean) => {
      onRevealed(s.id, revealed);
      const saved = await run(
        labelled("Отметка тайны", () => write.put(`/story/secrets/${s.id}/state`, { campaign_id: campaignId, revealed }).then(() => true)),
        { affects: secretAffects(campaignId) }
      );
      if (!saved) onRevealed(s.id, !revealed);
    },
    [campaignId, onRevealed, run]
  );

  const remove = useCallback(
    async (s: StorySecret) => {
      if (!(await confirm({ message: `Удалить «${s.title}»?`, confirmLabel: "Удалить", danger: true })))
        return;
      await run(labelled("Удаление тайны", () => write.del(`/story/secrets/${s.id}`)), { affects: secretAffects(campaignId) });
    },
    [campaignId, confirm, run]
  );

  const revealed = items.filter((s) => s.state?.revealed === 1).length;

  return (
    <details className="card res-group">
      {confirmDialog}
      <summary className="res-group__band">
        <span className="res-group__title">{title}</span>
        <span className="res-group__count">раскрыто {revealed} из {items.length}</span>
      </summary>
      <div className="res-group__body" style={{ padding: 12, gap: 8, display: "flex", flexDirection: "column" }}>
        {items.map((s) => (
          <SecretRow key={s.id} secret={s} onToggle={toggle} onRemove={remove} />
        ))}
        {/* §1.11a — как и у вех: приглашение здесь уже есть, это форма ниже. */}
        <AddSecretForm arcId={arcId} campaignId={campaignId} />
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
}: {
  arcId: number | null;
  campaignId: number;
}) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [kind, setKind] = useState<string>("secret");
  const run = useAction();

  async function add() {
    if (!title.trim()) return;
    // Поля очищаются только после записи: при отказе набранное остаётся.
    const created = await run(
      labelled("Новая тайна", () => write.post("/story/secrets", { campaign_id: campaignId, arc_id: arcId, kind, title, content }).then(() => true)),
      { affects: secretAffects(campaignId), retry: false }
    );
    if (!created) return;
    setTitle("");
    setContent("");
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
