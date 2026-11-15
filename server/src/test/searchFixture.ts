import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";

function fixturePdf(): string {
  const first = "BT /F1 18 Tf 70 680 Td (A folded leaflet.) Tj ET";
  const second = "BT /F1 18 Tf 70 680 Td (First signet stamp.) Tj 0 -440 Td (Second signet stamp.) Tj ET";
  const stream = (content: string) => `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  const page = (content: number) => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents ${content} 0 R >>`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    page(6), page(7), "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", stream(first), stream(second),
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = pdf.length;
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  return pdf + `xref\n0 8\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`
    + `trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n${pdf.length}\n%%EOF\n`;
}

export function makeSearchFixture(db: Database.Database, vault: string) {
  const insert = (sql: string, ...args: unknown[]) => Number(db.prepare(sql).run(...args).lastInsertRowid);
  const setting = insert("INSERT INTO settings (name) VALUES ('Вотердип')");
  const elsewhere = insert("INSERT INTO settings (name) VALUES ('Нестиум')");
  const system = insert("INSERT INTO systems (name) VALUES ('Тестовая система')");
  const campaign = insert("INSERT INTO campaigns (name, setting_id, system_id) VALUES ('Дозор', ?, ?)", setting, system);
  const arc = insert("INSERT INTO story_arcs (setting_id, name) VALUES (?, 'Ворота города')", setting);
  insert("INSERT INTO campaign_adventures (campaign_id, arc_id) VALUES (?, ?)", campaign, arc);
  const original = insert("INSERT INTO story_scenes (setting_id, arc_id, name, summary) VALUES (?, ?, 'Засада у заставы', 'У дозорного старая печать')", setting, arc);
  const scene = insert(`INSERT INTO story_scenes (setting_id, arc_id, campaign_id, source_scene_id, name, read_aloud, outcomes)
    VALUES (?, ?, ?, ?, 'Засада у заставы', 'Спрятана **новая печать**', 'Медная печать открывает ворота')`, setting, arc, campaign, original);
  const distantScene = insert("INSERT INTO story_scenes (setting_id, name) VALUES (?, 'Сигнал с маяка')", elsewhere);
  const being = insert("INSERT INTO setting_beings (setting_id, name) VALUES (?, 'Гоблин')", setting);
  const section = insert("INSERT INTO system_sections (system_id, name, kind) VALUES (?, 'Бестиарий', 'monster')", system);
  const monster = insert("INSERT INTO compendium_entries (system_id, section_id, name, kind) VALUES (?, ?, 'Гоблин', 'monster')", system, section);
  insert("INSERT INTO compendium_entries (system_id, section_id, name, kind) VALUES (?, ?, 'Гоблинский фокус', 'spell')", system, section);
  fs.mkdirSync(vault, { recursive: true });
  fs.writeFileSync(path.join(vault, "rules.pdf"), fixturePdf());
  const mdPath = path.join(vault, "watch.md");
  fs.writeFileSync(mdPath, "# Проверка пропуска\n\nПопросите показать **signet stamp**.\n\n## После проверки\n\nСверьте signet stamp с журналом.");
  fs.writeFileSync(path.join(vault, "titles.md"), "# Пустой пример\n\nДругой текст.");
  const pdf = insert("INSERT INTO resources (name, type, category, file_path) VALUES ('Справочник городской стражи', 'note', 'pdf', 'rules.pdf')");
  const md = insert("INSERT INTO resources (name, type, file_path, setting_id, scope) VALUES ('Памятка караульного', 'markdown', 'watch.md', ?, 'setting')", setting);
  insert("INSERT INTO resources (name, type, file_path) VALUES ('signet stamp', 'markdown', 'titles.md')");
  return { setting, system, campaign, arc, original, scene, distantScene, being, monster, pdf, md, mdPath };
}
