// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MentionText } from "./components/mentions/MentionText";
import { isMentionIndexReady, loadMentionIndex, resolveMention } from "./mentions";

const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("./data/imperative", () => ({ readResource: mocks.read, afterWriteAnywhere: vi.fn() }));
vi.mock("./api/currentUser", () => ({ getCachedUser: () => ({ role: "gm" }) }));
afterEach(() => { cleanup(); vi.useRealTimers(); });
const payload = { owners: {}, entities: { being: [[687, "7ff5d77686524b39a3fef6657d963eca", "s1"]] } };

it("recovers mentions after a failed index request without falsely marking them deleted or polling a truly missing target forever", async () => {
  vi.useFakeTimers();
  mocks.read.mockRejectedValueOnce(new Error("502 Bad Gateway")).mockResolvedValue(payload);
  const { container } = render(<MentionText text="[[being@7ff5d776|Вотердип|Брам]]" />);
  await act(async () => { await loadMentionIndex(); });
  expect(isMentionIndexReady()).toBe(false);
  expect(screen.getByText("Брам")).toBeTruthy();
  expect(container.querySelector(".mention-link")).toBeNull();
  expect(container.querySelector(".mention-dead")).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
  expect(isMentionIndexReady()).toBe(true);
  expect(resolveMention("being", "7ff5d776")).toBe(687);
  expect(screen.getByRole("button", { name: "Брам" }).className).toContain("mention-link");

  // A later outage preserves known links, and the next retry restores freshness.
  mocks.read.mockRejectedValueOnce(new Error("temporarily unavailable"));
  await act(async () => { await loadMentionIndex(); });
  expect(resolveMention("being", "7ff5d776")).toBe(687);
  await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
  const requests = mocks.read.mock.calls.length;
  expect(resolveMention("being", "deadbeef")).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
  expect(resolveMention("being", "deadbeef")).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
  expect(mocks.read.mock.calls.length).toBe(requests + 1);
});
