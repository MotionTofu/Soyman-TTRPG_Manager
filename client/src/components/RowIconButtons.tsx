// Править и удалить в строке списка — значками, рядом и всегда последними
// (просьба владельца 2026-10-02): подписи «Редактировать» растягивали строку.
// Значки — рисованные ассеты skin: --skin-edit-pencil, --skin-trash (Codex, 2026-10-02).

export function RowEditButton({ onClick, label = "Редактировать" }: { onClick: () => void; label?: string }) {
  return <button type="button" className="row-icon row-icon--edit" onClick={onClick} title={label} aria-label={label} />;
}

export function RowDeleteButton({ onClick, label = "Удалить" }: { onClick: () => void; label?: string }) {
  return <button type="button" className="row-icon row-icon--trash" onClick={onClick} title={label} aria-label={label} />;
}
