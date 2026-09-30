import express from "express";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/db";
import { attachUser, signToken, type AuthUser } from "../services/auth";
import { masteringRouter } from "./mastering";

const app = express(); app.use(express.json()); app.use(attachUser); app.use("/mastering", masteringRouter);
let ownerToken: string, otherToken: string, playerToken: string;
beforeAll(() => {
  const token = (username: string, role: "gm" | "player") => {
    const id = Number(db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, 'test-only', ?)").run(username, role).lastInsertRowid);
    return signToken({ id, username, role, playerId: null, isAdmin: false, tokenVersion: 0 } satisfies AuthUser);
  };
  ownerToken = token("reader", "gm"); otherToken = token("other-reader", "gm"); playerToken = token("player-reader", "player");
});
async function createBook() { return (await request(app).post("/mastering").send({ category: "prep", title: "Заметки", content: "А цитата Б" })).body.id as number; }
const quote = { quote: "цитата", anchor: { start: 2, end: 8 }, context_before: "А ", context_after: " Б", body: "Моя заметка" };
describe("личные заметки библиотеки", () => {
  it("сохраняет цитату и общую заметку отдельно от книги, ограничивает доступ автором", async () => {
    const id = await createBook(), path = `/mastering/${id}/notes`;
    expect((await request(app).get(path)).status).toBe(401);
    expect((await request(app).get(path).auth(playerToken, { type: "bearer" })).status).toBe(403);
    const created = await request(app).post(path).auth(ownerToken, { type: "bearer" }).send(quote);
    expect(created.status).toBe(201); expect(created.body).toMatchObject({ ...quote, book_id: id, needs_reattach: false });
    expect((await request(app).post(path).auth(ownerToken, { type: "bearer" }).send({ body: "Общая" })).body.anchor).toBeNull();
    expect((await request(app).get(path).auth(ownerToken, { type: "bearer" })).body).toHaveLength(2);
    expect((await request(app).get(path).auth(otherToken, { type: "bearer" })).body).toEqual([]);
    expect((await request(app).put(`${path}/${created.body.id}`).auth(otherToken, { type: "bearer" }).send({ body: "Чужая правка" })).status).toBe(404);
    expect((await request(app).delete(`${path}/${created.body.id}`).auth(otherToken, { type: "bearer" })).status).toBe(404);
    expect((await request(app).get(`/mastering/${id}`)).body.content).toBe("А цитата Б");
  });
  it("сохраняет признак изменённого текста при правке заметки и снимает его при перепривязке", async () => {
    const id = await createBook(), path = `/mastering/${id}/notes`;
    const note = (await request(app).post(path).auth(ownerToken, { type: "bearer" }).send(quote)).body;
    await request(app).put(`/mastering/${id}`).send({ content: "Новая цитата" });
    expect((await request(app).get(path).auth(ownerToken, { type: "bearer" })).body[0].needs_reattach).toBe(true);
    expect((await request(app).put(`${path}/${note.id}`).auth(ownerToken, { type: "bearer" }).send({ body: "Исправленная" })).body.needs_reattach).toBe(true);
    const attached = await request(app).put(`${path}/${note.id}`).auth(ownerToken, { type: "bearer" }).send({ quote: "Новая", anchor: { start: 0, end: 5 }, context_before: "", context_after: " цитата" });
    expect(attached.body).toMatchObject({ body: "Исправленная", quote: "Новая", needs_reattach: false });
    expect((await request(app).delete(`${path}/${note.id}`).auth(ownerToken, { type: "bearer" })).status).toBe(200);
    expect((await request(app).get(path).auth(ownerToken, { type: "bearer" })).body).toEqual([]);
  });
  it("проверяет ввод и сохраняет заметки при архивации до окончательного удаления книги", async () => {
    const id = await createBook(), path = `/mastering/${id}/notes`;
    for (const body of [{ body: " " }, { body: "a".repeat(20001) }, { ...quote, anchor: null }, { ...quote, anchor: { start: 9, end: 2 } }]) {
      expect((await request(app).post(path).auth(ownerToken, { type: "bearer" }).send(body)).status).toBe(400);
    }
    await request(app).post(path).auth(ownerToken, { type: "bearer" }).send(quote);
    await request(app).delete(`/mastering/${id}`);
    expect((await request(app).get(path).auth(ownerToken, { type: "bearer" })).status).toBe(404);
    expect(db.prepare("SELECT id FROM mastering_annotations WHERE book_id = ?").all(id)).toHaveLength(1);
    db.prepare("UPDATE mastering_notes SET archived_at = NULL WHERE id = ?").run(id);
    expect((await request(app).get(path).auth(ownerToken, { type: "bearer" })).body).toHaveLength(1);
    db.prepare("DELETE FROM mastering_notes WHERE id = ?").run(id);
    expect(db.prepare("SELECT id FROM mastering_annotations WHERE book_id = ?").all(id)).toEqual([]);
  });
});
