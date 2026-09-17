import { useEffect, useState } from "react";
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
import { NavIcon } from "../NavIcons";
import { ConfirmModal } from "../ConfirmModal";
import { loadHideFinance } from "../../financePrivacy";
import { useConfirm } from "../../hooks/useConfirm";
import { PlayerCharacterCards } from "./PlayerCharacterCards";

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

  return (
    <div className="stack" style={{ paddingBottom: "calc(var(--player-bar-height, 52px) + 16px)" }}>
      {confirmDialog}
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div className="player-profile-header">
          <h1>{player.name}</h1>
          {player.notes && (
            <div className="player-profile-notes">
              <MentionText text={player.notes} />
            </div>
          )}
        </div>
        <div className="entity-header-actions">
          <button onClick={startEdit}>Редактировать</button>
          <button className="danger" onClick={() => setShowArchiveModal(true)}>
            <NavIcon name="archive" /> Архивировать
          </button>
        </div>
      </div>

      <div className="card stack">
        <div className="player-section-header">Персонажи</div>
        <PlayerCharacterCards characters={player.characters} onRemove={removeCharacter} />
        <div className="row">
          <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
            <option value="">Кампания…</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <input
            placeholder="Имя персонажа"
            value={characterName}
            onChange={(e) => setCharacterName(e.target.value)}
          />
          <button className="primary" onClick={addCharacter} disabled={!campaignId || !characterName.trim()}>
            Добавить
          </button>
        </div>
      </div>

      <div className="card stack">
        <div className="player-section-header">Доступ к игрок-клиенту</div>
        {!accountLoaded && <span className="muted">Загрузка…</span>}
        {accountLoaded && account && !accountEditing && (
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span>
              Логин: <strong>{account.username}</strong>{" "}
              {account.role === "gm" && <span className="badge held">Мастер</span>}
            </span>
            <div className="row">
              {currentUser?.isAdmin && (
                <button onClick={() => setShowRoleModal(true)}>
                  {account.role === "gm" ? "Забрать метку «Мастер»" : "Сделать мастером"}
                </button>
              )}
              <button onClick={() => setAccountEditing(true)}>Сменить логин/пароль</button>
            </div>
          </div>
        )}
        {accountLoaded && !account && !accountEditing && (
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="muted">У игрока пока нет доступа.</span>
            <button className="primary" onClick={() => setAccountEditing(true)}>
              Создать доступ
            </button>
          </div>
        )}
        {accountEditing && (
          <div className="stack">
            <div className="row">
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
          </div>
        )}
      </div>

      {/* Долг нигде не хранится — сервер считает его как «ожидалось − оплачено
          − прощено» тем же кодом, что показывает игроку его собственный
          список. Гасить и прощать отсюда нельзя намеренно: сумма принадлежит
          конкретной игре, и «погасить вообще» заставило бы приложение выбрать
          сессию за Мастера. Поэтому — ссылка в нужную сессию. */}
      {unpaid.length > 0 && !loadHideFinance() && (
        <div className="card stack">
          <div className="player-section-header">Не оплачено</div>
          {unpaid.map((u) => (
            <div key={u.session_id} className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <Link to={`/sessions/${u.session_id}`}>
                {u.campaign_name} · {u.title?.trim() || u.date}
              </Link>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }}>
                {Math.round((u.expected - u.paid - u.forgiven) * 100) / 100}
              </span>
            </div>
          ))}
        </div>
      )}

      <RemindersWidget targetType="player" targetId={playerId} />

      <div className="card stack">
        <div className="player-section-header">Группы игроков</div>
        {allGroups.length === 0 ? (
          <span className="muted">Групп пока нет — создайте их на странице списка игроков.</span>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
            {allGroups.map((g) => {
              const isIn = playerGroupIds.includes(g.id);
              return (
                <label
                  key={g.id}
                  className={`player-group-chip${isIn ? " player-group-chip--active" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={isIn}
                    onChange={() => void toggleGroup(g.id, isIn)}
                  />
                  {g.name}
                </label>
              );
            })}
          </div>
        )}
      </div>

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
            <button onClick={() => setEditing(false)} disabled={saving}>Отмена</button>
          </div>
        </div>
      )}

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
    </div>
  );
}
