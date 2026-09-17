import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
const root = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(root, 'dist');
await mkdir(output, { recursive: true });
for (const name of ['index.html', 'sheet.html', 'style.css', 'state.js', 'app.js']) await copyFile(path.join(root, 'public', name), path.join(output, name));
function iconPng(size) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]); let crc = 0xffffffff;
    for (const byte of body) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const check = Buffer.alloc(4); check.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, body, check]);
  };
  const pixels = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const p = y * (size * 4 + 1) + 1 + x * 4;
    const mark = (x > size * .45 && x < size * .58 && y > size * .22 && y < size * .78) || (x > size * .32 && x < size * .65 && y > size * .69 && y < size * .79);
    pixels.set(mark ? [217, 251, 104, 255] : [22, 23, 27, 255], p);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
for (const size of [192, 512]) await writeFile(path.join(output, `icon-${size}.png`), iconPng(size));
for (const [id, name] of [['warrior', 'Тестовый воин'], ['mage', 'Тестовый маг']]) {
  const dir = path.join(output, 'c', id); await mkdir(dir, { recursive: true });
  await copyFile(path.join(root, 'public/sheet.html'), path.join(dir, 'index.html'));
  await copyFile(path.join(root, 'public/sw.js'), path.join(dir, 'sw.js'));
  await writeFile(path.join(dir, 'manifest.webmanifest'), JSON.stringify({ id: `/c/${id}/`, name, short_name: name, start_url: `/c/${id}/`, scope: `/c/${id}/`, display: 'standalone', background_color: '#16171b', theme_color: '#16171b', icons: [192, 512].map(size => ({ src: `/icon-${size}.png`, sizes: `${size}x${size}`, type: 'image/png' })) }, null, 2));
}
console.log('Static prototype built in SoyMan_1shot/dist');
