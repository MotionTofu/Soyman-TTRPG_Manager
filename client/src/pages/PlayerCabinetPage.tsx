import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useCurrentUser } from "../api/currentUser";
import { useImageCrop } from "../hooks/useImageCrop";
import { IMAGE_ACCEPT, IMAGE_HINT } from "../imageUpload";
import type { Player } from "../types";

// The player's self-service "Кабинет" — editing their own account (display
// name, avatar, login password), as opposed to /players/:id which is the
// GM-only roster page. Scoped server-side to the caller's own playerId (see
// playerAccess.ts) and own user row (PUT /auth/me), never another player's.
export function PlayerCabinetPage() {
  const { user } = useCurrentUser();
  const [player, setPlayer] = useState<Player | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

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
    await api.put(`/players/${user.playerId}`, { name: nameDraft });
    setEditingName(false);
    refresh();
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
      <h1>Кабинет</h1>

      <div className="card row" style={{ alignItems: "flex-start", gap: 16 }}>
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
        <div className="stack" style={{ flex: 1 }}>
          <span className="muted">Имя</span>
          {editingName ? (
            <div className="row">
              <input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} />
              <button className="primary" onClick={saveName}>
                Сохранить
              </button>
              <button
                onClick={() => {
                  setEditingName(false);
                  setNameDraft(player.name);
                }}
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

      <div className="card stack" style={{ maxWidth: 400 }}>
        <strong>Смена пароля</strong>
        <span className="muted">Логин: {user?.username}</span>
        <input
          type="password"
          placeholder="Текущий пароль"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
        />
        <input
          type="password"
          placeholder="Новый пароль"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
        <input
          type="password"
          placeholder="Повторите новый пароль"
          value={newPasswordConfirm}
          onChange={(e) => setNewPasswordConfirm(e.target.value)}
        />
        {passwordError && <p className="error">{passwordError}</p>}
        {passwordDone && <span className="muted">Пароль обновлён.</span>}
        <button className="primary" onClick={changePassword} disabled={passwordSaving}>
          {passwordSaving ? "Сохранение…" : "Сменить пароль"}
        </button>
      </div>
    </div>
  );
}
