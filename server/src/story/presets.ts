// Стартовые наборы для свободной доски (блок G5).
//
// Против страха пустого листа: доска, на которой нет ничего, предлагает три
// набора, каждый — три пина и две нити. Столько, чтобы стало с чего начать, и
// не столько, чтобы стирать было работой: `Ctrl+A`, `Delete`.
//
// Почему пины и нити, а не «три ноды и две стрелки», как записано в плане:
// стрелок на свободной доске нет вовсе. `GET /canvas/board?free_id=` отдаёт
// `edges: []` (`routes/canvas.ts`), и единственный вид связи здесь — нить
// между пинами (`canvas_threads`). Ребро на свободной доске означало бы
// переход между сценами, а сцен на ней не бывает.
//
// Имена узлов — ВОПРОСЫ, а не подписи («Кто за стойкой», не «Хозяин»).
// Пустой лист страшен не отсутствием кружков, а тем, что неясно, с чего
// начать; вопрос даёт начало, готовое имя — только ещё один чужой кружок.
//
// Цвет и форма здесь не задаются намеренно: палитра Полотна живёт в одном
// месте (`client/src/canvasPalette.ts`, блок B1), и продублировать её на
// сервере значило бы завести второе место, где цвет пина «по умолчанию».
// Пины заводятся дефолтами `POST /pins` — тем же самым, что у пина, который
// Мастер поставил рукой.

export interface PresetPin {
  name: string;
  x: number;
  y: number;
}

export interface CanvasPreset {
  /** Подпись на кнопке пустой доски. */
  label: string;
  /** Ровно три: больше — уже не «легко стереть». */
  pins: [PresetPin, PresetPin, PresetPin];
  /** Пары индексов в `pins`. Ровно две — цепочка, а не треугольник. */
  threads: [[number, number], [number, number]];
}

/**
 * Раскладка одна на все три набора: пологая дуга слева направо. Ровная
 * горизонталь читается как порядок шагов, которого здесь нет, а треугольник —
 * как схема, которую надо разгадывать.
 */
const SPOTS: [PresetPin, PresetPin, PresetPin] = [
  { name: "", x: 0, y: 0 },
  { name: "", x: 260, y: 150 },
  { name: "", x: 520, y: 0 },
];

const at = (names: [string, string, string]): [PresetPin, PresetPin, PresetPin] =>
  [
    { ...SPOTS[0], name: names[0] },
    { ...SPOTS[1], name: names[1] },
    { ...SPOTS[2], name: names[2] },
  ];

const CHAIN: [[number, number], [number, number]] = [
  [0, 1],
  [1, 2],
];

export const CANVAS_PRESETS: Record<string, CanvasPreset> = {
  tavern: {
    label: "Таверна",
    pins: at(["Кто за стойкой", "Кто в углу", "Слух, за который зацепятся"]),
    threads: CHAIN,
  },
  ambush: {
    label: "Засада",
    pins: at(["Кто нападает", "Где укрытие", "Куда отступать"]),
    threads: CHAIN,
  },
  chase: {
    label: "Погоня",
    pins: at(["Кто убегает", "Что мешает", "Чем кончится"]),
    threads: CHAIN,
  },
};

export type CanvasPresetKey = keyof typeof CANVAS_PRESETS;

export function isPresetKey(v: unknown): v is CanvasPresetKey {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(CANVAS_PRESETS, v);
}
