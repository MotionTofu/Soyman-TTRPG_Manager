import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import { MentionTextarea } from "../components/mentions/MentionTextarea";
import { MentionText } from "../components/mentions/MentionText";
import { syncMentionLinks } from "../mentions";
import { useImageCrop } from "../hooks/useImageCrop";
import { IMAGE_ACCEPT, IMAGE_HINT } from "../imageUpload";
import { RemindersWidget } from "../components/RemindersWidget";
import { useCurrentUser } from "../api/currentUser";
import type { Campaign, PlayerDetail } from "../types";

export function PlayerDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user: currentUser } = useCurrentUser();
  const [player, setPlayer] = useState<PlayerDetail | null>(null);
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
  }
  useEffect(() => {
    refresh();
    refreshAccount();
    api.get<Campaign[]>("/campaigns").then(setCampaigns);
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
    if (!confirm("Отправить персонажа в архив?")) return;
    await api.del(`/characters/${characterId}`);
    refresh();
  }

  async function saveEdit() {
    if (!nameDraft.trim() || !player) return;
    await api.put(`/players/${id}`, { name: nameDraft, notes: notesDraft });
    syncMentionLinks("player", Number(id), player.notes, notesDraft);
    setEditing(false);
    refresh();
  }

  async function archivePlayer() {
    if (!confirm("Отправить игрока в архив?")) return;
    await api.del(`/players/${id}`);
    navigate("/players");
  }

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div className="row" style={{ alignItems: "flex-start" }}>
          <label className="avatar-upload-label" title={IMAGE_HINT}>
            {player.avatar_image_url ? (
              <img src={player.avatar_image_url} alt="" className="player-avatar" />
            ) : (
              <div className="player-avatar roster-avatar-placeholder" />
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
          <div>
            <h1>{player.name}</h1>
            {player.notes && (
              <div className="muted">
                <MentionText text={player.notes} />
              </div>
            )}
          </div>
        </div>
        <div className="entity-header-actions">
          <button onClick={() => setEditing(true)}>Редактировать</button>
          <button className="danger" onClick={archivePlayer}>
            Архивировать
          </button>
        </div>
      </div>

      <div className="card stack">
        <h3>Доступ к игрок-клиенту</h3>
        {!accountLoaded && <span className="muted">Загрузка…</span>}
        {accountLoaded && account && !accountEditing && (
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span>
              Логин: <strong>{account.username}</strong>{" "}
              {account.role === "gm" && <span className="badge held">Мастер</span>}
            </span>
            <div className="row">
              {currentUser?.isAdmin && (
                <button onClick={toggleAccountRole}>
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

      <RemindersWidget targetType="player" targetId={Number(id)} />

      <div className="card stack">
        <h3>Персонажи (Игрок | Персонаж)</h3>
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
                      <img src={c.avatar_image_url} alt="" className="roster-avatar" />
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
          <button className="primary" onClick={addCharacter}>
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
            <button className="primary" onClick={saveEdit}>
              Сохранить
            </button>
            <button onClick={() => setEditing(false)}>Отмена</button>
          </div>
        </div>
      )}
    </div>
  );
}
