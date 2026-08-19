import { useState } from "react";
import { api } from "../api/client";
import { ENTITY_TYPE_SINGULAR } from "../entityTypes";

// Обслуживание ссылок в текстах: две операции, обе по кнопке.
//
// **Проверить зависимости** — оживить подвешенные ссылки, чьи модули с тех пор
// поставили. То же самое случается само после каждой установки модуля; кнопка
// нужна на случай, когда сущность появилась другим путём.
//
// **Убрать битые** — наследство: цели удалили до того, как появилось
// подвешивание, и опознать их уже нечем. Такая ссылка выглядит рабочей, но
// ведёт на несуществующую страницу. Уборка схлопывает её в обычный текст.
//
// Обе делаются по нажатию, а не при обновлении приложения: переписывать тексты
// пользователя, которых он не просил трогать, приложение не должно — даже
// когда правка верная.

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

  async function heal() {
    setBusy("heal");
    setDone("");
    try {
      const r = await api.post<{ healed: number }>("/links/heal", {});
      setDone(
        r.healed > 0
          ? `Ожило ссылок: ${r.healed}.`
          : "Все ссылки, которые можно оживить, уже живые."
      );
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="stack">
      <p className="muted">
        Зачёркнутая ссылка ждёт своего модуля и оживает сама, когда его поставят. Битая — это
        наследство: её цель удалили давно, опознать уже нечем, и выглядит она рабочей.
      </p>

      <div className="row">
        <button disabled={!!busy} onClick={() => void heal()}>
          {busy === "heal" ? "Проверяю…" : "Проверить зависимости"}
        </button>
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
