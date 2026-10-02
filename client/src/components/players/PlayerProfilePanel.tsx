import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { labelled } from "../../data/notices";
import { useAction, useAfterWrite, useEntity, useResource, write } from "../../data/hooks";
import type { Affect } from "../../data/entities";
import { LoadErrorCard } from "../Loadable";
import { MentionTextarea } from "../mentions/MentionTextarea";
import { MentionText } from "../mentions/MentionText";
import { syncMentionLinks } from "../../mentions";
import { RemindersWidget } from "../RemindersWidget";
import { useCurrentUser } from "../../api/currentUser";
import type { Campaign, PlayerDetail, PlayerGroup, UnpaidSession } from "../../types";
import { ConfirmModal } from "../ConfirmModal";
import { loadHideFinance } from "../../financePrivacy";
import { useConfirm } from "../../hooks/useConfirm";
import { PlayerCharacterCards } from "./PlayerCharacterCards";
import { EntityPage } from "../EntityPage";
import { EditableTextCard } from "../EditableTextCard";
import { useImageCrop } from "../../hooks/useImageCrop";
import { IMAGE_ACCEPT } from "../../imageUpload";

const NO_UNPAID: UnpaidSession[] = [];
const NO_CAMPAIGNS: Campaign[] = [];
const NO_GROUPS: PlayerGroup[] = [];

interface PlayerAccount {
  id: number;
  username: string;
  role: "gm" | "player";
  player_id: number;
}

/** Правка полей игрока: его карточка и списки, составы кампаний и списки персонажей (там его имя). */
function playerFieldsAffects(playerId: number): Affect[] {
  return [{ kind: "player", id: playerId, card: true }, { kind: "campaign", card: true }, { kind: "character", card: true }];
}

/** Персонаж добавлен или убран из профиля: персонажи игрока и списки персонажей кампаний. */
function playerCharacterAffects(playerId: number): Affect[] {
  return [{ kind: "player", id: playerId, card: true }, { kind: "character" }];
}

const ACCOUNTS_PATH = "/auth/players";

/**
 * Профиль игрока для правой колонки раздела «Игроки» (и для прямого маршрута
 * /players/:id — тот рендерит тот же workspace). Первым блоком идут персонажи
 * игрока, дальше — остальное (доступ, долги, напоминания, группы).
 */
export function PlayerProfilePanel({ playerId }: { playerId: number }) {
  const [confirmDialog, confirm] = useConfirm();
  const navigate = useNavigate();
  const thumbnailCrop = useImageCrop("thumbnail", (file) => void uploadThumbnailRef.current(file));
  const uploadThumbnailRef = useRef<(file: File | null) => Promise<void>>(async () => {});
  const run = useAction();
  const afterWrite = useAfterWrite();
  const { user: currentUser } = useCurrentUser();
  const playerState = useEntity<PlayerDetail>("player", playerId);
  const player = playerState.data ?? null;
  // Долги не грузятся — блок просто не показывается, как и раньше.
  const unpaid = useResource<UnpaidSession[]>(`/players/${playerId}/unpaid`).data ?? NO_UNPAID;
  const campaigns = useResource<Campaign[]>("/campaigns").data ?? NO_CAMPAIGNS;
  const accounts = useResource<PlayerAccount[]>(ACCOUNTS_PATH);
  const mine = accounts.data?.find((r) => r.player_id === playerId);
  const account = mine ? { id: mine.id, username: mine.username, role: mine.role } : null;
  const accountLoaded = !accounts.loading;
  const allGroups = useResource<PlayerGroup[]>("/player-groups").data ?? NO_GROUPS;
  const groupsOf = useResource<PlayerGroup[]>(`/player-groups/by-player/${playerId}`).data;
  // Отметки групп держатся здесь, чтобы галочка менялась сразу, а не после ответа.
  const [playerGroupIds, setPlayerGroupIds] = useState<number[]>([]);
  useEffect(() => {
    if (groupsOf) setPlayerGroupIds(groupsOf.map((g) => g.id));
  }, [groupsOf]);
  const [campaignId, setCampaignId] = useState("");
  const [characterName, setCharacterName] = useState("");
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [notesDraft, setNotesDraft] = useState("");
  const [loginDraft, setLoginDraft] = useState("");
  const [passwordDraft, setPasswordDraft] = useState("");
  const [accountEditing, setAccountEditing] = useState(false);
  const [accountError, setAccountError] = useState("");
  const [saving, setSaving] = useState(false);
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [showRoleModal, setShowRoleModal] = useState(false);

  async function toggleAccountRole() {
    if (!account) return;
    setShowRoleModal(false);
    const nextRole = account.role === "gm" ? "player" : "gm";
    await run(labelled("Метка «Мастер»", () => write.put(`/auth/players/${playerId}/role`, { role: nextRole })), {
      affects: [{ path: ACCOUNTS_PATH }],
    });
  }

  // Логин и пароль: ошибка — в форме рядом с набранным, без «Повторить»
  // (повтор держал бы пароль в плашке).
  async function createAccount() {
    setAccountError("");
    if (!loginDraft.trim() || !passwordDraft) return;
    try {
      await write.post(ACCOUNTS_PATH, { username: loginDraft.trim(), password: passwordDraft, player_id: playerId });
      afterWrite([{ path: ACCOUNTS_PATH }]);
      setLoginDraft("");
      setPasswordDraft("");
      setAccountEditing(false);
    } catch (err) {
      setAccountError(err instanceof Error ? err.message : String(err));
    }
  }

  async function saveAccountEdit() {
    setAccountError("");
    try {
      await write.put(`/auth/players/${playerId}/password`, {
        username: loginDraft.trim() || undefined,
        password: passwordDraft || undefined,
      });
      afterWrite([{ path: ACCOUNTS_PATH }]);
      setLoginDraft("");
      setPasswordDraft("");
      setAccountEditing(false);
    } catch (err) {
      setAccountError(err instanceof Error ? err.message : String(err));
    }
  }

  if (playerState.error && !player) {
    return <LoadErrorCard message={<>Не удалось загрузить игрока: {playerState.error}</>} onRetry={playerState.reload} />;
  }
  if (!player) return <p className="muted">Загрузка…</p>;

  function startEdit() {
    if (!player) return;
    setNameDraft(player.name);
    setNotesDraft(player.notes);
    setEditing(true);
  }

  async function addCharacter() {
    if (!campaignId || !characterName.trim()) return;
    const created = await run(
      labelled("Новый персонаж", () =>
        write
          .post("/characters", { player_id: playerId, campaign_id: Number(campaignId), character_name: characterName })
          .then(() => true)
      ),
      { affects: playerCharacterAffects(playerId), retry: false }
    );
    if (created) setCharacterName("");
  }

  async function removeCharacter(characterId: number) {
    if (!(await confirm({ message: "Отправить персонажа в архив?", confirmLabel: "Архивировать", danger: true })))
      return;
    await run(labelled("Персонаж не архивирован", () => write.del(`/characters/${characterId}`)), {
      affects: [...playerCharacterAffects(playerId), { path: "/archive" }],
    });
  }

  async function saveEdit() {
    if (!nameDraft.trim() || !player) return;
    const before = player.notes;
    const notes = notesDraft;
    setSaving(true);
    try {
      const saved = await run(
        labelled("Игрок", () => write.put(`/players/${playerId}`, { name: nameDraft, notes }).then(() => true)),
        { affects: playerFieldsAffects(playerId) }
      );
      if (!saved) return;
      syncMentionLinks("player", playerId, before, notes);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  async function archivePlayer() {
    setShowArchiveModal(false);
    const done = await run(labelled("Игрок не архивирован", () => write.del(`/players/${playerId}`).then(() => true)), {
      affects: [{ kind: "player" }, { kind: "campaign", card: true }, { kind: "character", card: true }, { path: "/archive" }],
    });
    if (done) navigate("/players");
  }

  async function toggleGroup(groupId: number, isIn: boolean) {
    setPlayerGroupIds((prev) => (isIn ? prev.filter((gid) => gid !== groupId) : [...prev, groupId]));
    const done = await run(
      labelled(isIn ? "Игрок не убран из группы" : "Игрок не добавлен в группу", () =>
        (isIn
          ? write.del(`/player-groups/${groupId}/members?playerIds=${playerId}`)
          : write.post(`/player-groups/${groupId}/members`, { playerIds: [playerId] })
        ).then(() => true)
      ),
      { affects: [{ path: "/player-groups" }] }
    );
    if (!done) setPlayerGroupIds((prev) => (isIn ? [...prev, groupId] : prev.filter((gid) => gid !== groupId)));
  }

  async function saveInterest(interest: string) {
    const done = await run(labelled("Чем увлечён", () => write.put(`/players/${playerId}`, { interest }).then(() => true)), {
      affects: playerFieldsAffects(playerId),
    });
    if (!done) throw new Error("Не сохранилось");
  }

  // Портрет: обложка игрока — та же, что на плитке списка; правится щелчком
  // (раньше — значком на карточке состава кампании).
  uploadThumbnailRef.current = uploadThumbnail;
  async function uploadThumbnail(file: File | null) {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    await run(labelled("Портрет игрока", () => write.post(`/players/${playerId}/thumbnail`, form, { timeoutMs: 120_000 })), {
      affects: playerFieldsAffects(playerId),
    });
  }

  // Долг по кампаниям: строка на кампанию, ссылки — на сессии с недоплатой.
  const debtByCampaign = new Map<number, { name: string; owed: number; sessions: UnpaidSession[] }>();
  for (const u of unpaid) {
    const row = debtByCampaign.get(u.campaign_id) ?? { name: u.campaign_name, owed: 0, sessions: [] };
    row.owed += u.expected - u.paid - u.forgiven;
    row.sessions.push(u);
    debtByCampaign.set(u.campaign_id, row);
  }
  const portrait = player.thumbnail_image_url ?? player.avatar_image_url;

  return (
    <EntityPage
      crumbs={[{ label: "Игроки", to: "/players" }, { label: player.name }]}
      entityType="player"
      title={player.name}
      paper
      meta={
        <span className="paper-ident-tags">
          <span className="badge tag">Игрок</span>
          {account?.role === "gm" && <span className="badge tag">Мастер</span>}
        </span>
      }
      actions={[
        { label: "Править имя и заметки", onClick: startEdit },
        { label: "Архивировать", danger: true, onClick: () => setShowArchiveModal(true) },
      ]}
      overlays={confirmDialog}
    >
      {/* Профиль игрока на бумаге (спека campaign-paper, Q47; доска 48):
          одно досье без вкладок. */}
      <div className="dossier player-profile">
        <aside className="dossier__aside">
          <label className="dossier__portrait" title="Сменить портрет">
            {portrait ? <img src={portrait} alt={`Портрет: ${player.name}`} /> : <span className="dossier__portrait-empty">Портрет</span>}
            <span className="dossier__portrait-hint">Сменить портрет</span>
            <input type="file" hidden accept={IMAGE_ACCEPT} onChange={(e) => thumbnailCrop.onSelect(e.target.files?.[0] ?? null)} />
          </label>
          {thumbnailCrop.modal}
          <dl className="paper-facts">
            <div>
              <dt className="paper-label">Доступ к клиенту</dt>
              <dd>
                {!accountLoaded ? (
                  "…"
                ) : account ? (
                  <>
                    учётка <strong>{account.username}</strong>
                  </>
                ) : (
                  <span className="muted">нет доступа</span>
                )}
              </dd>
              <dd className="player-profile__account">
                {accountLoaded && !accountEditing && (
                  <button type="button" className="paper-more" onClick={() => setAccountEditing(true)}>
                    {account ? "сменить логин или пароль ›" : "создать доступ ›"}
                  </button>
                )}
                {accountLoaded && account && !accountEditing && currentUser?.isAdmin && (
                  <button type="button" className="paper-more" onClick={() => setShowRoleModal(true)}>
                    {account.role === "gm" ? "забрать метку «Мастер» ›" : "сделать мастером ›"}
                  </button>
                )}
              </dd>
              {accountEditing && (
                <dd className="stack">
                  <input
                    placeholder={account ? "Новый логин (необязательно)" : "Логин"}
                    value={loginDraft}
                    onChange={(e) => setLoginDraft(e.target.value)}
                  />
                  <input
                    type="password"
                    placeholder={account ? "Новый пароль (необязательно)" : "Пароль"}
                    value={passwordDraft}
                    onChange={(e) => setPasswordDraft(e.target.value)}
                    autoComplete={account ? "current-password" : "new-password"}
                  />
                  <div className="row">
                    <button className="primary" onClick={account ? saveAccountEdit : createAccount}>
                      Сохранить
                    </button>
                    <button
                      onClick={() => {
                        setAccountEditing(false);
                        setLoginDraft("");
                        setPasswordDraft("");
                        setAccountError("");
                      }}
                    >
                      Отмена
                    </button>
                  </div>
                  {accountError && <p className="error">{accountError}</p>}
                </dd>
              )}
            </div>
            <div>
              <dt className="paper-label">Группы</dt>
              <dd className="player-profile__groups">
                {allGroups.length === 0 ? (
                  <span className="muted">групп пока нет</span>
                ) : (
                  allGroups.map((g) => {
                    const isIn = playerGroupIds.includes(g.id);
                    return (
                      <label key={g.id} className={`player-group-chip${isIn ? " player-group-chip--active" : ""}`}>
                        <input type="checkbox" checked={isIn} onChange={() => void toggleGroup(g.id, isIn)} />
                        {g.name}
                      </label>
                    );
                  })
                )}
              </dd>
            </div>
          </dl>
        </aside>

        <div className="dossier__main">
          {editing && (
            <div className="card stack">
              <label>
                Имя
                <input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} />
              </label>
              <label>
                Заметки
                <MentionTextarea value={notesDraft} onChange={setNotesDraft} />
              </label>
              <div className="row">
                <button className="primary" onClick={saveEdit} disabled={saving}>
                  {saving ? "Сохранение…" : "Сохранить"}
                </button>
                <button onClick={() => setEditing(false)} disabled={saving}>
                  Отмена
                </button>
              </div>
            </div>
          )}

          <EditableTextCard
            key={`interest-${playerId}`}
            title="Чем увлечён"
            help="Что игрок любит за столом и чего ждёт от игры — к этому цепляют крючки."
            value={player.interest ?? ""}
            onSave={saveInterest}
            rows={3}
            emptyLabel="что игрок любит за столом"
          />

          <section className="paper-list-group">
            <h2 className="paper-group__head">
              Персонажи <span className="paper-group__count">· {player.characters.length}</span>
            </h2>
            <PlayerCharacterCards characters={player.characters} onRemove={removeCharacter} />
            <div className="row player-profile__add">
              <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} aria-label="Кампания">
                <option value="">Кампания…</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <input placeholder="Имя персонажа" value={characterName} onChange={(e) => setCharacterName(e.target.value)} />
              <button onClick={addCharacter} disabled={!campaignId || !characterName.trim()}>
                + Персонаж
              </button>
            </div>
          </section>

          {/* Долг нигде не хранится — сервер считает его как «ожидалось −
              оплачено − прощено». Гасить отсюда нельзя намеренно: сумма
              принадлежит конкретной игре — поэтому ссылки в сессии. */}
          {debtByCampaign.size > 0 && !loadHideFinance() && (
            <section className="paper-list-group">
              <h2 className="paper-group__head">
                Долг <span className="paper-group__count">· {debtByCampaign.size}</span>
              </h2>
              <ul className="paper-rows">
                {[...debtByCampaign.entries()].map(([id, d]) => (
                  <li key={id}>
                    <span className="paper-rows__main">
                      <Link to={`/campaigns/${id}`}>{d.name}</Link>
                      <span className="player-profile__debt-sessions">
                        {d.sessions.map((u, i) => (
                          <span key={u.session_id}>
                            {i > 0 && ", "}
                            <Link to={`/sessions/${u.session_id}`}>{u.title?.trim() || u.date}</Link>
                          </span>
                        ))}
                      </span>
                    </span>
                    <span className="paper-rows__sub">
                      {Math.round(d.owed * 100) / 100} · {d.sessions.length}{" "}
                      {d.sessions.length === 1 ? "игра" : d.sessions.length < 5 ? "игры" : "игр"}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <details className="paper-fold">
            <summary>Напоминания</summary>
            <div className="paper-fold__body">
              <RemindersWidget targetType="player" targetId={playerId} />
            </div>
          </details>
          <details className="paper-fold" open={!!player.notes || undefined}>
            <summary>Заметки</summary>
            <div className="paper-fold__body">
              {player.notes ? <MentionText text={player.notes} /> : <span className="muted">Заметок нет.</span>}{" "}
              <button type="button" className="paper-more" onClick={startEdit}>
                править ›
              </button>
            </div>
          </details>
        </div>
      </div>

      {showArchiveModal && (
        <ConfirmModal
          title="Архивировать игрока?"
          message={`Это архивирует ${player.name} и его ${player.characters.length} персонаж${player.characters.length === 1 ? "а" : "ей"}. Игрок потеряет доступ к приложению.`}
          confirmLabel="Архивировать"
          cancelLabel="Отмена"
          danger
          onClose={() => setShowArchiveModal(false)}
          onConfirm={archivePlayer}
        />
      )}

      {showRoleModal && account && (
        <ConfirmModal
          title={account.role === "gm" ? "Забрать метку Мастер?" : "Сделать мастером?"}
          message={
            account.role === "gm"
              ? `${player.name} потеряет доступ к пульту сессий и редактированию кампаний.`
              : `${player.name} сможет готовить и вести сессии.`
          }
          confirmLabel={account.role === "gm" ? "Забрать метку" : "Сделать мастером"}
          cancelLabel="Отмена"
          danger={account.role === "gm"}
          onClose={() => setShowRoleModal(false)}
          onConfirm={toggleAccountRole}
        />
      )}
    </EntityPage>
  );
}
