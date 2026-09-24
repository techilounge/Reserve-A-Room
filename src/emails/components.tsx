import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import type { ReactNode } from "react";

import type { EmailData } from "./types";

// Email clients ignore CSS variables and most stylesheets, so the brand tokens are
// repeated here as literal values (see globals.css for the app's equivalents).
export const colors = {
  navy: "#031e47",
  gold: "#dea621",
  goldText: "#8a6508",
  text: "#1b2433",
  muted: "#566074",
  border: "#e3e6ec",
  surface: "#f5f6f8",
  warningBg: "#fff6e0",
  warningBorder: "#e8c46a",
} as const;

const font =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

export function EmailLayout({
  data,
  preview,
  heading,
  children,
}: {
  data: EmailData;
  preview: string;
  heading: string;
  children: ReactNode;
}) {
  return (
    <Html lang="en" dir="ltr">
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light" />
        <meta name="supported-color-schemes" content="light" />
      </Head>
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: colors.surface, margin: 0, padding: "24px 0", fontFamily: font }}>
        <Container style={{ maxWidth: 600, width: "100%", margin: "0 auto" }}>
          <Section style={{ backgroundColor: colors.navy, borderRadius: "12px 12px 0 0", padding: "24px 22px" }}>
            <Img
              src={`${data.appUrl}/branding/stonehill-logo-dark.png`}
              alt={`${data.appName} — ${data.churchName}`}
              width={240}
              height={67}
              style={{ display: "block", maxWidth: "100%", height: "auto" }}
            />
          </Section>
          <Section style={{ backgroundColor: colors.gold, height: 4, lineHeight: "4px", fontSize: 0 }}>&nbsp;</Section>
          <Section style={{ backgroundColor: "#ffffff", padding: "28px 22px", borderRadius: "0 0 12px 12px" }}>
            <Heading as="h1" style={{ color: colors.navy, fontSize: 22, lineHeight: "30px", margin: "0 0 16px" }}>
              {heading}
            </Heading>
            {children}
          </Section>
          <Section style={{ padding: "20px 28px", textAlign: "center" }}>
            <Text style={{ color: colors.muted, fontSize: 12, lineHeight: "18px", margin: 0 }}>
              {data.appName} · {data.churchName}
            </Text>
            {data.contactEmail || data.contactPhone ? (
              <Text style={{ color: colors.muted, fontSize: 12, lineHeight: "18px", margin: "4px 0 0" }}>
                Questions? Contact the church office
                {data.contactEmail ? (
                  <>
                    {" at "}
                    <Link href={`mailto:${data.contactEmail}`} style={{ color: colors.navy }}>
                      {data.contactEmail}
                    </Link>
                  </>
                ) : null}
                {data.contactPhone ? ` · ${data.contactPhone}` : null}.
              </Text>
            ) : null}
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export function Paragraph({ children }: { children: ReactNode }) {
  return <Text style={{ color: colors.text, fontSize: 15, lineHeight: "24px", margin: "0 0 14px" }}>{children}</Text>;
}

export function DetailsTable({ rows }: { rows: [label: string, value: string | null | undefined][] }) {
  const visible = rows.filter((row): row is [string, string] => Boolean(row[1]));
  return (
    <Section
      style={{ backgroundColor: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, padding: "8px 14px", margin: "4px 0 20px" }}
    >
      {/* data-text-format keeps label/value columns apart in the plain-text version. */}
      <table role="presentation" data-text-format="dataTable" width="100%" cellPadding={0} cellSpacing={0} style={{ borderCollapse: "collapse" }}>
        <tbody>
          {visible.map(([label, value]) => (
            <tr key={label}>
              <td
                style={{ color: colors.muted, fontSize: 13, lineHeight: "20px", padding: "8px 10px 8px 0", verticalAlign: "top", width: 88 }}
              >
                {label}
              </td>
              <td style={{ color: colors.text, fontSize: 14, lineHeight: "20px", padding: "8px 0", verticalAlign: "top", fontWeight: 600, whiteSpace: "pre-line" }}>
                {value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

export function PrimaryButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Section style={{ margin: "8px 0 20px" }}>
      <Button
        href={href}
        style={{
          backgroundColor: colors.navy,
          color: "#ffffff",
          borderRadius: 8,
          fontSize: 15,
          fontWeight: 600,
          padding: "12px 22px",
          textDecoration: "none",
          display: "inline-block",
        }}
      >
        {children}
      </Button>
    </Section>
  );
}

export function Callout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Section
      style={{ backgroundColor: colors.warningBg, border: `1px solid ${colors.warningBorder}`, borderRadius: 10, padding: "12px 16px", margin: "0 0 20px" }}
    >
      <Text style={{ color: colors.text, fontSize: 14, lineHeight: "20px", margin: 0, fontWeight: 700 }}>{title}</Text>
      <Text style={{ color: colors.text, fontSize: 14, lineHeight: "21px", margin: "4px 0 0", whiteSpace: "pre-line" }}>{children}</Text>
    </Section>
  );
}

export function StaffMessage({ message }: { message: string | null }) {
  if (!message) return null;
  return <Callout title="Message from the church office">{message}</Callout>;
}

/** The secure-link footnote shown under every requester email with a manage button. */
export function ManageLinkNote() {
  return (
    <>
      <Hr style={{ borderColor: colors.border, margin: "8px 0 16px" }} />
      <Text style={{ color: colors.muted, fontSize: 12, lineHeight: "18px", margin: 0 }}>
        The button above is a private link to your reservation. Anyone with it can view or cancel this reservation,
        so please don&apos;t forward this email.
      </Text>
    </>
  );
}
