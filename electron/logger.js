// Журнал главного процесса.
//
// В собранном приложении к процессу не подключена консоль, поэтому весь
// console.log — и главного процесса, и сервера, который живёт в нём же (см.
// require(serverEntry) в main.js) — уходил в никуда. Пока всё работает, это
// незаметно; в тот единственный раз, когда приложение не стартует, это
// означает полное отсутствие следов. Ровно так и вышло 2026-09-05: окна нет,
// процессы висят, сказать о причине нечего.
//
// Отсюда требования, и ничего сверх них: писать всегда (половина ценности
// журнала — то, что происходило ДО падения), одним файлом, без библиотек и
// без внешних зависимостей, никогда не мешая работе приложения.

const fs = require("fs");
const path = require("path");

// Больше этого — переименовываем в main.prev.log и начинаем заново. Вся
// ротация: один предыдущий файл, проверка один раз при старте. Двух мегабайт
// хватает на несколько запусков с миграциями, а разрастись файл не успеет.
const MAX_BYTES = 2 * 1024 * 1024;

let stream = null;
let logFile = null;

function ts() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
  );
}

// console.log("текст", {объект}, err) — аргументы бывают любые, и ни один из
// них не должен уронить запись в журнал. util.inspect дал бы вывод красивее,
// но JSON+fallback короче и не тянет ничего лишнего.
function format(args) {
  return args
    .map((a) => {
      if (typeof a === "string") return a;
      if (a instanceof Error) return a.stack || String(a);
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(" ");
}

function write(level, args) {
  if (!stream) return;
  try {
    stream.write(`${ts()} [${level}] ${format(args)}\n`);
  } catch {
    // Журнал не имеет права ломать приложение: диск заполнен, файл занят
    // антивирусом — что угодно здесь означает «пишем молча мимо», а не сбой.
  }
}

// Вызывать как можно раньше в main.js — до первого require, который может
// что-то напечатать или упасть.
function setupLogging(userDataDir) {
  const dir = path.join(userDataDir, "logs");
  try {
    fs.mkdirSync(dir, { recursive: true });
    logFile = path.join(dir, "main.log");
    try {
      if (fs.statSync(logFile).size > MAX_BYTES) {
        fs.renameSync(logFile, path.join(dir, "main.prev.log"));
      }
    } catch {
      // Файла ещё нет — обычное дело на первом запуске.
    }
    stream = fs.createWriteStream(logFile, { flags: "a" });
    stream.on("error", () => {
      stream = null;
    });
  } catch {
    return null;
  }

  // Перехватываем console целиком, а не заводим свой logger: сервер печатает
  // через console и правок ради журнала в нём делать не нужно. Оригинал
  // вызываем следом — в dev-запуске вывод в терминале должен остаться.
  for (const level of ["log", "info", "warn", "error"]) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      write(level.toUpperCase(), args);
      original(...args);
    };
  }

  return logFile;
}

function getLogFile() {
  return logFile;
}

module.exports = { setupLogging, getLogFile };
