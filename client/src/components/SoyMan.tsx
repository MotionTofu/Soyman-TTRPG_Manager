// SoyMan — маскот приложения. Один компонент на все холодные зоны:
// логин, онбординг, первичные пустые состояния, 404, экран ошибки, загрузка.
// За столом (сессия, инициатива, статблоки) маскота нет — см. CLAUDE.md
// «Приоритет: простота для Мастера».
//
// Полный рост — растровые арты public/mascot/<класс>-<состояние>.webp
// (реестр rasterAssets, ≤100КБ): живописный рендер вместо зинной печати —
// осознанное исключение из канона по решению владельца артов. Голова
// (headOnly, узкие экраны) — прежний SVG: лёгкий и едет за темой.
//
// Неприкасаемое (§25) соблюдено и там, и там — куб, лицо, росток, пропорции.
// Тофу светлый (§23), контур тёмный (§12).
import { useId } from "react";

export type SoyManState =
  /** Приветствие. Логин, онбординг. */
  | "idle"
  /** За работой. Загрузка, splash. */
  | "working"
  /** Спокойствие. Пустые состояния. */
  | "waiting"
  /** Тревога. 404 и экран ошибки. */
  | "error";

/**
 * Класс персонажа. Приложение системно-нейтральное (D&D, LitM, свои системы),
 * поэтому классы — настроения, а не привязка к разделу. Воина нет: листа
 * воина не существует, вместо него — сыщик. Остальные шесть — даос, вампир,
 * мироходец, пират, герой и агент.
 */
export type SoyManGuise =
  | "detective"
  | "mage"
  | "runner"
  | "taoist"
  | "vampire"
  | "walker"
  | "pirate"
  | "hero"
  | "agent";

export type SoyManSize = "sm" | "md" | "lg";

const SIZE_PX: Record<SoyManSize, number> = { sm: 32, md: 64, lg: 160 };

const GUISES: SoyManGuise[] = [
  "mage",
  "runner",
  "detective",
  "taoist",
  "vampire",
  "walker",
  "pirate",
  "hero",
  "agent",
];

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
  detective: "SoyMan-сыщик",
  mage: "SoyMan-колдун",
  runner: "SoyMan-нетраннер",
  taoist: "SoyMan-даос",
  vampire: "SoyMan-вампир",
  walker: "SoyMan-мироходец",
  pirate: "SoyMan-пират",
  hero: "SoyMan-герой",
  agent: "SoyMan-агент",
};
const STATE_LABEL: Record<SoyManState, string> = {
  idle: "машет рукой",
  working: "за работой",
  waiting: "ждёт",
  error: "расстроен",
};

/** Растровые арты полного роста: public/mascot, реестр rasterAssets. */
const RASTER: Record<SoyManGuise, Record<SoyManState, string>> = {
  mage: {
    idle: "/mascot/mage-idle.webp",
    working: "/mascot/mage-working.webp",
    waiting: "/mascot/mage-waiting.webp",
    error: "/mascot/mage-error.webp",
  },
  runner: {
    idle: "/mascot/runner-idle.webp",
    working: "/mascot/runner-working.webp",
    waiting: "/mascot/runner-waiting.webp",
    error: "/mascot/runner-error.webp",
  },
  detective: {
    idle: "/mascot/detective-idle.webp",
    working: "/mascot/detective-working.webp",
    waiting: "/mascot/detective-waiting.webp",
    error: "/mascot/detective-error.webp",
  },
  taoist: {
    idle: "/mascot/taoist-idle.webp",
    working: "/mascot/taoist-working.webp",
    waiting: "/mascot/taoist-waiting.webp",
    error: "/mascot/taoist-error.webp",
  },
  vampire: {
    idle: "/mascot/vampire-idle.webp",
    working: "/mascot/vampire-working.webp",
    waiting: "/mascot/vampire-waiting.webp",
    error: "/mascot/vampire-error.webp",
  },
  walker: {
    idle: "/mascot/walker-idle.webp",
    working: "/mascot/walker-working.webp",
    waiting: "/mascot/walker-waiting.webp",
    error: "/mascot/walker-error.webp",
  },
  pirate: {
    idle: "/mascot/pirate-idle.webp",
    working: "/mascot/pirate-working.webp",
    waiting: "/mascot/pirate-waiting.webp",
    error: "/mascot/pirate-error.webp",
  },
  hero: {
    idle: "/mascot/hero-idle.webp",
    working: "/mascot/hero-working.webp",
    waiting: "/mascot/hero-waiting.webp",
    error: "/mascot/hero-error.webp",
  },
  agent: {
    idle: "/mascot/agent-idle.webp",
    working: "/mascot/agent-working.webp",
    waiting: "/mascot/agent-waiting.webp",
    error: "/mascot/agent-error.webp",
  },
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
  const label = isCalmMage(state, guise)
    ? "SoyMan-колдун улыбается посреди пожара"
    : `${GUISE_LABEL[guise]} ${STATE_LABEL[state]}`;

  // Полный рост — растр. SVG ниже живёт только для headOnly.
  if (!headOnly) {
    return (
      <img
        src={RASTER[guise][state]}
        // Растр 4:3 (480×360): высотой в размер, ширина по пропорции.
        width={Math.round((px * 4) / 3)}
        height={px}
        className={className}
        role={decorative ? "presentation" : "img"}
        alt={decorative ? "" : label}
        aria-hidden={decorative || undefined}
      />
    );
  }

  // Голова живёт в 16..86 по X и 0..74 по Y.
  const viewBox = "16 0 70 74";
  const height = Math.round(px * (74 / 70));

  return (
    <svg
      // .soy-man несёт палитру персонажа — см. index.css. Класс обязателен:
      // без него все var(--soy-*) не разрешатся и рисунок уйдёт в чёрное.
      className={className ? `soy-man ${className}` : "soy-man"}
      width={px}
      height={height}
      viewBox={viewBox}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role={decorative ? "presentation" : "img"}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative || undefined}
    >
      <defs>
        {/* Халфтон — обязательный «шум» дизайн-системы §5.2. Тень на объёме
            даётся точками, а не размытием: box-shadow и blur в зине запрещены. */}
        <pattern id={halftone} width="3" height="3" patternUnits="userSpaceOnUse">
          <circle cx="1.2" cy="1.2" r="0.85" fill="var(--soy-ink)" opacity="0.22" />
        </pattern>
      </defs>

      <Head state={state} guise={guise} halftone={halftone} />
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
