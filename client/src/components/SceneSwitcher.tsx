import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { readResource } from "../data/imperative";
import { errorText, useAfterWrite, useResource, write } from "../data/hooks";
import { showSaveError } from "../data/notices";
import { launchAffects, sessionPaths } from "../data/sessions";
import { useSoundEngineOptional } from "../sound/engine";
import { FloatWindow } from "./FloatWindow";
import { NavIcon } from "./NavIcons";
import { setSceneBlockMode, useSceneBlockMode } from "../sceneFloatStore";
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
// Две колонки одной высоты: слева три яруса, сверху вниз по частоте
// использования:
//   «Дальше»  — переходы и исходы проверок, то есть 90% случаев;
//   «Назад»   — одна сцена: последняя, откуда пришли;
//   «На игру» — заготовленные сцены, собранные в подготовке.
// Яруса «Сейчас» слева нет намеренно: где мы — написано справа, в заголовке
// («Идёт сейчас» / «Предпросмотр»), повтор слева это лишний текст.
// Справа — предпросмотр выбранной сцены и кнопка запуска. Длинные списки
// скроллятся внутри ярусов, а не растягивают пульт: высота колонки задаётся
// превью справа.
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

export function SceneSwitcher({ sessionId }: { sessionId: number }) {
  // Сцена вечера — из кэша слоя данных: запуск здесь или в другом окне и
  // правка набора в подготовке задевают сессию (data/sessions.ts), и
  // переключатель перечитывается сам.
  const stageState = useResource<SessionStage>(sessionPaths.stage(sessionId));
  const stage = stageState.data ?? null;
  // Предпросмотр: щелчок по сцене НЕ запускает её. Запуск меняет панели и
  // музыку, и делать это перебором вариантов «куда дальше» нельзя.
  const [picked, setPicked] = useState<StageScene | null>(null);
  const [busy, setBusy] = useState(false);
  // Где живёт блок: сетка, окно или док-станция. Общее с PreviewDock
  // (плашка «Сцены» там) — через стор sceneFloatStore, переживает
  // перезагрузку.
  const mode = useSceneBlockMode();
  const detached = mode !== "grid";
  const sound = useSoundEngineOptional();
  const afterWrite = useAfterWrite();

  // Без сообщения сбой оставлял переключатель невидимым — главный орган пульта
  // молча исчезал с экрана, и понять, что случилось, было не по чему.
  const stageError = !stage && stageState.error != null;
  const refresh = stageState.reload;

  // Карточка показывает выбранную сцену, а пока не выбрали — запущенную. При
  // переборе стрелками держится прежняя карточка, пока не придёт новая.
  const shownId = picked?.id ?? stage?.current?.id ?? null;
  const previewData = useResource<ScenePreview>(
    shownId != null ? sessionPaths.preview(sessionId, shownId) : null,
    { keepPrevious: true }
  ).data;
  const preview = shownId == null ? null : previewData ?? null;

  const onPlannedChanged = useCallback(() => afterWrite(launchAffects(sessionId)), [afterWrite, sessionId]);

  async function launch(scene: StageScene) {
    if (busy) return;
    setBusy(true);
    try {
      const result = await write.post<LaunchResult>(`/sessions/${sessionId}/launch`, {
        scene_id: scene.id,
      });
      // Звук переключает клиент, а не сервер: движок живёт в главном окне
      // браузера. Через sceneSet, а не setSet, чтобы смена была подписана и
      // её можно было откатить одной кнопкой.
      if (result.soundSetId != null && sound) {
        sound.sceneSet(result.soundSetId, result.scene.name, result.soundSetName ?? "набор сцены");
      }
      setPicked(null);
      // Запуск меняет сцену, экран и состав панелей: всё это перечитается по
      // задетому — здесь, во вынесенных панелях и в окне показа.
      afterWrite(launchAffects(sessionId));
    } catch (e) {
      afterWrite(launchAffects(sessionId));
      showSaveError(`Сцена не запустилась: ${errorText(e)}`);
    } finally {
      setBusy(false);
    }
  }

  // Клавиатура за столом: ↑↓ — перебор Дальше+Назад+На игру, Enter — запуск, Esc — отмена. Без мыши.
  useEffect(() => {
    if (!stage) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const all: StageScene[] = [...stage.exits.map((x) => x.scene), ...stage.planned.map((p) => ({ id: p.id, name: p.name, kind: null, arc_id: null, arc_name: p.arc_name ?? null } as StageScene))];
      if (all.length === 0) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const idx = picked ? all.findIndex((s) => s.id === picked.id) : -1;
        const next = e.key === "ArrowDown" ? (idx + 1) % all.length : (idx - 1 + all.length) % all.length;
        setPicked(all[next]);
      } else if (e.key === "Enter" && picked && stage.current && picked.id !== stage.current.id) {
        e.preventDefault();
        launch(picked);
      } else if (e.key === "Escape" && picked) {
        e.preventDefault();
        setPicked(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stage, picked]);

  if (stageError)
    return (
      <div className="card row" style={{ gap: 8, alignItems: "center" }} role="alert">
        <span>Сцены вечера не прочитались.</span>
        <button onClick={refresh}>Повторить</button>
      </div>
    );
  if (!stage) return null;
  const isPreview = picked != null && picked.id !== stage.current?.id;

  // «Назад» — одна сцена: последняя, откуда пришли. Это последний запуск
  // журнала, отличный от текущего (возврат A → B → A даёт B, а не A).
  // Имя и приключение — из плана вечера; сцену могли убрать из подготовки
  // после запуска — тогда только имя из журнала, запустить всё равно можно.
  const prevEntry = stage.current
    ? [...stage.journal].reverse().find((j) => j.scene_id !== stage.current!.id) ?? null
    : null;
  const prevScene: StageScene | null = !prevEntry
    ? null
    : (stage.planned.find((s) => s.id === prevEntry.scene_id) ?? {
      id: prevEntry.scene_id,
      name: prevEntry.name,
      kind: null,
      arc_id: null,
      arc_name: null,
    });

  // Тело одно на оба места: в сетке и в окне живёт тот же JSX, поэтому
  // предпросмотр, выбор и запуск ведут себя одинаково.
  const body = (
      <div className="card sw">
      <div className="sw-left">
        {/* Звук сюда же, наверх колонки: раньше строка жила в ярусе «Сейчас»,
            которого больше нет (где мы — написано справа). */}
        <SceneSound />

        {/* Пока ничего не запущено, ярус «Дальше» не рисуется вовсе: «переходы
            не размечены» было бы неправдой — уходить пока не откуда. Вместо
            него — приглашение выбрать первую из списка ниже. */}
        {!stage.current && (
          <span className="muted">Сцена не запущена — выберите первую из списка ниже.</span>
        )}
        {stage.current && (
          <ExitList
            exits={stage.exits}
            currentArcId={stage.current.arc_id}
            pickedId={picked?.id ?? null}
            onPick={setPicked}
          />
        )}

        <BackList
          prev={prevScene}
          pickedId={picked?.id ?? null}
          onPick={setPicked}
        />

        <PlannedList
          planned={stage.planned}
          currentId={stage.current?.id ?? null}
          prevId={prevScene?.id ?? null}
          sessionId={sessionId}
          pickedId={picked?.id ?? null}
          onPick={setPicked}
          onChanged={onPlannedChanged}
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
  );

  // Вне сетки — ничего: блок целиком живёт в окне или в док-станции,
  // возврат — кнопками окна («В пульт») и плашкой дока. Полоску-заглушку
  // в сетке не оставляем: она занимала место ради новости, которую Мастер
  // и так видит.
  if (detached) {
    if (mode !== "float") return null;
    return (
      <FloatWindow
        title="Сцены"
        storageKey="rpgManagerFloatScenes"
        defaultSize={{ w: 760, h: 540 }}
        onDock={() => setSceneBlockMode("grid")}
        onToDockStation={() => setSceneBlockMode("dock")}
      >
        {body}
      </FloatWindow>
    );
  }

  return (
    // Обёртка объявляет контейнер: ширину пульта задаёт не окно, а колонка
    // между доками, и на экране 1280 она бывает уже 400px. Медиа-запрос этого
    // не видит — он схлопнул бы колонки поздно, а название сцены к тому
    // моменту уже рассыпалось бы по букве в строку.
    <div className="sw-wrap">
      <button
        type="button"
        className="sw-popout"
        title="Открыть сцены в отдельном окне"
        aria-label="Открыть сцены в отдельном окне"
        onClick={() => setSceneBlockMode("float")}
      >
        <NavIcon name="fullscreen" />
      </button>
      {body}
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
    <div className="stack sw-tier" style={{ gap: 6 }}>
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
 * «Назад» — одна сцена: последняя, откуда пришли. Кнопка как «Дальше», но
 * чуть мельче: это возврат, а не основной путь. Нет такой — яруса нет
 * вовсе: подпись без кнопки — лишний орган.
 */
function BackList({
  prev,
  pickedId,
  onPick,
}: {
  prev: StageScene | null;
  pickedId: number | null;
  onPick: (scene: StageScene) => void;
}) {
  if (!prev) return null;
  return (
    <div className="stack sw-tier" style={{ gap: 6 }}>
      <span className="sw-label">Назад</span>
      <div className="sw-exits">
        <button
          className={`sw-exit is-back${pickedId === prev.id ? " is-picked" : ""}`}
          onClick={() => onPick(prev)}
        >
          <span className="sw-exit-name">{prev.name}</span>
          {prev.arc_name && <span className="sw-exit-label">{prev.arc_name}</span>}
        </button>
      </div>
    </div>
  );
}

/**
 * «На игру» — то, что собрано в подготовке. Плюс экстренный поиск на случай,
 * когда партия ушла туда, куда её не готовили.
 */
function PlannedList({
  planned,
  currentId,
  prevId,
  sessionId,
  pickedId,
  onPick,
  onChanged,
}: {
  planned: PlannedScene[];
  currentId: number | null;
  prevId: number | null;
  sessionId: number;
  pickedId: number | null;
  onPick: (scene: StageScene) => void;
  onChanged: () => void;
}) {
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<SceneSearchRow[]>([]);

  // Поиск по мере набора — свежим запросом через слой: сцены пульта меняются
  // по ходу вечера, и найденное должно быть сегодняшним.
  useEffect(() => {
    if (!searching || query.trim().length < 2) {
      setFound([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      readResource<SceneSearchRow[]>(`/sessions/${sessionId}/scene-search?q=${encodeURIComponent(query)}`, { fresh: true })
        .then((rows) => !cancelled && setFound(rows))
        .catch(() => !cancelled && setFound([]));
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searching, query, sessionId]);

  async function addAndPick(row: SceneSearchRow) {
    try {
      await write.post(`/sessions/${sessionId}/planned`, { scene_ids: [row.id], on: true });
    } catch (e) {
      showSaveError(`Сцена не добавилась в вечер: ${errorText(e)}`);
      return;
    }
    setSearching(false);
    setQuery("");
    onChanged();
    onPick({ id: row.id, name: row.name, kind: null, arc_id: null, arc_name: row.arc_name || null });
  }

  // Предыдущая сцена живёт в ярусе «Назад» выше — здесь весь план без неё:
  // и предстоящее, и сыгранное (в него возвращаются, партия ходит кругами).
  const todo = planned.filter((s) => s.id !== prevId);

  return (
    <div className="stack sw-tier sw-tier--grow" style={{ gap: 6 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
        <span className="sw-label">На игру</span>
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
      {todo.length === 0 && !searching && (
        <span className="muted">
          Сцены на игру не отмечены — их набирают в{" "}
          <Link to={`/sessions/${sessionId}`}>подготовке сессии</Link>.
        </span>
      )}

      <div className="sw-exits">
        {todo.map((scene) => (
          <button
            key={scene.id}
            className={`sw-exit is-plan sw-planned${pickedId === scene.id ? " is-picked" : ""}${
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
