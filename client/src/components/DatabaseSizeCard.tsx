import { useEffect, useState } from "react";
import { api } from "../api/client";

// Размер файла базы и доля пустоты в нём.
//
// SQLite не возвращает место системе: удалённые строки оставляют свободные
// страницы, которые переиспользуются под новые данные, но файл не худеет
// никогда. У базы, из которой много удаляли — переставляли систему, чистили
// архив, откатывали импорты, — пустоты набирается кратно больше самих данных.
//
// Перестройка случается сама при старте, когда пустоты больше половины. Кнопка
// здесь для нетерпеливых и для случая, когда чистка была только что и ждать
// следующего запуска не хочется.

interface Fill {
  pages: number;
  freePages: number;
  freeRatio: number;
  bytes: number;
}

const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);

export function DatabaseSizeCard() {
  const [fill, setFill] = useState<Fill | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");

  function refresh(signal?: AbortSignal) {
    api
      .get<Fill>("/storages/db-size", signal ? { signal } : undefined)
      .then(setFill)
      .catch((e) => {
        if ((e as Error).name === "AbortError") return;
        setFill(null);
      });
  }
  useEffect(() => {
    const ac = new AbortController();
    refresh(ac.signal);
    return () => ac.abort();
  }, []);

  async function compact() {
    setBusy(true);
    setDone("");
    try {
      const r = await api.post<{ before: Fill; after: Fill }>("/storages/compact", {});
      setFill(r.after);
      const saved = r.before.bytes - r.after.bytes;
      setDone(
        saved > 0
          ? `Освобождено ${mb(saved)} МБ: файл был ${mb(r.before.bytes)} МБ, стал ${mb(r.after.bytes)} МБ.`
          : "Сжимать нечего — файл уже плотный."
      );
    } catch (e) {
      if ((e as Error).name !== "AbortError") setDone("Не удалось сжать — попробуй еще раз");
    } finally {
      setBusy(false);
    }
  }

  if (!fill) return (
    <div className="card stack">
      <h3>Файл базы</h3>
      <div className="muted" style={{ height: 20 }} />
    </div>
  );
  const percent = Math.round(fill.freeRatio * 100);

  return (
    <div className="card stack">
      <h3>Файл базы</h3>
      <div>
        Размер: <strong>{mb(fill.bytes)} МБ</strong>
        {percent > 0 && <> · из них пустоты от удалённых записей: {percent}%</>}
      </div>
      <span className="muted">
        Удалённые записи не возвращают место сами — файл растёт и не уменьшается, пока его не
        перестроят. Это происходит само при запуске, когда пустоты набирается больше половины.
      </span>
      {done && <div className="muted">{done}</div>}
      <div className="row">
        <button disabled={busy} onClick={() => void compact()}>
          {busy ? "Перестраиваю…" : "Сжать файл сейчас"}
        </button>
      </div>
    </div>
  );
}
