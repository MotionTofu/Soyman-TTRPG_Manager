import { useEffect, useState } from "react";

// Длительность трека нигде не хранится: в базе у звука есть только путь, а
// сотня файлов лежит в хранилище владельца и переезжает вместе с ним. В
// списке бэкграунда время нужно — по нему выбирают, что ставить на сцену, —
// поэтому оно снимается у самого файла при первом показе и остаётся в
// памяти вкладки. В базу не пишем: пересчёт стоит одно чтение заголовка, а
// лишняя колонка в resources потом врёт после замены файла.
//
// Очередь по два файла за раз: браузер честно тянет метаданные, а в
// библиотеке владельца попадаются файлы на сотни мегабайт.

const cache = new Map<number, number>();
const pending = new Set<number>();
let running = 0;
const queue: (() => void)[] = [];

function pump() {
  while (running < 2 && queue.length) {
    running += 1;
    queue.shift()!();
  }
}

function probe(src: string): Promise<number | null> {
  return new Promise((resolve) => {
    const audio = new Audio();
    audio.preload = "metadata";
    let done = false;
    const finish = (value: number | null) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      audio.removeAttribute("src");
      audio.load();
      resolve(value);
    };
    const timer = window.setTimeout(() => finish(null), 15000);
    audio.addEventListener("loadedmetadata", () =>
      finish(Number.isFinite(audio.duration) ? audio.duration : null)
    );
    audio.addEventListener("error", () => finish(null));
    audio.src = src;
  });
}

export function useDurations(tracks: { id: number; src: string | null }[]): Map<number, number> {
  const [, bump] = useState(0);

  useEffect(() => {
    let alive = true;
    for (const track of tracks) {
      if (!track.src || cache.has(track.id) || pending.has(track.id)) continue;
      pending.add(track.id);
      const { id, src } = track;
      queue.push(() => {
        probe(src).then((seconds) => {
          if (seconds !== null) cache.set(id, seconds);
          pending.delete(id);
          running -= 1;
          pump();
          if (alive) bump((n) => n + 1);
        });
      });
    }
    pump();
    return () => {
      alive = false;
    };
    // Пересчитываем при смене состава списка, а не при каждом рендере.
  }, [tracks.map((t) => t.id).join(",")]);

  return cache;
}

export function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
