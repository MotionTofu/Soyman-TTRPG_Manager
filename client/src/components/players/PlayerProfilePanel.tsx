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
import { PlayerCharacterCards } from "./PlayerCharacterCards";
import { EntityPage } from "../EntityPage";
import { EditableTextCard } from "../EditableTextCard";
import { useImageCrop } from "../../hooks/useImageCrop";
import { useIsMobile } from "../../hooks/useIsMobile";
import { PlayerPortrait } from "./PlayerPortrait";
import "../../pages/players-d.css";
import { plural } from "../../sceneKinds";
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

/** Самостоятельное досье игрока, принятые Players-Profile (2026-11-03). */
export function PlayerProfilePanel({ playerId }: { playerId: number }) {
  const mobile = useIsMobile();
  const [addingCharacter, setAddingCharacter] = useState(false);
  const [creatingCharacter, setCreatingCharacter] = useState(false);
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
    if (!campaignId || !characterName.trim() || creatingCharacter) return;
    setCreatingCharacter(true);
    try {
      const created = await run(labelled("Новый персонаж", () =>
        write.post("/characters", { player_id: playerId, campaign_id: Number(campaignId), character_name: characterName.trim() }).then(() => true)
      ), { affects: playerCharacterAffects(playerId), retry: false });
      if (created) { setCharacterName(""); setCampaignId(""); setAddingCharacter(false); }
    } finally { setCreatingCharacter(false); }
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
      titleAbove
      actions={[
        { label: "Править имя и заметки", onClick: startEdit },
        { label: "Архивировать", danger: true, onClick: () => setShowArchiveModal(true) },
      ]}
    >
      <div className="dossier player-profile">
        <aside className="dossier__aside">
          <label className="dossier__portrait" title="Сменить портрет">
            <PlayerPortrait url={portrait} name={player.name} />
            <span className="dossier__portrait-hint">Сменить портрет</span>
            <input type="file" hidden accept={IMAGE_ACCEPT} onChange={(e) => thumbnailCrop.onSelect(e.target.files?.[0] ?? null)} />
          </label>
          {thumbnailCrop.modal}
          <div className="player-profile__identity"><span className="d-note">Игрок{account?.role === "gm" ? " · Мастер" : ""}</span><h2>{player.name}</h2></div>
          <details className="player-profile__passport" open={!mobile}>
            <summary>Доступ и группы <span className="d-note">{account ? `Учётка ${account.username}` : "Нет доступа"} · {playerGroupIds.length} {plural(playerGroupIds.length, "группа", "группы", "групп")}</span></summary>
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
                    autoComplete="new-password"
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
          </details>
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

          <section className="player-profile__interest"><EditableTextCard
            key={`interest-${playerId}`}
            title="Чем увлечён"
            editLabel="Править"
            value={player.interest ?? ""}
            onSave={saveInterest}
            rows={3}
            emptyLabel="что игрок любит за столом"
          /></section>

          <section className="paper-list-group player-profile__characters d-focal" aria-label="Персонажи игрока">
            <header className="player-profile__character-head">
              <h2 className="d-plate">Персонажи <span className="d-note">{player.characters.length}</span></h2>
              {!addingCharacter && <button type="button" className="d-btn d-btn--primary" onClick={() => setAddingCharacter(true)}>+ Персонаж</button>}
            </header>
            <PlayerCharacterCards characters={player.characters} />
            {addingCharacter && <form className="player-profile__add" onSubmit={(event) => { event.preventDefault(); void addCharacter(); }}>
              <h3>Новый персонаж</h3>
              <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} aria-label="Кампания">
                <option value="">Кампания…</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <input autoFocus aria-label="Имя персонажа" placeholder="Имя персонажа" value={characterName} onChange={(e) => setCharacterName(e.target.value)} />
              <div className="row">
                <button type="button" disabled={creatingCharacter} onClick={() => setAddingCharacter(false)}>Отмена</button>
                <button type="submit" className="d-btn d-btn--primary" disabled={creatingCharacter || !campaignId || !characterName.trim()}>{creatingCharacter ? "Создание…" : "Создать персонажа"}</button>
              </div>
            </form>}
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
          message={`Архивировать игрока «${player.name}»? Его персонажи и доступ к приложению сохранятся.`}
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
