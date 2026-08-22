import { useState } from "react";
import { api } from "../api/client";
import { ENTITY_TYPE_SINGULAR } from "../entityTypes";

// Обслуживание ссылок в текстах: одна операция, по кнопке.
//
// **Убрать битые** — наследство в чистом виде: токен со старым локальным id,
// чья цель давно удалена. Опознать её нечем — глобального ключа у пропавшей
// строки не было. Уборка схлопывает такую ссылку в обычный текст.
//
// Кнопки «Проверить зависимости» здесь больше нет, и это не потеря: зачёркнутая
// ссылка теперь оживает сама в тот момент, когда её модуль появляется в базе —
// «жива ли» вычисляется, а не хранится в тексте, и чинить нечего. Отчёт «каких
// модулей не хватает» переехал в later.md, к разделу «Здоровье», где ему место
// рядом с остальными проверками базы.
//
// Уборка делается по нажатию, а не при обновлении приложения: переписывать
// тексты пользователя, которых он не просил трогать, приложение не должно —
// даже когда правка верная.

interface BrokenSample {
  type: string;
  label: string;
}

export function LinkMaintenanceCard() {
  const [scan, setScan] = useState<{ count: number; samples: BrokenSample[] } | null>(null);
  const [busy, setBusy] = useState("");
  const [done, setDone] = useState("");

  async function check() {
    setBusy("scan");
    setDone("");
    try {
      setScan(await api.get<{ count: number; samples: BrokenSample[] }>("/links/broken"));
    } finally {
      setBusy("");
    }
  }

  async function strip() {
    setBusy("strip");
    try {
      const r = await api.post<{ removed: number }>("/links/broken/strip", {});
      setDone(`Убрано битых ссылок: ${r.removed}. Подписи остались обычным текстом.`);
      setScan({ count: 0, samples: [] });
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="stack">
      <p className="muted">
        Зачёркнутая ссылка ждёт своего модуля и оживает сама, когда его поставят — делать для
        этого ничего не нужно. Битая — это наследство: её цель удалили давно, опознать уже нечем,
        и выглядит она рабочей.
      </p>

      <div className="row">
        <button disabled={!!busy} onClick={() => void check()}>
          {busy === "scan" ? "Считаю…" : "Найти битые ссылки"}
        </button>
      </div>

      {done && <div className="muted">{done}</div>}

      {scan && scan.count === 0 && <div className="muted">Битых ссылок нет.</div>}

      {scan && scan.count > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <strong>Найдено битых ссылок: {scan.count}</strong>
          <span className="muted">
            Ведут на:{" "}
            {scan.samples
              .map((s) => `${ENTITY_TYPE_SINGULAR[s.type] ?? s.type} «${s.label}»`)
              .join(", ")}
            {scan.count > scan.samples.length ? " и другие" : ""}
          </span>
          <div className="row">
            <button className="danger" disabled={!!busy} onClick={() => void strip()}>
              {busy === "strip" ? "Убираю…" : "Убрать, оставить текст"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
