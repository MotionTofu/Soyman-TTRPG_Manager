// @vitest-environment jsdom
import { describe,expect,it,vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { TYPE_COLORS } from "../../graphTypes";
import { ProfileHero,profileColor,profileStyle } from "./ProfileParts";
import { mergeProfileWorld, type ProfileWorldEvent } from "./ProfileChronicle";
import { ProfileLinks,profileRelationGroups } from "./ProfileLinks";
import type { ChronicleSession, ImportantDate } from "../../types";
import { ProfileEventSessions } from "./ProfileEventSessions";
import { mapPinPalette } from "./mapPinPalette";
import { pickTextOn } from "../../themes";

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
    expect(renderToStaticMarkup(<ProfileHero type="campaign_event" name="Событие" />)).toContain("type-glyph--event");
  });
  it("merges participation events and dates without conflating campaign ids",() => {
    const date={id:1,title:"Рождение",recurrence:"once",year:1492,month:1,day:3,source_event_id:39} as ImportantDate;
    const event={id:39,title:"Рождение",source:"setting",status:"happened",inworld_year:1492,inworld_month:1,inworld_day:3} as ProfileWorldEvent;
    expect(mergeProfileWorld([date],[event],null)).toHaveLength(1);
    expect(mergeProfileWorld([date],[{...event,source:"campaign"}],null)).toHaveLength(2);
    expect(mergeProfileWorld([date],[],null)[0].date).toBe(date);
  });
  it("places recurring dates in the current turn and tones future dates",() => {
    const date={id:1,title:"Годовщина",recurrence:"annual",year:1400,month:5,day:3} as ImportantDate;
    const ev=mergeProfileWorld([date],[],{year:1492,month:1})[0].ev;
    expect(ev.inworld_year).toBe(1492);expect(ev.status).toBe("upcoming");
    const monthly=mergeProfileWorld([{...date,recurrence:"monthly"}],[],{year:1492,month:6,day:7})[0].ev;
    expect(monthly.inworld_month).toBe(6);expect(monthly.status).toBe("happened");
  });
  it("does not render empty link groups, while preserving a populated group",() => {
    expect(profileRelationGroups("being",[],[{title:"Где",rows:[]}])).toEqual([]);
    const html=renderToStaticMarkup(<MemoryRouter><ProfileLinks type="being" id={686} name="Мара" settingId={1} groups={[{title:"Где",rows:[]},{title:"Что",rows:[{key:"item:1",type:"artifact",id:1,name:"Досье"}]}]} /></MemoryRouter>);
    expect(html).not.toContain(">Где<"); expect(html).toContain(">Что<"); expect(html).toContain("Досье");
  });
  it("hides the campaign event Session block without a reverse link",() => {
    expect(renderToStaticMarkup(<ProfileEventSessions />)).toBe("");
    expect(renderToStaticMarkup(<ProfileEventSessions sessions={[]} />)).toBe("");
    const sessions=[{id:188,link_id:9,date:"2026-11-04",title:"Встреча",session_number:7,status:"held"}] as ChronicleSession[];
    const html=renderToStaticMarkup(<MemoryRouter><ProfileEventSessions sessions={sessions} /></MemoryRouter>);
    expect(html).toContain("Сессия");expect(html).toContain('/sessions/188');expect(html).toContain("Встреча");
  });
  it("uses type backgrounds and readable glyphs on location map pins",() => {
    for(const type of ["location","being","community","artifact"]) expect(mapPinPalette(type)).toEqual({background:TYPE_COLORS[type],color:pickTextOn(TYPE_COLORS[type])});
    expect(mapPinPalette("being","#ffffff")).toEqual({background:"#ffffff",color:pickTextOn("#ffffff")});
  });
});
