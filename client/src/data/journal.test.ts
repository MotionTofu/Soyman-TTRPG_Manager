// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  BATCH_SIZE,
  MAX_PENDING,
  SLOW_MS,
  flushJournal,
  pendingJournal,
  reportRequest,
  resetJournalForTests,
  setJournalSender,
  type JournalEntry,
} from "./journal";

beforeEach(() => {
  resetJournalForTests();
  vi.useRealTimers();
});

describe("журнал запросов", () => {
  it("быстрый удачный запрос не пишется, медленный — пишется", () => {
    reportRequest({ method: "get", path: "/sessions/1", status: 200, durationMs: SLOW_MS - 1 });
    expect(pendingJournal()).toHaveLength(0);
    reportRequest({ method: "get", path: "/sessions/1", status: 200, durationMs: SLOW_MS + 500 });
    expect(pendingJournal()).toHaveLength(1);
    expect(pendingJournal()[0]).toMatchObject({ kind: "slow", action: "GET /sessions/1", status: 200, durationMs: 1500 });
  });

  it("ошибка пишется при любой длительности, кроме выхода из учётки и отмены", () => {
    reportRequest({ method: "put", path: "/beings/1", status: 500, durationMs: 12, error: "boom" });
    reportRequest({ method: "get", path: "/x", status: null, durationMs: 10_000, error: "Сервер не отвечает" });
    reportRequest({ method: "get", path: "/y", status: 401, durationMs: 5, error: "authentication required" });
    reportRequest({ method: "get", path: "/z", status: null, durationMs: 3, error: "aborted", aborted: true });
    expect(pendingJournal().map((e) => [e.kind, e.status, e.message])).toEqual([
      ["error", 500, "boom"],
      ["error", null, "Сервер не отвечает"],
    ]);
  });

  it("собственные запросы журнала не журналируются", () => {
    reportRequest({ method: "post", path: "/client-journal", status: 500, durationMs: 4000, error: "down" });
    expect(pendingJournal()).toHaveLength(0);
  });

  it("на устройстве копится не больше предела, старое вытесняется", () => {
    for (let i = 0; i < MAX_PENDING + 25; i++) {
      reportRequest({ method: "get", path: `/n/${i}`, status: 500, durationMs: 1, error: "e" });
    }
    expect(pendingJournal()).toHaveLength(MAX_PENDING);
    expect(pendingJournal()[0].action).toBe("GET /n/25");
  });

  it("неотправленное переживает перезагрузку страницы", async () => {
    reportRequest({ method: "get", path: "/persist", status: 503, durationMs: 1, error: "e" });
    const stored = JSON.parse(localStorage.getItem("soyman.clientJournal.pending") ?? "[]") as JournalEntry[];
    expect(stored.map((e) => e.action)).toEqual(["GET /persist"]);
  });

  it("отправка идёт пачками; при сбое записи остаются до следующей попытки", async () => {
    for (let i = 0; i < BATCH_SIZE + 10; i++) {
      reportRequest({ method: "get", path: `/b/${i}`, status: 500, durationMs: 1, error: "e" });
    }
    const batches: number[] = [];
    let failNext = true;
    setJournalSender(async (entries) => {
      if (failNext) {
        failNext = false;
        throw new Error("offline");
      }
      batches.push(entries.length);
    });
    await flushJournal();
    expect(batches).toEqual([]);
    expect(pendingJournal()).toHaveLength(BATCH_SIZE + 10);
    await flushJournal();
    expect(batches).toEqual([BATCH_SIZE, 10]);
    expect(pendingJournal()).toHaveLength(0);
    expect(localStorage.getItem("soyman.clientJournal.pending")).toBeNull();
  });
});
