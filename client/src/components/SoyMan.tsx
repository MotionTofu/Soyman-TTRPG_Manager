// SoyMan — маскот приложения. Один компонент на все холодные зоны:
// логин, онбординг, первичные пустые состояния, 404, экран ошибки, загрузка.
// За столом (сессия, инициатива, статблоки) маскота нет — см. CLAUDE.md
// «Приоритет: простота для Мастера».
//
// Подача — зинная печать, а не акварель из tofu_mascot.md: плоские заливки,
// жёсткий контур, халфтон вместо мягкой тени. Неприкасаемым остаётся то, что
// гайд §25 и называет неприкасаемым — куб, лицо, росток, пропорции.
//
// Цвет: тофу всегда светлый (§23 — иначе персонаж пропадает в тёмных темах),
// контур всегда тёмный (§12 — из --ink он слился бы с тофу в riot/neon),
// одежда, плащ и броня считаются от --accent, то есть едут за темой. Все
// переменные заданы в index.css, здесь только имена.
import { useId } from "react";

export type SoyManState =
  /** Приветствие — рука поднята. Логин, онбординг. */
  | "idle"
  /** За работой с книгой. Загрузка, splash. */
  | "working"
  /** Смотрит на пользователя, реквизит опущен. Пустые состояния. */
  | "waiting"
  /** Опущенные брови, уголки рта вниз. 404 и экран ошибки. */
  | "error";

/**
 * Класс персонажа. Ось независима от состояния: голова, лицо и росток общие,
 * меняется всё ниже шеи и головной убор. Приложение системно-нейтральное
 * (D&D, LitM, свои системы), поэтому один воин на все разделы врёт.
 */
export type SoyManGuise = "warrior" | "mage" | "runner";

export type SoyManSize = "sm" | "md" | "lg";

const SIZE_PX: Record<SoyManSize, number> = { sm: 32, md: 64, lg: 160 };

const GUISES: SoyManGuise[] = ["warrior", "mage", "runner"];

/**
 * Класс на эту загрузку приложения. Жеребьёвка ровно одна и на уровне модуля,
 * а не в компоненте: случайность внутри рендера означала бы, что маскот меняет
 * класс на каждой перерисовке — а перерисовка случается от чего угодно, вплоть
 * до наведения мыши в соседнем блоке. Плюс на одном экране может оказаться
 * два места с маскотом, и они должны показывать одного и того же.
 *
 * Тем же приёмом живут 96 баннеров в шапке (brandLogo.ts) — обновил вкладку,
 * получил другой вид.
 */
export const SESSION_GUISE: SoyManGuise = GUISES[Math.floor(Math.random() * GUISES.length)];

/** Колдун на ошибке: пожар на фоне, лицо спокойное. Совпадение проверяется
 *  в трёх местах — лицо, фон и подпись для скринридера, — поэтому вынесено. */
const isCalmMage = (state: SoyManState, guise: SoyManGuise) => guise === "mage" && state === "error";

// Подпись для скринридера. Эмоция считывается глазами (§14), но не ушами.
const GUISE_LABEL: Record<SoyManGuise, string> = {
  warrior: "SoyMan-воин",
  mage: "SoyMan-колдун",
  runner: "SoyMan-нетраннер",
};
const STATE_LABEL: Record<SoyManState, string> = {
  idle: "машет рукой",
  working: "за работой",
  waiting: "ждёт",
  error: "расстроен",
};

export function SoyMan({
  state = "waiting",
  size = "md",
  guise = SESSION_GUISE,
  headOnly = false,
  className,
  decorative = false,
}: {
  state?: SoyManState;
  size?: SoyManSize;
  /** По умолчанию — класс этой загрузки приложения (см. SESSION_GUISE). */
  guise?: SoyManGuise;
  /** ≤64px гайд §19 просит рисовать головой: куб + лицо + росток. */
  headOnly?: boolean;
  className?: string;
  /** true — картинка ничего не сообщает сверх соседнего текста, прячем от скринридера. */
  decorative?: boolean;
}) {
  const uid = useId();
  const halftone = `soy-halftone-${uid}`;
  const px = SIZE_PX[size];
  // Голова живёт в 16..86 по X и 0..74 по Y — общий блок для обоих режимов,
  // поэтому head-only это тот же рисунок, а не вторая версия персонажа.
  const viewBox = headOnly ? "16 0 70 74" : "0 0 100 116";
  const height = headOnly ? Math.round(px * (74 / 70)) : Math.round(px * (116 / 100));

  return (
    <svg
      // .soy-man несёт палитру персонажа — см. index.css. Класс обязателен:
      // без него все var(--soy-*) не разрешатся и рисунок уйдёт в чёрное.
      className={className ? `soy-man ${className}` : "soy-man"}
      width={headOnly ? px : Math.round(px * (100 / 116))}
      height={height}
      viewBox={viewBox}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role={decorative ? "presentation" : "img"}
      aria-label={
        decorative
          ? undefined
          : isCalmMage(state, guise)
            ? "SoyMan-колдун улыбается посреди пожара"
            : `${GUISE_LABEL[guise]} ${STATE_LABEL[state]}`
      }
      aria-hidden={decorative || undefined}
    >
      <defs>
        {/* Халфтон — обязательный «шум» дизайн-системы §5.2. Тень на объёме
            даётся точками, а не размытием: box-shadow и blur в зине запрещены. */}
        <pattern id={halftone} width="3" height="3" patternUnits="userSpaceOnUse">
          <circle cx="1.2" cy="1.2" r="0.85" fill="var(--soy-ink)" opacity="0.22" />
        </pattern>
      </defs>

      {!headOnly &&
        (guise === "mage" ? (
          <MageBody state={state} halftone={halftone} />
        ) : guise === "runner" ? (
          <RunnerBody state={state} halftone={halftone} />
        ) : (
          <WarriorBody state={state} halftone={halftone} />
        ))}

      <Head state={state} guise={guise} halftone={halftone} />

      {!headOnly &&
        (guise === "mage" ? (
          <MageFront state={state} />
        ) : guise === "runner" ? (
          <RunnerFront state={state} />
        ) : (
          <WarriorFront state={state} />
        ))}
    </svg>
  );
}

// ---------- голова ----------

// Куб: передняя грань 22..70 × 22..66, верхняя и правая уходят вправо-вверх на
// 10 — этого хватает, чтобы читался кусок тофу, а не квадратная наклейка.
// Голова 52 из 116 по высоте — 45%, нижняя граница вилки гайда §3.
function Head({ state, guise, halftone }: { state: SoyManState; guise: SoyManGuise; halftone: string }) {
  // Наклон при работе — единственное, чем разрешено двигать голову (§14).
  const tilt = state === "working" ? "rotate(5 46 66)" : undefined;
  return (
    <g transform={tilt}>
      <Sprout state={state} guise={guise} />
      {/* верхняя грань */}
      <path d="M22 22 L32 14 L80 14 L70 22 Z" fill="var(--soy-tofu-2)" stroke="var(--soy-ink)" strokeWidth="2" strokeLinejoin="round" />
      {/* правая грань */}
      <path d="M70 22 L80 14 L80 58 L70 66 Z" fill="var(--soy-tofu-2)" stroke="var(--soy-ink)" strokeWidth="2" strokeLinejoin="round" />
      <path d="M70 22 L80 14 L80 58 L70 66 Z" fill={`url(#${halftone})`} stroke="none" />
      {/* передняя грань */}
      <path d="M22 22 L70 22 L70 66 L22 66 Z" fill="var(--soy-tofu)" stroke="var(--soy-ink)" strokeWidth="2" strokeLinejoin="round" />
      {/* поры: тофу, а не коробка (§10) */}
      <circle cx="30" cy="29" r="1.5" fill="var(--soy-tofu-2)" />
      <circle cx="63" cy="31" r="1.1" fill="var(--soy-tofu-2)" />
      <circle cx="27" cy="59" r="1.3" fill="var(--soy-tofu-2)" />
      <circle cx="59" cy="61" r="1" fill="var(--soy-tofu-2)" />
      {guise === "mage" && <WizardHair halftone={halftone} />}
      {guise === "runner" && <Implant />}
      <Face state={state} guise={guise} />
    </g>
  );
}

// Росток — второй логотип (§5). Из центра верхней грани, чуть асимметрично.
function Sprout({ state, guise }: { state: SoyManState; guise: SoyManGuise }) {
  // Гайд §5: при радости поднимается, при грусти опускается. У колдуна на
  // ошибке грусти нет — росток остаётся ровным вместе с лицом.
  const lift = state === "idle" ? -2 : state === "error" && !isCalmMage(state, guise) ? 3 : 0;
  return (
    <g transform={`translate(0 ${lift})`}>
      <path d="M51 18 C51 12 50 9 49 6" stroke="var(--soy-ink)" strokeWidth="2.4" strokeLinecap="round" />
      <path
        d="M49 9 C44 6 40 6.5 39 9 C41.5 11.5 46 11.5 49 9 Z"
        fill="var(--soy-leaf)"
        stroke="var(--soy-ink)"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M50 6.5 C53 2.5 57.5 1.5 60 3 C59 6.5 54.5 8.5 50 6.5 Z"
        fill="var(--soy-leaf)"
        stroke="var(--soy-ink)"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </g>
  );
}

// Седая голова колдуна. Головного убора нет вовсе: колпак приходилось валить
// вбок (прямой конус нужной высоты не встаёт над кубом) и он читался хвостом,
// а оставшиеся от него поля — повязкой. Класс держат волосы, посох и огонь.
//
// Волосы всегда белые, как тофу и контур: это признак класса, а не костюма,
// и в тёмных темах он должен оставаться светлым по той же причине (§23).
function WizardHair({ halftone }: { halftone: string }) {
  return (
    <g>
      {/* макушка — по верхней грани куба; росток проходит сквозь неё, как и
          сквозь сам куб, потому что рисуется раньше */}
      <path d="M22 22 L32 14 L80 14 L70 22 Z" fill="var(--soy-hair)" stroke="var(--soy-ink)" strokeWidth="2" strokeLinejoin="round" />
      {/* чёлка: ниже бровей не спускается — там начинается зона мимики (§14) */}
      <path
        d="M22 22 L70 22 L70 30 L64 34 L57 29 L50 34 L43 29 L36 34 L29 29 L22 32 Z"
        fill="var(--soy-hair)"
        stroke="var(--soy-ink)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {/* Пряди идут вдоль рёбер куба и почти не выступают наружу: отведённые
          в стороны, они читались парой белых ушей, а не волосами. */}
      <path d="M22 22 L28 23 L27 41 L24 48 L21 40 Z" fill="var(--soy-hair)" stroke="var(--soy-ink)" strokeWidth="2" strokeLinejoin="round" />
      <path d="M70 22 L80 15 L79 40 L75 46 L71 38 Z" fill="var(--soy-hair)" stroke="var(--soy-ink)" strokeWidth="2" strokeLinejoin="round" />
      <path d="M70 22 L80 15 L79 40 L75 46 L71 38 Z" fill={`url(#${halftone})`} stroke="none" />
    </g>
  );
}

// Язык пламени, растущий вверх из точки (x, y). Один и тот же контур на все
// случаи — меняется только масштаб, иначе на 32px огонь превращается в кашу.
function Flame({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path
        d="M0 0 C-7 -3 -8 -12 -3 -18 C-3 -12 0 -11 1 -15 C3 -20 1 -24 0 -27 C6 -23 10 -15 9 -8 C8.4 -3.5 5 -0.5 0 0 Z"
        fill="var(--soy-flame)"
        stroke="var(--soy-ink)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M0 -2 C-3.5 -4 -4 -9 -1.5 -12 C-0.5 -8 2 -9 2.5 -13 C4.5 -10 5 -6 3.5 -3.5 C2.6 -2.2 1.4 -1.8 0 -2 Z"
        fill="var(--soy-flame-2)"
        stroke="none"
      />
    </g>
  );
}

// Пожар за спиной колдуна на ошибке. Рисуется до фигуры и не поднимается выше
// плеч: перекрыв голову, огонь съел бы лицо, а вся шутка в том, что лицо видно.
function BackdropFire() {
  return (
    <g>
      <Flame x={17} y={113} s={2} />
      <Flame x={27} y={114} s={1.3} />
      <Flame x={37} y={113} s={1.8} />
      <Flame x={48} y={115} s={1.2} />
      <Flame x={59} y={114} s={1.6} />
      <Flame x={70} y={113} s={1.9} />
      <Flame x={80} y={114} s={1.3} />
      <Flame x={87} y={115} s={1.4} />
    </g>
  );
}

// Огненный шар над раскрытой ладонью. Оранжевый постоянный, за темой не идёт:
// огонь, перекрашенный в акцент, перестаёт быть огнём — та же логика, что у
// зелёного ростка. На ошибке гаснет: убавленный шар говорит «не вышло»
// понятнее, чем любая правка лица.
function Fireball({ x, y, dim = false }: { x: number; y: number; dim?: boolean }) {
  const k = dim ? 0.62 : 1;
  return (
    <g transform={`translate(${x} ${y}) scale(${k})`} opacity={dim ? 0.55 : 1}>
      <path
        d="M-8 2 C-9 -5 -4 -7 -3 -13 C-1 -8 1 -10 2 -14 C4 -9 8 -7 8 1 C8 6 4 9 0 9 C-4 9 -8 6 -8 2 Z"
        fill="var(--soy-flame)"
        stroke="var(--soy-ink)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="0" cy="2" r="3.6" fill="var(--soy-flame-2)" stroke="var(--soy-ink)" strokeWidth="1.4" />
    </g>
  );
}

// Имплант нетраннера. Ставится сбоку и не трогает глаза: визор закрыл бы
// единственный носитель эмоции (§14), и все четыре состояния слились бы в одно.
function Implant() {
  return (
    <g>
      <path d="M69 33 L78 26" stroke="var(--soy-ink)" strokeWidth="4.6" strokeLinecap="round" />
      <path d="M69 33 L78 26" stroke="var(--soy-neon)" strokeWidth="2" strokeLinecap="round" />
      <circle cx="79" cy="25" r="2.4" fill="var(--soy-neon)" stroke="var(--soy-ink)" strokeWidth="1.6" />
      <rect x="61" y="33" width="9" height="11" rx="1.5" fill="var(--soy-suit)" stroke="var(--soy-ink)" strokeWidth="2" />
      <path d="M63.4 36.5 L67.6 36.5" stroke="var(--soy-neon)" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M63.4 40.5 L66.2 40.5" stroke="var(--soy-neon)" strokeWidth="1.8" strokeLinecap="round" />
    </g>
  );
}

// Лицо. Меняются только глаза, брови и рот — деталей не добавляем (§14),
// иначе на 32px эмоция превращается в грязь.
function Face({ state, guise }: { state: SoyManState; guise: SoyManGuise }) {
  const ink = "var(--soy-ink)";

  // Колдун на ошибке не расстраивается, а делает вид, что всё хорошо, — вокруг
  // при этом полыхает (см. BackdropFire). Поэтому у него на error своё лицо:
  // ровные брови, обычные глаза и маленькая вежливая улыбка. Читается это
  // только вместе с огнём на фоне, порознь обе половины шутки не работают.
  if (isCalmMage(state, guise)) {
    return (
      <g>
        <path d="M32 33 L42 33" stroke={ink} strokeWidth="2.2" strokeLinecap="round" />
        <path d="M50 33 L60 33" stroke={ink} strokeWidth="2.2" strokeLinecap="round" />
        <ellipse cx="37.5" cy="42" rx="4.2" ry="4.8" fill={ink} />
        <ellipse cx="54.5" cy="42" rx="4.2" ry="4.8" fill={ink} />
        <circle cx="39" cy="40" r="1.4" fill="var(--soy-tofu)" />
        <circle cx="56" cy="40" r="1.4" fill="var(--soy-tofu)" />
        <ellipse cx="28.5" cy="50" rx="3.6" ry="2.4" fill="var(--soy-cloak)" opacity="0.32" />
        <ellipse cx="63.5" cy="50" rx="3.6" ry="2.4" fill="var(--soy-cloak)" opacity="0.32" />
        <path d="M41 52 Q46 55.5 51 52" stroke={ink} strokeWidth="2.4" strokeLinecap="round" fill="none" />
      </g>
    );
  }

  return (
    <g>
      {/* брови */}
      {state === "error" && (
        <>
          <path d="M32 34 L42 31.5" stroke={ink} strokeWidth="2.2" strokeLinecap="round" />
          <path d="M60 34 L50 31.5" stroke={ink} strokeWidth="2.2" strokeLinecap="round" />
        </>
      )}
      {state === "working" && (
        <>
          <path d="M33 33 L42 33" stroke={ink} strokeWidth="2.2" strokeLinecap="round" />
          <path d="M50 31 L59 32.5" stroke={ink} strokeWidth="2.2" strokeLinecap="round" />
        </>
      )}

      {/* глаза */}
      {state === "working" ? (
        // Смотрит в книгу — веки опущены.
        <>
          <path d="M33 41 Q37.5 46.5 42 41" stroke={ink} strokeWidth="2.6" strokeLinecap="round" />
          <path d="M50 41 Q54.5 46.5 59 41" stroke={ink} strokeWidth="2.6" strokeLinecap="round" />
        </>
      ) : (
        <>
          <ellipse cx="37.5" cy="42" rx="4.2" ry={state === "idle" ? 5.4 : 4.8} fill={ink} />
          <ellipse cx="54.5" cy="42" rx="4.2" ry={state === "idle" ? 5.4 : 4.8} fill={ink} />
          <circle cx="39" cy="40" r="1.4" fill="var(--soy-tofu)" />
          <circle cx="56" cy="40" r="1.4" fill="var(--soy-tofu)" />
        </>
      )}

      {/* щёки */}
      <ellipse cx="28.5" cy="50" rx="3.6" ry="2.4" fill="var(--soy-cloak)" opacity="0.32" />
      <ellipse cx="63.5" cy="50" rx="3.6" ry="2.4" fill="var(--soy-cloak)" opacity="0.32" />

      {/* Импланты-линии на скуле у нетраннера: тонкие, серебристые, только на
          одной стороне. Симметричная разметка читалась бы разлиновкой лица,
          а асимметричная — вживлённой деталью. Зону глаз и рта не трогают. */}
      {guise === "runner" && (
        <g stroke="var(--soy-chrome)" strokeWidth="1.5" strokeLinecap="round" fill="none">
          <path d="M59.5 48.5 L62 55" />
          <path d="M63 47 L65.5 52" />
          <path d="M31.5 30 L29.5 36.5" />
        </g>
      )}

      {/* рот */}
      {state === "idle" && <path d="M38 50 Q46 58.5 54 50" stroke={ink} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />}
      {state === "waiting" && <path d="M40 51 Q46 55.5 52 51" stroke={ink} strokeWidth="2.6" strokeLinecap="round" fill="none" />}
      {state === "working" && <path d="M41 52 Q46 55 51 52" stroke={ink} strokeWidth="2.4" strokeLinecap="round" fill="none" />}
      {state === "error" && <path d="M39 55.5 Q46 49.5 53 55.5" stroke={ink} strokeWidth="2.6" strokeLinecap="round" fill="none" />}
    </g>
  );
}

// ---------- общие детали тела ----------

// Конечности рисуются двумя обводками поверх одной линии: широкая тёмная
// снизу даёт контур, узкая цветная сверху — заливку. Дешевле и ровнее, чем
// замкнутый контур руки, и толщина контура не пляшет на изгибах.
function Limb({ d, fill, w = 7 }: { d: string; fill: string; w?: number }) {
  return (
    <>
      <path d={d} stroke="var(--soy-ink)" strokeWidth={w + 3.4} strokeLinecap="round" fill="none" />
      <path d={d} stroke={fill} strokeWidth={w} strokeLinecap="round" fill="none" />
    </>
  );
}

function Hand({ x, y }: { x: number; y: number }) {
  return <circle cx={x} cy={y} r="4.2" fill="var(--soy-tofu)" stroke="var(--soy-ink)" strokeWidth="2" />;
}

// Тень под ногами — плоская, без размытия.
function Shadow() {
  return <ellipse cx="49" cy="112" rx="24" ry="3.2" fill="var(--soy-ink)" opacity="0.16" />;
}

// Четырёхлучевая искра — общий знак «магия/данные». У колдуна фиолетовая,
// у нетраннера тот же силуэт, но неоновый; у воина её нет вовсе.
function Sparkle({ x, y, r = 4, fill = "var(--soy-arcane)" }: { x: number; y: number; r?: number; fill?: string }) {
  const s = r * 0.32;
  return (
    <path
      d={`M${x} ${y - r} L${x + s} ${y - s} L${x + r} ${y} L${x + s} ${y + s} L${x} ${y + r} L${x - s} ${y + s} L${x - r} ${y} L${x - s} ${y - s} Z`}
      fill={fill}
      stroke="var(--soy-ink)"
      strokeWidth="1.4"
      strokeLinejoin="round"
    />
  );
}

// Раскрытая книга в обеих руках — поза «работа» (§15). Общая для воина и колдуна.
function Book() {
  return (
    <g>
      <path d="M33 82 L49 86 L65 82 L65 94 L49 98 L33 94 Z" fill="var(--soy-tofu)" stroke="var(--soy-ink)" strokeWidth="2" strokeLinejoin="round" />
      <path d="M49 86 L49 98" stroke="var(--soy-ink)" strokeWidth="2" />
      <path d="M37 87 L45 89" stroke="var(--soy-ink)" strokeWidth="1.4" opacity="0.5" />
      <path d="M37 91 L45 93" stroke="var(--soy-ink)" strokeWidth="1.4" opacity="0.5" />
      <path d="M53 89 L61 87" stroke="var(--soy-ink)" strokeWidth="1.4" opacity="0.5" />
      <path d="M53 93 L61 91" stroke="var(--soy-ink)" strokeWidth="1.4" opacity="0.5" />
    </g>
  );
}

// ---------- воин ----------

function WarriorBody({ state, halftone }: { state: SoyManState; halftone: string }) {
  // При ошибке плечи опущены — поза «усталость» из §15, но без отдельного рисунка.
  const slump = state === "error" ? 3 : 0;
  return (
    <g>
      <Shadow />

      {/* Плащ: узкий, за корпусом, рваный низ (§9). Шире корпуса ровно
          настолько, чтобы читался, — разведённый в стороны он превращался
          в крылья и ломал силуэт «маленького приключенца». */}
      <path
        d="M38 66 C33 78 31 96 32 108 L38 103 L44 109 L49 104 L54 109 L60 103 L66 108 C67 96 65 78 60 66 Z"
        fill="var(--soy-cloak)"
        stroke="var(--soy-ink)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {/* Тень плаща — только по левому краю, а не половиной полотна:
          вертикальный раздел посередине читался швом, а не объёмом. */}
      <path d="M38 66 C33 78 31 96 32 108 L38 103 L40 104 L41 66 Z" fill={`url(#${halftone})`} stroke="none" />

      {/* ноги и ботинки */}
      <Limb d="M43 88 L42 100" fill="var(--soy-armor-2)" w={8} />
      <Limb d="M55 88 L56 100" fill="var(--soy-armor-2)" w={8} />
      <path d="M36 100 L48 100 L48 108 L36 108 Z" fill="var(--soy-leather)" stroke="var(--soy-ink)" strokeWidth="2" strokeLinejoin="round" />
      <path d="M50 100 L62 100 L62 108 L50 108 Z" fill="var(--soy-leather)" stroke="var(--soy-ink)" strokeWidth="2" strokeLinejoin="round" />

      <g transform={`translate(0 ${slump})`}>
        {/* корпус в потёртой броне */}
        <path d="M36 65 L62 65 L65 90 L33 90 Z" fill="var(--soy-armor)" stroke="var(--soy-ink)" strokeWidth="2" strokeLinejoin="round" />
        <path d="M36 65 L49 65 L49 90 L33 90 Z" fill={`url(#${halftone})`} stroke="none" />
        {/* пояс и подсумок */}
        <path d="M33 81 L65 81 L65.6 86 L32.4 86 Z" fill="var(--soy-leather)" stroke="var(--soy-ink)" strokeWidth="2" strokeLinejoin="round" />
        <rect x="45" y="80.5" width="7" height="6" fill="var(--soy-metal)" stroke="var(--soy-ink)" strokeWidth="1.8" />
        {/* ремень через грудь */}
        <path d="M38 66 L58 78" stroke="var(--soy-ink)" strokeWidth="4.6" strokeLinecap="round" />
        <path d="M38 66 L58 78" stroke="var(--soy-leather)" strokeLinecap="round" strokeWidth="2.6" />

        <WarriorArms state={state} />
      </g>
    </g>
  );
}

// Руки и то, что в них. Правая рука (слева на картинке) — основная, с мечом,
// левая — сменная: щит, книга, приветственный жест (§7).
function WarriorArms({ state }: { state: SoyManState }) {
  if (state === "idle") {
    // Поднятая рука рисуется не здесь, а во WarriorFront: тело идёт до головы,
    // и на своём месте она уходила за правую грань куба.
    return (
      <g>
        <Limb d="M38 69 L30 82" fill="var(--soy-armor-2)" />
        <Sword hiltX={29} hiltY={84} angle={22} />
        <Hand x={30} y={83} />
      </g>
    );
  }
  if (state === "working") {
    return (
      <g>
        <Limb d="M38 70 L36 82" fill="var(--soy-armor-2)" />
        <Limb d="M60 70 L62 82" fill="var(--soy-armor-2)" />
        <Hand x={35} y={83} />
        <Hand x={63} y={83} />
      </g>
    );
  }
  if (state === "error") {
    return (
      <g>
        <Limb d="M38 70 L33 86" fill="var(--soy-armor-2)" />
        <Hand x={32} y={87} />
        <Limb d="M60 70 L65 86" fill="var(--soy-armor-2)" />
        <Hand x={66} y={87} />
        <Sword hiltX={66} hiltY={88} angle={-8} />
      </g>
    );
  }
  // waiting
  return (
    <g>
      <Limb d="M38 69 L31 83" fill="var(--soy-armor-2)" />
      <Hand x={30} y={84} />
      <Limb d="M60 69 L67 83" fill="var(--soy-armor-2)" />
      <Hand x={68} y={84} />
      <Sword hiltX={68} hiltY={85} angle={-14} />
    </g>
  );
}

// Реквизит, который должен лежать поверх корпуса и рук.
function WarriorFront({ state }: { state: SoyManState }) {
  if (state === "waiting") return <Shield x={28} y={86} />;
  if (state === "error") return <Shield x={30} y={92} tilt={-24} />;
  if (state === "working") return <Book />;
  if (state === "idle") {
    // Приветственная рука проходит перед головой — иначе куб её закрывает.
    return (
      <g>
        <Limb d="M61 70 L78 58" fill="var(--soy-armor-2)" />
        <Hand x={80} y={56.5} />
      </g>
    );
  }
  return null;
}

// Меч — маленький и понятный по силуэту (§7): на 32px от него остаётся
// одна тёмная чёрточка, и это нормально.
function Sword({ hiltX, hiltY, angle }: { hiltX: number; hiltY: number; angle: number }) {
  return (
    <g transform={`rotate(${angle} ${hiltX} ${hiltY})`}>
      <path d={`M${hiltX - 4} ${hiltY} L${hiltX + 4} ${hiltY}`} stroke="var(--soy-ink)" strokeWidth="3.4" strokeLinecap="round" />
      <path
        d={`M${hiltX - 2.4} ${hiltY + 1} L${hiltX + 2.4} ${hiltY + 1} L${hiltX + 1.2} ${hiltY + 18} L${hiltX} ${hiltY + 21} L${hiltX - 1.2} ${hiltY + 18} Z`}
        fill="var(--soy-metal)"
        stroke="var(--soy-ink)"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </g>
  );
}

// Щит — круглый, деревянный, с металлическим умбоном (§8). В интерфейсе он же
// знак «сохранено / защищено», поэтому силуэт держим узнаваемым.
function Shield({ x, y, tilt = 0 }: { x: number; y: number; tilt?: number }) {
  return (
    <g transform={`rotate(${tilt} ${x} ${y})`}>
      <circle cx={x} cy={y} r="11" fill="var(--soy-leather)" stroke="var(--soy-ink)" strokeWidth="2.2" />
      <circle cx={x} cy={y} r="7.5" fill="none" stroke="var(--soy-ink)" strokeWidth="1.4" opacity="0.55" />
      <circle cx={x} cy={y} r="3.4" fill="var(--soy-metal)" stroke="var(--soy-ink)" strokeWidth="1.8" />
    </g>
  );
}

// ---------- колдун ----------

// Силуэт держится на другом принципе, чем у воина: не «плечи и ноги», а
// колокол мантии до земли. На 32px воин и колдун должны различаться пятном,
// а не деталями, — ног у колдуна поэтому не видно вовсе.
function MageBody({ state, halftone }: { state: SoyManState; halftone: string }) {
  // Плечи на ошибке не опускаются, как у остальных двоих: он же делает вид,
  // что всё в порядке, — поникшая поза противоречила бы лицу.
  return (
    <g>
      {isCalmMage(state, "mage") && <BackdropFire />}
      <Shadow />
      <g>
        {/* мантия с рваным подолом (§9) */}
        <path
          d="M37 64 L61 64 L69 104 L63 109 L56 104 L49 109 L42 104 L35 109 L29 104 Z"
          fill="var(--soy-cloak)"
          stroke="var(--soy-ink)"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path d="M37 64 L46 64 L44 106 L35 109 L29 104 Z" fill={`url(#${halftone})`} stroke="none" />
        {/* воротник-капюшон, лежащий на плечах */}
        <path d="M34 67 L49 76 L64 67 L61 61 L37 61 Z" fill="var(--soy-cloak-2)" stroke="var(--soy-ink)" strokeWidth="2" strokeLinejoin="round" />
        {/* звёзды на мантии */}
        <Sparkle x={39} y={94} r={2.6} />
        <Sparkle x={59} y={91} r={2} />
        <Sparkle x={50} y={101} r={2.2} />
        {/* верёвочный пояс с узлом */}
        <path d="M35 84 L63 84" stroke="var(--soy-ink)" strokeWidth="4.6" strokeLinecap="round" />
        <path d="M35 84 L63 84" stroke="var(--soy-leather)" strokeWidth="2.6" strokeLinecap="round" />
        <circle cx="49" cy="84.5" r="3" fill="var(--soy-leather)" stroke="var(--soy-ink)" strokeWidth="1.8" />

        <MageArms state={state} />
      </g>
    </g>
  );
}

// Рукава широкие (w=9): это второй после подола признак, по которому колдун
// отличается от воина в мелком размере.
function MageArms({ state }: { state: SoyManState }) {
  if (state === "working") {
    return (
      <g>
        <Limb d="M38 70 L36 82" fill="var(--soy-cloak-2)" w={9} />
        <Limb d="M60 70 L62 82" fill="var(--soy-cloak-2)" w={9} />
      </g>
    );
  }
  // В waiting и error правый рукав уезжает в MageFront вместе с посохом:
  // рука уведена дальше в сторону, чем у воина, и должна лежать поверх мантии.
  if (state === "idle") return <Limb d="M38 69 L30 82" fill="var(--soy-cloak-2)" w={9} />;
  return <Limb d="M38 69 L31 83" fill="var(--soy-cloak-2)" w={9} />;
}

// Посох и кисти рисуются поверх мантии: иначе широкий рукав съедает и то и другое.
//
// Посох всегда наклонён наружу, а не поставлен вертикально: вертикальный он
// приходится ровно на щёку — кристалл шире куба по вылету и ложится на лицо.
function MageFront({ state }: { state: SoyManState }) {
  if (state === "idle") {
    // Посоха в приветствии нет: он занимал бы вторую руку и всё равно упирался
    // бы кристаллом в лицо. Машет он свободной рукой, огонь — в опущенной.
    return (
      <g>
        <Hand x={30} y={83} />
        <Fireball x={26} y={79} />
        <Limb d="M61 70 L78 58" fill="var(--soy-cloak-2)" w={9} />
        <Hand x={80} y={56.5} />
      </g>
    );
  }
  if (state === "working") {
    return (
      <g>
        <Book />
        <Hand x={35} y={83} />
        <Hand x={63} y={83} />
        {/* руны, поднимающиеся со страниц */}
        <Sparkle x={38} y={74} r={2.6} />
        <Sparkle x={49} y={68} r={3.4} />
        <Sparkle x={61} y={73} r={2.2} />
      </g>
    );
  }
  if (state === "error") {
    return (
      <g>
        {/* Посох и шар горят как обычно: он именно что не замечает пожара.
            Погашенный реквизит читался бы «сдался», а нужно «всё нормально». */}
        <Staff x={74} top={46} bottom={106} angle={14} />
        <Limb d="M60 69 L77 82" fill="var(--soy-cloak-2)" w={9} />
        <Hand x={30} y={84} />
        <Fireball x={26} y={80} />
        <Hand x={79} y={85} />
      </g>
    );
  }
  // waiting
  return (
    <g>
      <Staff x={74} top={46} bottom={106} angle={14} />
      <Limb d="M60 69 L77 82" fill="var(--soy-cloak-2)" w={9} />
      <Hand x={30} y={84} />
      <Fireball x={26} y={80} />
      <Hand x={79} y={85} />
    </g>
  );
}

// Посох: тот же двухобводочный приём, что и у конечностей, плюс кристалл-ромб.
// Кристалл — прямая замена меча по роли: на 32px остаётся палка с яркой
// точкой наверху, и этого достаточно, чтобы отличить его от клинка.
function Staff({ x, top, bottom, angle = 0, dim = false }: { x: number; top: number; bottom: number; angle?: number; dim?: boolean }) {
  return (
    <g transform={`rotate(${angle} ${x} ${bottom})`}>
      <path d={`M${x} ${top + 6} L${x} ${bottom}`} stroke="var(--soy-ink)" strokeWidth="6" strokeLinecap="round" />
      <path d={`M${x} ${top + 6} L${x} ${bottom}`} stroke="var(--soy-leather)" strokeWidth="3.2" strokeLinecap="round" />
      <g opacity={dim ? 0.45 : 1}>
        <path
          d={`M${x} ${top - 7} L${x + 5.5} ${top} L${x} ${top + 8} L${x - 5.5} ${top} Z`}
          fill="var(--soy-arcane)"
          stroke="var(--soy-ink)"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </g>
    </g>
  );
}

// ---------- нетраннер ----------

function RunnerBody({ state, halftone }: { state: SoyManState; halftone: string }) {
  const slump = state === "error" ? 3 : 0;
  return (
    <g>
      <Shadow />

      {/* Плаща нет намеренно: он у воина и у колдуна, и третий такой же силуэт
          их не разводил. Нетраннера держат рука-имплант, куртка и линии. */}

      {/* ноги и ботинки со светящейся подошвой */}
      <Limb d="M43 88 L42 100" fill="var(--soy-suit-2)" w={8} />
      <Limb d="M55 88 L56 100" fill="var(--soy-suit-2)" w={8} />
      <path d="M36 100 L48 100 L48 108 L36 108 Z" fill="var(--soy-suit-2)" stroke="var(--soy-ink)" strokeWidth="2" strokeLinejoin="round" />
      <path d="M50 100 L62 100 L62 108 L50 108 Z" fill="var(--soy-suit-2)" stroke="var(--soy-ink)" strokeWidth="2" strokeLinejoin="round" />
      <path d="M37 105.5 L47 105.5" stroke="var(--soy-neon)" strokeWidth="2" strokeLinecap="round" />
      <path d="M51 105.5 L61 105.5" stroke="var(--soy-neon)" strokeWidth="2" strokeLinecap="round" />

      <g transform={`translate(0 ${slump})`}>
        {/* куртка с неоновыми швами */}
        <path d="M36 65 L62 65 L65 90 L33 90 Z" fill="var(--soy-suit)" stroke="var(--soy-ink)" strokeWidth="2" strokeLinejoin="round" />
        <path d="M36 65 L49 65 L49 90 L33 90 Z" fill={`url(#${halftone})`} stroke="none" />
        <path d="M41 66 L40 89" stroke="var(--soy-neon)" strokeWidth="1.6" fill="none" />
        <path d="M57 66 L58 89" stroke="var(--soy-neon)" strokeWidth="1.6" fill="none" />
        {/* нагрудный модуль — он же индикатор «жив» */}
        <rect x="44" y="69" width="10" height="8" rx="1.5" fill="var(--soy-metal)" stroke="var(--soy-ink)" strokeWidth="1.8" />
        <circle cx="49" cy="73" r="2" fill="var(--soy-neon)" stroke="var(--soy-ink)" strokeWidth="1.2" />
        {/* пояс */}
        <path d="M33 81 L65 81 L65.6 86 L32.4 86 Z" fill="var(--soy-suit-2)" stroke="var(--soy-ink)" strokeWidth="2" strokeLinejoin="round" />
        <path d="M34 83.5 L64 83.5" stroke="var(--soy-neon)" strokeWidth="1.6" />

        <RunnerArms state={state} />
      </g>
    </g>
  );
}

// Живая рука — правая (на картинке справа). Левая протезирована и рисуется
// в RunnerFront вместе с декой, в которую она переходит.
function RunnerArms({ state }: { state: SoyManState }) {
  if (state === "working") return <Limb d="M60 70 L62 82" fill="var(--soy-suit-2)" />;
  if (state === "error") return <Limb d="M60 70 L65 86" fill="var(--soy-suit-2)" />;
  if (state === "idle") return null; // приветственная рука уходит вперёд, во FrontProps
  return <Limb d="M60 69 L67 83" fill="var(--soy-suit-2)" />;
}

// Рука-имплант: та же двойная обводка, что и у живой конечности, но хромовая
// и с сочленением. Кисти нет — рука переходит прямо в деку, поэтому вместо
// кружка-ладони на конце стоит терминал.
function CyberArm({ d, joint, deck }: { d: string; joint: [number, number]; deck: React.ReactNode }) {
  return (
    <g>
      <Limb d={d} fill="var(--soy-chrome)" />
      <circle cx={joint[0]} cy={joint[1]} r="2.6" fill="var(--soy-suit)" stroke="var(--soy-ink)" strokeWidth="1.6" />
      {deck}
    </g>
  );
}

function RunnerFront({ state }: { state: SoyManState }) {
  if (state === "idle") {
    return (
      <g>
        <CyberArm d="M38 69 L28 82" joint={[33, 75.5]} deck={<Deck x={26} y={89} tilt={-8} />} />
        {/* приветствие — живой рукой, а не протезом */}
        <Limb d="M61 70 L78 58" fill="var(--soy-suit-2)" />
        <Hand x={80} y={56.5} />
        <Sparkle x={88} y={48} r={3.2} fill="var(--soy-neon)" />
        <Sparkle x={80} y={41} r={2.2} fill="var(--soy-neon)" />
      </g>
    );
  }
  if (state === "working") {
    return (
      <g>
        {/* всплывшее окно — «идёт обработка» без единой анимации */}
        <Holo />
        <CyberArm d="M38 70 L36 82" joint={[37, 76]} deck={<Deck x={41} y={90} />} />
        <Hand x={62} y={83} />
      </g>
    );
  }
  if (state === "error") {
    return (
      <g>
        <CyberArm d="M38 70 L31 86" joint={[34.5, 78]} deck={<Deck x={28} y={94} tilt={-22} glitch />} />
        <Hand x={66} y={87} />
      </g>
    );
  }
  // waiting
  return (
    <g>
      <CyberArm d="M38 69 L29 83" joint={[33.5, 76]} deck={<Deck x={26} y={90} tilt={-6} />} />
      <Hand x={68} y={84} />
    </g>
  );
}

// Дека — ручной терминал. Роль та же, что у меча: узнаваемое пятно в руке,
// от которого на 32px остаётся яркий прямоугольник.
function Deck({ x, y, tilt = 0, glitch = false }: { x: number; y: number; tilt?: number; glitch?: boolean }) {
  const ink = "var(--soy-ink)";
  return (
    <g transform={`rotate(${tilt} ${x} ${y})`}>
      <rect x={x - 10} y={y - 7} width="20" height="14" rx="2" fill="var(--soy-suit)" stroke={ink} strokeWidth="2" />
      <rect x={x - 7} y={y - 4.5} width="14" height="9" fill="var(--soy-neon)" stroke={ink} strokeWidth="1.2" />
      {glitch ? (
        <>
          <path d={`M${x - 4} ${y - 2.5} L${x + 4} ${y + 2.5}`} stroke={ink} strokeWidth="1.8" strokeLinecap="round" />
          <path d={`M${x + 4} ${y - 2.5} L${x - 4} ${y + 2.5}`} stroke={ink} strokeWidth="1.8" strokeLinecap="round" />
        </>
      ) : (
        <>
          <path d={`M${x - 5} ${y - 2} L${x + 2} ${y - 2}`} stroke={ink} strokeWidth="1.4" opacity="0.7" />
          <path d={`M${x - 5} ${y + 0.6} L${x + 4} ${y + 0.6}`} stroke={ink} strokeWidth="1.4" opacity="0.7" />
          <path d={`M${x - 5} ${y + 3.2} L${x} ${y + 3.2}`} stroke={ink} strokeWidth="1.4" opacity="0.7" />
        </>
      )}
    </g>
  );
}

// Голограмма сбоку — аналог рун у колдуна. Угол срезан (§9), заливка почти
// прозрачная: сквозь окно должен просвечивать фон, иначе это просто плашка.
function Holo() {
  const ink = "var(--soy-ink)";
  return (
    <g>
      <path d="M70 56 L94 56 L94 74 L86 80 L70 80 Z" fill="var(--soy-neon)" opacity="0.28" stroke="none" />
      <path d="M70 56 L94 56 L94 74 L86 80 L70 80 Z" fill="none" stroke={ink} strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M74 62 L90 62" stroke={ink} strokeWidth="1.6" opacity="0.75" />
      <path d="M74 67 L88 67" stroke={ink} strokeWidth="1.6" opacity="0.75" />
      <path d="M74 72 L82 72" stroke={ink} strokeWidth="1.6" opacity="0.75" />
      <path d="M66 68 L70 68" stroke="var(--soy-neon)" strokeWidth="2" strokeLinecap="round" />
    </g>
  );
}

// Полный рост на широком экране, одна голова на узком. Переключение чистым
// CSS (см. .soy-only-wide / .soy-only-narrow в index.css), а не слушателем
// resize: слушатель дал бы лишние рендеры на каждом движении рамки окна, а
// никакого состояния тут по существу нет. Второй SVG в разметке ничего не
// стоит — невидимый он не рисуется, а оба помечены decorative.
export function SoyManResponsive(props: Parameters<typeof SoyMan>[0]) {
  const cls = (extra: string) => (props.className ? `${extra} ${props.className}` : extra);
  return (
    <>
      <SoyMan {...props} className={cls("soy-only-wide")} />
      <SoyMan {...props} headOnly className={cls("soy-only-narrow")} />
    </>
  );
}
