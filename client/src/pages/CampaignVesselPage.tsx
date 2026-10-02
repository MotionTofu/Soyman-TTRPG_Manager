import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAction, useResource, write } from "../data/hooks";
import { campaignPaths } from "../data/campaigns";
import {
  CREW_DRAG_MIME,
  VESSEL_AFFECTS,
  crewText,
  readCrewDrag,
  startCrewDrag,
  type CrewDrag,
  hpText,
  vesselPaths,
  type Vessel,
  type VesselHp,
  type VesselPeople,
  type VesselPost,
} from "../data/campaignVessels";
import { EntityPage } from "../components/EntityPage";
import { EditableTextCard } from "../components/EditableTextCard";
import { MentionText } from "../components/mentions/MentionText";
import { MentionTextarea } from "../components/mentions/MentionTextarea";
import { Modal } from "../components/Modal";
import { VesselHpModal } from "../components/VesselHpModal";
import { VesselCrewPlan } from "../components/VesselCrewPlan";
import { useConfirm, usePrompt } from "../hooks/useConfirm";
import { useTabState } from "../hooks/useTabState";
import type { CampaignDetail } from "../types";

// Корабль кампании (спека profiles-paper-2, «Корабль кампании»; доски 39–40):
// запись на основе судна компендиума. Статы, посты и чертёж — основы; своё —
// имя, хиты корпуса и постов, экипаж, груз, заметки Мастера.
const TABS = ["Досье", "Чертёж"] as const;

type HpTarget = { title: string; hp: VesselHp; post?: number };

export function CampaignVesselPage() {
  const params = useParams();
  const campaignId = Number(params.id);
  const vesselId = Number(params.vesselId);
  const navigate = useNavigate();
  const state = useResource<Vessel>(Number.isFinite(vesselId) ? vesselPaths.detail(vesselId) : null);
  const vessel = state.data;
  const campaign = useResource<CampaignDetail>(Number.isFinite(campaignId) ? campaignPaths.detail(campaignId) : null).data;
  const [tab, selectTab] = useTabState(TABS, "Досье");
  const [confirmDialog, confirm] = useConfirm();
  const [promptDialog, prompt] = usePrompt();
  const [hpTarget, setHpTarget] = useState<HpTarget | null>(null);
  const [pickPost, setPickPost] = useState<VesselPost | null>(null);
  const run = useAction();
  const path = vesselPaths.detail(vesselId);

  async function send(action: () => Promise<unknown>, retry = true) {
    return (await run(action, { affects: VESSEL_AFFECTS, retry })) !== undefined;
  }

  const crumbs = [
    { label: "Кампании", to: "/campaigns" },
    { label: campaign?.name ?? "Кампания", to: `/campaigns/${campaignId}` },
    { label: "Транспорт", to: `/campaigns/${campaignId}?tab=${encodeURIComponent("Транспорт")}` },
    { label: vessel?.name ?? "Корабль" },
  ];

  if (!vessel) {
    return (
      <EntityPage
        crumbs={crumbs}
        entityType="vessel"
        title="Корабль"
        paper
        loading={state.loading}
        error={state.error}
        onRetry={state.reload}
        missing={!state.loading && !state.error}
      >
        {null}
      </EntityPage>
    );
  }
  const v = vessel;

  async function rename() {
    const name = (await prompt({ title: "Имя корабля", message: "Как зовут корабль?", defaultValue: v.name }))?.trim();
    if (!name || name === v.name) return;
    await send(() => write.put(path, { name }));
  }

  async function archive() {
    const ok = await confirm({
      title: "Убрать корабль в архив?",
      message: `«${v.name}» потоплен или продан? Он уйдёт в архив вкладки «Транспорт» и вернётся оттуда вместе с экипажем и грузом.`,
      confirmLabel: "В архив",
    });
    if (ok) await send(() => write.post(`${path}/archive`, {}));
  }

  async function removeForever() {
    const ok = await confirm({
      title: "Удалить корабль насовсем?",
      message: `«${v.name}», его экипаж, груз и заметки удалятся. Судно в компендиуме останется.`,
      confirmLabel: "Удалить",
      danger: true,
    });
    if (!ok) return;
    if (await send(() => write.del(path), false)) navigate(`/campaigns/${campaignId}?tab=${encodeURIComponent("Транспорт")}`);
  }

  async function setHp(target: HpTarget, next: number) {
    return send(() =>
      target.post != null ? write.put(`${path}/posts/${target.post}`, { hp: next }) : write.put(path, { hull_hp: next })
    );
  }

  async function addCrew(postId: number, item: CrewDrag) {
    await send(() =>
      write.post(`${path}/crew`, {
        post_id: postId,
        ...(item.kind === "character" ? { character_id: item.ref_id } : { being_id: item.ref_id }),
      })
    );
  }

  async function setUnnamed(post: VesselPost) {
    const raw = await prompt({
      title: `Безымянные · ${post.name}`,
      message: "Сколько безымянных на посту (гребцов, матросов)?",
      defaultValue: String(post.unnamed),
    });
    if (raw == null) return;
    const n = Number(raw.trim() || "0");
    if (!Number.isInteger(n) || n < 0) return;
    await send(() => write.put(`${path}/posts/${post.id}`, { unnamed: n }));
  }

  const archived = v.archived_at != null;
  const tags = [v.base?.category, "Корабль кампании"].filter(Boolean) as string[];

  return (
    <EntityPage
      crumbs={crumbs}
      entityType="vessel"
      title={v.name}
      paper
      meta={
        <span className="paper-ident-tags">
          {tags.map((t) => (
            <span key={t} className="badge tag">
              {t}
            </span>
          ))}
          {archived && <span className="badge tag">в архиве</span>}
          {v.base ? (
            <Link className="paper-more" to={`/compendium/${v.base.id}`}>
              на основе «{v.base.name}» ›
            </Link>
          ) : (
            <span className="muted">основа удалена из компендиума</span>
          )}
        </span>
      }
      actions={[
        { label: "Переименовать", onClick: () => void rename() },
        ...(archived
          ? [
              { label: "Вернуть из архива", onClick: () => void send(() => write.post(`${path}/restore`, {})) },
              { label: "Удалить насовсем", danger: true, onClick: () => void removeForever() },
            ]
          : [{ label: "В архив", onClick: () => void archive() }]),
      ]}
      tabs={TABS}
      tab={tab}
      onTab={(t) => selectTab(t as (typeof TABS)[number])}
      overlays={
        <>
          {confirmDialog}
          {promptDialog}
          {hpTarget && (
            <VesselHpModal
              title={hpTarget.title}
              hp={hpTarget.hp}
              onSet={async (next) => {
                const ok = await setHp(hpTarget, next);
                if (ok) setHpTarget((t) => (t ? { ...t, hp: { ...t.hp, hp: next } } : t));
                return ok;
              }}
              onClose={() => setHpTarget(null)}
            />
          )}
          {pickPost && (
            <CrewPicker
              vessel={v}
              post={pickPost}
              onPick={(item) => {
                setPickPost(null);
                void addCrew(pickPost.id, item);
              }}
              onClose={() => setPickPost(null)}
            />
          )}
        </>
      }
    >
      {tab === "Досье" && (
        <div className="dossier">
          <aside className="dossier__aside">
            {v.blueprint_image_url ? (
              <button type="button" className="dossier__portrait vessel-plan-open" title="Открыть чертёж" onClick={() => selectTab("Чертёж")}>
                <VesselCrewPlan vessel={v} />
                <span className="dossier__portrait-hint">Открыть чертёж</span>
              </button>
            ) : (
              <div className="dossier__portrait">
                {v.base?.avatar_image_url ? (
                  <img src={v.base.avatar_image_url} alt={`Картинка: ${v.base.name}`} />
                ) : (
                  <span className="dossier__portrait-empty">Чертежа у основы нет</span>
                )}
              </div>
            )}
            <dl className="paper-facts">
              {v.base && (
                <div>
                  <dt className="paper-label">Основа</dt>
                  <dd>
                    <Link to={`/compendium/${v.base.id}`}>{v.base.name}</Link>
                  </dd>
                </div>
              )}
              {v.base?.size && (
                <div>
                  <dt className="paper-label">Размер</dt>
                  <dd>{v.base.size}</dd>
                </div>
              )}
            </dl>
          </aside>

          <div className="dossier__main">
            <VesselHead vessel={v} onHull={() => setHpTarget({ title: "корпус", hp: v.hull })} />

            <section className="vessel-posts">
              <h2 className="paper-group__head">
                Посты и экипаж <span className="paper-group__count">· {v.posts.length}</span>
              </h2>
              {v.posts.length > 0 ? (
                <ul className="paper-rows vessel-posts__rows">
                  {v.posts.map((p) => (
                    <PostRow
                      key={p.id}
                      post={p}
                      onHp={() => setHpTarget({ title: p.name || "пост", hp: { hp: p.hp, max: p.hp_max, threshold: null }, post: p.id })}
                      onUnnamed={() => void setUnnamed(p)}
                      onAdd={() => setPickPost(p)}
                      onRemove={(crewId) => void send(() => write.del(`${path}/crew/${crewId}`))}
                      onDropCrew={(item) => void addCrew(p.id, item)}
                    />
                  ))}
                </ul>
              ) : (
                <p className="muted">У основы нет постов экипажа — их заводят на странице судна в компендиуме.</p>
              )}
            </section>

            <CargoSection vessel={v} settingId={campaign?.setting_id ?? undefined} send={send} />

            <details className="paper-fold">
              <summary>Заметки Мастера</summary>
              <div className="paper-fold__body">
                <EditableTextCard
                  title="Заметки Мастера"
                  value={v.notes ?? ""}
                  onSave={(notes) => send(() => write.put(path, { notes })).then((ok) => {
                    if (!ok) throw new Error("Не сохранилось");
                  })}
                  rows={5}
                  defaultSettingId={campaign?.setting_id ?? undefined}
                  emptyLabel="заметки"
                />
              </div>
            </details>
          </div>
        </div>
      )}

      {tab === "Чертёж" && <VesselBoard vessel={v} onDropCrew={(postId, item) => void addCrew(postId, item)} />}
    </EntityPage>
  );
}

/** Кнопка калькулятора рядом с хитами (доска 39). */
function CalcButton({ onClick, title }: { onClick: () => void; title: string }) {
  return (
    <button type="button" className="vessel-calc" title={title} aria-label={title} onClick={onClick}>
      ±
    </button>
  );
}

/** «За столом» корабля: корпус с калькулятором, скорость, экипаж, груз. */
function VesselHead({ vessel, onHull }: { vessel: Vessel; onHull: () => void }) {
  const c = vessel.crew_total;
  const down = vessel.hull.max != null && vessel.hull.hp != null && vessel.hull.hp <= 0;
  return (
    <article className="creature-card paper-scope creature-card--page is-embedded">
      <div className="creature-card__head">
        <span className="creature-card__head-label">За столом</span>
      </div>
      <dl className="vehicle-head__stats">
        <div>
          <dt className="creature-card__head-label">Корпус</dt>
          <dd className={`vehicle-head__value vessel-hp${down ? " is-down" : ""}`}>
            {hpText(vessel.hull)}
            {vessel.hull.max != null && <CalcButton onClick={onHull} title="Хиты корпуса — урон и починка" />}
          </dd>
          {(vessel.base?.ac || vessel.hull.threshold != null) && (
            <dd className="vehicle-head__sub">
              {[vessel.base?.ac && `КЗ ${vessel.base.ac}`, vessel.hull.threshold != null && `порог урона ${vessel.hull.threshold}`]
                .filter(Boolean)
                .join(" · ")}
            </dd>
          )}
        </div>
        <div>
          <dt className="creature-card__head-label">Скорость</dt>
          <dd className="vehicle-head__value">{vessel.base?.speed || "—"}</dd>
        </div>
        <div>
          <dt className="creature-card__head-label">Экипаж</dt>
          <dd className="vehicle-head__value">{crewText(c)}</dd>
          {c.named + c.unnamed > 0 && (
            <dd className="vehicle-head__sub">
              {c.named} по именам, {c.unnamed} безымянных
            </dd>
          )}
        </div>
        <div>
          <dt className="creature-card__head-label">Груз</dt>
          <dd className="vehicle-head__value">{vessel.base?.cargo || "—"}</dd>
          {vessel.cargo.length > 0 && <dd className="vehicle-head__sub">на борту строк: {vessel.cargo.length}</dd>}
        </div>
      </dl>
    </article>
  );
}

function PostRow({
  post,
  onHp,
  onUnnamed,
  onAdd,
  onRemove,
  onDropCrew,
}: {
  post: VesselPost;
  onHp: () => void;
  onUnnamed: () => void;
  onAdd: () => void;
  onRemove: (crewId: number) => void;
  onDropCrew: (item: CrewDrag) => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <li
      className={`vessel-post${post.broken ? " is-broken" : ""}${over ? " is-over" : ""}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(CREW_DRAG_MIME)) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const item = readCrewDrag(e);
        if (item) onDropCrew(item);
      }}
    >
      <span className="paper-rows__main">
        <Link to={`/compendium/${post.id}`}>{post.name || "Без названия"}</Link>
        {post.broken && <span className="vessel-post__broken">выведен из строя</span>}
      </span>
      <span className={`vessel-hp${post.broken ? " is-down" : ""}`}>
        {post.hp_max != null ? (
          <>
            {post.hp} / {post.hp_max}
            <CalcButton onClick={onHp} title={`Хиты поста «${post.name}»`} />
          </>
        ) : (
          <span className="muted">хиты не записаны</span>
        )}
      </span>
      <span className="vessel-post__crew">
        {post.crew.map((c) => (
          <span
            key={c.id}
            className="vessel-crew-chip"
            draggable
            onDragStart={(e) => startCrewDrag(e, { kind: c.kind, ref_id: c.ref_id })}
            title="Перетащите на другой пост"
          >
            <Link to={c.kind === "character" ? `/characters/${c.ref_id}` : `/beings/${c.ref_id}`}>{c.name}</Link>
            <button type="button" className="vessel-crew-chip__x" aria-label={`Снять ${c.name} с поста`} onClick={() => onRemove(c.id)}>
              ✕
            </button>
          </span>
        ))}
        <button type="button" className="vessel-crew-unnamed" onClick={onUnnamed} title="Сколько безымянных на посту">
          {post.unnamed > 0 ? `безымянных: ${post.unnamed}` : "+ безымянные"}
        </button>
      </span>
      <button type="button" className="comp-mini" onClick={onAdd}>
        + на пост
      </button>
    </li>
  );
}

function CargoSection({
  vessel,
  settingId,
  send,
}: {
  vessel: Vessel;
  settingId: number | undefined;
  send: (a: () => Promise<unknown>, retry?: boolean) => Promise<boolean>;
}) {
  const path = vesselPaths.detail(vessel.id);
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [text, setText] = useState("");
  const [amount, setAmount] = useState("");

  function open(id: number | "new") {
    const row = id === "new" ? null : vessel.cargo.find((c) => c.id === id);
    setText(row?.text ?? "");
    setAmount(row?.amount ?? "");
    setEditing(id);
  }

  async function save() {
    const t = text.trim();
    if (!t) return;
    const ok =
      editing === "new"
        ? await send(() => write.post(`${path}/cargo`, { text: t, amount }), false)
        : await send(() => write.put(`${path}/cargo/${editing}`, { text: t, amount }));
    if (ok) setEditing(null);
  }

  const form = (
    <form
      className="vessel-cargo__form"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {/* Предмет сеттинга — упоминанием: «@» в поле открывает выбор. */}
      <MentionTextarea value={text} onChange={setText} rows={1} placeholder="Что везём — «@» для предмета сеттинга" defaultSettingId={settingId} />
      <input className="vessel-cargo__amount" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Сколько" />
      <button type="submit" className="primary" disabled={!text.trim()}>
        Сохранить
      </button>
      <button type="button" onClick={() => setEditing(null)}>
        Отмена
      </button>
    </form>
  );

  return (
    <section className="vessel-cargo">
      <h2 className="paper-group__head">
        Груз <span className="paper-group__count">· {vessel.cargo.length}</span>
      </h2>
      {vessel.cargo.length > 0 && (
        <ul className="paper-rows">
          {vessel.cargo.map((c) =>
            editing === c.id ? (
              <li key={c.id}>{form}</li>
            ) : (
              <li key={c.id}>
                <span className="paper-rows__main">
                  <MentionText text={c.text} />
                </span>
                <span className="paper-rows__sub">{c.amount}</span>
                <button type="button" className="comp-mini" onClick={() => open(c.id)}>
                  Править
                </button>
                <button
                  type="button"
                  className="comp-mini"
                  title="Убрать строку груза"
                  onClick={() => void send(() => write.del(`${path}/cargo/${c.id}`))}
                >
                  ✕
                </button>
              </li>
            )
          )}
        </ul>
      )}
      {editing === "new" ? (
        form
      ) : (
        <button type="button" className="editable-card-add" onClick={() => open("new")}>
          + Груз
        </button>
      )}
    </section>
  );
}

/** Вкладка «Чертёж»: крупный чертёж, кого можно поставить — сбоку, тянуть на пин. */
function VesselBoard({ vessel, onDropCrew }: { vessel: Vessel; onDropCrew: (postId: number, item: CrewDrag) => void }) {
  const people = useResource<VesselPeople>(vesselPaths.people(vessel.id)).data;
  const aboard = useMemo(
    () => new Set(vessel.posts.flatMap((p) => p.crew.map((c) => `${c.kind}:${c.ref_id}`))),
    [vessel.posts]
  );
  if (!vessel.blueprint_image_url) {
    return (
      <p className="muted">
        У основы нет чертежа. Загрузите его на странице судна
        {vessel.base ? (
          <>
            {" "}
            <Link to={`/compendium/${vessel.base.id}?tab=${encodeURIComponent("Чертёж")}`}>«{vessel.base.name}»</Link>
          </>
        ) : null}{" "}
        в компендиуме — посты и экипаж появятся здесь.
      </p>
    );
  }
  const free = [
    ...(people?.characters ?? []).map((c) => ({ kind: "character" as const, ...c })),
    ...(people?.beings ?? []).map((b) => ({ kind: "being" as const, sub: "", ...b })),
  ].filter((p) => !aboard.has(`${p.kind}:${p.id}`));
  return (
    <div className="vessel-board">
      <VesselCrewPlan vessel={vessel} large onDropCrew={onDropCrew} />
      <aside className="vessel-board__side">
        <h2 className="paper-group__head">Не на борту</h2>
        <p className="muted vessel-board__hint">Тяните на пин поста. Чтобы перевести — тяните имя из строки поста в «Досье».</p>
        <ul className="vessel-board__people">
          {free.map((p) => (
            <li
              key={`${p.kind}:${p.id}`}
              draggable
              onDragStart={(e) => startCrewDrag(e, { kind: p.kind, ref_id: p.id })}
              className="vessel-crew-chip"
            >
              {p.name}
              <span className="muted"> · {p.kind === "character" ? p.sub || "персонаж" : "существо"}</span>
            </li>
          ))}
          {people && free.length === 0 && <li className="muted">Все уже на борту.</li>}
        </ul>
      </aside>
    </div>
  );
}

/** «+ на пост»: персонажи кампании и существа её сеттинга, с поиском. */
function CrewPicker({
  vessel,
  post,
  onPick,
  onClose,
}: {
  vessel: Vessel;
  post: VesselPost;
  onPick: (item: CrewDrag) => void;
  onClose: () => void;
}) {
  const people = useResource<VesselPeople>(vesselPaths.people(vessel.id)).data;
  const [q, setQ] = useState("");
  const here = new Set(post.crew.map((c) => `${c.kind}:${c.ref_id}`));
  const elsewhere = new Map(
    vessel.posts.filter((p) => p.id !== post.id).flatMap((p) => p.crew.map((c) => [`${c.kind}:${c.ref_id}`, p.name] as const))
  );
  const match = (name: string) => name.toLowerCase().includes(q.trim().toLowerCase());
  const group = (title: string, kind: CrewDrag["kind"], rows: { id: number; name: string; sub?: string }[]) => {
    const list = rows.filter((r) => match(r.name) && !here.has(`${kind}:${r.id}`));
    if (list.length === 0) return null;
    return (
      <>
        <h3 className="paper-label">{title}</h3>
        <ul className="vessel-picker__list">
          {list.map((r) => {
            const from = elsewhere.get(`${kind}:${r.id}`);
            return (
              <li key={r.id}>
                <button type="button" onClick={() => onPick({ kind, ref_id: r.id })}>
                  {r.name}
                  {r.sub && <span className="muted"> · {r.sub}</span>}
                  {from && <span className="muted"> · сейчас: {from}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </>
    );
  };
  return (
    <Modal onClose={onClose} ariaLabel={`На пост: ${post.name}`}>
      <div className="vessel-picker">
        <h2>На пост «{post.name}»</h2>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по имени" />
        {!people ? (
          <p className="muted">Загрузка…</p>
        ) : (
          <>
            {group("Персонажи кампании", "character", people.characters)}
            {group("Существа сеттинга", "being", people.beings)}
          </>
        )}
      </div>
    </Modal>
  );
}
