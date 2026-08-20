import { useEffect, useState } from "react";
import { api, deleteFileWithChoice } from "../api/client";
import { Modal } from "./Modal";
import { SoundIcon, SOUND_ICON_NAMES } from "../sound/SoundIcon";
import type { AudioRole, SoundButton } from "../sound/types";

interface Usage {
  sets: { id: number; name: string }[];
  playlists: { id: number; name: string }[];
}

// Правка одного звука: имя, роль, иконка, «постоянный стингер», удаление.
//
// Отдельным окном, а не прямо на плитке: в библиотеке полсотни звуков, и
// выпадающий список на каждом делает раздел неразборчивым. Сюда же вынесена
// прослушка — иначе понять, тот ли это «Хруст ветки», можно только на игре.
export function SoundEditModal({
  sound,
  roles,
  onPatch,
  onRelink,
  onDeleted,
  onClose,
}: {
  sound: SoundButton;
  roles: { role: AudioRole; title: string }[];
  onPatch: (body: Record<string, unknown>) => void;
  onRelink: () => void;
  onDeleted: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(sound.name);
  const [usage, setUsage] = useState<Usage | null>(null);

  useEffect(() => setName(sound.name), [sound.name]);

  // Использование подтягивается сразу, а не по нажатию «Удалить»: Мастер
  // должен видеть, что звук стоит в трёх наборах, ДО того как решит его
  // убрать, а не в тексте подтверждения, которое читают через раз.
  useEffect(() => {
    api
      .get<Usage>(`/sounds/${sound.resource_id}/usage`)
      .then(setUsage)
      .catch(() => setUsage(null));
  }, [sound.resource_id]);

  const used = (usage?.sets.length ?? 0) + (usage?.playlists.length ?? 0);

  async function remove() {
    const where = [
      usage?.sets.length ? `наборов: ${usage.sets.map((s) => s.name).join(", ")}` : null,
      usage?.playlists.length
        ? `боевых тем: ${usage.playlists.map((p) => p.name).join(", ")}`
        : null,
    ]
      .filter(Boolean)
      .join("\n");
    const ok = confirm(
      `Удалить звук «${sound.name}» из библиотеки и из хранилища?` +
        (where ? `\n\nОн стоит в:\n${where}` : "")
    );
    if (!ok) return;
    const done = await deleteFileWithChoice(`/sounds/${sound.resource_id}`);
    if (done) onDeleted();
  }

  return (
    <Modal onClose={onClose}>
      <div className="sl-edit">
        <div className="sl-edit-head">
          <SoundIcon name={sound.icon} imageUrl={sound.icon_url} size={26} />
          <span className="sl-edit-name">{sound.name}</span>
        </div>

        {sound.missing ? (
          <div className="sl-alert">
            <div className="sl-alert-body">
              <div className="sl-alert-title">файл не найден</div>
              <div className="sl-alert-note">В пульте эта кнопка погашена.</div>
            </div>
            <button className="sl-add" onClick={onRelink}>
              Указать новое место
            </button>
          </div>
        ) : sound.src ? (
          <audio controls preload="none" src={sound.src} />
        ) : null}

        <div className="sl-edit-field">
          <span>Название</span>
          <div className="row" style={{ gap: 6 }}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && name.trim() && name.trim() !== sound.name) {
                  onPatch({ name: name.trim() });
                }
              }}
              style={{ flex: "1 1 auto" }}
            />
            <button
              className="sl-add"
              disabled={!name.trim() || name.trim() === sound.name}
              onClick={() => onPatch({ name: name.trim() })}
            >
              Сохранить
            </button>
          </div>
          {/* Имя файла на диске не меняется: по нему звук находят обратно,
              когда хранилище переезжает. */}
          <span className="ss-note">Имя в приложении. Файл на диске не переименовывается.</span>
        </div>

        <div className="sl-edit-field">
          <span>Роль</span>
          <div className="sl-seg">
            {roles.map((r) => (
              <button
                key={r.role}
                className={sound.role === r.role ? "active" : ""}
                onClick={() => onPatch({ audio_role: r.role })}
              >
                {r.title}
              </button>
            ))}
          </div>
        </div>

        <div className="sl-edit-field">
          <span>Иконка</span>
          <div className="sl-icon-grid">
            <button
              className={sound.icon ? "sl-icon-pick" : "sl-icon-pick active"}
              title="без иконки"
              onClick={() => onPatch({ audio_icon: null })}
            >
              —
            </button>
            {SOUND_ICON_NAMES.map((name) => (
              <button
                key={name}
                className={sound.icon === name ? "sl-icon-pick active" : "sl-icon-pick"}
                title={name}
                onClick={() => onPatch({ audio_icon: name })}
              >
                <SoundIcon name={name} size={22} />
              </button>
            ))}
          </div>
        </div>

        {sound.role === "stinger" ? (
          <label className="row" style={{ alignItems: "center", gap: 6 }}>
            <input
              type="checkbox"
              checked={sound.pinned}
              onChange={(e) => onPatch({ audio_pinned: e.target.checked })}
            />
            <span className="muted">★ Постоянный: виден при любом наборе</span>
          </label>
        ) : null}

        <div className="sl-edit-field">
          <span>Удаление</span>
          <span className="ss-note">
            {usage === null
              ? "Проверяем, где используется…"
              : used === 0
                ? "Звук нигде не используется."
                : [
                    usage.sets.length ? `в наборах: ${usage.sets.map((s) => s.name).join(", ")}` : "",
                    usage.playlists.length
                      ? `в боевых темах: ${usage.playlists.map((p) => p.name).join(", ")}`
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
          </span>
          <div>
            <button className="sl-add" onClick={() => void remove()}>
              Удалить звук
            </button>
          </div>
        </div>

        <div className="sl-edit-actions">
          <span style={{ flex: "1 1 auto" }} />
          <button className="primary" onClick={onClose}>
            Готово
          </button>
        </div>
      </div>
    </Modal>
  );
}
