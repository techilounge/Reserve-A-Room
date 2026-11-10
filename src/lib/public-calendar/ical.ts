import { publicEventPath, type PublicCalendarEvent, type PublicCalendarCancellation } from "./types";

/** RFC 5545 TEXT escaping; do not allow control characters to create properties. */
export function escapeIcalText(value:string):string {
  return value.replace(/\r\n|\r|\n/g,"\n").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,"")
    .replace(/\\/g,"\\\\").replace(/;/g,"\\;").replace(/,/g,"\\,").replace(/\n/g,"\\n");
}

/** Fold at 75 octets without splitting a Unicode code point. */
export function foldIcalLine(line:string):string {
  const lines:string[]=[]; let part=""; let size=0;
  for (const character of line) {
    const bytes=Buffer.byteLength(character,"utf8");
    if (size+bytes>75) { lines.push(part); part=" "; size=1; }
    part+=character; size+=bytes;
  }
  lines.push(part);
  return lines.join("\r\n");
}
const utc = (value:string) => new Date(value).toISOString().replace(/[-:]/g,"").replace(/\.\d{3}Z$/,"Z");
const day = (value:string) => value.replaceAll("-","");
const isCancellation = (event:PublicCalendarEvent | PublicCalendarCancellation):event is PublicCalendarCancellation =>
  "status" in event && event.status === "cancelled";

export function createPublicIcal(events:(PublicCalendarEvent | PublicCalendarCancellation)[],origin:string):string {
  const lines=["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Stonehill SDA Church//Reserve-A-Room//EN","CALSCALE:GREGORIAN","METHOD:PUBLISH","X-WR-CALNAME:Stonehill Church Calendar"];
  for (const event of events) {
    lines.push("BEGIN:VEVENT",`UID:${event.uid}`,`DTSTAMP:${utc(event.last_modified)}`,`LAST-MODIFIED:${utc(event.last_modified)}`,
      `SEQUENCE:${event.sequence}`,event.all_day ? `DTSTART;VALUE=DATE:${day(event.local_start_date)}` : `DTSTART:${utc(event.starts_at)}`,
      event.all_day ? `DTEND;VALUE=DATE:${day(event.local_end_date)}` : `DTEND:${utc(event.ends_at)}`);
    if (isCancellation(event)) {
      lines.push("STATUS:CANCELLED","END:VEVENT");
      continue;
    }
    const url=new URL(publicEventPath(event.uid),origin);
    lines.push(`SUMMARY:${escapeIcalText(event.title)}`);
    if (event.description) lines.push(`DESCRIPTION:${escapeIcalText(event.description)}`);
    if (event.location) lines.push(`LOCATION:${escapeIcalText(event.location)}`);
    lines.push(`URL:${url.toString()}`,"END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(foldIcalLine).join("\r\n")}\r\n`;
}
