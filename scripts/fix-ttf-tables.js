// Починка TTF, который браузер отказывается принимать.
//
// Понадобилось для New_Zelek.ttf: Chrome отвергал его с
// «OTS parsing error: bad table directory searchRange / cmap: expected
// search range != search range». Это поля бинарного поиска — searchRange,
// entrySelector, rangeShift — в каталоге таблиц и в подтаблице cmap
// формата 4. Они целиком выводятся из данных, поэтому пересчёт однозначен и
// безопасен: глифы, метрики и кодировка не трогаются.
//
// Запуск: node scripts/fix-ttf-tables.js исходный.ttf готовый.ttf
//
// Пересчёт производных полей TTF: searchRange/entrySelector/rangeShift в
// каталоге таблиц и в подтаблице cmap формата 4, плюс контрольные суммы.
// Все эти значения выводятся из самих данных, поэтому починка однозначна —
// глифы и метрики не трогаются вовсе.
const fs = require("fs");
const src = process.argv[2], dst = process.argv[3];
const b = fs.readFileSync(src);

const log2floor = (n) => Math.floor(Math.log2(n));

// --- 1. каталог таблиц ---
const numTables = b.readUInt16BE(4);
const sr = 16 * Math.pow(2, log2floor(numTables));
b.writeUInt16BE(sr, 6);
b.writeUInt16BE(log2floor(numTables), 8);
b.writeUInt16BE(numTables * 16 - sr, 10);

const dir = {};
for (let i = 0; i < numTables; i++) {
  const off = 12 + i * 16;
  dir[b.slice(off, off + 4).toString("latin1")] = { entry: off, start: b.readUInt32BE(off + 8), len: b.readUInt32BE(off + 12) };
}

// --- 2. cmap: подтаблицы формата 4 ---
let fixedSubtables = 0;
if (dir.cmap) {
  const c = dir.cmap.start;
  const n = b.readUInt16BE(c + 2);
  for (let i = 0; i < n; i++) {
    const rec = c + 4 + i * 8;
    const sub = c + b.readUInt32BE(rec + 4);
    if (b.readUInt16BE(sub) !== 4) continue;
    const segCountX2 = b.readUInt16BE(sub + 6);
    const segCount = segCountX2 / 2;
    const s = 2 * Math.pow(2, log2floor(segCount));
    b.writeUInt16BE(s, sub + 8);
    b.writeUInt16BE(log2floor(segCount), sub + 10);
    b.writeUInt16BE(segCountX2 - s, sub + 12);
    fixedSubtables++;
  }
}

// --- 3. контрольные суммы ---
function sum(start, len) {
  let acc = 0;
  const end = start + ((len + 3) & ~3);
  for (let i = start; i < end; i += 4) acc = (acc + (i + 4 <= b.length ? b.readUInt32BE(i) : 0)) >>> 0;
  return acc >>> 0;
}
if (dir.head) b.writeUInt32BE(0, dir.head.start + 8); // checkSumAdjustment обнуляется на время расчёта
for (const t of Object.values(dir)) b.writeUInt32BE(sum(t.start, t.len), t.entry + 4);
if (dir.head) {
  let whole = 0;
  for (let i = 0; i < b.length; i += 4) whole = (whole + (i + 4 <= b.length ? b.readUInt32BE(i) : 0)) >>> 0;
  b.writeUInt32BE((0xb1b0afba - whole) >>> 0, dir.head.start + 8);
}

fs.writeFileSync(dst, b);
console.log(`таблиц: ${numTables}, починено cmap-подтаблиц: ${fixedSubtables}, записано: ${dst}`);
