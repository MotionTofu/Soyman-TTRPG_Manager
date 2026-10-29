import { useEffect, useState } from "react";

// Длительность трека нигде не хранится: в базе у звука есть только путь, а
// сотня файлов лежит в хранилище владельца и переезжает вместе с ним. В
// аудиотеке время нужно и для выбора звука, и для сортировки, —
// поэтому оно снимается у самого файла при первом показе и остаётся в
// памяти вкладки. В базу не пишем: пересчёт стоит одно чтение заголовка, а
// лишняя колонка в resources потом врёт после замены файла.
//
// Очередь по два файла за раз: браузер честно тянет метаданные, а в
// библиотеке владельца попадаются файлы на сотни мегабайт.

// Ключ — URL: после перепривязки того же resource_id старое время неверно.
// Завершение общего запроса будит все открытые списки, а не только первый.
const cache = new Map<string, number | null>();
const pending = new Set<string>();
const listeners = new Set<() => void>();
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
    const notify = () => { if (alive) bump((n) => n + 1); };
    listeners.add(notify);
    for (const track of tracks) {
      if (!track.src || cache.has(track.src) || pending.has(track.src)) continue;
      pending.add(track.src);
      const { src } = track;
      queue.push(() => {
        probe(src).then((seconds) => {
          cache.set(src, seconds);
          pending.delete(src);
          running -= 1;
          pump();
          listeners.forEach((listener) => listener());
        });
      });
    }
    pump();
    return () => {
      alive = false;
      listeners.delete(notify);
    };
    // Пересчитываем при смене состава списка, а не при каждом рендере.
  }, [tracks]);

  const result = new Map<number, number>();
  for (const track of tracks) {
    const seconds = track.src ? cache.get(track.src) : null;
    if (seconds != null) result.set(track.id, seconds);
  }
  return result;
}

export function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
