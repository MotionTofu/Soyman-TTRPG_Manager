// Скрипт аварийного экрана. Отдельным файлом, а не inline: страница грузится
// в sandbox с preload (errorPreload.js), и отдельный файл проще править.

const api = window.startupError;

api.details().then((text) => {
  const box = document.getElementById("details");
  // Текста может не быть вовсе (сервер молчал по таймауту, исключения не
  // случилось) — тогда рамку показывать не за чем.
  if (text) box.textContent = text;
  else box.remove();
});

document.getElementById("log").addEventListener("click", () => api.openLog());
document.getElementById("data").addEventListener("click", () => api.openDataDir());
document.getElementById("close").addEventListener("click", () => api.close());
