import { Hr, Text } from "@react-email/components";
import type { ReactElement } from "react";

import { colors, EmailLayout, Paragraph, PrimaryButton } from "./components";
import type { EmailBrandData } from "./types";

export type AuthEmailKind = "invitation" | "password_reset";

export type AuthEmailData = EmailBrandData & {
  actionUrl: string;
  recipientFirstName: string;
};

type Built = { subject: string; element: ReactElement };

export function buildAuthEmail(kind: AuthEmailKind, data: AuthEmailData): Built {
  if (kind === "invitation") {
    return {
      subject: `You're invited to administer ${data.appName}`,
      element: (
        <EmailLayout
          data={data}
          preview={`Set your password to access the ${data.appName} staff portal.`}
          heading="You're invited to the staff portal"
        >
          <Paragraph>Hi {data.recipientFirstName},</Paragraph>
          <Paragraph>
            You&apos;ve been invited to help manage room reservations for {data.churchName}. Choose a password to activate
            your administrator account.
          </Paragraph>
          <PrimaryButton href={data.actionUrl}>Choose your password</PrimaryButton>
          <AuthLinkNote />
        </EmailLayout>
      ),
    };
  }

  return {
    subject: `Reset your ${data.appName} password`,
    element: (
      <EmailLayout
        data={data}
        preview={`Choose a new password for the ${data.appName} staff portal.`}
        heading="Reset your password"
      >
        <Paragraph>Hi {data.recipientFirstName},</Paragraph>
        <Paragraph>
          We received a request to reset the password for your {data.appName} administrator account. Use the button
          below to choose a new password.
        </Paragraph>
        <PrimaryButton href={data.actionUrl}>Choose a new password</PrimaryButton>
        <AuthLinkNote />
        <Paragraph>If you didn&apos;t request this, you can safely ignore this email. Your password has not changed.</Paragraph>
      </EmailLayout>
    ),
  };
}

function AuthLinkNote() {
  return (
    <>
      <Hr style={{ borderColor: colors.border, margin: "8px 0 16px" }} />
      <Text style={{ color: colors.muted, fontSize: 12, lineHeight: "18px", margin: "0 0 14px" }}>
        This secure link expires soon and can be used only once. Don&apos;t forward this email.
      </Text>
    </>
  );
}
