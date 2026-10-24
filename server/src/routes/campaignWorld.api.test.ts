import { beforeEach, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { db } from "../db/db";
import { entityRecordsRouter } from "./entityRecords";
import { artifactsRouter } from "./artifacts";
import { collectOrphans, sweepOrphans } from "../services/orphans";

const app = express();
app.use(express.json());
app.use("/api", entityRecordsRouter);
app.use("/api/artifacts", artifactsRouter);
let setting: number, campaign: number, otherCampaign: number, artifact: number, being: number, location: number, community: number;
const insert = (sql: string, ...params: unknown[]) => Number(db.prepare(sql).run(...params).lastInsertRowid);
const url = () => `/api/campaigns/${campaign}`;
const state = (kind: string, id: number, value: unknown, extra = {}) => request(app).put(`${url()}/world/${kind}/${id}/state`).send({ state: value, ...extra });
const record = (body: object) => request(app).post(`${url()}/records`).send(body);
const world = async () => (await request(app).get(`${url()}/world`)).body;
const link = (kind: string, id: number) => db.prepare(
  "SELECT data, manual FROM participations WHERE context_type = 'campaign' AND context_id = ? AND entity_type = ? AND entity_id = ?"
).get(campaign, kind, id) as { data: string; manual: number } | undefined;
const session = (date: string, status = "held", liveMode: string | null = null, campaignId = campaign) => insert(
  "INSERT INTO sessions (campaign_id, date, status, live_mode) VALUES (?, ?, ?, ?)", campaignId, date, status, liveMode
);

beforeEach(() => {
  setting = insert("INSERT INTO settings (name) VALUES ('[тест] Мир')");
  campaign = insert("INSERT INTO campaigns (name, setting_id) VALUES ('[тест] Мир кампании', ?)", setting);
  otherCampaign = insert("INSERT INTO campaigns (name, setting_id) VALUES ('[тест] Другая', ?)", setting);
  artifact = insert("INSERT INTO artifacts (setting_id, name, description, avatar_image_path) VALUES (?, 'Камень Голорра', 'Говорящий камень', 'stone.png')", setting);
  being = insert("INSERT INTO setting_beings (setting_id, name) VALUES (?, 'Валлен Стерн')", setting);
  location = insert("INSERT INTO setting_locations (setting_id, name, description, thumbnail_image_path) VALUES (?, 'Особняк', 'Старый особняк', 'manor.png')", setting);
  community = insert("INSERT INTO setting_communities (setting_id, name) VALUES (?, 'Жентарим')", setting);
});

describe("артефакт в слое кампании", () => {
  it("первая запись задействует артефакт; графы проверяются, удаление подметает спутника", async () => {
    const r = await record({ owner_type: "artifact", owner_id: artifact, aspect: "holder", text: "У Лиары" });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ owner_type: "artifact", owner_name: "Камень Голорра", aspect: "holder" });
    expect(link("artifact", artifact)?.manual).toBe(0);
    expect((await record({ owner_type: "artifact", owner_id: artifact, aspect: "revealed", text: "Говорит во сне" })).status).toBe(201);
    expect((await record({ owner_type: "artifact", owner_id: artifact, aspect: "fear", text: "x" })).status).toBe(400);
    db.prepare("DELETE FROM artifacts WHERE id = ?").run(artifact);
    expect(collectOrphans()["entity_records:artifact"]).toEqual(expect.arrayContaining([expect.objectContaining({ id: r.body.id })]));
    sweepOrphans();
    expect(db.prepare("SELECT 1 FROM entity_records WHERE id = ?").get(r.body.id)).toBeUndefined();
  });

  it("артефакт добавляется вручную; чужой сеттинг не проходит проверку", async () => {
    expect((await request(app).post(`${url()}/world`).send({ entity_type: "artifact", entity_id: artifact })).status).toBe(201);
    expect(link("artifact", artifact)?.manual).toBe(1);
    const otherSetting = insert("INSERT INTO settings (name) VALUES ('Другой мир')");
    const outsider = insert("INSERT INTO artifacts (setting_id, name) VALUES (?, 'Чужой камень')", otherSetting);
    expect((await state("artifact", outsider, "lost")).status).toBe(400);
    expect((await record({ owner_type: "artifact", owner_id: outsider, text: "x" })).status).toBe(400);
  });
});

describe("состояние и отмена", () => {
  it("задействует сменой, записывает историю и возвращает прежнее; отмена удаляет только её", async () => {
    const last = session("2026-10-15");
    const r = await state("being", being, "dead");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ state: "dead", previous: "alive", record_id: expect.any(Number) });
    expect(JSON.parse(link("being", being)!.data)).toEqual({ state: "dead" });
    expect(db.prepare("SELECT * FROM entity_records WHERE id = ?").get(r.body.record_id)).toMatchObject({
      owner_type: "being", owner_id: being, aspect: "state", text: "жив → погиб", status: "established", session_id: last,
    });
    const note = await record({ owner_type: "being", owner_id: being, text: "Оставил письмо" });
    const undo = await state("being", being, r.body.previous, { undo_record_id: r.body.record_id });
    expect(undo.status).toBe(200);
    expect(undo.body).toMatchObject({ state: "alive", previous: "dead" });
    expect(JSON.parse(link("being", being)!.data).state).toBe("alive");
    expect(db.prepare("SELECT 1 FROM entity_records WHERE id = ?").get(r.body.record_id)).toBeUndefined();
    expect(db.prepare("SELECT 1 FROM entity_records WHERE id = ?").get(note.body.id)).toBeDefined();
    expect((await state("being", being, "alive", { undo_record_id: r.body.record_id })).status).toBe(409);
  });

  it.each([
    ["being", "dead"], ["location", "damaged"], ["community", "weakened"], ["artifact", "with_party"],
  ])("принимает словарь %s, не теряет прочие ключи и manual", async (kind, value) => {
    const id = { being, location, community, artifact }[kind]!;
    await request(app).post(`${url()}/world`).send({ entity_type: kind, entity_id: id });
    db.prepare("UPDATE participations SET data = ? WHERE context_type = 'campaign' AND context_id = ? AND entity_type = ? AND entity_id = ?")
      .run(JSON.stringify({ extra: { keep: true } }), campaign, kind, id);
    const r = await state(kind, id, value);
    expect(r.status).toBe(200);
    expect(JSON.parse(link(kind, id)!.data)).toEqual({ extra: { keep: true }, state: value });
    expect(link(kind, id)!.manual).toBe(1);
    const entity = (await world()).entities.find((e: { entity_type: string; entity_id: number }) => e.entity_type === kind && e.entity_id === id);
    expect(entity.state).toBe(value);
    expect(entity.aspects).toEqual([{ key: "state", text: expect.stringContaining(" → ") }]);
  });

  it("отклоняет чужие значения, вид, сессию и id отмены без записи и ссылки", async () => {
    expect((await state("being", being, "with_party")).status).toBe(400);
    expect((await state("character", being, "dead")).status).toBe(400);
    expect((await state("being", being, 1)).status).toBe(400);
    expect((await state("being", being, "dead", { session_id: session("2026-10-01", "held", null, otherCampaign) })).status).toBe(400);
    expect((await state("being", being, "dead", { undo_record_id: "bad" })).status).toBe(400);
    expect(link("being", being)).toBeUndefined();
  });

  it("идущая сессия важнее сыгранной, переданная важнее идущей; без сессий — null", async () => {
    const first = await state("being", being, "missing");
    expect((db.prepare("SELECT session_id FROM entity_records WHERE id = ?").get(first.body.record_id) as { session_id: null }).session_id).toBeNull();
    session("2026-10-19", "held", "rehearsal");
    const held = session("2026-10-20");
    const live = session("2026-10-10", "planned", "live");
    session("2026-10-25", "planned", "rehearsal");
    const r = await state("artifact", artifact, "with_party");
    expect(db.prepare("SELECT session_id FROM entity_records WHERE id = ?").get(r.body.record_id)).toEqual({ session_id: live });
    const explicit = await state("location", location, "damaged", { session_id: held });
    expect(db.prepare("SELECT session_id FROM entity_records WHERE id = ?").get(explicit.body.record_id)).toEqual({ session_id: held });
    db.prepare("UPDATE sessions SET archived_at = '2026-10-21' WHERE id = ?").run(live);
    const fallback = await state("community", community, "weakened");
    expect(db.prepare("SELECT session_id FROM entity_records WHERE id = ?").get(fallback.body.record_id)).toEqual({ session_id: held });
  });

  it("чужая, обычная или устаревшая запись отменой не удаляется", async () => {
    const first = (await state("being", being, "dead")).body;
    const second = (await state("being", being, "missing")).body;
    expect((await state("being", being, "alive", { undo_record_id: first.record_id })).status).toBe(409);
    expect((await state("location", location, "intact", { undo_record_id: second.record_id })).status).toBe(409);
    const note = await record({ owner_type: "being", owner_id: being, text: "пропал → жив" });
    expect((await state("being", being, "alive", { undo_record_id: note.body.id })).status).toBe(409);
    expect((await state("being", being, "alive", { undo_record_id: second.record_id })).status).toBe(409);
    expect((await state("being", being, "dead", { undo_record_id: second.record_id })).status).toBe(200);
    expect(db.prepare("SELECT 1 FROM entity_records WHERE id = ?").get(first.record_id)).toBeDefined();
    expect((await state("being", being, "dead")).body.record_id).toBeNull();
  });
});

describe("сводка мира и достоверность", () => {
  it("показывает основу без записей, аватар важнее миниатюры, артефакт входит в мир", async () => {
    await request(app).post(`${url()}/world`).send({ entity_type: "location", entity_id: location });
    await request(app).post(`${url()}/world`).send({ entity_type: "artifact", entity_id: artifact });
    let body = await world();
    expect(body.entities).toEqual(expect.arrayContaining([
      expect.objectContaining({ entity_type: "location", state: "intact", image: "/files/manor.png", summary: { text: "Старый особняк", from_setting: true }, aspects: [], changed_at: expect.any(String) }),
      expect.objectContaining({ entity_type: "artifact", state: "as_setting", image: "/files/stone.png", summary: { text: "Говорящий камень", from_setting: true } }),
    ]));
    db.prepare("UPDATE setting_locations SET avatar_image_path = 'avatar.png' WHERE id = ?").run(location);
    body = await world();
    expect(body.entities.find((e: { entity_type: string }) => e.entity_type === "location").image).toBe("/files/avatar.png");
  });

  it("путь портрета становится URL с кодированием сегментов, без картинки — null", async () => {
    db.prepare("UPDATE setting_beings SET avatar_image_path = ? WHERE id = ?").run("Портреты/Валлен #1.png", being);
    await request(app).post(`${url()}/world`).send({ entity_type: "being", entity_id: being });
    await request(app).post(`${url()}/world`).send({ entity_type: "community", entity_id: community });
    const body = await world();
    expect(body.entities.find((e: { entity_type: string }) => e.entity_type === "being").image).toBe("/files/%D0%9F%D0%BE%D1%80%D1%82%D1%80%D0%B5%D1%82%D1%8B/%D0%92%D0%B0%D0%BB%D0%BB%D0%B5%D0%BD%20%231.png");
    expect(body.entities.find((e: { entity_type: string }) => e.entity_type === "community").image).toBeNull();
  });

  it("право убрать совпадает с DELETE при оставшейся истории замен", async () => {
    await request(app).post(`${url()}/world`).send({ entity_type: "location", entity_id: location });
    const old = (await record({ owner_type: "artifact", owner_id: artifact, text: "Старая запись" })).body;
    const next = (await request(app).post(`/api/records/${old.id}/replace`).send({ text: "Отброшенная замена", status: "discarded" })).body;
    expect(next.status).toBe("discarded");
    const body = await world();
    expect(body.entities.find((e: { entity_type: string }) => e.entity_type === "artifact")).toMatchObject({ records: 0, drafts: 0, can_remove: false });
    expect(body.entities.find((e: { entity_type: string }) => e.entity_type === "location").can_remove).toBe(true);
    expect((await request(app).delete(`${url()}/world/artifact/${artifact}`)).status).toBe(409);
    expect((await request(app).delete(`${url()}/world/location/${location}`)).status).toBe(200);
  });

  it("новый черновик меняет порядок, но сводка остаётся основой; отброшенное не меняет дату", async () => {
    const draft = (await record({ owner_type: "location", owner_id: location, text: "Черновик", status: "draft" })).body;
    await request(app).post(`${url()}/world`).send({ entity_type: "community", entity_id: community });
    db.prepare("UPDATE participations SET created_at = '2026-10-01 00:00:00' WHERE context_type='campaign' AND context_id=?").run(campaign);
    db.prepare("UPDATE entity_records SET updated_at='2026-10-03 00:00:00' WHERE id=?").run(draft.id);
    const discarded = (await record({ owner_type: "community", owner_id: community, text: "Отброшено", status: "discarded" })).body;
    db.prepare("UPDATE entity_records SET updated_at='2026-10-04 00:00:00' WHERE id=?").run(discarded.id);
    const body = await world();
    expect(body.entities[0]).toMatchObject({ entity_type: "location", changed_at: "2026-10-03 00:00:00", can_remove: false, summary: { text: "Старый особняк", from_setting: true } });
    expect(body.entities[1]).toMatchObject({ entity_type: "community", changed_at: "2026-10-01 00:00:00", can_remove: true });
  });

  it("последняя действующая запись и графы, сортировка по изменению; счёт — записями, включая без адреса", async () => {
    const old = (await record({ owner_type: "artifact", owner_id: artifact, aspect: "holder", text: "У врага", certainty: "rumor" })).body;
    const replacement = (await request(app).post(`/api/records/${old.id}/replace`).send({ text: "У героев", certainty: "rumor" })).body;
    const revealed = (await record({ owner_type: "artifact", owner_id: artifact, aspect: "revealed", text: "Говорит", certainty: "rumor" })).body;
    const rumor = (await record({ owner_type: "artifact", owner_id: artifact, aspect: "note", text: "Знает путь", certainty: "rumor" })).body;
    await record({ owner_type: "artifact", owner_id: artifact, text: "Не показывать", status: "discarded", certainty: "rumor" });
    const draft = (await record({ owner_type: "artifact", owner_id: artifact, text: "Черновик", status: "draft", certainty: "rumor" })).body;
    await record({ owner_type: "campaign", owner_id: campaign, aspect: "unsorted", text: "Без адреса", status: "draft" });
    await request(app).post(`${url()}/world`).send({ entity_type: "location", entity_id: location });
    db.prepare("UPDATE participations SET created_at = '2026-10-01 00:00:00' WHERE context_id = ? AND context_type = 'campaign'").run(campaign);
    db.prepare("UPDATE entity_records SET updated_at = '2026-10-02 00:00:00' WHERE id IN (?, ?)").run(replacement.id, revealed.id);
    db.prepare("UPDATE entity_records SET updated_at = '2026-10-03 00:00:00' WHERE id = ?").run(rumor.id);
    db.prepare("UPDATE entity_records SET updated_at = '2026-10-04 00:00:00' WHERE id = ?").run(draft.id);
    const body = await world();
    expect(body).toMatchObject({ rumors: 3, drafts: 2 });
    expect(body.entities[0]).toMatchObject({ entity_type: "artifact", records: 3, rumors: 3, drafts: 1, changed_at: "2026-10-04 00:00:00", summary: { text: "Знает путь", from_setting: false } });
    expect(body.entities[0].aspects.map((a: { key: string }) => a.key).sort()).toEqual(["holder", "note", "revealed"]);
    const filtered = await request(app).get(`${url()}/records?certainty=rumor&status=established`);
    expect(filtered.status).toBe(200);
    expect(filtered.body.records.every((r: { certainty: string; status: string }) => r.certainty === "rumor" && r.status === "established")).toBe(true);
    expect((await request(app).get(`${url()}/records?certainty=invented`)).status).toBe(400);
  });
});


describe("контекст кампании в профиле артефакта", () => {
  it("возвращает задействованные кампании со сводкой и последней встречей, исключает архивные", async () => {
    const sid = session("2026-10-20");
    await record({ owner_type: "artifact", owner_id: artifact, aspect: "holder", text: "У героев", session_id: sid });
    await request(app).post(`/api/campaigns/${otherCampaign}/world`).send({ entity_type: "artifact", entity_id: artifact });
    let response = await request(app).get(`/api/artifacts/${artifact}`);
    expect(response.status).toBe(200);
    expect(response.body.campaigns).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: campaign, records: 1, drafts: 0, last_session: { id: sid, title: null, date: "2026-10-20" } }),
      expect.objectContaining({ id: otherCampaign, records: 0, last_session: null }),
    ]));
    db.prepare("UPDATE campaigns SET archived_at = datetime('now') WHERE id = ?").run(otherCampaign);
    response = await request(app).get(`/api/artifacts/${artifact}`);
    expect(response.body.campaigns.map((c: { id: number }) => c.id)).toEqual([campaign]);
    expect(response.body.description).toBe("Говорящий камень");
  });

  it("без задействования возвращает пустой список; неизвестный предмет — 404", async () => {
    expect((await request(app).get(`/api/artifacts/${artifact}`)).body.campaigns).toEqual([]);
    expect((await request(app).get("/api/artifacts/99999999")).status).toBe(404);
  });
});
