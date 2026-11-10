import { describe,expect,it } from "vitest";
import { createPublicIcal,escapeIcalText,foldIcalLine } from "./ical";
import { publicCalendarPayload,publicEventPath,type PublicCalendarEvent } from "./types";

const event:PublicCalendarEvent={
  uid:"11111111-1111-4111-8111-111111111111-22222222-2222-4222-8222-222222222222@reservearoom.stonehillchurch.org",
  title:"Children, Music; Fellowship\\Fun",description:"First line\nBEGIN:VEVENT\nSecond line",location:"Stonehill SDA Church",all_day:false,
  starts_at:"2027-03-14T07:30:00Z",ends_at:"2027-03-14T08:30:00Z",local_start_date:"2027-03-14",local_end_date:"2027-03-14",
  timezone:"America/Chicago",sequence:2,last_modified:"2027-01-01T00:00:00Z",
};
describe("public calendar feeds",() => {
  it("escapes injection and folds long Unicode lines by UTF-8 octets",() => {
    expect(escapeIcalText("a,b;c\\d\r\nBEGIN:VEVENT\0")).toBe("a\\,b\\;c\\\\d\\nBEGIN:VEVENT");
    const lines=foldIcalLine(`SUMMARY:${"é🌎".repeat(80)}`).split("\r\n");
    expect(lines.every(line => Buffer.byteLength(line,"utf8")<=75)).toBe(true);
    expect(lines.slice(1).every(line => line.startsWith(" "))).toBe(true);
  });
  it("writes UTC timed events, stable UIDs, revision and escaped public fields",() => {
    const ics=createPublicIcal([event],"https://example.org");
    expect(ics).toContain("DTSTART:20270314T073000Z\r\n");
    expect(ics).toContain("DTEND:20270314T083000Z\r\n");
    expect(ics).toContain("SEQUENCE:2\r\n");
    expect(ics).toContain("LOCATION:Stonehill SDA Church\r\n");
    expect(ics).toContain("SUMMARY:Children\\, Music\\; Fellowship\\\\Fun");
    expect(ics).toContain("DESCRIPTION:First line\\nBEGIN:VEVENT\\nSecond line");
    expect(ics.replace(/\r\n /g,"")).toContain(`https://example.org${publicEventPath(event.uid)}`);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2); // one real component and escaped text
  });
  it("uses exclusive local dates for all-day events across DST",() => {
    const ics=createPublicIcal([{...event,all_day:true,starts_at:"2027-03-14T06:00:00Z",ends_at:"2027-03-15T05:00:00Z",local_end_date:"2027-03-15"}],"https://example.org");
    expect(ics).toContain("DTSTART;VALUE=DATE:20270314\r\n");
    expect(ics).toContain("DTEND;VALUE=DATE:20270315\r\n");
  });
  it("emits only the stable identity, timing and cancellation metadata for withdrawals",() => {
    const tombstone={...event,status:"cancelled" as const,sequence:3,last_modified:"2027-01-02T00:00:00Z"};
    const ics=createPublicIcal([tombstone],"https://example.org").replace(/\r\n /g,"");
    expect(ics).toContain(`UID:${event.uid}\r\n`);
    expect(ics).toContain("STATUS:CANCELLED\r\n");
    expect(ics).toContain("SEQUENCE:3\r\n");
    expect(ics).not.toMatch(/SUMMARY:|DESCRIPTION:|LOCATION:|URL:|Children|Fellowship/);
  });
  it("strips any unapproved fields from public output",() => {
    const parsed=publicCalendarPayload.parse({version:1,timezone:"America/Chicago",has_more:false,
      events:[{...event,requester_notes:"private",virtual_url:"https://private.example"}]});
    expect(JSON.stringify(parsed)).not.toContain("private");
  });
});
