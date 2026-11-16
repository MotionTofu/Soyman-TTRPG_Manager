import express from "express";
import request from "supertest";
import { expect, it } from "vitest";
import { db } from "../db/db";
import { settingEntriesRouter } from "./settingEntries";

it("сохраняет поля Атласа и старые записи, а связи ограничивает сеттингом", async () => {
  const app = express();
  app.use(express.json());
  app.use("/setting-entries", settingEntriesRouter);
  const api = request(app);
  const insertSetting = db.prepare("INSERT INTO settings (name, folder_path) VALUES (?, ?)");
  const setting = Number(insertSetting.run("Берег", "Берег").lastInsertRowid);
  const other = Number(insertSetting.run("Остров", "Остров").lastInsertRowid);
  const insertLegacy = db.prepare("INSERT INTO setting_entries (setting_id, category, title, fields, visible_to_players) VALUES (?, ?, ?, ?, ?)");
  const property = Number(insertLegacy.run(setting, "world_truth", "Реки", '{"formula":"Реки текут вспять","strictness":"hard"}', 1).lastInsertRowid);
  const note = Number(insertLegacy.run(setting, "notes", "Задумка", "{}", 0).lastInsertRowid);
  const foreign = Number(insertLegacy.run(other, "world_truth", "Остров", "{}", 0).lastInsertRowid);

  const claim = (await api.post("/setting-entries").send({
    setting_id: setting,
    category: "claim",
    title: "Сообщение сторожа",
    fields: { status: "accepted", claim: "Вода солёная", confirmation: "Сторож это сказал", knowledge: "Лодочники слышали" },
    related_entry_ids: [property, note, foreign, property, String(property)],
  }).expect(201)).body;
  expect(claim.related_entry_ids).toEqual([property]);
  expect(claim.visible_to_players).toBe(0);
  expect(claim.fields).toEqual({ status: "accepted", claim: "Вода солёная", confirmation: "Сторож это сказал", knowledge: "Лодочники слышали" });

  const changed = (await api.put(`/setting-entries/${property}`).send({
    fields: { formula: "Реки текут вспять", strictness: "hard", conditions: "Полнолуние", status: "unknown" },
    related_entry_ids: [claim.id, property],
  }).expect(200)).body;
  expect(changed.fields).toEqual({ formula: "Реки текут вспять", strictness: "hard", conditions: "Полнолуние" });
  expect(changed.related_entry_ids).toEqual([claim.id]);
  expect(changed.visible_to_players).toBe(1);

  const updated = (await api.put(`/setting-entries/${claim.id}`).send({
    fields: { ...claim.fields, evidence: "Проба воды" },
  }).expect(200)).body;
  expect(updated.related_entry_ids).toEqual([property]);
  const filtered = await api.get(`/setting-entries?setting_id=${setting}&category=claim`).expect(200);
  expect(filtered.body[0].related_entry_ids).toEqual([property]);

  await api.delete(`/setting-entries/${property}`).expect(200);
  const remaining = await api.get(`/setting-entries?setting_id=${setting}&category=claim`).expect(200);
  expect(remaining.body[0].related_entry_ids).toEqual([]);
});
