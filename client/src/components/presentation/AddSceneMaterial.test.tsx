// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AddSceneMap, AddScenePicture } from "./AddSceneMaterial";

const post = vi.hoisted(() => vi.fn());
vi.mock("../../data/hooks", () => ({ errorText: String, useAfterWrite: () => vi.fn(), write: { post }, useResource: (url: string | null) => ({ data: url === "/maps" ? [{ id: 8, name: "Карта стенда" }] : url?.startsWith("/resources") ? [{ id: 4, name: "Картинка стенда", file_path: "test.jpg", file_url: "/files/test.jpg" }] : [] }) }));
vi.mock("../Modal", () => ({ Modal: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../mentions/MentionPickerModal", () => ({ MentionPickerModal: () => null }));
beforeEach(() => post.mockReset().mockResolvedValue({ scene_id: 472 }));
afterEach(cleanup);

describe("окна материалов: основа и кампания", () => {
  it.each([null, 31])("картинка из библиотеки, campaignId=%s", async (campaignId) => {
    render(<AddScenePicture sceneId={472} sceneName="Комната" campaignId={campaignId} onAdded={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTitle("Картинка стенда"));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][1]).toEqual({ source: { kind: "resource", id: 4 }, ...(campaignId == null ? {} : { campaign_id: campaignId }) });
  });
  it.each([null, 31])("загрузка не отправляет null строкой, campaignId=%s", async (campaignId) => {
    const { container } = render(<AddScenePicture sceneId={472} sceneName="Комната" campaignId={campaignId} onAdded={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(["image"], "scene.png", { type: "image/png" })] } });
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect((post.mock.calls[0][1] as FormData).get("campaign_id")).toBe(campaignId == null ? null : String(campaignId));
  });
  it.each([null, 31])("привязка карты, campaignId=%s", async (campaignId) => {
    render(<AddSceneMap sceneId={472} sceneName="Комната" campaignId={campaignId} onAdded={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Карта стенда" }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][1]).toEqual({ map_id: 8, ...(campaignId == null ? {} : { campaign_id: campaignId }) });
  });
});
