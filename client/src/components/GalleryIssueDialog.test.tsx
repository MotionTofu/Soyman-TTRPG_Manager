// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GalleryIssueDialog } from "./GalleryIssueDialog";
import { GalleryTab } from "./GalleryTab";
import { TagChips } from "./TagChips";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const fixture = vi.hoisted(() => ({ post: vi.fn().mockResolvedValue({section_id:7}), campaigns:[{id:2,name:"Вотердип"}], images:[
  {id:1,image_path:"image.png",image_url:"/files/image.png",caption:"Портрет",issues:[{image_id:8,campaign_id:2,campaign_name:"Вотердип",section_id:7,section_name:"Изображения",players:[{id:3,name:"Аня"}]}]},
  {id:2,image_path:"second.png",image_url:"/files/second.png",caption:"Пейзаж",issues:[]},
] }));
vi.mock("../data/hooks", () => ({
  errorText: String, useAfterWrite: () => vi.fn(),
  useResource: (path: string | null) => ({ data: path?.startsWith("/gallery/issue-options") ? fixture.campaigns : path?.startsWith("/gallery?") ? fixture.images : path?.startsWith("/campaign-player-sections") ? [{id:7,name:"Изображения",kind:"gallery",archived_at:null}] : path?.startsWith("/campaigns/") ? {roster:[{id:3,name:"Аня",roster_status:"active"},{id:4,name:"Борис",roster_status:"active"}]} : undefined, loading:false,error:null,reload:vi.fn() }),
  write:{post:fixture.post},
}));
vi.mock("../hooks/useConfirm", () => ({useConfirm: () => [null, vi.fn()]}));
vi.mock("../hooks/useUndoDelete", () => ({useUndoDelete: () => ({offerUndo:vi.fn()})}));
afterEach(() => { cleanup(); fixture.post.mockClear(); localStorage.clear(); });

describe("gallery issuance UI", () => {
  it("starts with no recipients and submits exactly the checked roster members", async () => {
    const done=vi.fn();
    render(<GalleryIssueDialog imageId={1} campaigns={fixture.campaigns} onClose={vi.fn()} onIssued={done} />);
    expect(screen.getAllByRole("checkbox").every((e) => !(e as HTMLInputElement).checked)).toBe(true);
    fireEvent.click(screen.getByLabelText("Аня"));
    fireEvent.click(screen.getByRole("button",{name:"Выдать"}));
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(fixture.post).toHaveBeenCalledWith("/gallery/1/issue",{campaign_id:2,section_id:7,player_ids:[3]});
    expect(localStorage.getItem("gallery-issue-section:2")).toBe("7");
  });
  it("counts source images with grants, filters them and links to the exact copied image", () => {
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><GalleryTab profile ownerType="being" ownerId={686} /></MemoryRouter></QueryClientProvider>);
    expect(screen.getByRole("button",{name:"Все 2"})).toBeTruthy();
    expect(screen.getByText("у игроков: Аня").getAttribute("href")).toContain("section=7&image=8");
    fireEvent.click(screen.getByRole("button",{name:"Выдано игрокам 1"}));
    expect(screen.queryByText("Пейзаж")).toBeNull();
    expect(screen.getByText("Портрет")).toBeTruthy();
  });
  it("opens tag input only after clicking the dashed chip", () => {
    const change=vi.fn(); render(<TagChips profile tags={[]} onChange={change} />);
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("button",{name:"+ ТЕГ"}));
    fireEvent.change(screen.getByRole("textbox"),{target:{value:"порт"}});
    fireEvent.keyDown(screen.getByRole("textbox"),{key:"Enter"});
    expect(change).toHaveBeenCalledWith(["порт"]);
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
