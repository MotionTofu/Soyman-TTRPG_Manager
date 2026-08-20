import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { Modal } from "./Modal";
import { SoundIcon } from "../sound/SoundIcon";
import { useSoundEngineOptional } from "../sound/engine";
import type { AudioRole, SoundButton, SoundSetDetail, SoundSetSummary } from "../sound/types";
import type { Campaign, Playlist, PlaylistDetail, Setting } from "../types";
import "../soundLibrary.css";

// Вкладка «Аудио-наборы». Набор — состав кнопок всех четырёх каналов плюс то,
// что заиграет при его включении: собственные треки Бэкграунда и один
// стартовый звук Эмбиента. Погода и Стингеры при включении не трогаются —
// дождь идёт и снаружи, и в таверне, а самозапускающийся стингер просто
// пугает игроков.
//
// Бэкграунд — именно треки, а не плейлист: заготавливать плейлист ради того,
// чтобы положить его в набор, значит делать одну работу дважды. Плейлист
// остался ровно под одну роль — боевая тема, её и правда переиспользуют
// между наборами, поэтому она живёт отдельным списком слева.
//
// Слева наборы и боевые темы, справа один открытый: колонка на канал. В
// колонках только то, ЧТО входит в набор, а выбор состава убран в отдельное
// окно по кнопке «+». Показывать всю библиотеку прямо в колонках — значит
// утопить набор из шести звуков в полусотне доступных.

type MemberRole = Exclude<AudioRole, "background">;

const COLUMNS: { role: MemberRole; title: string; key: "ambient" | "weather" | "stingers" }[] = [
  { role: "ambient", title: "Эмбиент", key: "ambient" },
  { role: "weather", title: "Погода", key: "weather" },
  { role: "stinger", title: "Стингеры", key: "stingers" },
];

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} ${one}`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} ${few}`;
  return `${n} ${many}`;
}

// Перетаскивание списка: один и тот же приём и для треков набора, и для
// треков боевой темы. Порядок здесь слышен — им Мастер задаёт, с чего
// начнётся сцена, — поэтому таскать надо, а не сортировать по имени.
function moved<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function SoundSetsTab() {
  const [sets, setSets] = useState<SoundSetSummary[]>([]);
  const [current, setCurrent] = useState<SoundSetDetail | null>(null);
  const [battles, setBattles] = useState<Playlist[]>([]);
  const [battle, setBattle] = useState<PlaylistDetail | null>(null);
  const [sounds, setSounds] = useState<SoundButton[]>([]);
  const [settings, setSettings] = useState<Setting[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [naming, setNaming] = useState<
    "create" | "rename" | "battle-create" | "battle-rename" | null
  >(null);
  const [picking, setPicking] = useState<MemberRole | "tracks" | "battle-tracks" | null>(null);
  const [drag, setDrag] = useState<{ list: "set" | "battle"; index: number } | null>(null);
  const [over, setOver] = useState<number | null>(null);

  // Движка нет в вынесенных окнах — там «Включить» просто не показывается.
  const engine = useSoundEngineOptional();

  const refreshSets = useCallback(() => {
    api.get<SoundSetSummary[]>("/sound-sets").then(setSets).catch(() => setSets([]));
  }, []);
  const refreshBattles = useCallback(() => {
    api.get<Playlist[]>("/playlists").then(setBattles).catch(() => setBattles([]));
  }, []);

  useEffect(() => {
    refreshSets();
    refreshBattles();
    api.get<SoundButton[]>("/sounds").then(setSounds).catch(() => setSounds([]));
    api.get<Setting[]>("/settings").then(setSettings).catch(() => setSettings([]));
    api.get<Campaign[]>("/campaigns").then(setCampaigns).catch(() => setCampaigns([]));
  }, [refreshSets, refreshBattles]);

  const open = useCallback((id: number) => {
    setBattle(null);
    api.get<SoundSetDetail>(`/sound-sets/${id}`).then(setCurrent);
  }, []);

  const openBattle = useCallback((id: number) => {
    setCurrent(null);
    api.get<PlaylistDetail>(`/playlists/${id}`).then(setBattle);
  }, []);

  async function create(name: string) {
    const created = await api.post<SoundSetSummary>("/sound-sets", { name });
    refreshSets();
    open(created.id);
  }

  async function rename(name: string) {
    if (!current) return;
    await api.put(`/sound-sets/${current.id}`, { name });
    refreshSets();
    open(current.id);
  }

  async function saveItems(next: SoundSetDetail) {
    await api.put(`/sound-sets/${next.id}/items`, {
      tracks: next.tracks.map((b) => b.resource_id),
      ambient: next.ambient.map((b) => b.resource_id),
      weather: next.weather.map((b) => b.resource_id),
      stingers: next.stingers.map((b) => b.resource_id),
      start_ambient_id: next.ambient.find((b) => b.is_start)?.resource_id ?? null,
    });
    open(next.id);
    refreshSets();
    // Пульт держит состав набора в памяти, и без этого он бы играл прежним
    // составом до следующего переключения.
    if (engine && engine.state.setId === next.id) engine.reload();
  }

  function setMembers(role: MemberRole, ids: number[]) {
    if (!current) return;
    const key = role === "stinger" ? "stingers" : role;
    const kept = current[key].filter((b) => ids.includes(b.resource_id));
    const added = ids
      .filter((id) => !kept.some((b) => b.resource_id === id))
      .map((id) => {
        const sound = sounds.find((s) => s.resource_id === id)!;
        return { ...sound, is_start: false };
      });
    void saveItems({ ...current, [key]: [...kept, ...added] } as SoundSetDetail);
  }

  function setTracks(ids: number[]) {
    if (!current) return;
    // Порядок уже выбранных треков сохраняется: добавление шестого не должно
    // перетасовывать пять, которые Мастер уже расставил.
    const kept = current.tracks.filter((b) => ids.includes(b.resource_id));
    const added = ids
      .filter((id) => !kept.some((b) => b.resource_id === id))
      .map((id) => sounds.find((s) => s.resource_id === id)!);
    void saveItems({ ...current, tracks: [...kept, ...added] });
  }

  // Стартовый эмбиент один на набор, поэтому щелчок по нему же его снимает:
  // отдельная кнопка «убрать старт» ради одного состояния не нужна.
  function toggleStart(resourceId: number) {
    if (!current) return;
    void saveItems({
      ...current,
      ambient: current.ambient.map((b) => ({
        ...b,
        is_start: b.resource_id === resourceId && !b.is_start,
      })),
    });
  }

  async function patchSet(body: Record<string, unknown>) {
    if (!current) return;
    await api.put(`/sound-sets/${current.id}`, body);
    refreshSets();
    open(current.id);
    if (engine && engine.state.setId === current.id) engine.reload();
  }

  // --- боевые темы ---

  async function createBattle(name: string) {
    const created = await api.post<Playlist>("/playlists", { name, scope: "battle" });
    refreshBattles();
    openBattle(created.id);
  }

  async function renameBattle(name: string) {
    if (!battle) return;
    await api.put(`/playlists/${battle.id}`, { name });
    refreshBattles();
    openBattle(battle.id);
  }

  async function setBattleTracks(ids: number[]) {
    if (!battle) return;
    for (const item of battle.items) {
      if (!ids.includes(item.resource_id)) {
        await api.del(`/playlists/${battle.id}/items/${item.id}`);
      }
    }
    for (const id of ids) {
      if (!battle.items.some((it) => it.resource_id === id)) {
        await api.post(`/playlists/${battle.id}/items`, { resource_id: id });
      }
    }
    refreshBattles();
    openBattle(battle.id);
  }

  async function reorderBattle(from: number, to: number) {
    if (!battle) return;
    const next = moved(battle.items, from, to);
    setBattle({ ...battle, items: next });
    await api.put(`/playlists/${battle.id}/items/reorder`, { order: next.map((it) => it.id) });
  }

  const pinnedStingers = sounds.filter((s) => s.role === "stinger" && s.pinned).length;
  const playing = engine?.state.setId ?? null;
  const backgroundSounds = sounds.filter((s) => s.role === "background");

  function ownerLabel(s: SoundSetSummary): string {
    return [
      s.setting_id ? settings.find((x) => x.id === s.setting_id)?.name : null,
      s.campaign_id ? campaigns.find((x) => x.id === s.campaign_id)?.name : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  function trackClass(list: "set" | "battle", i: number): string {
    if (drag?.list === list && drag.index === i) return "ss-track dragging";
    if (drag?.list === list && over === i) return "ss-track over";
    return "ss-track";
  }

  return (
    <div className="stack ss-wrap">
      <div className="ss-layout">
        <div className="ss-list">
          <div className="ss-list-head">
            <span className="ss-list-label">Наборы</span>
            <span className="sl-section-spacer" />
            <button className="sl-add" onClick={() => setNaming("create")}>
              + Новый
            </button>
          </div>

          {sets.length === 0 ? <p className="ss-empty">Наборов ещё нет.</p> : null}
          {sets.map((s) => (
            <button
              key={s.id}
              className={current?.id === s.id ? "ss-set active" : "ss-set"}
              onClick={() => open(s.id)}
            >
              <span className="ss-set-name">
                <SoundIcon name={s.id === playing ? "music" : "forest"} size={18} />
                <span style={{ flex: "1 1 auto", minWidth: 0 }}>{s.name}</span>
                {s.id === playing ? <span className="ss-row-badge">играет</span> : null}
              </span>
              <span className="ss-set-meta">
                {plural(s.track_count, "трек", "трека", "треков")} ·{" "}
                {plural(s.ambient_count, "эмбиент", "эмбиента", "эмбиентов")} ·{" "}
                {plural(s.weather_count, "погода", "погоды", "погод")} ·{" "}
                {plural(s.stinger_count, "стингер", "стингера", "стингеров")}
              </span>
              {ownerLabel(s) ? <span className="ss-set-meta">{ownerLabel(s)}</span> : null}
            </button>
          ))}

          <p className="ss-list-note">
            Набор — глобальный. Сеттинг и кампания только поднимают его в списке, а не владеют им.
          </p>

          <div className="ss-list-head" style={{ marginTop: 6 }}>
            <span className="ss-list-label">Боевые темы</span>
            <span className="sl-section-spacer" />
            <button className="sl-add" onClick={() => setNaming("battle-create")}>
              + Новая
            </button>
          </div>

          {battles.length === 0 ? <p className="ss-empty">Боевых тем ещё нет.</p> : null}
          {battles.map((p) => (
            <button
              key={p.id}
              className={battle?.id === p.id ? "ss-set active" : "ss-set"}
              onClick={() => openBattle(p.id)}
            >
              <span className="ss-set-name">
                <SoundIcon name="bolt" size={18} />
                <span style={{ flex: "1 1 auto", minWidth: 0 }}>{p.name}</span>
              </span>
              <span className="ss-set-meta">{plural(p.item_count, "трек", "трека", "треков")}</span>
            </button>
          ))}

          <p className="ss-list-note">
            Боевая тема — единственный оставшийся плейлист: её переиспользуют и наборы, и сессии.
          </p>
        </div>

        {current ? (
          <div className="ss-editor">
            <div className="ss-editor-head">
              <span className="ss-editor-title">{current.name}</span>
              <span className="sl-section-spacer" />
              <button className="sl-add" onClick={() => setNaming("rename")}>
                Переименовать
              </button>
              <button
                className="sl-add"
                onClick={async () => {
                  await api.del(`/sound-sets/${current.id}`);
                  setCurrent(null);
                  refreshSets();
                }}
              >
                Удалить
              </button>
              {engine ? (
                <button
                  className="ss-on"
                  disabled={playing === current.id}
                  onClick={() => engine.setSet(current.id)}
                >
                  {playing === current.id ? "Включён" : "Включить"}
                </button>
              ) : null}
            </div>

            <div className="ss-cols">
              <div className="ss-col">
                <div className="ss-col-head">
                  Бэкграунд
                  <button className="ss-col-add" onClick={() => setPicking("tracks")}>
                    +
                  </button>
                </div>

                {current.tracks.length === 0 ? (
                  <p className="ss-note">Пусто.</p>
                ) : (
                  current.tracks.map((t, i) => (
                    <div
                      key={t.resource_id}
                      className={trackClass("set", i)}
                      draggable
                      onDragStart={() => setDrag({ list: "set", index: i })}
                      onDragOver={(e) => {
                        if (drag?.list !== "set") return;
                        e.preventDefault();
                        setOver(i);
                      }}
                      onDrop={() => {
                        if (drag?.list !== "set" || drag.index === i) return;
                        void saveItems({ ...current, tracks: moved(current.tracks, drag.index, i) });
                        setDrag(null);
                        setOver(null);
                      }}
                      onDragEnd={() => {
                        setDrag(null);
                        setOver(null);
                      }}
                    >
                      <span className="ss-track-grip">⠿</span>
                      <span className="ss-track-num">{i + 1}</span>
                      <span className={t.missing ? "ss-track-name broken" : "ss-track-name"}>
                        {t.name}
                        {t.missing ? " · нет файла" : ""}
                      </span>
                      <button
                        className="ss-track-drop"
                        title="Убрать из набора"
                        onClick={() =>
                          void saveItems({
                            ...current,
                            tracks: current.tracks.filter((x) => x.resource_id !== t.resource_id),
                          })
                        }
                      >
                        ✕
                      </button>
                    </div>
                  ))
                )}

                <p className="ss-note">
                  Играют по порядку при включении набора, порядок задаётся перетаскиванием. Набор без
                  треков включает тишину — это и значит «здесь музыки нет».
                </p>
              </div>

              {COLUMNS.map((col) => {
                const chosen = current[col.key];
                return (
                  <div key={col.role} className="ss-col">
                    <div className="ss-col-head">
                      {col.title}
                      <button className="ss-col-add" onClick={() => setPicking(col.role)}>
                        +
                      </button>
                    </div>

                    {col.role === "stinger" && pinnedStingers > 0 ? (
                      <div className="ss-pinned">
                        <span className="sl-pin">★</span>
                        <span>{pinnedStingers} постоянных — общие для всех наборов</span>
                      </div>
                    ) : null}

                    {chosen.length === 0 ? (
                      <p className="ss-note">Пусто.</p>
                    ) : (
                      chosen.map((b) =>
                        col.role === "ambient" ? (
                          <button
                            key={b.resource_id}
                            className={b.is_start ? "ss-row start" : "ss-row"}
                            title="Запускать при включении набора"
                            onClick={() => toggleStart(b.resource_id)}
                          >
                            <SoundIcon name={b.icon} imageUrl={b.icon_url} size={16} />
                            <span className="ss-row-name">{b.name}</span>
                            {b.is_start ? <span className="ss-row-badge">старт</span> : null}
                          </button>
                        ) : (
                          <div key={b.resource_id} className="ss-row">
                            <SoundIcon name={b.icon} imageUrl={b.icon_url} size={16} />
                            <span className="ss-row-name">{b.name}</span>
                            {col.role === "stinger" ? <span className="ss-dot" /> : null}
                          </div>
                        )
                      )
                    )}

                    {col.role === "ambient" ? (
                      <p className="ss-note">Отмеченный «старт» заиграет при включении набора.</p>
                    ) : null}
                    {col.role === "weather" ? (
                      <p className="ss-note">
                        При включении набора не запускается и не гасится: дождь идёт и снаружи, и в
                        таверне.
                      </p>
                    ) : null}
                    {col.role === "stinger" ? (
                      <p className="ss-note">Точкой отмечены дополнения этого набора.</p>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <div className="ss-fields">
              <label className="ss-field">
                <span>Боевая тема</span>
                <select
                  value={current.battle_playlist_id ?? ""}
                  onChange={(e) =>
                    void patchSet({
                      battle_playlist_id: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                >
                  <option value="">— не задана —</option>
                  {battles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="ss-field">
                <span>Сеттинг</span>
                <select
                  value={current.setting_id ?? ""}
                  onChange={(e) =>
                    void patchSet({ setting_id: e.target.value ? Number(e.target.value) : null })
                  }
                >
                  <option value="">— не важно —</option>
                  {settings.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="ss-field">
                <span>Кампания</span>
                <select
                  value={current.campaign_id ?? ""}
                  onChange={(e) =>
                    void patchSet({ campaign_id: e.target.value ? Number(e.target.value) : null })
                  }
                >
                  <option value="">— не важно —</option>
                  {campaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <p className="ss-note">
              Боевую тему включает трекер инициативы. Если у самой сессии задана своя боевая тема,
              играет она: сессионную выбирают под конкретный вечер, а набор заготовлен на всю
              кампанию.
            </p>
          </div>
        ) : battle ? (
          <div className="ss-editor">
            <div className="ss-editor-head">
              <span className="ss-editor-title">{battle.name}</span>
              <span className="sl-section-spacer" />
              <button className="sl-add" onClick={() => setNaming("battle-rename")}>
                Переименовать
              </button>
              <button
                className="sl-add"
                onClick={async () => {
                  await api.del(`/playlists/${battle.id}`);
                  setBattle(null);
                  refreshBattles();
                  refreshSets();
                }}
              >
                Удалить
              </button>
              <button className="ss-on" onClick={() => setPicking("battle-tracks")}>
                Состав
              </button>
            </div>

            <div className="ss-col" style={{ maxWidth: 420 }}>
              {battle.items.length === 0 ? (
                <p className="ss-note">Пусто — добавьте треки кнопкой «Состав».</p>
              ) : (
                battle.items.map((it, i) => (
                  <div
                    key={it.id}
                    className={trackClass("battle", i)}
                    draggable
                    onDragStart={() => setDrag({ list: "battle", index: i })}
                    onDragOver={(e) => {
                      if (drag?.list !== "battle") return;
                      e.preventDefault();
                      setOver(i);
                    }}
                    onDrop={() => {
                      if (drag?.list !== "battle" || drag.index === i) return;
                      void reorderBattle(drag.index, i);
                      setDrag(null);
                      setOver(null);
                    }}
                    onDragEnd={() => {
                      setDrag(null);
                      setOver(null);
                    }}
                  >
                    <span className="ss-track-grip">⠿</span>
                    <span className="ss-track-num">{i + 1}</span>
                    <span className="ss-track-name">{it.name}</span>
                  </div>
                ))
              )}
              <p className="ss-note">
                Тему включает трекер инициативы, когда начинается бой, и возвращает музыку набора на
                прежнее место, когда бой кончается.
              </p>
            </div>
          </div>
        ) : (
          <p className="ss-empty">Выберите набор или боевую тему слева.</p>
        )}
      </div>

      {naming ? (
        <NameModal
          title={
            naming === "create"
              ? "Новый набор"
              : naming === "battle-create"
                ? "Новая боевая тема"
                : naming === "rename"
                  ? "Название набора"
                  : "Название боевой темы"
          }
          initial={
            naming === "rename"
              ? (current?.name ?? "")
              : naming === "battle-rename"
                ? (battle?.name ?? "")
                : ""
          }
          onSubmit={(name) => {
            if (naming === "create") void create(name);
            else if (naming === "rename") void rename(name);
            else if (naming === "battle-create") void createBattle(name);
            else void renameBattle(name);
            setNaming(null);
          }}
          onClose={() => setNaming(null)}
        />
      ) : null}

      {picking === "tracks" && current ? (
        <MembersModal
          title="Бэкграунд"
          available={backgroundSounds}
          selected={current.tracks.map((b) => b.resource_id)}
          onDone={(ids) => {
            setTracks(ids);
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      ) : null}

      {picking === "battle-tracks" && battle ? (
        <MembersModal
          title={battle.name}
          available={backgroundSounds}
          selected={battle.items.map((it) => it.resource_id)}
          onDone={(ids) => {
            void setBattleTracks(ids);
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      ) : null}

      {picking && picking !== "tracks" && picking !== "battle-tracks" && current ? (
        <MembersModal
          title={COLUMNS.find((c) => c.role === picking)!.title}
          available={sounds.filter((s) => s.role === picking)}
          selected={current[picking === "stinger" ? "stingers" : picking].map((b) => b.resource_id)}
          onDone={(ids) => {
            setMembers(picking, ids);
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      ) : null}
    </div>
  );
}

function NameModal({
  title,
  initial,
  onSubmit,
  onClose,
}: {
  title: string;
  initial: string;
  onSubmit: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial);
  return (
    <Modal onClose={onClose} closeOnBackdropClick={false}>
      <div className="ss-pick">
        <div className="sl-edit-name">{title}</div>
        <input
          autoFocus
          value={name}
          placeholder="Например: Таверна у дороги"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) onSubmit(name.trim());
          }}
        />
        <div className="sl-edit-actions">
          <button className="sl-add" onClick={onClose}>
            Отмена
          </button>
          <span style={{ flex: "1 1 auto" }} />
          <button className="primary" disabled={!name.trim()} onClick={() => onSubmit(name.trim())}>
            Сохранить
          </button>
        </div>
      </div>
    </Modal>
  );
}

function MembersModal({
  title,
  available,
  selected,
  onDone,
  onClose,
}: {
  title: string;
  available: SoundButton[];
  selected: number[];
  onDone: (ids: number[]) => void;
  onClose: () => void;
}) {
  const [ids, setIds] = useState<number[]>(selected);
  return (
    <Modal onClose={onClose} closeOnBackdropClick={false}>
      <div className="ss-pick">
        <div className="sl-edit-name">Состав: {title}</div>
        {available.length === 0 ? (
          <p className="ss-note">
            Звуков этой роли ещё нет в библиотеке — добавьте их во вкладке «Звук».
          </p>
        ) : (
          <div className="ss-pick-list">
            {available.map((s) => (
              <label key={s.resource_id} className="ss-pick-row">
                <input
                  type="checkbox"
                  checked={ids.includes(s.resource_id)}
                  onChange={(e) =>
                    setIds((prev) =>
                      e.target.checked
                        ? [...prev, s.resource_id]
                        : prev.filter((id) => id !== s.resource_id)
                    )
                  }
                />
                <SoundIcon name={s.icon} imageUrl={s.icon_url} size={16} />
                <span className="ss-row-name">{s.name}</span>
                {s.missing ? <span className="sl-tile-note broken">нет файла</span> : null}
              </label>
            ))}
          </div>
        )}
        <div className="sl-edit-actions">
          <button className="sl-add" onClick={onClose}>
            Отмена
          </button>
          <span style={{ flex: "1 1 auto" }} />
          <button className="primary" onClick={() => onDone(ids)}>
            Сохранить
          </button>
        </div>
      </div>
    </Modal>
  );
}
