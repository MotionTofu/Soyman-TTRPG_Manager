// @vitest-environment jsdom
import { describe,expect,it,vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { TYPE_COLORS } from "../../graphTypes";
import { ProfileHero,profileColor,profileStyle } from "./ProfileParts";
import { mergeProfileWorld, type ProfileWorldEvent } from "./ProfileChronicle";
import { ProfileLinks,profileRelationGroups } from "./ProfileLinks";
import type { ImportantDate } from "../../types";

vi.mock("../../data/hooks",() => ({useResource:() => ({data:{outgoing:[],incoming:[]}}),useAction:() => vi.fn(),write:{}}));
vi.mock("../../hooks/useIsMobile",() => ({useIsMobile:() => false}));

describe("Prof-* shared model",() => {
  it("uses the graph palette for labels/spines and Chronicle time for events",() => {
    for (const type of ["being","location","community","artifact"]) expect(profileColor(type)).toBe(TYPE_COLORS[type]);
    expect(profileStyle("being")).toEqual({"--profile-type":TYPE_COLORS.being});
    expect(profileColor("setting_event","up")).toBe("var(--t-up)");
    expect(profileColor("campaign_event","on")).toBe("var(--t-on)");
    const html=renderToStaticMarkup(<ProfileHero type="being" name="Мара" createdAt="2026-10-03 08:00:00" />);
    expect(html).toContain("profile-type-label"); expect(html).toContain("С 03.10.2026"); expect(html).toContain("profile-cover--ph");
  });
  it("merges participation events and dates without conflating campaign ids",() => {
    const date={id:1,title:"Рождение",recurrence:"once",year:1492,month:1,day:3,source_event_id:39} as ImportantDate;
    const event={id:39,title:"Рождение",source:"setting",status:"happened",inworld_year:1492,inworld_month:1,inworld_day:3} as ProfileWorldEvent;
    expect(mergeProfileWorld([date],[event],null)).toHaveLength(1);
    expect(mergeProfileWorld([date],[{...event,source:"campaign"}],null)).toHaveLength(2);
    expect(mergeProfileWorld([date],[],null)[0].date).toBe(date);
  });
  it("does not render empty link groups, while preserving a populated group",() => {
    expect(profileRelationGroups("being",[],[{title:"Где",rows:[]}])).toEqual([]);
    const html=renderToStaticMarkup(<MemoryRouter><ProfileLinks type="being" id={686} name="Мара" settingId={1} groups={[{title:"Где",rows:[]},{title:"Что",rows:[{key:"item:1",type:"artifact",id:1,name:"Досье"}]}]} /></MemoryRouter>);
    expect(html).not.toContain(">Где<"); expect(html).toContain(">Что<"); expect(html).toContain("Досье");
  });
});
