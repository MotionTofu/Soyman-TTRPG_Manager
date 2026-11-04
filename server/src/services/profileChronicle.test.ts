import { describe,it,expect } from "vitest";
import { db } from "../db/db";
import { profileChronicle } from "./profileChronicle";

describe("entity-scoped Chronicle",() => {
  it("reads both link directions, deduplicates links and filters campaign participation",() => {
    const sid=Number(db.prepare("INSERT INTO settings (name,pinned_calendar_year,pinned_calendar_month) VALUES ('Профили',1492,1)").run().lastInsertRowid);
    const bid=Number(db.prepare("INSERT INTO setting_beings (setting_id,name) VALUES (?,'Мара')").run(sid).lastInsertRowid);
    const c1=Number(db.prepare("INSERT INTO campaigns (name,setting_id) VALUES ('Первая',?)").run(sid).lastInsertRowid);
    const c2=Number(db.prepare("INSERT INTO campaigns (name,setting_id) VALUES ('Вторая',?)").run(sid).lastInsertRowid);
    const world=Number(db.prepare("INSERT INTO setting_calendar_events (setting_id,title,inworld_year,inworld_month,inworld_day) VALUES (?,'Встреча',1492,1,2)").run(sid).lastInsertRowid);
    const own=(c:number) => Number(db.prepare("INSERT INTO campaign_calendar_events (campaign_id,title,inworld_year,inworld_month,inworld_day) VALUES (?,'Поход',1492,1,3)").run(c).lastInsertRowid);
    const e1=own(c1),e2=own(c2);
    const link=db.prepare("INSERT INTO generic_links (from_type,from_id,to_type,to_id,section) VALUES (?,?,?,?,?)");
    link.run("setting_event",world,"being",bid,"participants"); link.run("being",bid,"setting_event",world,"participants");
    link.run("campaign_event",e1,"being",bid,"participants"); link.run("being",bid,"campaign_event",e2,"participants");
    const result=profileChronicle("being",bid,c1)!;
    expect(result.events).toHaveLength(2);
    expect(result.events).toEqual(expect.arrayContaining([expect.objectContaining({id:world,source:"setting"}),expect.objectContaining({id:e1,source:"campaign"})]));
    expect(profileChronicle("being",bid,null)!.events).toHaveLength(3);
    expect(profileChronicle("bad-sql",bid,null)).toBeNull();
  });
});
