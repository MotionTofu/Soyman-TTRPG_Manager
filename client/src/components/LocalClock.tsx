import { useEffect, useState } from "react";

function nowHHMM(): string {
  return new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function nowFull(): string {
  return new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export function LocalClock() {
  const [time, setTime] = useState(() => nowHHMM());
  const [full, setFull] = useState(() => nowFull());

  useEffect(() => {
    // Выравниваем к началу следующей минуты, чтобы не дрейфовать
    const now = new Date();
    const msToNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
    let interval: number | undefined;

    const timeout = window.setTimeout(() => {
      setTime(nowHHMM());
      setFull(nowFull());
      if (document.visibilityState === "visible") {
        interval = window.setInterval(() => {
          setTime(nowHHMM());
          setFull(nowFull());
        }, 60000);
      }
    }, msToNextMinute);

    const onVis = () => {
      if (document.visibilityState === "visible") {
        setTime(nowHHMM());
        setFull(nowFull());
        if (!interval) {
          interval = window.setInterval(() => {
            setTime(nowHHMM());
            setFull(nowFull());
          }, 60000);
        }
      } else if (interval) {
        clearInterval(interval);
        interval = undefined;
      }
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      clearTimeout(timeout);
      if (interval) clearInterval(interval);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return (
    <span
      className="local-clock"
      title={`${full} ${Intl.DateTimeFormat().resolvedOptions().timeZone}`}
      aria-label={`Текущее время ${time}`}
    >
      {time}
    </span>
  );
}
