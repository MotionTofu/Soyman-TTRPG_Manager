// Лист D&D, шапка боя: хиты, инициатива, класс доспеха, спасброски от смерти
// и состояния.
import { type ReactNode, useState, useEffect, useRef, type ChangeEvent, type KeyboardEvent } from "react";
import type { DndCharacterData, DndEquipmentSection } from "../../types";
import { conditionIconSrc } from "./conditionIcons";
import { type DndMechanicsOption, loadDndMechanicsGroup } from "./dndCompendium";
import { Modal } from "../Modal";
import { pluralRu, SbQuickValue } from "./sheetShared";
import { DndDie } from "./DndDie";
import { formatModifier } from "./AbilityScores";
import type { Derived } from "@shared/dnd/derive";
import { useDndRuntime } from "./DndRuntime";
import { useResource, useAction, write } from "../../data/hooks";
import { RECEIVED_SPELLS_ENABLED } from "./dndFeatures";
import { ReceivedSpellPicker } from "./SheetSpells";

/**
 * Закладки первой карты — до трёх строк «Действий», вынесенных на портрет.
 *
 * Пока игрок ничего не закрепил, лист предлагает сам: лучшее оружие и
 * атакующее заклинание высшего круга. Это ответ на вопрос «чем я обычно
 * бью», который за столом задают каждый ход, — и он не должен требовать
 * настройки: Мастер и игрок заняты игрой, а не листом. Как только игрок
 * закрепил хоть одну строку, показывается только его выбор.
 */
/**
 * Жетон спутника — ссылка на запись бестиария.
 *
 * Ссылка хранит и id, и имя: по id открывается статблок, а имя остаётся
 * читаемым, если запись переехала или компендиум не загрузился (правило
 * «глобальные ключи ссылок», гриллинг 2026-09-03). Портрет берётся из самой
 * записи — своего у спутника нет и не заводится.
 */
/**
 * Состояния персонажа — плашка на карте и выбор из компендиума системы.
 *
 * Список берётся из механик («Состояния»), а не из константы в коде:
 * состояния — часть системы, и у самодельной или импортированной системы
 * они свои. Пока список не загрузился (или его в системе нет), уже
 * проставленные состояния всё равно показываются: они хранятся именами.
 */
/**
 * Плашка живого ряда — состояния, концентрация, истощение.
 *
 * Кнопкой целиком, а не только числом внутри: за столом по ней попадают
 * пальцем не глядя, и подпись «КОНЦЕНТРАЦИЯ» — такая же часть мишени, как
 * значение. Вложить кнопку в кнопку нельзя, поэтому подпись и значение
 * здесь — простые span'ы.
 */
export function LiveChip({
  label,
  value,
  active,
  title,
  ariaLabel,
  onClick,
  onUndo,
  undoLabel,
}: {
  label: string;
  value: ReactNode;
  active?: boolean;
  title?: string;
  ariaLabel: string;
  onClick?: () => void;
  /** Откат на шаг назад. Истощение ходит только вверх по кругу 0…6→0, и
   *  промах пальцем за столом стоил шести нажатий через «смерть», причём
   *  каждое — сохранение (аудит 09.09, В7). Кнопка появляется, только когда
   *  откатывать есть что: пустой орган управления на карте — шум (§1.11). */
  onUndo?: () => void;
  undoLabel?: string;
}) {
  const cls = `dnd-live-chip${active ? " is-on" : ""}`;
  const body = (
    <>
      <span className="sb-label">{label}</span>
      <span className="sb-value">{value}</span>
    </>
  );
  if (!onClick) {
    return (
      <div className={cls} title={title}>
        {body}
      </div>
    );
  }
  const main = (
    <button type="button" className={cls} title={title} aria-label={ariaLabel} aria-pressed={active} onClick={onClick}>
      {body}
    </button>
  );
  if (!onUndo) return main;
  return (
    <span className="dnd-live-chip-pair">
      {main}
      <button
        type="button"
        className="dnd-live-chip-undo"
        title={undoLabel}
        aria-label={undoLabel ?? "Шаг назад"}
        onClick={onUndo}
      >
        −
      </button>
    </span>
  );
}

// Спасброски от смерти — поверх портрета, крупно (решение владельца 09.09).
// Раньше дорожки жили только на карте «Ресурсы», а урон вводится с «Карты»:
// упавший на нуле игрок оказывался за шесть карт от того, чем этот ноль
// отыгрывается (аудит 09.09, В3).
//
// Лист считает, но ничего не решает: три успеха — «Стабилизирован» (оверлей
// сжимается в полоску и освобождает портрет), три провала — «Смерть» словом,
// без единой правки данных. Судьбу персонажа объявляет стол, а не приложение
// — тот же принцип, что у концентрации и мгновенной смерти.
//
// «Стабилизирован» хранится самими тремя успехами: отдельного поля в данных
// не заводится, иначе его пришлось бы гасить в каждом месте, где меняются
// хиты. Любое лечение с нуля обнуляет обе дорожки (см. applyHeal).
export function DeathSaveOverlay({
  successes,
  failures,
  onQuickUpdate,
}: {
  successes: number;
  failures: number;
  onQuickUpdate?: (patch: Partial<DndCharacterData>) => void;
}) {
  const stabilized = successes >= 3 && failures < 3;
  const dead = failures >= 3;
  function row(field: "deathSaveSuccesses" | "deathSaveFailures", filled: number, mood: "good" | "bad", label: string) {
    return (
      <div className="dnd-death-row" role="group" aria-label={label}>
        <span className="dnd-death-label" aria-hidden="true">{label}</span>
        {[0, 1, 2].map((i) => {
          const on = i < filled;
          return (
            <button
              key={i}
              type="button"
              className={`dnd-death-cell${on ? " is-on" : ""}`}
              aria-pressed={on}
              aria-label={`${label}: ${i + 1} из 3`}
              disabled={!onQuickUpdate}
              // Повторный тап по крайней снимает — тот же приём, что у
              // PipTrack и TofuPips по всему листу: ошибочная отметка
              // откатывается одним движением, учиться нечему.
              onClick={onQuickUpdate ? () => onQuickUpdate({ [field]: i + 1 === filled ? i : i + 1 }) : undefined}
            >
              {/* Черепушки владельца (DeathSaves.png): весёлая — успех,
                  грустная — провал. Картинка фоном из CSS — автономный
                  HTML встраивает только url() стилей. */}
              {on && <span className={`dnd-death-skull is-${mood}`} aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    );
  }
  if (stabilized) {
    return (
      <div className="dnd-death-strip" role="status">
        <span className="sb-label">Стабилизирован</span>
        <button
          type="button"
          className="comp-mini"
          title="Вернуть дорожки спасбросков"
          disabled={!onQuickUpdate}
          onClick={onQuickUpdate ? () => onQuickUpdate({ deathSaveSuccesses: 2 }) : undefined}
        >
          Спасброски
        </button>
      </div>
    );
  }
  return (
    <div className="dnd-death-overlay" role="group" aria-label="Спасброски от смерти">
      <span className="dnd-death-title">{dead ? "Смерть" : "Спасброски от смерти"}</span>
      {row("deathSaveSuccesses", successes, "good", "Успехи")}
      {row("deathSaveFailures", failures, "bad", "Провалы")}
    </div>
  );
}

/**
 * Ряд навешанных состояний над живым рядом: по иконке на каждое (см.
 * conditionIcons.ts), клик ведёт в модалку. Постоянного места ряд не
 * занимает: виден, только когда есть что показать, а якорь — плашка
 * «Состояния» в живом ряду ниже. Состояние без значка не пропадает —
 * встаёт текстом.
 */
export function ActiveConditionIcons({ conditions, onOpen }: { conditions: string[]; onOpen?: () => void }) {
  if (conditions.length === 0) return null;
  return (
    <div className="dnd-active-conditions" role="list" aria-label="Активные состояния">
      {conditions.map((c) => {
        const src = conditionIconSrc(c);
        // Значок и имя капсом, как на доске состояний: значки одни
        // различались хуже, чем читались бы словами.
        const body = (
          <>
            {src && <img src={src} alt="" aria-hidden="true" draggable={false} />}
            <span className="dnd-active-condition-text">{c}</span>
          </>
        );
        // Без правки (чужой лист) — просто значки, кнопке без действия
        // на карте не место.
        if (!onOpen) {
          return (
            <span key={c} className="dnd-active-condition is-static" role="listitem" title={c}>
              {body}
            </span>
          );
        }
        return (
          <button
            key={c}
            type="button"
            className="dnd-active-condition"
            role="listitem"
            title={`${c} — изменить`}
            aria-label={`${c} — изменить состояния`}
            onClick={onOpen}
          >
            {body}
          </button>
        );
      })}
    </div>
  );
}

export function ConditionsBox({
  conditions,
  systemId,
  onQuickUpdate,
  open,
  onOpenChange,
}: {
  conditions: string[];
  systemId: number | null;
  onQuickUpdate?: (patch: Partial<DndCharacterData>) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [options, setOptions] = useState<DndMechanicsOption[]>([]);
  useEffect(() => {
    if (!open || !systemId) return;
    let alive = true;
    loadDndMechanicsGroup(systemId, "Состояния").then((v) => {
      if (alive) setOptions(v);
    });
    return () => {
      alive = false;
    };
  }, [open, systemId]);

  function toggle(name: string) {
    if (!onQuickUpdate) return;
    onQuickUpdate({
      conditions: conditions.includes(name)
        ? conditions.filter((c) => c !== name)
        : [...conditions, name],
    });
  }

  function ConditionRow({ name }: { name: string }) {
    const src = conditionIconSrc(name);
    return (
      <label className="dnd-condition-option">
        <input
          type="checkbox"
          checked={conditions.includes(name)}
          onChange={() => toggle(name)}
        />
        {src && <img className="dnd-condition-icon" src={src} alt="" aria-hidden="true" draggable={false} />}
        <span>{name}</span>
      </label>
    );
  }

  return (
    <>
      {/* Число, а не перечисление: три состояния подряд не влезают в плашку
          и рвут живой ряд на две строки. Какие именно — видно в окне,
          которое эта же плашка и открывает. */}
      <LiveChip
        label="Состояния"
        value={conditions.length > 0 ? conditions.length : "нет"}
        active={conditions.length > 0}
        ariaLabel="Состояния — изменить"
        onClick={onQuickUpdate ? () => onOpenChange(true) : undefined}
      />
      {open && (
        <Modal onClose={() => onOpenChange(false)} className="modal-conditions" ariaLabel="Состояния">
          <div className="stack dnd-conditions-modal">
            {/* Шапка, подсказка и «Готово · N» — по доске «Состояния» макета. */}
            <div className="dnd-conditions-head">
              <h3>Состояния</h3>
              <button type="button" className="dnd-conditions-close" aria-label="Закрыть" onClick={() => onOpenChange(false)}>
                ✕
              </button>
            </div>
            <p className="dnd-conditions-hint">Тап — наложить или снять. На карте — значками над живым рядом.</p>
            {options.length === 0 && (
              <p className="muted" style={{ margin: 0 }}>
                В системе не нашлось раздела механик «Состояния».
              </p>
            )}
            <div className="stack dnd-conditions-list">
              {options.map((o) => (
                <ConditionRow key={o.id} name={o.name} />
              ))}
              {/* Состояние, проставленное до того, как система обзавелась
                  списком, не должно пропасть из окна — иначе снять его будет
                  нечем. */}
              {conditions
                .filter((c) => !options.some((o) => o.name === c))
                .map((c) => (
                  <ConditionRow key={c} name={c} />
                ))}
            </div>
            <button type="button" className="primary dnd-conditions-done" onClick={() => onOpenChange(false)}>
              Готово
              {conditions.length > 0 && ` · ${conditions.length} ${pluralRu(conditions.length, "состояние", "состояния", "состояний")}`}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

// requiring the full DndCharacterEdit form for a single number. Always
// rendered (even when both fields are still unset — shows "— / —") so a
// fresh character always has a place to tap and fill these in, instead of
// the box only appearing once a value already exists somehow.
// Щелчок открывает HpEditModal — и на телефоне, и на десктопе. Раньше
// десктоп правил два числа прямо в строке и модалку не открывал вовсе, а
// значит урон, лечение, временные хиты и временный максимум были доступны
// только с телефона: за ноутбуком их приходилось считать в уме и вписывать
// в «текущие» руками.
// Эффективный максимум хитов: складской плюс временная поправка, которая
// бывает и отрицательной (похищение жизни и т.п.). Везде показывается он, а
// не складской, иначе минус «не работает»: число вписано, а лист кажет старое.
function effectiveMaxHp(value: DndCharacterData): { stored: number; temp: number; effective: number } {
  const stored = Number(value.hitPointMax) || 0;
  const temp = Number(value.hitPointMaxTemp) || 0;
  return { stored, temp, effective: stored + temp };
}

export function HpQuickBox({
  value,
  onQuickUpdate,
  accentColor,
}: {
  value: DndCharacterData;
  onQuickUpdate?: (patch: Partial<DndCharacterData>) => void;
  /** Цвет класса — заливка кости хитов. */
  accentColor?: string;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  // На кости — эффективный максимум (с временной поправкой, в т.ч. минусом),
  // а не складской: иначе вписанный минус нигде не виден.
  const { effective: effMax } = effectiveMaxHp(value);
  return (
    <div style={{ flex: 1.2 }}>
      {/* «из N» — в подписи под костью, а не на ней (макет, правка владельца
          2026-09-25): на кости одно число — сколько осталось. */}
      <div className="sb-label">
        Хиты <b>из {value.hitPointMax ? effMax : "—"}</b>
      </div>
      <SbQuickValue
        className="dnd-die-quick"
        onClick={onQuickUpdate ? () => setModalOpen(true) : undefined}
        ariaLabel="Хиты — изменить"
      >
        {/* Хиты — та же текстура, что у соседних костей: заливка цветом
            класса с текстурой спорила и убрана с экрана (решение владельца).
            `filled` остался ради печати — там текстуры нет, и векторный контур
            заливается классовым цветом, как раньше. */}
        <DndDie size="lg" filled textured accentColor={accentColor}>
          <span className="dnd-die-value">{value.hitPointsCurrent || "—"}</span>
          {/* Временные — кислотной меткой в углу кости. Именно по числу, а не
              по «строка не пустая»: и урон, и длинный отдых записывают сюда
              строку "0", а она истинна. */}
          {Number(value.hitPointsTemp) > 0 && (
            <span className="dnd-die-badge" title="Временные хиты">+{value.hitPointsTemp}</span>
          )}
        </DndDie>
      </SbQuickValue>
      {modalOpen && onQuickUpdate && (
        <HpEditModal value={value} onQuickUpdate={onQuickUpdate} onClose={() => setModalOpen(false)} />
      )}
    </div>
  );
}

const HP_KEYS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

function HpBackspaceIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M9 5h11v14H9L3 12z" />
      <path d="M13 9.5l5 5M18 9.5l-5 5" />
    </svg>
  );
}

// Порядок блоков отвечает частоте: за столом окно открывают, чтобы записать
// урон или лечение, а не чтобы поправить максимум — максимум меняет визард
// повышения уровня. Поэтому пад и две кнопки стоят в середине, а четыре поля
// живут под свёрткой.
function HpEditModal({
  value,
  onQuickUpdate,
  onClose,
}: {
  value: DndCharacterData;
  onQuickUpdate: (patch: Partial<DndCharacterData>) => void;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [concentrationDc, setConcentrationDc] = useState<number | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  // Свёртка открывается ниже видимой части окна: содержимое с четырьмя полями
  // выше 85vh, и без подтяжки нажатие выглядело так, будто ничего не
  // произошло.
  const fieldsRef = useRef<HTMLDivElement>(null);
  // Последнее применение — для отмены. Хранятся оба поля: урон сначала съедает
  // временные хиты, и откат, вернувший только текущие, потерял бы их.
  const [last, setLast] = useState<{ current: string; temp: string; text: string } | null>(null);
  // Черновик четырёх полей. Раньше каждое из них звало onQuickUpdate прямо из
  // onChange — то есть на каждое нажатие клавиши пересобирался весь чарник и
  // уходил PUT: набрать «15» стоило двух запросов, а промежуточное пустое
  // поле на секунду записывало «хитов нет». Теперь правка живёт локально до
  // blur или Enter.
  const [draft, setDraft] = useState({
    hitPointsCurrent: value.hitPointsCurrent,
    hitPointMax: value.hitPointMax,
    hitPointsTemp: value.hitPointsTemp,
    hitPointMaxTemp: value.hitPointMaxTemp,
  });
  type HpField = keyof typeof draft;
  // Урон и лечение считают от сохранённого значения, поэтому набранное в полях
  // надо сначала зафиксировать — иначе кнопка «Урон» вычтет из старых хитов.
  function commitField(field: HpField) {
    if (draft[field] === value[field]) return;
    const patch = { [field]: draft[field] } as Partial<DndCharacterData>;
    // Снижение временного максимума опускает и текущие, если они оказались
    // выше нового потолка: по правилам максимум тянет их за собой, а «27 из
    // 22» на листе — враньё. Повышение текущих не трогает.
    if (field === "hitPointMaxTemp") {
      const eff = maxNum + (Number(draft[field]) || 0);
      if (curNum > eff) {
        patch.hitPointsCurrent = String(Math.max(0, eff));
        setDraft((d) => ({ ...d, hitPointsCurrent: patch.hitPointsCurrent as string }));
      }
    }
    onQuickUpdate(patch);
  }
  function hpFieldProps(field: HpField) {
    return {
      type: "number",
      value: draft[field],
      onChange: (e: ChangeEvent<HTMLInputElement>) =>
        setDraft((d) => ({ ...d, [field]: e.target.value })),
      onBlur: () => commitField(field),
      onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") commitField(field);
      },
    };
  }

  useEffect(() => {
    if (manualOpen) fieldsRef.current?.scrollIntoView({ block: "nearest" });
  }, [manualOpen]);

  const curNum = Number(value.hitPointsCurrent) || 0;
  const maxNum = Number(value.hitPointMax) || 0;
  const tempNum = Number(value.hitPointsTemp) || 0;
  const maxTempNum = Number(value.hitPointMaxTemp) || 0;
  const effMax = maxNum + maxTempNum;
  const atZero = maxNum > 0 && curNum <= 0;
  // Полоса: сплошное — текущие хиты, штриховка — временные, и штриховка стоит
  // справа намеренно. Урон снимает её первой, так что полоса заодно
  // показывает правило, а не просто заполняется. Делитель — эффективный
  // максимум: временный минус сжимает шкалу, а не прячется за складским.
  const barTotal = Math.max(1, effMax + tempNum);
  const curPct = Math.max(0, Math.min(100, (curNum / barTotal) * 100));
  const tempPct = Math.max(0, Math.min(100 - curPct, (tempNum / barTotal) * 100));

  // Пад вместо клавиатуры: на телефоне системная клавиатура закрывала
  // половину окна, включая кнопки «Урон» и «Лечение», ради которых его и
  // открывали. Три цифры — потолок в 999, больше одним ударом не наносят.
  function pressKey(d: number) {
    setAmount((a) => {
      const next = (a + String(d)).replace(/^0+(?=\d)/, "");
      return next.length > 3 ? a : next;
    });
  }

  function applyDamage() {
    const n = Number(amount) || 0;
    if (n <= 0) return;
    const fromTemp = Math.min(n, Math.max(0, tempNum));
    const rest = n - fromTemp;
    // Хиты не уходят в минус: по правилам они останавливаются на нуле, а
    // «-7 хитов» на листе — это ещё и потерянный признак того, что персонаж
    // при смерти. Мгновенная смерть от превышения максимума за одно
    // попадание — решение стола, лист её не объявляет.
    const patch = {
      hitPointsTemp: String(tempNum - fromTemp),
      hitPointsCurrent: String(Math.max(0, curNum - rest)),
    };
    onQuickUpdate(patch);
    setDraft((d) => ({ ...d, ...patch }));
    setLast({
      current: value.hitPointsCurrent,
      temp: value.hitPointsTemp,
      text: `−${n} · ${curNum} → ${patch.hitPointsCurrent}`,
    });
    // Урон по концентрирующемуся требует спасброска Телосложения, СЛ 10 или
    // половина урона — что больше. Лист считает СЛ, но не решает за игрока:
    // спасбросок чаще проходит, чем нет, и снимать концентрацию самому было
    // бы враньём. Исключение — Неустанный охотник следопыта (13 ур.): урон не
    // прерывает концентрацию на Метке охотника, и СЛ тогда не показываем.
    const relentlessHunter = [...value.classFeatures, ...value.speciesFeatures, ...value.feats, ...value.specialAbilities].some(
      (f) => f.name === "Неустанный охотник"
    );
    const huntersMarkConc = /метка охотника/i.test(value.concentration ?? "");
    if (value.concentration && !(relentlessHunter && huntersMarkConc)) {
      setConcentrationDc(Math.max(10, Math.floor(n / 2)));
    }
    setAmount("");
  }
  function applyHeal() {
    const n = Number(amount) || 0;
    if (n <= 0) return;
    // Потолок лечения — эффективный максимум: временный минус его снижает.
    const cap = effMax;
    const healed = cap > 0 ? Math.min(curNum + n, cap) : curNum + n;
    // Любое лечение с нуля поднимает на ноги: накопленные спасброски от
    // смерти сбрасываются, иначе они переживут исцеление и убьют персонажа
    // в следующем бою.
    const revived = curNum <= 0 && healed > 0;
    onQuickUpdate({
      hitPointsCurrent: String(healed),
      ...(revived ? { deathSaveSuccesses: 0, deathSaveFailures: 0 } : {}),
    });
    setDraft((d) => ({ ...d, hitPointsCurrent: String(healed) }));
    setLast({
      current: value.hitPointsCurrent,
      temp: value.hitPointsTemp,
      text: `+${n} · ${curNum} → ${healed}`,
    });
    setConcentrationDc(null);
    setAmount("");
  }
  // Отмена возвращает ровно то, что было до применения. Спасброски от смерти,
  // сброшенные лечением с нуля, она не восстанавливает: их значение — итог
  // бросков за столом, и «вернуть как было» тут угадыванием не заменишь.
  function undoLast() {
    if (!last) return;
    onQuickUpdate({ hitPointsCurrent: last.current, hitPointsTemp: last.temp });
    setDraft((d) => ({ ...d, hitPointsCurrent: last.current, hitPointsTemp: last.temp }));
    setLast(null);
    setConcentrationDc(null);
  }

  return (
    <Modal onClose={onClose} ariaLabel="Хиты" autoFocus={false}>
      <div className="dnd-hp-modal">
        <div className="dnd-hp-plate">
          <span className="dnd-hp-plate-title">Хиты</span>
          <button type="button" className="dnd-hp-close" aria-label="Закрыть" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="M3 3l10 10M13 3L3 13" />
            </svg>
          </button>
        </div>

        <div className="dnd-hp-state">
          <div className="dnd-hp-readout">
            <span className={atZero ? "dnd-hp-cur is-down" : "dnd-hp-cur"}>{value.hitPointsCurrent || "—"}</span>
            <span className="dnd-hp-max">/ {value.hitPointMax ? effMax : "—"}</span>
            {/* §1.11: блоку, которому нечего показать, показывать нечего. */}
            {tempNum > 0 && <span className="dnd-hp-temp-chip">+{tempNum} врем</span>}
            {maxTempNum !== 0 && <span className="dnd-hp-temp-chip">{formatModifier(maxTempNum)} макс</span>}
          </div>
          <div className="dnd-hp-bar">
            <div className="dnd-hp-bar-cur" style={{ width: `${curPct}%` }} />
            <div className="dnd-hp-bar-temp" style={{ width: `${tempPct}%` }} />
          </div>
        </div>

        {last && (
          <div className="dnd-hp-undo">
            <span className="dnd-hp-undo-text">{last.text}</span>
            <button type="button" onClick={undoLast}>
              Отменить
            </button>
          </div>
        )}

        {concentrationDc !== null && value.concentration && (
          <div className="dnd-hp-conc">
            <div className="dnd-hp-conc-text">
              <span className="dnd-hp-caps">Концентрация</span>
              <br />«{value.concentration}» — спасбросок Телосложения, СЛ{" "}
              <span className="dnd-hp-conc-dc">{concentrationDc}</span>
            </div>
            {/* Две кнопки, а не одна: раньше лист предлагал только «Сорвалась»,
                и после удачного спасброска подсказка висела до закрытия окна. */}
            <div className="row" style={{ gap: 6 }}>
              <button
                type="button"
                onClick={() => {
                  onQuickUpdate({ concentration: "" });
                  setConcentrationDc(null);
                }}
              >
                Сорвалась
              </button>
              <button type="button" onClick={() => setConcentrationDc(null)}>
                Устояла
              </button>
            </div>
          </div>
        )}

        {atZero && (
          <div className="dnd-hp-down">
            Без сознания. Спасброски от смерти — на портрете. Любое лечение поднимает на ноги и сбрасывает их.
          </div>
        )}

        <div className="dnd-hp-apply">
          <div className="dnd-hp-amount">
            <span className="dnd-hp-caps">Сколько</span>
            <span className={amount === "" ? "dnd-hp-amount-value is-empty" : "dnd-hp-amount-value"}>
              {amount === "" ? "0" : amount}
            </span>
          </div>
          <div className="dnd-hp-pad">
            {HP_KEYS.map((d) => (
              <button type="button" key={d} className="dnd-hp-key" onClick={() => pressKey(d)}>
                {d}
              </button>
            ))}
            <button
              type="button"
              className="dnd-hp-key is-aux"
              aria-label="Стереть цифру"
              onClick={() => setAmount((a) => a.slice(0, -1))}
            >
              <HpBackspaceIcon />
            </button>
            <button type="button" className="dnd-hp-key" onClick={() => pressKey(0)}>
              0
            </button>
            <button type="button" className="dnd-hp-key is-aux is-word" onClick={() => setAmount("")}>
              Сброс
            </button>
          </div>
          <div className="dnd-hp-actions">
            <button type="button" className="danger" onClick={applyDamage} disabled={!Number(amount)}>
              Урон
            </button>
            <button type="button" className="primary" onClick={applyHeal} disabled={!Number(amount)}>
              Лечение
            </button>
          </div>
        </div>

        <button
          type="button"
          className={manualOpen ? "dnd-hp-manual is-open" : "dnd-hp-manual"}
          aria-expanded={manualOpen}
          onClick={() => setManualOpen((v) => !v)}
        >
          <span className="dnd-hp-caps">Поправить вручную</span>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d={manualOpen ? "M12 10L8 6l-4 4" : "M4 6l4 4 4-4"} />
          </svg>
        </button>

        {manualOpen && (
          <>
            <div className="dnd-hp-fields" ref={fieldsRef}>
              <label>
                <span className="dnd-hp-caps">Текущие</span>
                <input {...hpFieldProps("hitPointsCurrent")} />
              </label>
              <label>
                <span className="dnd-hp-caps">Максимум</span>
                <input {...hpFieldProps("hitPointMax")} />
              </label>
              <label>
                <span className="dnd-hp-caps">Временные</span>
                <input {...hpFieldProps("hitPointsTemp")} />
              </label>
              <label>
                <span className="dnd-hp-caps">Врем. максимум</span>
                <input {...hpFieldProps("hitPointMaxTemp")} />
              </label>
            </div>
            <p className="dnd-hp-hint">
              Максимум обычно меняет визард повышения уровня — здесь он на случай эффектов, которых лист не знает.
              Врем. максимум бывает и минусом (похищение жизни): текущие опустятся до нового потолка сами.
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}

// Плашка инициативы в «Действиях» (по центру между правкой и веером):
// своё число — чтобы помнить его и назвать Мастеру. Число — из калькулятора
// на кости с лица карты; щелчок по плашке открывает тот же калькулятор.
// С кампанией число и место в очереди берутся у Мастера (туда уходит бросок).
export function InitiativePlate({
  characterId,
  local,
  derived,
  misc,
  onQuickUpdate,
}: {
  characterId?: number | null;
  /** Своё записанное число — без кампании только оно и есть. */
  local: number | null;
  derived: Derived;
  misc: string;
  onQuickUpdate?: (patch: Partial<DndCharacterData>) => void;
}) {
  const { campaignConnected } = useDndRuntime();
  const [open, setOpen] = useState(false);
  // Мастер поправил число в очереди — плашка обновляется тем же событием,
  // которым обновляется весь лист (data/syncAffects.ts).
  const standing = useResource<{ initiative: number | null; place: number | null }>(
    campaignConnected && characterId != null ? `/characters/${characterId}/initiative` : null
  ).data;
  const inQueue = standing?.place != null;
  const shown = inQueue ? standing.initiative : local;
  return (
    <>
      <button
        type="button"
        className="dnd-magic-num dnd-initiative-plate"
        disabled={!onQuickUpdate}
        onClick={() => setOpen(true)}
        aria-label={`Инициатива ${shown ?? "не брошена"} — открыть калькулятор`}
      >
        <span>Инициатива</span> <b>{shown ?? "—"}</b>
        {inQueue && <span>{standing.place}-й в очереди</span>}
      </button>
      {open && (
        <InitiativeRollModal
          derived={derived}
          misc={misc}
          local={local}
          characterId={characterId}
          onQuickUpdate={onQuickUpdate}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

// Бонус инициативы на лице карты. Щелчок открывает модалку броска: там игрок
// вписывает то, что выпало на к20, а приложение прибавляет бонус и отправляет
// сумму Мастеру в очередь.
//
// Почему не поле ввода прямо здесь: за столом у игрока заняты руки и голова, а
// на экран он смотрит урывками. Складывать кубик с бонусом в уме — работа,
// которую машина делает бесплатно; а до модалки бонус вообще нигде не
// раскладывался, и проверить его было нечем.
export function InitiativeQuickBox({
  derived,
  misc,
  local,
  characterId,
  onQuickUpdate,
}: {
  derived: Derived;
  misc: string;
  local: number | null;
  characterId?: number | null;
  onQuickUpdate?: (patch: Partial<DndCharacterData>) => void;
}) {
  const { campaignConnected } = useDndRuntime();
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div className="sb-label">Инициатива</div>
      <SbQuickValue
        className="dnd-die-quick"
        title={onQuickUpdate ? (campaignConnected ? "Нажмите, чтобы бросить инициативу" : "Вписать результат инициативы") : undefined}
        ariaLabel={campaignConnected ? "Инициатива — бросить и отправить Мастеру" : "Инициатива — вписать результат"}
        onClick={onQuickUpdate ? () => setOpen(true) : undefined}
      >
        <DndDie size="lg" textured>
          <span className="dnd-die-value">{formatModifier(derived.value)}</span>
        </DndDie>
      </SbQuickValue>
      {open && (
        <InitiativeRollModal
          derived={derived}
          misc={misc}
          local={local}
          characterId={characterId}
          onQuickUpdate={onQuickUpdate}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function InitiativeRollModal({
  derived,
  misc,
  local,
  characterId,
  onQuickUpdate,
  onClose,
}: {
  derived: Derived;
  misc: string;
  /** Записанное в листе число — без кампании сбрасывается оно. */
  local: number | null;
  characterId?: number | null;
  onQuickUpdate?: (patch: Partial<DndCharacterData>) => void;
  onClose: () => void;
}) {
  const [die, setDie] = useState("");
  const { campaignConnected } = useDndRuntime();
  const [miscDraft, setMiscDraft] = useState(misc);
  const [sending, setSending] = useState(false);
  const initiativePath = characterId != null ? `/characters/${characterId}/initiative` : null;
  const standing =
    useResource<{ initiative: number | null; place: number | null }>(initiativePath).data ?? null;
  const run = useAction();
  // Брошенное число меняет место в очереди боя Мастера — задеты оба.
  const initiativeAffects = [
    ...(initiativePath ? [{ path: initiativePath }] : []),
    { path: "/initiative-entries" },
  ];

  const bonus = derived.value;
  const dieNum = die.trim() === "" ? null : Number(die.trim());
  const dieValid = dieNum != null && Number.isFinite(dieNum);
  const total = dieValid ? dieNum + bonus : null;

  // Слагаемые бонуса, кроме ручной поправки: она ниже отдельной строкой с
  // полем ввода — иначе задать её было бы негде.
  const rows = derived.parts.filter((p) => p.label !== "Прочее" && p.value !== 0);

  async function send() {
    if (!dieValid || sending) return;
    if (!campaignConnected) { onQuickUpdate?.({ initiative: total, initiativeMisc: miscDraft }); onClose(); return; }
    if (characterId == null) return;
    setSending(true);
    try {
      const sent = await run(
        async () => {
          await write.put(`/characters/${characterId}/initiative`, { initiative: total });
          return true;
        },
        { affects: initiativeAffects }
      );
      if (!sent) return;
      onQuickUpdate?.({ initiative: total });
      onClose();
    } finally {
      setSending(false);
    }
  }

  async function reset() {
    if (!campaignConnected) { onQuickUpdate?.({ initiative: null }); onClose(); return; }
    if (characterId == null || sending) return;
    setSending(true);
    try {
      const sent = await run(
        async () => {
          await write.put(`/characters/${characterId}/initiative`, { initiative: null });
          return true;
        },
        { affects: initiativeAffects }
      );
      if (!sent) return;
      onQuickUpdate?.({ initiative: null });
      onClose();
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal onClose={onClose} ariaLabel="Бросок инициативы">
      <div className="stack dnd-init-modal" style={{ gap: 10 }}>
        <strong>Бросок инициативы</strong>
        <div className="muted">
          {campaignConnected ? 'Напиши сюда значение на д20, а мы прибавим бонус инициативы и отправим Мастеру в очередь боя.' : 'Впишите результат физического броска д20. Бонус будет добавлен, а итог сохранён в листе.'}
        </div>
        <div className="row" style={{ gap: 8, alignItems: "center" }}>
          <input
            autoFocus
            type="number"
            style={{ width: 72 }}
            placeholder="к20"
            value={die}
            onChange={(e) => setDie(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
          />
          <span className="muted">
            {formatModifier(bonus)} = <b>{total ?? "—"}</b>
          </span>
        </div>

        <div className="stack dnd-init-breakdown" style={{ gap: 2 }}>
          {rows.length === 0 ? (
            <div className="muted">У персонажа отсутствуют бонусы к инициативе.</div>
          ) : (
            rows.map((p, i) => (
              <div key={`${p.label}-${i}`} className="row dnd-init-row" style={{ justifyContent: "space-between" }}>
                <span>{p.label}</span>
                <span>{formatModifier(p.value)}</span>
              </div>
            ))
          )}
          {/* Ручная поправка — всегда: это единственное место, где её задают,
              и появляйся строка только при непустом значении, задать её было
              бы негде. */}
          <div className="row dnd-init-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <span>Дополнительный бонус</span>
            <input
              type="number"
              style={{ width: 56 }}
              value={miscDraft}
              onChange={(e) => setMiscDraft(e.target.value)}
              onBlur={() => miscDraft !== misc && onQuickUpdate?.({ initiativeMisc: miscDraft })}
            />
          </div>
        </div>

        {standing?.place != null && (
          <div className="muted">
            {standing.initiative == null
              ? "Мастер держит тебя в очереди, числа пока нет."
              : `Сейчас у Мастера: ${standing.initiative} · ${standing.place}-й в очереди`}
          </div>
        )}

        <div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
          {(campaignConnected ? standing?.initiative != null : local != null) && (
            <button type="button" className="comp-mini" onClick={reset} disabled={sending || !onQuickUpdate}>
              Сбросить
            </button>
          )}
          <button type="button" className="comp-mini" onClick={send} disabled={!dieValid || sending}>
            {sending ? "…" : campaignConnected ? "Отправить Мастеру" : "Сохранить результат"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// КЗ is always computed (10/armor + Ловкость, capped per equipped armor,
// plus flat bonuses from equipped items, plus Защита без доспехов when its
// feature is on the sheet and no armor — and no shield for a monk — is worn)
// — the only thing a click here edits is the small manual bonus for effects
// not captured by inventory (Shield/Mage Armor spells, …), same click-to-edit
// shell as TextQuickBox.
export function AcQuickBox({
  derived,
  manualBonus,
  activeSpells,
  received,
  systemId,
  sections,
  onQuickUpdate,
}: {
  derived: Derived;
  manualBonus: string;
  /** Действующие заклинания без концентрации — плашками под костью. */
  activeSpells: string[];
  /** Наложенное на меня другими (Q10) — тоже плашками. */
  received: NonNullable<DndCharacterData["receivedSpells"]>;
  systemId: number | null;
  /** Инвентарь — для переноса бонуса «Защитника» в КЗ (Q11). */
  sections: DndEquipmentSection[];
  onQuickUpdate?: (patch: Partial<DndCharacterData>) => void;
}) {
  const [open, setOpen] = useState(false);
  // Плашка — только у заклинания, которое сейчас меняет КЗ: «Доспехи мага»
  // под латами не действуют, и плашка без эффекта путала бы.
  // Наложенное другими — плашкой всегда: «Благословение» КЗ не меняет, а
  // снять его, кроме плашки, негде.
  const chips = [
    ...activeSpells
      .map((name) => ({ name, part: derived.parts.find((p) => p.label === name) }))
      .filter((c) => c.part),
    ...received.map((r) => ({ name: r.name, part: derived.parts.find((p) => p.label === r.name) })),
  ];
  const dismiss = (name: string) =>
    onQuickUpdate?.(
      activeSpells.includes(name)
        ? { activeSpells: activeSpells.filter((n) => n !== name) }
        : { receivedSpells: received.filter((r) => r.name !== name) }
    );
  return (
    <div>
      <div className="sb-label">КЗ</div>
      <SbQuickValue
        className="dnd-die-quick"
        title="Нажмите, чтобы увидеть, из чего сложился КЗ"
        ariaLabel={`Класс защиты ${derived.value} — из чего сложился`}
        onClick={() => setOpen(true)}
      >
        <DndDie size="lg" textured>
          <span className="dnd-die-value">{derived.value}</span>
        </DndDie>
      </SbQuickValue>
      {chips.map(({ name, part }) => (
        <div key={name} className="dnd-ac-chip">
          <span>{!part || derived.parts.indexOf(part) === 0 ? name : `${formatModifier(part.value)} ${name}`}</span>
          {onQuickUpdate && (
            <button type="button" className="comp-mini" aria-label={`${name} — закончилось`} onClick={() => dismiss(name)}>
              ✕
            </button>
          )}
        </div>
      ))}
      {(derived.situational ?? []).map((s) => (
        <div key={`sit-${s.label}`} className="muted dnd-ac-situational" title={s.label}>
          {s.text}
        </div>
      ))}
      {open && (
        <AcBreakdownModal
          derived={derived}
          manualBonus={manualBonus}
          received={received}
          systemId={systemId}
          sections={sections}
          onQuickUpdate={onQuickUpdate}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

// Разбор КЗ (гриллинг 2026-09-23, Q23): из чего сложилось число и что не
// вошло, с причиной. Первая строка — база (доспех, «Без доспеха» или формула
// умения), дальше — прибавки. Ручная поправка — отдельной строкой с полем,
// как у инициативы: задать её больше негде.
function AcBreakdownModal({
  derived,
  manualBonus,
  received,
  systemId,
  sections,
  onQuickUpdate,
  onClose,
}: {
  derived: Derived;
  manualBonus: string;
  received: NonNullable<DndCharacterData["receivedSpells"]>;
  systemId: number | null;
  sections: DndEquipmentSection[];
  onQuickUpdate?: (patch: Partial<DndCharacterData>) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(manualBonus);
  const [picking, setPicking] = useState(false);
  // Надетое оружие, чей бонус переносится в КЗ («Защитник», Q11).
  const shiftables = sections.flatMap((sec, si) =>
    sec.items.flatMap((it, ii) => (it.equipped && it.acShiftable && it.magicBonus ? [{ si, ii, it }] : []))
  );
  const setShift = (si: number, ii: number, acShift: number) =>
    onQuickUpdate?.({
      equipmentSections: sections.map((sec, s) =>
        s !== si ? sec : { ...sec, items: sec.items.map((it, i) => (i === ii ? { ...it, acShift } : it)) }
      ),
    });
  const rows = derived.parts.filter((p) => p.label !== "Прочее");
  return (
    <Modal onClose={onClose} ariaLabel="Класс защиты">
      <div className="stack dnd-init-modal" style={{ gap: 10 }}>
        <strong>Класс защиты {derived.value}</strong>
        {derived.stale && <div className="muted">{derived.stale}</div>}
        <div className="stack dnd-init-breakdown" style={{ gap: 2 }}>
          {rows.map((p, i) => (
            <div key={`${p.label}-${i}`} className="row dnd-init-row" style={{ justifyContent: "space-between" }}>
              <span>{p.label}</span>
              <span>{i === 0 ? p.value : formatModifier(p.value)}</span>
            </div>
          ))}
          {(derived.inactive ?? []).map((x) => (
            <div key={`off-${x.label}`} className="row dnd-init-row muted" style={{ justifyContent: "space-between" }}>
              <span>{x.label}</span>
              <span>не учтено: {x.reason}</span>
            </div>
          ))}
          {(derived.situational ?? []).map((s) => (
            <div key={`sit-${s.label}`} className="row dnd-init-row muted" style={{ justifyContent: "space-between" }}>
              <span>{s.label}</span>
              <span>{s.text}</span>
            </div>
          ))}
          {shiftables.map(({ si, ii, it }) => (
            <div key={`shift-${si}-${ii}`} className="row dnd-init-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <span>{it.name}: бонус в КЗ</span>
              {onQuickUpdate ? (
                <input
                  type="number"
                  min={0}
                  max={it.magicBonus}
                  style={{ width: 56 }}
                  aria-label={`${it.name}: сколько бонуса перенести в КЗ`}
                  value={it.acShift ?? 0}
                  onChange={(e) =>
                    setShift(si, ii, Math.max(0, Math.min(it.magicBonus ?? 0, Number.parseInt(e.target.value, 10) || 0)))
                  }
                />
              ) : (
                <span>{it.acShift ?? 0}</span>
              )}
            </div>
          ))}
          <div className="row dnd-init-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <span>Дополнительный бонус</span>
            {onQuickUpdate ? (
              <input
                type="number"
                style={{ width: 56 }}
                aria-label="Дополнительный бонус к КЗ"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => draft !== manualBonus && onQuickUpdate({ manualAcBonus: draft })}
              />
            ) : (
              <span>{manualBonus || "0"}</span>
            )}
          </div>
        </div>
        {RECEIVED_SPELLS_ENABLED && onQuickUpdate && systemId != null && (
          picking ? (
            <ReceivedSpellPicker
              systemId={systemId}
              onPick={(entry) => {
                setPicking(false);
                if (received.some((r) => r.entryId === entry.id)) return;
                onQuickUpdate({ receivedSpells: [...received, { name: entry.name, entryId: entry.id }] });
              }}
              onCancel={() => setPicking(false)}
            />
          ) : (
            <button type="button" className="comp-mini" style={{ alignSelf: "flex-start" }} onClick={() => setPicking(true)}>
              + Наложено на меня
            </button>
          )
        )}
      </div>
    </Modal>
  );
}
