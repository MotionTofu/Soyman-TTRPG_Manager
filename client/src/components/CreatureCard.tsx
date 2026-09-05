import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { getCachedUser } from "../api/currentUser";
import { Modal } from "./Modal";
import { MentionText } from "./mentions/MentionText";
import { DndCreatureView, normalizeDndCreature } from "./dnd/DndCreatureForm";
import type { DndCreatureAction, DndCreatureData, DndCreatureSpeed } from "../types";

// Карточка существа — быстрый взгляд (design_revision.md, шаг 4). Показывает
// то, чем существо отличается от других; за полным статблоком Мастер идёт
// кнопкой. Одна колоночная вёрстка на все места: измеренные ширины —
// докстанция ~280, модалка меншена ~380, поповер полотна 300 — это одна и та
// же колонка, а не три ступени.

export const COMBAT_ROLES = [
  "Ближний бой",
  "Дальний бой",
  "Танковый",
  "Заклинатель",
  "Контроль",
  "Мобильный",
  "Высокий урон",
] as const;

// Больше двух ролей — это существо без роли: ограничение заставляет Мастера
// назвать главное, ради чего карточка и заведена.
export const MAX_COMBAT_ROLES = 2;

export interface CreatureCardStatblock {
  id: number;
  kind: string;
  format: string;
  content: string;
  theme: string | null;
  density: string | null;
  avatar_image_url: string | null;
}

export interface CreatureCardPayload {
  type: "being" | "compendium_entry";
  id: number;
  name: string;
  description: string;
  combat_roles: string[];
  tactics: string[];
  secret: string;
  avatar_image_url: string | null;
  statblock: CreatureCardStatblock | null;
  statblock_inherited: boolean;
  inherited: {
    from_id: number;
    from_name: string;
    description: string;
    combat_roles: string[];
    tactics: string[];
  } | null;
}

const PROFILE_PATH: Record<string, string> = {
  being: "/beings",
  compendium_entry: "/compendium",
};

export async function fetchCreatureCard(
  type: string,
  id: number,
  statblockId?: number
): Promise<CreatureCardPayload> {
  const q = statblockId ? `?statblock_id=${statblockId}` : "";
  try {
    return await api.get<CreatureCardPayload>(`/creature-card/${type}/${id}${q}`);
  } catch (e) {
    // Жетон спутника открывает ту же карточку и у игрока, а мастерский
    // /creature-card ему закрыт. Существа сеттинга (being) игроку не отдаём
    // и здесь: игроцкий роут существует только для записей бестиария.
    if (type === "compendium_entry" && getCachedUser()?.role === "player") {
      return api.get<CreatureCardPayload>(`/player/creature-card/compendium_entry/${id}${q}`);
    }
    throw e;
  }
}

// Скорость показывается, только если набор отличается от «ходьба 30» — и
// тогда печатаются ВСЕ ненулевые, включая ходьбу: «полёт 60» у бегающей твари
// читается как «не ходит».
export function formatCardSpeed(speed: DndCreatureSpeed): string {
  const others =
    speed.fly !== null || speed.swim !== null || speed.climb !== null || speed.burrow !== null || !!speed.note;
  if (!others && (speed.walk === null || speed.walk === 30)) return "";
  const parts: string[] = [];
  if (speed.walk === 0) parts.push("неподвижно");
  else if (speed.walk !== null) parts.push(`ходьба ${speed.walk} фт.`);
  if (speed.fly !== null) parts.push(`полёт ${speed.fly} фт.${speed.hover ? " (парит)" : ""}`);
  if (speed.swim !== null) parts.push(`плавание ${speed.swim} фт.`);
  if (speed.climb !== null) parts.push(`лазание ${speed.climb} фт.`);
  if (speed.burrow !== null) parts.push(`копание ${speed.burrow} фт.`);
  if (speed.note) parts.push(speed.note);
  return parts.join(", ");
}

// Карточка печатает ЧИСЛА, а не их происхождение: тип защиты («натуральная
// броня», «кольчуга») и кости хитов — это разбор статблока, за ним Мастер
// открывает статблок. На быстром взгляде они занимают полстроки каждое и не
// меняют ни одного решения за столом.
export function cardArmorClass(value: DndCreatureData): string {
  return value.armorClass.value !== null ? String(value.armorClass.value) : "—";
}

export function cardHitPoints(value: DndCreatureData): string {
  const hp = value.hitPoints;
  if (hp.diceCount && hp.dieSize) {
    return String(Math.floor(hp.diceCount * (hp.dieSize / 2 + 0.5)) + (hp.bonus ?? 0));
  }
  // Не разобранный в поля статблок хранит строку вида «45 (6к10+18)» —
  // среднее из неё и берём, скобку отбрасываем.
  const fromFormula = hp.formula.match(/\d+/);
  return fromFormula ? fromFormula[0] : "";
}

function allActionRows(value: DndCreatureData): DndCreatureAction[] {
  return [
    ...value.actions,
    ...value.bonusActions,
    ...value.reactions,
    ...value.legendary.actions,
    ...value.legendary.lairActions,
  ];
}

// Максимум, а не среднее и не диапазон: за столом нужна верхняя граница
// угрозы — «во что оно попадёт», — а вторую цифру разбирать некогда.
export function maxAttackBonus(value: DndCreatureData): number | null {
  const bonuses = allActionRows(value)
    .filter((a) => a.rollType === "attack" && typeof a.bonus === "number")
    .map((a) => a.bonus as number);
  const spellBonuses = value.spellcasting.spells
    .filter((s) => s.rollType === "attack" && typeof s.bonus === "number")
    .map((s) => s.bonus as number);
  const all = [...bonuses, ...spellBonuses];
  return all.length ? Math.max(...all) : null;
}

export function maxSaveDC(value: DndCreatureData): number | null {
  const dcs = allActionRows(value)
    .filter((a) => typeof a.saveDC === "number")
    .map((a) => a.saveDC as number);
  const spellDCs = value.spellcasting.spells
    .filter((s) => typeof s.saveDC === "number")
    .map((s) => s.saveDC as number);
  const all = [...dcs, ...spellDCs];
  return all.length ? Math.max(...all) : null;
}

// Из чувств на карточку идут только те, что меняют тактику Мастера сразу.
// Пассивная внимательность, языки и преимущество на спасбросках остаются в
// полном статблоке.
const CARD_SENSES = ["тёмное", "темное", "истинное", "слеп"];

function cardSenses(value: DndCreatureData): string[] {
  return value.sensesList
    .filter((s) => CARD_SENSES.some((needle) => s.name.toLowerCase().includes(needle)))
    .map((s) => `${s.name}${s.distance ? ` ${s.distance} фт.` : ""}`);
}

function formatChallenge(value: DndCreatureData): string {
  if (!value.challenge.rating) return "";
  const pb = value.challenge.proficiencyBonus;
  return `КО ${value.challenge.rating}${pb ? ` (БМ +${pb})` : ""}`;
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}

// Свёрнутость блока — своя у каждой карточки, а не общая на приложение.
// Общее состояние отменено владельцем: в докстанции рядом стоят несколько
// карточек, и сворачивать их приходится по одной — общий тумблер там сворачивал
// бы всю колонку разом.
//
// Само состояние живёт в карточке, а не здесь: свёрнутая целиком карточка
// (докстанция) блоки не рисует, и состояние, оставленное внутри них, умирало
// вместе с размонтированием — развернув карточку, Мастер снова получал оба
// блока раскрытыми.
function Section({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className="creature-card__section">
      <button
        type="button"
        className={`creature-card__section-head${open ? " is-open" : ""}`}
        onClick={onToggle}
      >
        <span>{title}</span>
        <span className="creature-card__section-mark">{open ? "−" : "+"}</span>
      </button>
      {open && <div className="creature-card__section-body">{children}</div>}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="creature-card__row">
      <span className="creature-card__label">{label}</span>
      <span className="creature-card__value">{value}</span>
    </div>
  );
}

export function CreatureCard({
  data,
  playerSafe,
  variant = "column",
  hideProfileButton,
  profileInNewWindow,
  onShowStatblock,
  onClose,
  collapsed,
  onToggleCollapse,
}: {
  data: CreatureCardPayload;
  // Показ игрокам: секрет и тактика НЕ рендерятся вовсе — свёрнутый блок
  // видно, и по нему видно, что тайна есть. В этом шаге не включается нигде.
  playerSafe?: boolean;
  variant?: "column" | "page";
  hideProfileButton?: boolean;
  // В докстанции пульта переход в профиль уводит с живой сессии, а док при
  // уходе сбрасывается — поэтому оттуда профиль открывается новым окном.
  profileInNewWindow?: boolean;
  // Задан — кнопка «Статблок» отдаётся хозяину: модалка меншена подменяет
  // своё содержимое вместо второй модалки поверх первой.
  onShowStatblock?: () => void;
  onClose?: () => void;
  // Сворачивание карточки целиком — в докстанции пульта, где их несколько в
  // одной колонке. Свёрнутая карточка оставляет плашку с портретом и именем и
  // обе кнопки: это то, ради чего её туда положили.
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const [statblockOpen, setStatblockOpen] = useState(false);
  const [sectionsOpen, setSectionsOpen] = useState({ mechanics: true, description: true });
  const toggleSection = (key: "mechanics" | "description") =>
    setSectionsOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  const creature: DndCreatureData | null = data.statblock
    ? {
        // Унаследованный статблок несёт content.name ШАБЛОНА (сервер отдаёт
        // его целиком, creatureCard.ts): в модалке статблока это выглядело
        // бы чужим именем под имени существа — подменяем на фактическое
        // (находка 10.10).
        ...normalizeDndCreature(safeParse(data.statblock.content)),
        ...(data.statblock_inherited ? { name: data.name } : {}),
      }
    : null;

  const roles = data.combat_roles.length ? data.combat_roles : data.inherited?.combat_roles ?? [];
  const rolesInherited = !data.combat_roles.length && !!data.inherited?.combat_roles.length;
  const tactics = data.tactics.length ? data.tactics : data.inherited?.tactics ?? [];
  const tacticsInherited = !data.tactics.length && !!data.inherited?.tactics.length;
  const prose = data.description.trim() || data.inherited?.description.trim() || "";
  const proseInherited = !data.description.trim() && !!data.inherited?.description.trim();

  const speedText = creature ? formatCardSpeed(creature.speed) : "";
  const attack = creature ? maxAttackBonus(creature) : null;
  const dc = creature ? maxSaveDC(creature) : null;
  const senses = creature ? cardSenses(creature) : [];
  // Иммунитеты к урону и к состояниям — одна графа, половинки через «;»:
  // отдельная строка «Состояния» читалась двусмысленно (состояния, которые
  // существо накладывает? в которых оно находится?), а вместе они отвечают на
  // один вопрос — что ему не вредит.
  const immunities = creature
    ? [creature.damageImmunities.join(", "), creature.conditionImmunities.join(", ")]
        .filter(Boolean)
        .join("; ")
    : "";
  const defenceRows: [string, string][] = creature
    ? (
        [
          ["Уязвимости", creature.damageVulnerabilities.join(", ")],
          ["Сопротивления", creature.damageResistances.join(", ")],
          ["Иммунитеты", immunities],
          ["Чувства", senses.join(", ")],
        ] as [string, string][]
      ).filter(([, value]) => value.length > 0)
    : [];

  const hasMechanics = !!creature || (!playerSafe && tactics.length > 0);
  const hasDescription = (!playerSafe && !!data.secret.trim()) || !!prose;
  const isEmpty = !hasMechanics && !hasDescription && roles.length === 0;

  const profilePath = `${PROFILE_PATH[data.type] ?? "/beings"}/${data.id}`;
  // Портрет — только собственный портрет существа (вкладка «Изображения» его
  // профиля). Подстраховка «взять картинку статблока» убрана намеренно: с ней
  // карточка показывала не то, что вкладка, и было непонятно, какую именно
  // картинку ты меняешь.
  const avatar = data.avatar_image_url ?? null;

  return (
    <article className={`creature-card${variant === "page" ? " creature-card--page" : ""}`}>
      <header
        className={`creature-card__band${onToggleCollapse ? " is-clickable" : ""}`}
        onClick={onToggleCollapse}
        title={onToggleCollapse ? (collapsed ? "Развернуть" : "Свернуть") : undefined}
      >
        {avatar ? (
          // Портрет — изображение-СОДЕРЖИМОЕ: дуотон на него не ложится
          // (design_revision.md §1.13), по нему тварь узнают.
          <img className="creature-card__portrait" src={avatar} alt="" />
        ) : (
          <span className="creature-card__portrait creature-card__portrait--empty" />
        )}
        <div className="creature-card__title">
          <div className="creature-card__name">{data.name || "Без названия"}</div>
          {creature && formatChallenge(creature) && (
            <div className="creature-card__cr">{formatChallenge(creature)}</div>
          )}
        </div>
        {onToggleCollapse && <span className="creature-card__mark">{collapsed ? "+" : "−"}</span>}
        {onClose && (
          <button
            type="button"
            className="creature-card__close"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            title="Убрать"
          >
            ✕
          </button>
        )}
      </header>

      {!collapsed && (creature?.creatureType || roles.length > 0 || creature?.size) && (
        <div className="creature-card__chips">
          {creature?.creatureType && (
            <span className="creature-card__chip is-type">{creature.creatureType}</span>
          )}
          {roles.map((r) => (
            <span key={r} className="creature-card__chip is-role">
              {r}
            </span>
          ))}
          {creature?.size && <span className="creature-card__chip is-size">{creature.size}</span>}
        </div>
      )}
      {!collapsed && rolesInherited && data.inherited && (
        <div className="creature-card__inherited">Роль от вида «{data.inherited.from_name}»</div>
      )}

      {!collapsed && isEmpty && (
        <div className="creature-card__empty">
          Карточка не заполнена.{" "}
          <Link to={`${profilePath}?tab=${encodeURIComponent("Карточка существа")}`}>Заполнить</Link>
        </div>
      )}

      {!collapsed && hasMechanics && (
        <Section
          title="Механика"
          open={sectionsOpen.mechanics}
          onToggle={() => toggleSection("mechanics")}
        >
          {creature && (
            <div className="creature-card__rows">
              {/* КД и хиты — одной строкой пополам: два самых спрашиваемых
                  числа, и держать их на двух строках значит гонять глаз
                  вертикально там, где хватает одного взгляда. */}
              <div className="creature-card__row creature-card__row--pair">
                <span className="creature-card__label">КД</span>
                <span className="creature-card__value">{cardArmorClass(creature)}</span>
                <span className="creature-card__label">Хиты</span>
                <span className="creature-card__value">{cardHitPoints(creature) || "—"}</span>
              </div>
              {speedText && <Row label="Скорость" value={speedText} />}
              {attack !== null && <Row label="Атака" value={attack >= 0 ? `+${attack}` : String(attack)} />}
              {dc !== null && <Row label="СЛ" value={String(dc)} />}
            </div>
          )}
          {data.statblock_inherited && data.inherited && (
            <div className="creature-card__inherited">Статблок от вида «{data.inherited.from_name}»</div>
          )}
          {defenceRows.length > 0 && (
            <div className="creature-card__rows">
              {defenceRows.map(([label, value]) => (
                <Row key={label} label={label} value={value} />
              ))}
            </div>
          )}
          {!playerSafe && tactics.length > 0 && (
            <div className="creature-card__tactics">
              <div className="creature-card__sublabel">Тактика</div>
              <ul>
                {tactics.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
              {tacticsInherited && data.inherited && (
                <div className="creature-card__inherited">От вида «{data.inherited.from_name}»</div>
              )}
            </div>
          )}
        </Section>
      )}

      {!collapsed && hasDescription && (
        <Section
          title="Описание"
          open={sectionsOpen.description}
          onToggle={() => toggleSection("description")}
        >
          {!playerSafe && data.secret.trim() && (
            <div className="creature-card__secret">
              <div className="creature-card__sublabel">Секрет</div>
              <MentionText text={data.secret} />
            </div>
          )}
          {prose && (
            <div className="creature-card__prose">
              <MentionText text={prose} />
              {proseInherited && data.inherited && (
                <div className="creature-card__inherited">Описание вида «{data.inherited.from_name}»</div>
              )}
            </div>
          )}
        </Section>
      )}

      {(!hideProfileButton || creature) && (
        <footer className="creature-card__actions">
          {!hideProfileButton &&
            (profileInNewWindow ? (
              <a className="creature-card__button" href={profilePath} target="_blank" rel="noreferrer">
                В профиль
              </a>
            ) : (
              <Link className="creature-card__button" to={profilePath}>
                В профиль
              </Link>
            ))}
          {creature && (
            <button
              type="button"
              className="creature-card__button"
              onClick={() => (onShowStatblock ? onShowStatblock() : setStatblockOpen(true))}
            >
              Статблок
            </button>
          )}
        </footer>
      )}

      {statblockOpen && creature && data.statblock && (
        <Modal onClose={() => setStatblockOpen(false)}>
          <div className="stack">
            <DndCreatureView value={creature} />
            <button type="button" onClick={() => setStatblockOpen(false)}>
              Закрыть
            </button>
          </div>
        </Modal>
      )}
    </article>
  );
}

// Обёртка, которая сама сходит за данными — ею пользуются все места, кроме
// вкладки профиля: там карточка соседствует с редактором и данные общие.
export function CreatureCardLoader({
  type,
  id,
  statblockId,
  playerSafe,
  hideProfileButton,
  profileInNewWindow,
  onShowStatblock,
  onClose,
  collapsed,
  onToggleCollapse,
}: {
  type: string;
  id: number;
  // Карточка на месте конкретного статблока — «краткий» на странице существа
  // показывает свой, а не выбранный общим правилом.
  statblockId?: number;
  playerSafe?: boolean;
  hideProfileButton?: boolean;
  profileInNewWindow?: boolean;
  onShowStatblock?: (data: CreatureCardPayload) => void;
  onClose?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const [data, setData] = useState<CreatureCardPayload | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    setData(undefined);
    fetchCreatureCard(type, id, statblockId)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [type, id, statblockId]);
  const showStatblock = useCallback(() => {
    if (data && onShowStatblock) onShowStatblock(data);
  }, [data, onShowStatblock]);

  if (data === undefined) return <span className="muted">Загрузка…</span>;
  if (data === null) return <span className="muted">Не найдено.</span>;
  return (
    <CreatureCard
      data={data}
      playerSafe={playerSafe}
      hideProfileButton={hideProfileButton}
      profileInNewWindow={profileInNewWindow}
      onShowStatblock={onShowStatblock ? showStatblock : undefined}
      onClose={onClose}
      collapsed={collapsed}
      onToggleCollapse={onToggleCollapse}
    />
  );
}
