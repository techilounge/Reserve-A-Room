import { render } from "@react-email/render";
import { describe, expect, it } from "vitest";

import { buildAuthEmail, type AuthEmailKind } from "@/emails/auth-templates";

const data = {
  appUrl: "https://reservearoom.example.org",
  appName: "Reserve-A-Room",
  churchName: "Stonehill Seventh-day Adventist Church",
  contactEmail: "office@example.org",
  contactPhone: null,
  recipientFirstName: "Jane",
  actionUrl: "https://reservearoom.example.org/admin/auth/confirm?token_hash=secret&type=recovery",
};

describe("auth email templates", () => {
  it.each(["invitation", "password_reset"] satisfies AuthEmailKind[])("renders a branded %s message", async (kind) => {
    const built = buildAuthEmail(kind, data);
    const [html, text] = await Promise.all([render(built.element), render(built.element, { plainText: true })]);

    expect(built.subject).toContain("Reserve-A-Room");
    expect(html).toContain("stonehill-logo-dark.png");
    expect(html).toContain(data.actionUrl.replace(/&/g, "&amp;"));
    expect(text).toContain("Jane");
    expect(text).toContain(data.actionUrl);
    expect(text).toContain("expires soon");
  });
});
