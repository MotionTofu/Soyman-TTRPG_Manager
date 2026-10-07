import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAction, write } from "../../data/hooks";

export function OpenProjectWorkbook({ type, id }: { type: "setting" | "adventure" | "campaign"; id: number }) {
  const navigate = useNavigate();
  const run = useAction();
  const [opening, setOpening] = useState(false);
  async function open() {
    if (opening) return;
    setOpening(true);
    try {
      const workbook = await run(() => write.post<{ id: number }>(`/workbooks/projects/${type}/${id}/notebook`, {}), {
        affects: [{ path: "/workbooks" }, { path: "/book-library" }], retry: false,
      });
      if (workbook) navigate(`/workbooks/${workbook.id}`);
    } finally { setOpening(false); }
  }
  return <button type="button" onClick={() => void open()} disabled={opening}>{opening ? "Открываем тетрадь…" : "Открыть тетрадь"}</button>;
}
