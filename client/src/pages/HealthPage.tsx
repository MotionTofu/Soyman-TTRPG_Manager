import { useState } from "react";
import { api } from "../api/client";

interface ScanResult {
  brokenPaths: { table: string; column: string; id: number; path: string }[];
  brokenPathsCount: number;
  missingFiles: { resource_id: number; name: string; file_path: string; file_name: string }[];
  missingFilesCount: number;
  orphans: Record<string, number>;
  orphansTotal: number;
  seq: { table: string; seq: number; maxId: number | null; drift: number }[];
  seqWorst: { table: string; seq: number; maxId: number | null; drift: number } | null;
  brokenLinks: { count: number; samples: { type: string; label: string }[] };
  brokenLinksCount: number;
  danglingModules: { code: string; label: string; count: number }[];
  danglingModulesCount: number;
  deadUidMentions: { type: string; uid: string; code: string; label: string; table: string; column: string }[];
  deadUidMentionsCount: number;
  orphanFiles: { path: string; size: number }[];
  orphanFilesCount: number;
  relinkCandidates: { resource_id: number; name: string; old_path: string; new_path: string; match: string }[];
  relinkCandidatesCount: number;
  bracketNames: { table: string; count: number; sample: string }[];
  bracketNamesCount: number;
}

export function HealthPage() {
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  async function runScan() {
    setLoading(true);
    setMsg("");
    try {
      const r = await api.get<ScanResult>("/health/scan");
      setScan(r);
    } catch (e) {
      setMsg(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }

  async function cleanOrphans() {
    if (!confirm("Убрать все сироты (статблоки, ссылки, доски) без возможности отмены? Рекомендуется сделать бэкап.")) return;
    try {
      const r = await api.post<{ removed: number }>("/health/orphans/clean");
      setMsg(`Убрано сирот: ${r.removed}`);
      runScan();
    } catch (e) {
      setMsg(String(e instanceof Error ? e.message : e));
    }
  }

  async function resetSeq(table: string) {
    if (!confirm(`Сбросить счётчик ${table} до max(id)?`)) return;
    try {
      const r = await api.post<{ table: string; maxId: number | null; seq: number }>("/health/seq/reset", { table });
      setMsg(`Счётчик ${r.table} → ${r.seq} (max ${r.maxId})`);
      runScan();
    } catch (e) {
      setMsg(String(e instanceof Error ? e.message : e));
    }
  }

  async function stripBroken() {
    if (!confirm("Убрать битые ссылки? Подписи останутся обычным текстом.")) return;
    try {
      const r = await api.post<{ removed: number }>("/health/links/strip");
      setMsg(`Убрано битых ссылок: ${r.removed}`);
      runScan();
    } catch (e) {
      setMsg(String(e instanceof Error ? e.message : e));
    }
  }

  async function fixDeadUidLinks() {
    if (!confirm("Починить мёртвые UID-ссылки? Ссылки будут заменены на актуальные, если цель найдена по имени. Неизвестные ссылки схлопнутся в текст.")) return;
    try {
      const r = await api.post<{ fixed: number; unresolved: number }>("/health/uid-links/fix");
      setMsg(`Починено: ${r.fixed}, неизвестных (схлопнуто в текст): ${r.unresolved}`);
      runScan();
    } catch (e) {
      setMsg(String(e instanceof Error ? e.message : e));
    }
  }

  async function relink(c: { resource_id: number; new_path: string }) {
    try {
      await api.post("/health/relink", { resource_id: c.resource_id, new_path: c.new_path });
      setMsg(`Перепривязан ${c.resource_id} → ${c.new_path}`);
      runScan();
    } catch (e) {
      setMsg(String(e instanceof Error ? e.message : e));
    }
  }

  async function openFolder(path: string) {
    try {
      await api.post("/health/open-folder", { path });
      setMsg(`Открываю папку: ${path}`);
    } catch (e) {
      setMsg(String(e instanceof Error ? e.message : e));
    }
  }

  return (
    <div className="stack">
      <h1>Здоровье</h1>
      <p className="muted">
        Ревизия базы и файлов по кнопке — списком с предложением починить. Проверяет битые пути, потерянные файлы,
        сироты (см. П0.2), дрифт счётчиков (П0.4), битые ссылки.
      </p>

      <div className="row">
        <button className={scan ? "" : "primary"} onClick={runScan} disabled={loading}>
          {loading ? "Проверяю…" : "Проверить здоровье"}
        </button>
        {msg && <span className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }}>{msg}</span>}
      </div>

      {!scan && !loading && <p className="muted">Нажмите «Проверить» — проверки идут только по кнопке.</p>}

      {scan && (
        <div className="stack">
          {/* Сироты — §1.11: пустой блок не показывается, §1.8: один горячий на странице */}
          {scan.orphansTotal > 0 && (
            <details className="card stack" open>
              <summary><strong className="entry-title">Сироты</strong> — полиморфные хвосты без хозяина</summary>
              <p className="muted">statblocks / generic_links / entity_relations / canvas_boards. Считаются без удаления; чистка — кнопкой.</p>
              <ul className="muted" style={{ margin: 0, paddingLeft: 18, fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }}>
                {Object.entries(scan.orphans).map(([k, v]) => <li key={k}>{k}: {v}</li>)}
              </ul>
              <div className="row">
                <button className="danger" onClick={cleanOrphans}>Убрать сирот ({scan.orphansTotal})</button>
              </div>
            </details>
          )}

          {/* Счётчики — §1.5: числа моноширинным */}
          {scan.seq.some((r) => r.drift > 0) && (
            <details className="card stack" open={(scan.seqWorst?.drift ?? 0) > 20}>
              <summary><strong className="entry-title">Счётчики AUTOINCREMENT</strong> — дрифт seq vs max(id)</summary>
              <p className="muted">Норма — drift 0..4. Большой drift = кто-то плодит строки в цикле (см. П0.4).</p>
              <div className="stack">
                {scan.seq.filter((r) => r.drift > 0).map((r) => (
                  <div key={r.table} className="row" style={{ justifyContent: "space-between" }}>
                    <span className={r.drift > 20 ? "badge cancelled" : "muted"} style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }}>{r.table}: seq {r.seq} / max {r.maxId ?? "—"} / drift {r.drift}</span>
                    <button onClick={() => resetSeq(r.table)}>Сбросить</button>
                  </div>
                ))}
              </div>
            </details>
          )}

          {/* Битые пути — §1.11: не показывается если нечего */}
          {scan.brokenPathsCount > 0 && (
            <details className="card stack" open>
              <summary><strong className="entry-title">Битые пути к файлам</strong> — *_path без файла на диске</summary>
              <p className="muted">Показано до 200. Починка — вручную: перепривязать файл или удалить запись.</p>
              <div className="stack" style={{ maxHeight: 260, overflowY: "auto", fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }}>
                {scan.brokenPaths.map((b, i) => (
                  <div key={`${b.table}:${b.column}:${b.id}:${i}`} className="muted">
                    {b.table}.{b.column} #{b.id}: {b.path}
                  </div>
                ))}
              </div>
            </details>
          )}

          {/* Пропавшие файлы ресурсов — §1.11 */}
          {scan.missingFilesCount > 0 && (
            <details className="card stack" open>
              <summary><strong className="entry-title">Пропавшие файлы ресурсов</strong></summary>
              <ul className="muted" style={{ margin: 0, paddingLeft: 18, fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }}>
                {scan.missingFiles.slice(0, 50).map((f) => (
                  <li key={f.resource_id}>{f.name} — {f.file_path}</li>
                ))}
              </ul>
              {scan.missingFilesCount > 50 && <span className="muted" style={{ fontFamily: "var(--font-mono)" }}>…и ещё {scan.missingFilesCount - 50}</span>}
              {scan.relinkCandidatesCount > 0 && (
                <div className="stack">
                  <strong className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }}>Кандидаты автоперепривязки (по имени файла):</strong>
                  {scan.relinkCandidates.map((c) => (
                    <div key={c.resource_id} className="row" style={{ justifyContent: "space-between" }}>
                      <span className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }}>{c.name}: {c.old_path} → {c.new_path}</span>
                      <button onClick={() => relink(c)}>Перепривязать</button>
                    </div>
                  ))}
                </div>
              )}
              <p className="muted">Если кандидата нет — перепривяжите вручную в карточке ресурса.</p>
            </details>
          )}

          {/* Битые ссылки — наследство */}
          {scan.brokenLinksCount > 0 && (
            <details className="card stack" open>
              <summary><strong className="entry-title">Битые ссылки в текстах</strong> — наследство `[[type:id|label]]` без цели</summary>
              <p className="muted">Зачёркнутая ждёт модуля и оживает сама; битая — цель удалена навсегда. Уборка схлопывает в текст.</p>
              <p className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }}>
                Найдено: {scan.brokenLinks.count} — {scan.brokenLinks.samples.map((s) => `${s.type} «${s.label}»`).join(", ")}{scan.brokenLinks.count > scan.brokenLinks.samples.length ? " и другие" : ""}
              </p>
              <div className="row">
                <button onClick={stripBroken}>Убрать, оставить текст ({scan.brokenLinks.count})</button>
              </div>
            </details>
          )}

          {/* Каких модулей не хватает — подвешенные ref */}
          {scan.danglingModulesCount > 0 && (
            <details className="card stack" open>
              <summary><strong className="entry-title">Каких модулей не хватает</strong> — подвешенные `[[type@uid|code|label]]`</summary>
              <ul className="muted" style={{ margin: 0, paddingLeft: 18, fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }}>
                {scan.danglingModules.map((m) => (
                  <li key={m.code}>{m.code} — «{m.label}» ×{m.count}</li>
                ))}
              </ul>
              <p className="muted">Поставьте модуль с этим code — ссылки оживут сами (uid-линки), делать ничего не нужно.</p>
            </details>
          )}

          {/* Мёртвые UID-ссылки внутри установленных модулей */}
          {scan.deadUidMentionsCount > 0 && (
            <details className="card stack" open>
              <summary><strong className="entry-title">Мёртвые UID-ссылки</strong> — `[[type@uid|code|label]]` с несуществующим UID</summary>
              <p className="muted">UID-ссылки指向 записи, которых больше нет (модуль установлен, но UID изменился). Можно починить автоматически по имени.</p>
              <ul className="muted" style={{ margin: 0, paddingLeft: 18, fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }}>
                {scan.deadUidMentions.slice(0, 20).map((m, i) => (
                  <li key={i}>{m.table}.{m.column} — «{m.label}» ({m.code}: {m.uid.slice(0, 8)}…)</li>
                ))}
              </ul>
              {scan.deadUidMentionsCount > 20 && <span className="muted" style={{ fontFamily: "var(--font-mono)" }}>…и ещё {scan.deadUidMentionsCount - 20}</span>}
              <div className="row">
                <button onClick={fixDeadUidLinks}>Починить ссылки ({scan.deadUidMentionsCount})</button>
              </div>
            </details>
          )}

          {/* Бракет-хвосты — наследство П2.6 */}
          {scan.bracketNamesCount > 0 && (
            <details className="card stack" open>
              <summary><strong className="entry-title">Имена с хвостом [Original]</strong> — наследство П2.6</summary>
              <ul className="muted" style={{ margin: 0, paddingLeft: 18, fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }}>
                {scan.bracketNames.map((b) => (
                  <li key={b.table}>{b.table}: {b.count} — напр. «{b.sample}»</li>
                ))}
              </ul>
              <p className="muted">Миграция режет хвост в name_original; перезапустите приложение — `db.ts:2382` добьёт остатки.</p>
            </details>
          )}

          {/* Орфан-файлы на диске — группировка по конечным папкам */}
          {scan.orphanFilesCount > 0 && (() => {
            const byDir = new Map<string, { files: typeof scan.orphanFiles; total: number }>();
            for (const f of scan.orphanFiles) {
              const dir = f.path.includes("/") || f.path.includes("\\") ? f.path.replace(/[/\\][^/\\]+$/, "") : ".";
              const g = byDir.get(dir);
              if (g) { g.files.push(f); g.total += f.size; } else byDir.set(dir, { files: [f], total: f.size });
            }
            return (
              <details className="card stack" open>
                <summary><strong className="entry-title">Файлы-сироты на диске</strong> — без записи в БД (до 100)</summary>
                <div className="stack">
                  {[...byDir.entries()].map(([dir, g]) => (
                    <div key={dir} className="stack" style={{ gap: 6, padding: "8px 10px", border: "1.5px solid var(--line)" }}>
                      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }}>{dir} — {g.files.length} файл(ов), {(g.total / 1024).toFixed(1)} КБ</span>
                        <button onClick={() => openFolder(dir)}>Открыть папку</button>
                      </div>
                      <ul className="muted" style={{ margin: 0, paddingLeft: 18, fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }}>
                        {g.files.slice(0, 20).map((f) => (
                          <li key={f.path}>{f.path.split(/[/\\]/).pop()} — {(f.size / 1024).toFixed(1)} КБ</li>
                        ))}
                      </ul>
                      {g.files.length > 20 && <span className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }}>…и ещё {g.files.length - 20} в этой папке</span>}
                    </div>
                  ))}
                </div>
                <p className="muted">Кнопка открывает конечную папку в проводнике — проверьте и удалите вручную. Авто-удаления нет.</p>
              </details>
            );
          })()}

          {scan.orphansTotal === 0 && scan.brokenPathsCount === 0 && scan.missingFilesCount === 0 && scan.brokenLinksCount === 0 && scan.danglingModulesCount === 0 && scan.deadUidMentionsCount === 0 && scan.orphanFilesCount === 0 && scan.bracketNamesCount === 0 && !scan.seq.some((r) => r.drift > 0) && (
            <div className="card stack" style={{ borderStyle: "dashed" }}>
              <strong className="entry-title">Всё чисто</strong>
              <p className="muted" style={{ margin: 0 }}>Сирот, битых путей, пропавших файлов, битых ссылок, сирот-файлов, хвостов [Original] и дрифта нет — ревизия пройдена.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
