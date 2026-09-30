import { beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { masteringRouter } from "./mastering";

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use("/mastering", masteringRouter);
let sectionId: number;
let bookId: number;
const resource = "soyman:resource/12345678-1234-1234-1234-123456789abc";
const content = `## Большая статья\n\n![Обложка](${resource})\n\n${"текст ".repeat(5000)}`;

beforeAll(async () => {
  sectionId = (await request(app).post("/mastering/sections").send({ category: "prep", name: "Полка" })).body.id;
  bookId = (await request(app).post("/mastering").send({ category: "prep", section_id: sectionId, title: "Большая книга", content })).body.id;
});

describe("библиотека Мастерения", () => {
  it("сохраняет отдельную обложку, отключает картинку и возвращает изображение из текста", async () => {
    const custom = "https://example.com/cover.webp";
    const id = (await request(app).post("/mastering").send({ category: "prep", title: "Настраиваемая книга", content, cover_image: custom })).body.id;
    const cover = async () => (await request(app).get("/mastering").query({ view: "library" })).body.find((item: { id: number }) => item.id === id).cover_image;
    expect(await cover()).toBe(custom);
    await request(app).put(`/mastering/${id}`).send({ title: "Другое название" });
    expect(await cover()).toBe(custom);
    await request(app).put(`/mastering/${id}`).send({ cover_image: "" });
    expect(await cover()).toBeNull();
    await request(app).put(`/mastering/${id}`).send({ cover_image: null });
    expect(await cover()).toBe(resource);
    expect((await request(app).put(`/mastering/${id}`).send({ cover_image: "data:image/png;base64,aaa" })).status).toBe(400);
    expect(await cover()).toBe(resource);
  });
  it("отдаёт обложки без полного текста, а открытая книга сохраняет весь Markdown", async () => {
    const summary = await request(app).get("/mastering").query({ view: "library", category: "prep" });
    expect(summary.status).toBe(200);
    const book = summary.body.find((item: { id: number }) => item.id === bookId);
    expect(book).not.toHaveProperty("content");
    expect(book).toMatchObject({ section_id: sectionId, section_name: "Полка", cover_image: resource });
    expect(book.reading_minutes).toBeGreaterThanOrEqual(25);
    expect(JSON.stringify(book).length).toBeLessThan(1000);
    expect((await request(app).get(`/mastering/${bookId}`)).body.content).toBe(content);
    expect((await request(app).get("/mastering")).body.find((item: { id: number }) => item.id === bookId).content).toBe(content);
  });
  it("поиск находит текст во всех категориях и сохраняет фильтр системы", async () => {
    const id = (await request(app).post("/mastering").send({ category: "knowledge", title: "Другая категория", content: "УНИКАЛЬНАЯ ПОДСКАЗКА" })).body.id;
    const found = (await request(app).get("/mastering").query({ view: "library", q: "уникальная подсказка" })).body;
    expect(found.map((item: { id: number }) => item.id)).toContain(id);
    expect((await request(app).get("/mastering").query({ view: "library", q: "уникальная", category: "prep" })).body).toEqual([]);
  });
  it("после удаления полки книга остаётся доступна, архивные книги исчезают с полок", async () => {
    const section = (await request(app).post("/mastering/sections").send({ category: "prep", name: "Временная полка" })).body.id;
    const id = (await request(app).post("/mastering").send({ category: "prep", section_id: section, title: "Сохраняемая книга" })).body.id;
    await request(app).delete(`/mastering/sections/${section}`);
    expect((await request(app).get(`/mastering/${id}`)).body.section_id).toBeNull();
    await request(app).delete(`/mastering/${id}`);
    expect((await request(app).get("/mastering").query({ view: "library" })).body.map((item: { id: number }) => item.id)).not.toContain(id);
  });
  it("не переносит Base64 или изображения внутри примеров кода в обложку", async () => {
    for (const text of ["![Фото](data:image/png;base64,abcd)", "![Фото](C:/secret.png)", "```md\n![Фото](https://example.com/image.png)\n```", "![Фото](javascript:alert)"]) {
      const id = (await request(app).post("/mastering").send({ category: "prep", title: "Без обложки", content: text })).body.id;
      const book = (await request(app).get("/mastering").query({ view: "library" })).body.find((item: { id: number }) => item.id === id);
      expect(book.cover_image).toBeNull();
    }
  });
});
