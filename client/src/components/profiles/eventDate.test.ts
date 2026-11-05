import { describe, expect, it } from "vitest";
import { formatProfileEventDate } from "./eventDate";

describe("event hero date", () => {
  const months = [{id:1,setting_id:1,position:6,name:"Июнь",days:30}];
  it("uses the real calendar month in genitive and shortens a multiword era", () => {
    expect(formatProfileEventDate(1496,6,7,"day",months,"Летоисчисление Долин")).toBe("7 июня 1496 ЛД");
    expect(formatProfileEventDate(1496,6,7,"day",[{...months[0],name:"Киторна"}],"ЛД")).toBe("7 Киторна 1496 ЛД");
  });
  it("does not invent a day for a less precise date", () => {
    expect(formatProfileEventDate(1496,6,7,"month",months,"ЛД")).toBe("Июнь 1496 ЛД");
    expect(formatProfileEventDate(1496,6,7,"year",months,"")).toBe("1496");
  });
});
