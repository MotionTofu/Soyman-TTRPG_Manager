import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import { useAction, useAfterWrite, useResource, write } from "../data/hooks";
import { attemptWithNotice, labelled } from "../data/notices";
import { SOUND_LIBRARY_AFFECTS } from "../sound/soundAffects";
import { useConfirm, usePrompt } from "../hooks/useConfirm";
import { NavIcon } from "./NavIcons";
import { RelinkModal } from "./RelinkModal";
import { SoundEditModal } from "./SoundEditModal";
import { SoundLibrarySection, type SoundSection } from "./SoundLibrarySection";
import { useDurations } from "../sound/duration";
import { useSoundPreview } from "../sound/useSoundPreview";
import { previewSourceNeedsRefresh, refreshPreviewSound } from "../sound/previewSource";
import type { AudioRole, MissingFile, SoundButton, SoundFolder } from "../sound/types";
import "../soundLibrary.css";

const SECTIONS: SoundSection[] = [
  { role: "background", title: "Бэкграунд", into: "бэкграунд", hint: "музыка наборов и боевых тем", icon: "music" },
  { role: "ambient", title: "Эмбиент", into: "эмбиент", hint: "зацикленные, по одному на канал", icon: "forest" },
  { role: "weather", title: "Погода", into: "погоду", hint: "состояние мира, а не места", icon: "rain" },
  { role: "stinger", title: "Стингеры", into: "стингеры", hint: "постоянный состав пульта отмечен ★", icon: "bolt" },
];
const NO_SOUNDS: SoundButton[] = [];
const NO_MISSING: MissingFile[] = [];
const NO_FOLDERS: SoundFolder[] = [];

export function SoundLibraryTab() {
  const run = useAction();
  const afterWrite = useAfterWrite();
  const [promptDialog, prompt] = usePrompt();
  const [confirmDialog, confirm] = useConfirm();
  const sounds = useResource<SoundButton[]>("/sounds").data ?? NO_SOUNDS;
  const folderState = useResource<SoundFolder[]>("/sounds/folders");
  const folders = folderState.data ?? NO_FOLDERS;
  const missing = useResource<MissingFile[]>("/files/missing").data ?? NO_MISSING;
  const [relink, setRelink] = useState<MissingFile | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [uploading, setUploading] = useState<AudioRole | null>(null);
  const [query, setQuery] = useState("");
  const refresh = useCallback(() => afterWrite(SOUND_LIBRARY_AFFECTS), [afterWrite]);
  const tracks = useMemo(() => sounds.filter((s) => !s.missing).map((s) => ({ id: s.resource_id, src: s.src })), [sounds]);
  const durations = useDurations(tracks);
  const preview = useSoundPreview();
  const stopPreview = preview.stop;
  const previewSound = sounds.find((sound) => sound.resource_id === preview.playingId);

  useEffect(() => {
    if (preview.playingId !== null && (!previewSound || previewSound.missing || !previewSound.src)) stopPreview();
  }, [preview.playingId, previewSound, stopPreview]);

  async function openEditor(id: number) {
    preview.stop();
    const sound = sounds.find((item) => item.resource_id === id);
    if (sound && previewSourceNeedsRefresh(sound.src)) {
      await attemptWithNotice("Прослушка не загружена", () => refreshPreviewSound(sound), { retry: false });
    }
    setEditingId(id);
  }

  function closeEditor() {
    preview.stop();
    setEditingId(null);
  }

  async function upload(role: AudioRole, folderId: number | null, event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    setUploading(role);
    try {
      // Повтора нет: часть файлов уже могла загрузиться.
      await run(labelled("Звук не загружен", async () => {
        for (const file of files) {
          const form = new FormData();
          form.append("name", file.name.replace(/\.[^.]+$/, ""));
          form.append("type", "link");
          form.append("scope", "global");
          form.append("category", "audio");
          form.append("file", file);
          const created = await write.post<{ id: number }>("/resources", form, { timeoutMs: 120_000 });
          await write.put("/sounds/" + created.id, { audio_role: role, ...(folderId !== null ? { folder_id: folderId } : {}) });
        }
      }), { affects: SOUND_LIBRARY_AFFECTS, retry: false });
    } finally {
      // И при частичном отказе уже загруженные файлы должны стать видны.
      refresh();
      setUploading(null);
    }
  }

  async function patch(id: number, body: Record<string, unknown>) {
    await run(labelled("Звук не сохранён", () => write.put("/sounds/" + id, body)), { affects: SOUND_LIBRARY_AFFECTS });
  }

  async function nameFolder(role: AudioRole, folder?: SoundFolder) {
    const name = await prompt({
      title: folder ? "Переименовать папку" : "Новая папка",
      message: "Название папки",
      defaultValue: folder?.name ?? "",
      confirmLabel: folder ? "Сохранить" : "Создать",
    });
    if (!name?.trim() || (folder && name.trim() === folder.name)) return;
    await run(labelled("Папка не сохранена", () => folder
      ? write.put("/sounds/folders/" + folder.id, { name: name.trim() })
      : write.post("/sounds/folders", { role, name: name.trim() })),
      { affects: SOUND_LIBRARY_AFFECTS, retry: false });
  }

  async function deleteFolder(folder: SoundFolder) {
    if (!await confirm({
      title: "Удалить папку «" + folder.name + "»?",
      message: "Все звуки останутся в разделе без папки. Файлы и состав наборов сохранятся.",
      confirmLabel: "Удалить папку",
    })) return;
    await run(labelled("Папка не удалена", () => write.del("/sounds/folders/" + folder.id)),
      { affects: SOUND_LIBRARY_AFFECTS, retry: false });
  }

  const missingAudio = missing.filter((m) => m.audio_role);
  const editing = sounds.find((s) => s.resource_id === editingId) ?? null;

  return <div className="stack">
    <div className="sl-preview-toolbar">
      <label className="sl-preview-volume">
        <NavIcon name="volume" />
        <span>Предпрослушивание</span>
        <input type="range" min="0" max="1" step="0.01" value={preview.volume}
          aria-label="Громкость предпрослушивания" aria-valuetext={`${Math.round(preview.volume * 100)}%`}
          onChange={(event) => preview.setVolume(Number(event.target.value))} />
        <output>{Math.round(preview.volume * 100)}%</output>
      </label>
      {previewSound && <div className="sl-preview-now">
        <span>{previewSound.name}</span>
        <button type="button" className="d-btn d-btn--sm" onClick={preview.stop} aria-label="Остановить предпрослушивание">Стоп</button>
      </div>}
      <label className="sl-search">
        <NavIcon name="search" />
        <input type="search" aria-label="Найти звук" placeholder="Найти трек…" value={query}
          onChange={(event) => setQuery(event.target.value)} />
      </label>
    </div>
    {preview.error && <p className="sl-empty" role="alert">{preview.error}</p>}
    {!editing && <audio ref={preview.audioRef} preload="none" onPause={preview.onPause}
      onEnded={preview.onEnded} onError={preview.onError} onVolumeChange={preview.onVolumeChange} />}
    {missingAudio.length > 0 && <div className="sl-alert">
      <NavIcon name="warning" />
      <div className="sl-alert-body">
        <div className="sl-alert-title">{missingAudio.length} звуков не найдено</div>
        <div className="sl-alert-note">В пульте эти кнопки погашены заранее — разобрать лучше сейчас, а не за столом.</div>
      </div>
      <button className="d-btn d-btn--sm" onClick={() => setRelink(missingAudio[0])}>Разобрать</button>
    </div>}
    {folderState.error && <div className="sl-alert" role="alert">
      <span>Не удалось загрузить папки: {folderState.error}</span>
      <button className="d-btn d-btn--sm" onClick={folderState.reload}>Повторить</button>
    </div>}
    {SECTIONS.map((section) => <SoundLibrarySection key={section.role} section={section}
      sounds={sounds} folders={folders} durations={durations} uploading={uploading}
      playingId={preview.playingId} query={query} onPreview={preview.toggle}
      onUpload={upload} onEdit={openEditor}
      onCreate={() => void nameFolder(section.role)}
      onRename={(folder) => void nameFolder(section.role, folder)}
      onDelete={(folder) => void deleteFolder(folder)} />)}
    <div className="sl-foot">Звуки глобальные · роль, папка и иконка меняются по щелчку · иконка необязательна</div>
    {editing && <SoundEditModal sound={editing} roles={SECTIONS} folders={folders} preview={preview}
      onPatch={(body) => patch(editing.resource_id, body)}
      onDeleted={() => { closeEditor(); refresh(); }}
      onRelink={() => {
        setRelink(missing.find((m) => m.resource_id === editing.resource_id) ?? null);
        closeEditor();
      }}
      onClose={closeEditor} />}
    {relink && <RelinkModal target={relink} onClose={() => setRelink(null)} onDone={refresh} />}
    {promptDialog}
    {confirmDialog}
  </div>;
}
