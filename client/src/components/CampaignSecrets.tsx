import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAction, useResource, write } from "../data/hooks";
import { dataKeys } from "../data/entities";
import { campaignPaths, secretAffects } from "../data/campaigns";
import { labelled } from "../data/notices";
import { MentionText } from "./mentions/MentionText";
import "./campaign-secrets.css";
import type { CampaignGrouped, StorySecret } from "../types";
import { useConfirm } from "../hooks/useConfirm";
import { LoadErrorCard } from "./Loadable";

export const SECRET_KINDS = [
  { key: "secret", label: "Тайна" },
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
  const source = useResource<CampaignGrouped<StorySecret>>(path);
  const data = source.data ?? EMPTY;
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

  // Группы монтируются после чтения: иначе временное EMPTY раскрывает
  // форму «пустой группы», даже когда следом приходят существующие записи.
  if (!source.data) return source.error
    ? <LoadErrorCard message={source.error} onRetry={source.reload} />
    : <p className="muted" role="status">Загрузка…</p>;

  return (
    <div className="campaign-check-groups">
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

  // По образцу вех (макет Camp-Story-Milestones): своих досок у тайн нет.
  const [adding, setAdding] = useState(items.length === 0);
  return (
    <section className="campaign-check-group">
      {confirmDialog}
      <div className="d-gh">
        <h3 className="d-plate">{title}</h3>
        <span className="d-note">раскрыто {revealed} из {items.length}</span>
        <span className="d-end">
          <button type="button" className={`d-btn d-btn--sm${arcId == null ? "" : " d-btn--quiet"}`} onClick={() => setAdding((v) => !v)}>
            + Своя запись
          </button>
        </span>
      </div>
      {items.map((s) => (
        <SecretRow key={s.id} secret={s} onToggle={toggle} onRemove={remove} />
      ))}
      {adding && <AddSecretForm arcId={arcId} campaignId={campaignId} />}
    </section>
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
  const done = secret.state?.revealed === 1;
  return (
    <div className={`campaign-check-row${done ? " is-done" : ""}`}>
      <input
        type="checkbox"
        className="d-check"
        checked={done}
        aria-label={`«${secret.title}» раскрыта`}
        onChange={(e) => onToggle(secret, e.target.checked)}
      />
      <div className="campaign-check-row__text">
        <b>{secret.title}</b>
        {secret.content && <MentionText text={secret.content} />}
      </div>
      <span className="d-mono">{SECRET_KIND_LABELS[secret.kind] ?? secret.kind}</span>
      {/* Тайна приключения принадлежит сеттингу — её видят все его кампании,
          поэтому удалять её отсюда нельзя. */}
      {secret.campaign_id ? (
        <button type="button" className="d-dots" aria-label={`Удалить «${secret.title}»`} onClick={() => onRemove(secret)}>
          ✕
        </button>
      ) : <span />}
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
    <form className="campaign-check-add" onSubmit={(e) => { e.preventDefault(); void add(); }}>
      <select className="d-select" value={kind} onChange={(e) => setKind(e.target.value)}>
        {SECRET_KINDS.map((k) => (
          <option key={k.key} value={k.key}>
            {k.label}
          </option>
        ))}
      </select>
      <input className="d-input" placeholder="Название" value={title} onChange={(e) => setTitle(e.target.value)} />
      <input className="d-input" placeholder="Содержание" value={content} onChange={(e) => setContent(e.target.value)} />
      <button type="submit" className="d-btn d-btn--sm" disabled={!title.trim()}>
        Добавить
      </button>
    </form>
  );
});
