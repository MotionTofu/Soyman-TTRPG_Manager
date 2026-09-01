import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useCurrentUser } from "../api/currentUser";
import { useImageCrop } from "../hooks/useImageCrop";
import { IMAGE_ACCEPT, IMAGE_HINT } from "../imageUpload";
import { Breadcrumbs } from "../components/Breadcrumbs";
import type { Player } from "../types";

interface MyCharacter {
  id: number;
  character_name: string;
  campaign_id: number | null;
  campaign_name: string | null;
}

interface PlayerMe {
  player: { id: number; name: string } | null;
  characters: MyCharacter[];
}

// The player's self-service "Кабинет" — editing their own account (display
// name, avatar, login password), as opposed to /players/:id which is the
// GM-only roster page. Scoped server-side to the caller's own playerId (see
// playerAccess.ts) and own user row (PUT /auth/me), never another player's.
//
// Also hosts the player's character list (formerly the standalone
// /my-characters page, folded in here by ticket 13 to free up a mobile
// bottom-nav slot) — sourced from the same player-scoped /player/me endpoint.
export function PlayerCabinetPage() {
  const { user } = useCurrentUser();
  const [player, setPlayer] = useState<Player | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [nameSaving, setNameSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [me, setMe] = useState<PlayerMe | null>(null);
  const [charactersError, setCharactersError] = useState("");

  useEffect(() => {
    const ac = new AbortController();
    api
      .get<PlayerMe>("/player/me", { signal: ac.signal })
      .then(setMe)
      .catch((e) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setCharactersError(String(e));
      });
    return () => ac.abort();
  }, []);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordDone, setPasswordDone] = useState(false);

  function refresh() {
    if (!user?.playerId) return;
    api.get<Player>(`/players/${user.playerId}`).then((p) => {
      setPlayer(p);
      setNameDraft(p.name);
    });
  }
  useEffect(refresh, [user?.playerId]);

  async function handleAvatarChange(file: File | null) {
    if (!file || !user?.playerId) return;
    setUploadingAvatar(true);
    const form = new FormData();
    form.append("file", file);
    await api.post(`/players/${user.playerId}/avatar`, form);
    setUploadingAvatar(false);
    refresh();
  }
  const avatarCrop = useImageCrop("square", handleAvatarChange);

  async function saveName() {
    if (!nameDraft.trim() || !user?.playerId) return;
    setNameSaving(true);
    try {
      await api.put(`/players/${user.playerId}`, { name: nameDraft });
      setEditingName(false);
      refresh();
    } finally {
      setNameSaving(false);
    }
  }

  async function changePassword() {
    setPasswordError("");
    setPasswordDone(false);
    if (!currentPassword) {
      setPasswordError("Введите текущий пароль.");
      return;
    }
    if (!newPassword) {
      setPasswordError("Введите новый пароль.");
      return;
    }
    if (newPassword.length < 6) {
      setPasswordError("Пароль должен быть не менее 6 символов.");
      return;
    }
    if (newPassword !== newPasswordConfirm) {
      setPasswordError("Пароли не совпадают.");
      return;
    }
    setPasswordSaving(true);
    try {
      await api.put("/auth/me", { currentPassword, password: newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setNewPasswordConfirm("");
      setPasswordDone(true);
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : String(err));
    } finally {
      setPasswordSaving(false);
    }
  }

  if (!player) return <p className="muted">Загрузка…</p>;

  return (
    <div className="stack">
      <Breadcrumbs items={[{ label: "Главная", to: "/" }, { label: "Кабинет" }]} />
      <h1>Кабинет</h1>

      <div className="card row" style={{ alignItems: "flex-start", gap: 16 }}>
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
        <div className="stack" style={{ flex: 1 }}>
          <span className="muted">Имя</span>
          {editingName ? (
            <div className="row">
              <input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} />
              <button className="primary" onClick={saveName} disabled={nameSaving}>
                {nameSaving ? "Сохранение…" : "Сохранить"}
              </button>
              <button
                onClick={() => {
                  setEditingName(false);
                  setNameDraft(player.name);
                }}
                disabled={nameSaving}
              >
                Отмена
              </button>
            </div>
          ) : (
            <div className="row">
              <h2 style={{ margin: 0 }}>{player.name}</h2>
              <button onClick={() => setEditingName(true)}>Редактировать</button>
            </div>
          )}
        </div>
      </div>

      <div className="card stack player-cabinet-password">
        <strong>Смена пароля</strong>
        <span className="muted">Логин: {user?.username}</span>
        <input
          type="password"
          placeholder="Текущий пароль"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          autoComplete="current-password"
        />
        <input
          type="password"
          placeholder="Новый пароль"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
        />
        <input
          type="password"
          placeholder="Повторите новый пароль"
          value={newPasswordConfirm}
          onChange={(e) => setNewPasswordConfirm(e.target.value)}
          autoComplete="new-password"
        />
        {passwordError && <p className="error">{passwordError}</p>}
        {passwordDone && <span className="muted">Пароль обновлён.</span>}
        <button className="primary" onClick={changePassword} disabled={passwordSaving}>
          {passwordSaving ? "Сохранение…" : "Сменить пароль"}
        </button>
      </div>

      <div className="card stack">
        <strong>Персонажи</strong>
        {charactersError && <p className="error">Не удалось загрузить персонажей: {charactersError}</p>}
        {!charactersError && !me && <p className="muted">Загрузка…</p>}
        {me && me.characters.length === 0 && <p className="muted">У вас пока нет персонажей. Перейдите в кампанию и попросите Мастера создать персонажа.</p>}
        {me && me.characters.length > 0 && (
          <div className="stack" style={{ gap: 8 }}>
            {me.characters.map((c) => (
              <Link key={c.id} to={`/characters/${c.id}`} className="card row" style={{ textDecoration: "none", gap: 12 }}>
                <strong>{c.character_name}</strong>
                <span className="muted">{c.campaign_name ?? "без кампании"}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
