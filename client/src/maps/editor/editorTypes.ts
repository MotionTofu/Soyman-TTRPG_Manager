// Общие типы редактора карт (Фаза 1): нейтральное место для понятий,
// принадлежащих редактору целиком, а не одной подсистеме.
// Владелец понятия инструмента в будущем — Tool Controller;
// hotkeys/camera/history его только используют.

// Канонический список инструментов редактора. Раньше жил в MapEditorPage,
// затем временно — в useMapHotkeys; здесь — постоянное место.
export type PaintTool =
  | "brush"
  | "fill"
  | "eraser"
  | "picker"
  | "road"
  | "river"
  | "wall"
  | "shape"
  | "ruler"
  | "label"
  | "select"
  | "door"
  | "trap"
  | "chest"
  | "altar"
  | "marker"
  | "start"
  | "finish";

// Размер кисти 1/2/3: Чебышев-окрестность на квадратах, hex-distance на гексах.
export type BrushSize = 1 | 2 | 3;
