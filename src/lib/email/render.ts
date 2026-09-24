import { render } from "@react-email/render";

import { buildEmail } from "@/emails/templates";
import type { EmailData, EmailEvent } from "@/emails/types";

export type RenderedEmail = { subject: string; html: string; text: string };

/** Renders an event's template to HTML plus a plain-text alternative. */
export async function renderEmail(event: EmailEvent, data: EmailData): Promise<RenderedEmail> {
  const { subject, element } = buildEmail(event, data);
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { subject, html, text };
}
