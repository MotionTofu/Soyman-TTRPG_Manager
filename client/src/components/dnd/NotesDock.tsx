import { useState, type ReactNode } from "react";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { Sheet } from "./wizardUi";
import "./SheetNotesColumn.css";

// Где живут заметки листа (гриллинг 2026-09-28, Q20–Q23): колонкой справа от
// вкладок, где ей хватает места, уже — плашкой внизу экрана, которая
// открывает ту же ленту шторкой поверх текущей вкладки. Лента рисуется в
// одном месте — выбор media-запросом, а не прятанием в CSS.
//
// Общее у основного приложения (SheetNotesColumn) и OneShot.

// Тот же порог, что в SheetNotesColumn.css: шире — колонка, уже — плашка.
const WIDE = "(min-width: 1600px)";

export function NotesDock({
  status,
  link,
  children,
}: {
  /** Подпись рядом с заголовком: «Идёт №12», «К сессии №10». */
  status?: string;
  /** «Весь дневник» и подобное — в шапке колонки и подвале шторки. */
  link?: ReactNode;
  /** Сама лента (NotesFeed). */
  children: ReactNode;
}) {
  const wide = useMediaQuery(WIDE);
  const [open, setOpen] = useState(false);

  if (!wide) {
    return (
      <>
        <button type="button" className="sheet-notes-bar" onClick={() => setOpen(true)}>
          <strong>Заметки</strong>
          {status && <span className="muted">{status}</span>}
        </button>
        {open && (
          <Sheet title="Заметки" onClose={() => setOpen(false)} actions={link || undefined}>
            {status && <span className="muted sheet-notes__target">{status}</span>}
            <div className="sheet-notes__sheet-feed">{children}</div>
          </Sheet>
        )}
      </>
    );
  }

  return (
    <aside className="sheet-notes" aria-label="Заметки">
      <div className="sheet-notes__head">
        <strong>Заметки</strong>
        <span className="muted sheet-notes__target">{status}</span>
        {link}
      </div>
      {children}
    </aside>
  );
}
