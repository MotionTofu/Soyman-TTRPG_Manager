// Подписи (Фаза 1, Tool Controller): инструмент отвечает за клик по клетке
// и запрос открытия редактора. Сама modal/draft UI остаётся снаружи —
// инструмент сообщает onRequestLabelEdit, страница связывает с формой.

interface CreateLabelToolsArgs {
  onRequestLabelEdit: (x: number, y: number) => void;
}

export function createLabelTools(a: CreateLabelToolsArgs) {
  // Клик — модалка новой/правки. Мазков нет.
  function click(cell: { x: number; y: number }) {
    a.onRequestLabelEdit(cell.x, cell.y);
  }

  return { click };
}

export type LabelTools = ReturnType<typeof createLabelTools>;
