import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useSoundEngineOptional } from "../sound/engine";
import type {
  LaunchResult,
  PlannedScene,
  SceneSearchRow,
  ScenePreview,
  SessionStage,
  StageScene,
} from "../types";

// Переключатель сцен — главный орган пульта, поэтому он наверху и без
// прокрутки. За столом у Мастера заняты голова и руки: то, ради чего он сюда
// смотрит, не должно требовать ни поиска, ни переключения вкладки.
//
// Две колонки. Слева три яруса, сверху вниз по частоте использования:
//   «Сейчас»    — запущенная сцена;
//   «Дальше»    — переходы и исходы проверок, то есть 90% случаев;
//   «На вечер»  — заготовленные сцены, собранные в подготовке.
// Справа — предпросмотр выбранной сцены и кнопка запуска.
//
// Выбирать сцены здесь больше нельзя: набор вечера собирают в профиле сессии,
// в подготовке. Пульт отвечает за игру, а не за неё же плюс подготовку — и
// дерево на три уровня посреди боя это ровно то, чего Мастеру за столом
// делать некогда.
//
// Осталось одно исключение — экстренный поиск: партия ушла не туда, и нужная
// сцена не заготовлена. Он добавляет её в вечер и показывает предпросмотр, но
// не запускает: правило «щелчок не запускает» держит момент включения музыки и
// панелей за Мастером.

export function SceneSwitcher({
  sessionId,
  onLaunched,
}: {
  sessionId: number;
  onLaunched: () => void;
}) {
  const [stage, setStage] = useState<SessionStage | null>(null);
  // Предпросмотр: щелчок по сцене НЕ запускает её. Запуск меняет панели и
  // музыку, и делать это перебором вариантов «куда дальше» нельзя.
  const [picked, setPicked] = useState<StageScene | null>(null);
  const [preview, setPreview] = useState<ScenePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const sound = useSoundEngineOptional();

  const refresh = useCallback(() => {
    api.get<SessionStage>(`/sessions/${sessionId}/stage`).then(setStage);
  }, [sessionId]);
  useEffect(refresh, [refresh]);

  // Карточка показывает выбранную сцену, а пока не выбрали — запущенную.
  const shownId = picked?.id ?? stage?.current?.id ?? null;
  useEffect(() => {
    if (shownId == null) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    api
      .get<ScenePreview>(`/sessions/${sessionId}/preview/${shownId}`)
      .then((p) => !cancelled && setPreview(p))
      .catch(() => !cancelled && setPreview(null));
    return () => {
      cancelled = true;
    };
  }, [sessionId, shownId]);

  async function launch(scene: StageScene) {
    if (busy) return;
    setBusy(true);
    try {
      const result = await api.post<LaunchResult>(`/sessions/${sessionId}/launch`, {
        scene_id: scene.id,
      });
      // Звук переключает клиент, а не сервер: движок живёт в главном окне
      // браузера. Через sceneSet, а не setSet, чтобы смена была подписана и
      // её можно было откатить одной кнопкой.
      if (result.soundSetId != null && sound) {
        sound.sceneSet(result.soundSetId, result.scene.name, result.soundSetName ?? "набор сцены");
      }
      setPicked(null);
      refresh();
      onLaunched();
    } finally {
      setBusy(false);
    }
  }

  if (!stage) return null;
  const isPreview = picked != null && picked.id !== stage.current?.id;

  return (
    // Обёртка объявляет контейнер: ширину пульта задаёт не окно, а колонка
    // между доками, и на экране 1280 она бывает уже 400px. Медиа-запрос этого
    // не видит — он схлопнул бы колонки поздно, а название сцены к тому
    // моменту уже рассыпалось бы по букве в строку.
    <div className="sw-wrap">
      <div className="card sw">
      <div className="sw-left">
        <div className="sw-now">
          <span className="sw-label">Сейчас</span>
          {stage.current ? (
            <>
              <Link to={`/scenes/${stage.current.id}`} className="sw-scene-name">
                {stage.current.name}
              </Link>
              {stage.current.arc_name && <div className="muted sw-arc-name">{stage.current.arc_name}</div>}
            </>
          ) : (
            <span className="muted">Сцена не запущена — выберите первую из списка ниже.</span>
          )}
          <SceneSound />
        </div>

        {/* Пока ничего не запущено, ярус «Дальше» не рисуется вовсе: «переходы
            не размечены» было бы неправдой — уходить пока не откуда. */}
        {stage.current && (
          <ExitList
            exits={stage.exits}
            currentArcId={stage.current.arc_id}
            pickedId={picked?.id ?? null}
            onPick={setPicked}
          />
        )}

        <PlannedList
          planned={stage.planned}
          currentId={stage.current?.id ?? null}
          sessionId={sessionId}
          pickedId={picked?.id ?? null}
          onPick={setPicked}
          onChanged={refresh}
        />
      </div>

      <div className="sw-right">
        <div className="sw-preview-head">
          <div style={{ minWidth: 0, flex: 1 }}>
            <span className="sw-label">{isPreview ? "Предпросмотр" : "Идёт сейчас"}</span>
            <div className="sw-preview-name">{preview?.scene.name ?? "—"}</div>
          </div>
          {isPreview && picked && (
            <button className="primary sw-launch" disabled={busy} onClick={() => launch(picked)}>
              Запустить сцену
            </button>
          )}
          {picked && <button onClick={() => setPicked(null)}>Отмена</button>}
        </div>

        {preview ? <PreviewBody preview={preview} /> : <span className="muted">Сцена не выбрана.</span>}
        </div>
      </div>
    </div>
  );
}

const CAST_ROLE_LABEL: Record<string, string> = {
  location: "Локации",
  plot_characters: "Сюжетные персонажи",
  obstacles: "Препятствия",
  loot: "Потенциальный лут",
};

function PreviewBody({ preview }: { preview: ScenePreview }) {
  const byRole = Object.keys(CAST_ROLE_LABEL)
    .map((role) => ({ role, rows: preview.cast.filter((c) => c.role === role) }))
    .filter((g) => g.rows.length > 0);

  return (
    <div className="sw-preview">
      {preview.entryCondition && (
        <div className="sw-entry">
          <span className="sw-label">Вход</span>
          {preview.entryCondition}
        </div>
      )}

      {/* «Зачитать» — единственный текст на пульте, который произносят вслух,
          поэтому он крупнее остального и в рамке: за столом его находят
          глазами, не читая, что вокруг. */}
      {preview.readAloud && (
        <div className="sw-read">
          <span className="sw-label">Зачитать</span>
          <p>{preview.readAloud}</p>
        </div>
      )}

      {!preview.readAloud && preview.summary && (
        <div className="sw-read is-summary">
          <span className="sw-label">В двух словах</span>
          <p>{preview.summary}</p>
        </div>
      )}

      <div className="sw-cards">
        {byRole.map((g) => (
          <div key={g.role} className="sw-card">
            <div className="sw-card__head">{CAST_ROLE_LABEL[g.role]}</div>
            <div className="sw-card__body">
              {g.rows.map((c, i) => (
                <div key={i} className="row" style={{ gap: 6, alignItems: "baseline" }}>
                  <span style={{ flex: 1, minWidth: 0 }}>{c.name}</span>
                  {c.qty && <span className="muted qty-chip">{c.qty}</span>}
                </div>
              ))}
            </div>
          </div>
        ))}

        {preview.checks.length > 0 && (
          <div className="sw-card">
            <div className="sw-card__head">Проверки</div>
            <div className="sw-card__body">
              {preview.checks.map((c, i) => (
                <div key={i} className="stack" style={{ gap: 2 }}>
                  <strong>{c.what || "—"}</strong>
                  <span className="muted sw-check-meta">
                    {[c.dc, c.outcomes.join(" · ")].filter(Boolean).join(" — ")}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {preview.sound && (
          <div className="sw-card">
            <div className="sw-card__head">Звук</div>
            <div className="sw-card__body">
              <strong>{preview.sound.name}</strong>
              <span className="muted sw-check-meta">включится при запуске</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Строка про звук. Показывается только когда музыку включила сцена: пока её
 * не включали, сообщать нечего, а постоянная строка про звук — ещё один
 * орган управления, которого решено избегать.
 */
function SceneSound() {
  const sound = useSoundEngineOptional();
  const notice = sound?.state.sceneSwitch;
  if (!notice) return null;
  return (
    <div className="sw-sound is-notice">
      <span>Звук ушёл на «{notice.to}» — это запуск сцены, не вы.</span>
      <button onClick={() => sound?.revertSceneSet()}>Вернуть прежний</button>
    </div>
  );
}

/** «Дальше» — переходы и исходы проверок, слитые в один список. */
function ExitList({
  exits,
  currentArcId,
  pickedId,
  onPick,
}: {
  exits: { scene: StageScene; label: string }[];
  currentArcId: number | null;
  pickedId: number | null;
  onPick: (scene: StageScene) => void;
}) {
  return (
    <div className="stack" style={{ gap: 6 }}>
      <span className="sw-label">Дальше</span>
      {exits.length === 0 && (
        <span className="muted">
          Из этой сцены переходы не размечены — возьмите следующую из списка ниже.
        </span>
      )}
      <div className="sw-exits">
        {exits.map((exit) => (
          <button
            key={exit.scene.id}
            className={`sw-exit${pickedId === exit.scene.id ? " is-picked" : ""}`}
            onClick={() => onPick(exit.scene)}
          >
            <span className="sw-exit-name">{exit.scene.name}</span>
            {exit.label && <span className="sw-exit-label">{exit.label}</span>}
            {/* Сцена из другого приключения помечается его названием: без
                пометки переход через границу главы за столом пугает — «я же
                не там». */}
            {exit.scene.arc_id !== currentArcId && exit.scene.arc_name && (
              <span className="sw-exit-arc">{exit.scene.arc_name}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * «На вечер» — то, что собрано в подготовке. Плюс экстренный поиск на случай,
 * когда партия ушла туда, куда её не готовили.
 */
function PlannedList({
  planned,
  currentId,
  sessionId,
  pickedId,
  onPick,
  onChanged,
}: {
  planned: PlannedScene[];
  currentId: number | null;
  sessionId: number;
  pickedId: number | null;
  onPick: (scene: StageScene) => void;
  onChanged: () => void;
}) {
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<SceneSearchRow[]>([]);

  useEffect(() => {
    if (!searching || query.trim().length < 2) {
      setFound([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .get<SceneSearchRow[]>(`/sessions/${sessionId}/scene-search?q=${encodeURIComponent(query)}`)
        .then((rows) => !cancelled && setFound(rows))
        .catch(() => !cancelled && setFound([]));
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searching, query, sessionId]);

  async function addAndPick(row: SceneSearchRow) {
    await api.post(`/sessions/${sessionId}/planned`, { scene_ids: [row.id], on: true });
    setSearching(false);
    setQuery("");
    onChanged();
    onPick({ id: row.id, name: row.name, kind: null, arc_id: null, arc_name: row.arc_name || null });
  }

  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
        <span className="sw-label">На вечер</span>
        <button className="comp-mini" onClick={() => setSearching((v) => !v)}>
          {searching ? "Закрыть" : "Найти сцену"}
        </button>
      </div>

      {searching && (
        <div className="stack" style={{ gap: 4 }}>
          <input
            autoFocus
            placeholder="Название сцены"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {found.map((row) => (
            <button key={row.id} className="sw-exit" onClick={() => addAndPick(row)}>
              <span className="sw-exit-name">{row.name}</span>
              {(row.arc_name || row.chapter_name) && (
                <span className="sw-exit-label">
                  {[row.arc_name, row.chapter_name].filter(Boolean).join(" · ")}
                </span>
              )}
              {row.in_library === 1 && <span className="sw-exit-arc">заготовка</span>}
            </button>
          ))}
          {query.trim().length >= 2 && found.length === 0 && (
            <span className="muted">Ничего не нашлось.</span>
          )}
        </div>
      )}

      {/* Приглашение, а не пустой экран: сессия без заготовки — это пульт,
          которому нечего показать в момент, когда игра уже началась. */}
      {planned.length === 0 && !searching && (
        <span className="muted">
          Сцены на вечер не отмечены — их набирают в{" "}
          <Link to={`/sessions/${sessionId}`}>подготовке сессии</Link>.
        </span>
      )}

      <div className="sw-exits">
        {planned.map((scene) => (
          <button
            key={scene.id}
            className={`sw-exit sw-planned${pickedId === scene.id ? " is-picked" : ""}${
              scene.played && scene.id !== currentId ? " is-played" : ""
            }`}
            onClick={() => onPick(scene)}
          >
            <span className="sw-exit-name">{scene.name}</span>
            {scene.arc_name && <span className="sw-exit-label">{scene.arc_name}</span>}
            {/* «Сыграна» не убирает сцену из списка: в неё возвращаются — и
                чаще, чем кажется, когда партия ходит кругами. */}
            {scene.played && scene.id !== currentId && (
              <span className="sw-exit-arc">сыграна</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
