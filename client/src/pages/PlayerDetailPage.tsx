import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import { MentionTextarea } from "../components/mentions/MentionTextarea";
import { MentionText } from "../components/mentions/MentionText";
import { syncMentionLinks } from "../mentions";
import { useImageCrop } from "../hooks/useImageCrop";
import { IMAGE_ACCEPT, IMAGE_HINT } from "../imageUpload";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { RemindersWidget } from "../components/RemindersWidget";
import { useCurrentUser } from "../api/currentUser";
import type { Campaign, PlayerDetail, PlayerGroup, UnpaidSession } from "../types";
import { NavIcon } from "../components/NavIcons";
import { ConfirmModal } from "../components/ConfirmModal";
import { loadHideFinance } from "../financePrivacy";
import { useConfirm } from "../hooks/useConfirm";

export function PlayerDetailPage() {
  const [confirmDialog, confirm] = useConfirm();
  const { id } = useParams();
  const navigate = useNavigate();
  const { user: currentUser } = useCurrentUser();
  const [player, setPlayer] = useState<PlayerDetail | null>(null);
  const [unpaid, setUnpaid] = useState<UnpaidSession[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState("");
  const [characterName, setCharacterName] = useState("");
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [notesDraft, setNotesDraft] = useState("");
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const avatarCrop = useImageCrop("square", handleAvatarChange);
  const [account, setAccount] = useState<{ id: number; username: string; role: "gm" | "player" } | null>(null);
  const [accountLoaded, setAccountLoaded] = useState(false);
  const [loginDraft, setLoginDraft] = useState("");
  const [passwordDraft, setPasswordDraft] = useState("");
  const [accountEditing, setAccountEditing] = useState(false);
  const [accountError, setAccountError] = useState("");
  const [allGroups, setAllGroups] = useState<PlayerGroup[]>([]);
  const [playerGroupIds, setPlayerGroupIds] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [showRoleModal, setShowRoleModal] = useState(false);

  function refreshAccount() {
    api
      .get<{ id: number; username: string; role: "gm" | "player"; player_id: number }[]>("/auth/players")
      .then((rows) => {
        const mine = rows.find((r) => r.player_id === Number(id));
        setAccount(mine ? { id: mine.id, username: mine.username, role: mine.role } : null);
        setAccountLoaded(true);
      })
      .catch(() => setAccountLoaded(true));
  }

  async function toggleAccountRole() {
    if (!account) return;
    setShowRoleModal(false);
    const nextRole = account.role === "gm" ? "player" : "gm";
    await api.put(`/auth/players/${id}/role`, { role: nextRole });
    refreshAccount();
  }

  async function createAccount() {
    setAccountError("");
    if (!loginDraft.trim() || !passwordDraft) return;
    try {
      await api.post("/auth/players", { username: loginDraft.trim(), password: passwordDraft, player_id: Number(id) });
      setLoginDraft("");
      setPasswordDraft("");
      setAccountEditing(false);
      refreshAccount();
    } catch (err) {
      setAccountError(err instanceof Error ? err.message : String(err));
    }
  }

  async function saveAccountEdit() {
    setAccountError("");
    try {
      await api.put(`/auth/players/${id}/password`, {
        username: loginDraft.trim() || undefined,
        password: passwordDraft || undefined,
      });
      setLoginDraft("");
      setPasswordDraft("");
      setAccountEditing(false);
      refreshAccount();
    } catch (err) {
      setAccountError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleAvatarChange(file: File | null) {
    if (!file) return;
    setUploadingAvatar(true);
    const form = new FormData();
    form.append("file", file);
    await api.post(`/players/${id}/avatar`, form);
    setUploadingAvatar(false);
    refresh();
  }

  function refresh() {
    api.get<PlayerDetail>(`/players/${id}`).then((p) => {
      setPlayer(p);
      setNameDraft(p.name);
      setNotesDraft(p.notes);
    });
    api.get<UnpaidSession[]>(`/players/${id}/unpaid`).then(setUnpaid).catch(() => setUnpaid([]));
  }
  useEffect(() => {
    refresh();
    refreshAccount();
    api.get<Campaign[]>("/campaigns").then(setCampaigns);
    api.get<PlayerGroup[]>("/player-groups").then(setAllGroups);
    api.get<PlayerGroup[]>(`/player-groups/by-player/${id}`).then((groups) => {
      setPlayerGroupIds(groups.map((g) => g.id));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!player) return <p className="muted">Загрузка…</p>;

  async function addCharacter() {
    if (!campaignId || !characterName.trim()) return;
    await api.post("/characters", {
      player_id: Number(id),
      campaign_id: Number(campaignId),
      character_name: characterName,
    });
    setCharacterName("");
    refresh();
  }

  async function removeCharacter(characterId: number) {
    if (!(await confirm({ message: "Отправить персонажа в архив?", confirmLabel: "Архивировать", danger: true })))
      return;
    await api.del(`/characters/${characterId}`);
    refresh();
  }

  async function saveEdit() {
    if (!nameDraft.trim() || !player) return;
    setSaving(true);
    try {
      await api.put(`/players/${id}`, { name: nameDraft, notes: notesDraft });
      syncMentionLinks("player", Number(id), player.notes, notesDraft);
      setEditing(false);
      refresh();
    } finally {
      setSaving(false);
    }
  }

  async function archivePlayer() {
    setShowArchiveModal(false);
    await api.del(`/players/${id}`);
    navigate("/players");
  }

  return (
    <div className="stack" style={{ paddingBottom: "calc(var(--player-bar-height, 52px) + 16px)" }}>
      {confirmDialog}
      <Breadcrumbs items={[{ label: "Игроки", to: "/players" }, { label: player.name }]} />
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div className="row" style={{ alignItems: "flex-start" }}>
          <label className="avatar-upload-label" title={IMAGE_HINT}>
            {player.avatar_image_url ? (
              <img src={player.avatar_image_url} alt={`Аватар ${player.name}`} className="player-avatar" />
            ) : (
              <div className="player-avatar player-avatar-placeholder" />
            )}
            <span className="avatar-upload-hint">{uploadingAvatar ? "Загрузка…" : "Сменить фото"}</span>
            <input
              type="file"
              accept={IMAGE_ACCEPT}
              style={{ display: "none" }}
              onChange={(e) => avatarCrop.onSelect(e.target.files?.[0] ?? null)}
            />
          </label>
          {avatarCrop.modal}
          <div className="player-profile-header">
            <h1>{player.name}</h1>
            {player.notes && (
              <div className="player-profile-notes">
                <MentionText text={player.notes} />
              </div>
            )}
          </div>
        </div>
        <div className="entity-header-actions">
          <button onClick={() => setEditing(true)}>Редактировать</button>
          <button className="danger" onClick={() => setShowArchiveModal(true)}>
            <NavIcon name="archive" /> Архивировать
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

      <RemindersWidget targetType="player" targetId={Number(id)} />

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
                    onChange={() => {
                      setPlayerGroupIds((prev) =>
                        isIn ? prev.filter((gid) => gid !== g.id) : [...prev, g.id]
                      );
                      if (isIn) {
                        api.del(`/player-groups/${g.id}/members?playerIds=${Number(id)}`).catch(() => {
                          setPlayerGroupIds((prev) => isIn ? [...prev, g.id] : prev.filter((gid) => gid !== g.id));
                        });
                      } else {
                        api.post(`/player-groups/${g.id}/members`, { playerIds: [Number(id)] }).catch(() => {
                          setPlayerGroupIds((prev) => isIn ? [...prev, g.id] : prev.filter((gid) => gid !== g.id));
                        });
                      }
                    }}
                  />
                  {g.name}
                </label>
              );
            })}
          </div>
        )}
      </div>

      <div className="card stack">
        <div className="player-section-header">Персонажи</div>
        <table>
          <thead>
            <tr>
              <th>Аватар</th>
              <th>Персонаж</th>
              <th>Кампания</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {player.characters.map((c) => (
              <tr key={c.id}>
                <td>
                  {c.avatar_image_url ? (
                    <Link to={`/characters/${c.id}`}>
                      <img src={c.avatar_image_url} alt={`Аватар ${c.character_name}`} className="roster-avatar" />
                    </Link>
                  ) : (
                    <div className="roster-avatar roster-avatar-placeholder" />
                  )}
                </td>
                <td>
                  <Link to={`/characters/${c.id}`}>{c.character_name}</Link>
                </td>
                <td>
                  {c.campaign_id ? (
                    <Link to={`/campaigns/${c.campaign_id}`}>{c.campaign_name}</Link>
                  ) : (
                    <span className="muted">без кампании</span>
                  )}
                </td>
                <td>
                  <button onClick={() => removeCharacter(c.id)}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
