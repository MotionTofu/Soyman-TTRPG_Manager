// Автономная копия открывается на чём придётся, в том числе на iOS старше
// 15.4: там нет этих функций, и лист падал пустым экраном. Сборщик переписывает
// только синтаксис, не встроенные API — поэтому заплатки вручную, до всего
// остального кода (импортируется первым).
function at<T>(this: ArrayLike<T>, index: number): T | undefined {
  const i = Math.trunc(index) || 0;
  return this[i < 0 ? this.length + i : i];
}
if (!Array.prototype.at) Object.defineProperty(Array.prototype, 'at', { value: at, writable: true, configurable: true });
if (!String.prototype.at) Object.defineProperty(String.prototype, 'at', { value: at, writable: true, configurable: true });
if (typeof globalThis.structuredClone !== 'function') {
  // Копируются только JSON-данные листа — JSON-копии достаточно.
  globalThis.structuredClone = (<T,>(value: T): T => JSON.parse(JSON.stringify(value))) as typeof structuredClone;
}
if (globalThis.crypto && typeof globalThis.crypto.randomUUID !== 'function') {
  globalThis.crypto.randomUUID = (() => {
    const b = globalThis.crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }) as Crypto['randomUUID'];
}
