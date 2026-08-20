import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import { api } from "../api/client";
import { NavIcon } from "./NavIcons";
import { RelinkModal } from "./RelinkModal";
import { SoundEditModal } from "./SoundEditModal";
import { SoundIcon } from "../sound/SoundIcon";
import { formatDuration, useDurations } from "../sound/duration";
import type { AudioRole, MissingFile, SoundButton } from "../sound/types";
import "../soundLibrary.css";

// Вкладка «Звук» в Ресурсах: библиотека всего, что играет пульт.
//
// Подразделы — это роли, и добавление идёт ВНУТРИ подраздела: роль
// подставляется сама, вместо того чтобы выбирать её отдельным полем на
// каждую загрузку. Угадывать роль по имени файла не пробуем — угадывание
// будет ошибаться и приучит проверять за собой.
//
// Бэкграунд показан строчками, остальные три — плитками с иконкой: в пульте
// они выглядят так же, и одинаковый вид в обоих местах экономит узнавание.

// into — винительный падеж для подписи кнопки: «добавить в погоду», а не «в
// погода». Одного title на оба места не хватает.
const SECTIONS: { role: AudioRole; title: string; into: string; hint: string; icon: string }[] = [
  { role: "background", title: "Бэкграунд", into: "бэкграунд", hint: "музыка наборов и боевых тем", icon: "music" },
  { role: "ambient", title: "Эмбиент", into: "эмбиент", hint: "зацикленные, по одному на канал", icon: "forest" },
  { role: "weather", title: "Погода", into: "погоду", hint: "состояние мира, а не места", icon: "rain" },
  { role: "stinger", title: "Стингеры", into: "стингеры", hint: "постоянный состав пульта отмечен ★", icon: "bolt" },
];

export function SoundLibraryTab() {
  const [sounds, setSounds] = useState<SoundButton[]>([]);
  const [missing, setMissing] = useState<MissingFile[]>([]);
  const [relink, setRelink] = useState<MissingFile | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [uploading, setUploading] = useState<AudioRole | null>(null);

  const refresh = useCallback(() => {
    api.get<SoundButton[]>("/sounds").then(setSounds).catch(() => setSounds([]));
    api.get<MissingFile[]>("/files/missing").then(setMissing).catch(() => setMissing([]));
  }, []);

  useEffect(refresh, [refresh]);

  const tracks = useMemo(
    () => sounds.filter((s) => s.role === "background").map((s) => ({ id: s.resource_id, src: s.src })),
    [sounds]
  );
  const durations = useDurations(tracks);

  async function upload(role: AudioRole, e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;
    setUploading(role);
    try {
      for (const file of files) {
        const form = new FormData();
        form.append("name", file.name.replace(/\.[^.]+$/, ""));
        form.append("type", "link");
        form.append("scope", "global");
        form.append("category", "audio");
        form.append("file", file);
        const created = await api.post<{ id: number }>("/resources", form);
        await api.put(`/sounds/${created.id}`, { audio_role: role });
      }
      refresh();
    } finally {
      setUploading(null);
    }
  }

  async function patch(id: number, body: Record<string, unknown>) {
    await api.put(`/sounds/${id}`, body);
    refresh();
  }

  const missingAudio = missing.filter((m) => m.audio_role);
  const editing = sounds.find((s) => s.resource_id === editingId) ?? null;

  // Подпись под плиткой. «Без иконки» — не украшение: в пульте такая кнопка
  // останется текстовой, и найти её на слух посреди сцены будет дольше.
  function note(sound: SoundButton): { text: string; broken: boolean } | null {
    if (sound.missing) return { text: "файл не найден", broken: true };
    if (!sound.icon && !sound.icon_url) return { text: "без иконки", broken: false };
    return null;
  }

  return (
    <div className="stack">
      {missingAudio.length > 0 ? (
        <div className="sl-alert">
          <NavIcon name="warning" />
          <div className="sl-alert-body">
            <div className="sl-alert-title">{missingAudio.length} звуков не найдено</div>
            <div className="sl-alert-note">
              В пульте эти кнопки погашены заранее — разобрать лучше сейчас, а не за столом.
            </div>
          </div>
          <button className="sl-add" onClick={() => setRelink(missingAudio[0])}>
            Разобрать
          </button>
        </div>
      ) : null}

      {SECTIONS.map((section) => {
        const items = sounds.filter((s) => s.role === section.role);
        return (
          <section key={section.role} className="sl-section">
            <div className="sl-section-head">
              <SoundIcon name={section.icon} size={18} />
              <span className="sl-section-title">{section.title}</span>
              <span className="sl-section-hint">
                {items.length} · {section.hint}
              </span>
              <span className="sl-section-spacer" />
              <label className="sl-add">
                <input
                  type="file"
                  multiple
                  accept="audio/*"
                  style={{ display: "none" }}
                  onChange={(e) => upload(section.role, e)}
                  disabled={uploading !== null}
                />
                {uploading === section.role
                  ? "Загружаю…"
                  : `+ Добавить в ${section.into}`}
              </label>
            </div>

            {items.length === 0 ? (
              <p className="sl-empty">Пока пусто.</p>
            ) : section.role === "background" ? (
              <div className="sl-tracks">
                {items.map((sound) => {
                  const seconds = durations.get(sound.resource_id);
                  return (
                    <button
                      key={sound.resource_id}
                      className={sound.missing ? "sl-track broken" : "sl-track"}
                      onClick={() => setEditingId(sound.resource_id)}
                    >
                      <SoundIcon name="wave" size={14} />
                      <span className="sl-track-name">{sound.name}</span>
                      <span className="sl-track-time">
                        {sound.missing ? "нет файла" : seconds ? formatDuration(seconds) : ""}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="sl-tiles">
                {items.map((sound) => {
                  const hint = note(sound);
                  return (
                    <button
                      key={sound.resource_id}
                      className={sound.missing ? "sl-tile broken" : "sl-tile"}
                      onClick={() => setEditingId(sound.resource_id)}
                    >
                      {sound.pinned ? <span className="sl-pin">★</span> : null}
                      <SoundIcon name={sound.icon} imageUrl={sound.icon_url} size={26} />
                      <span className="sl-tile-name">{sound.name}</span>
                      {hint ? (
                        <span className={hint.broken ? "sl-tile-note broken" : "sl-tile-note"}>
                          {hint.text}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}

      <div className="sl-foot">
        Звуки глобальные · роль и иконка меняются по щелчку · иконка необязательна
      </div>

      {editing ? (
        <SoundEditModal
          sound={editing}
          roles={SECTIONS}
          onPatch={(body) => patch(editing.resource_id, body)}
          onDeleted={() => {
            setEditingId(null);
            refresh();
          }}
          onRelink={() => {
            setRelink(missing.find((m) => m.resource_id === editing.resource_id) ?? null);
            setEditingId(null);
          }}
          onClose={() => setEditingId(null)}
        />
      ) : null}

      {relink ? (
        <RelinkModal target={relink} onClose={() => setRelink(null)} onDone={refresh} />
      ) : null}
    </div>
  );
}
