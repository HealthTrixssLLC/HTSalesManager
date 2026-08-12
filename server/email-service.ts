/**
 * Azure Graph email service — sends transactional email via the Microsoft Graph API.
 *
 * PREREQUISITE: The Azure app registration must have the `Mail.Send` APPLICATION permission
 * (not delegated) consented by an Azure admin in Entra ID. Without this consent the
 * Graph sendMail call will return 403 Forbidden.
 *
 * Required secrets: AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_SENDER_EMAIL
 */

const TENANT_ID    = process.env.AZURE_TENANT_ID!;
const CLIENT_ID    = process.env.AZURE_CLIENT_ID!;
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET!;
const SENDER_EMAIL = process.env.AZURE_SENDER_EMAIL!;

/** Acquire an app-only (client credentials) access token scoped to Graph. */
async function getAppOnlyToken(): Promise<string> {
  const params = new URLSearchParams({
    grant_type:    "client_credentials",
    client_id:     CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope:         "https://graph.microsoft.com/.default",
  });

  const res = await fetch(
    `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
    {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body:    params.toString(),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`[Email] Token acquisition failed (${res.status}): ${text}`);
  }

  const data = await res.json() as { access_token: string };
  return data.access_token;
}

/**
 * Send a password-reset email to `toEmail` containing a single-use `resetUrl`.
 * Errors are logged but never thrown — a failed send must not reveal whether
 * an email address exists in the system.
 */
export async function sendPasswordResetEmail(
  toEmail:  string,
  resetUrl: string
): Promise<void> {
  try {
    if (!CLIENT_ID || !CLIENT_SECRET || !TENANT_ID || !SENDER_EMAIL) {
      console.error("[Email] Missing Azure credentials — password reset email not sent.");
      return;
    }

    const accessToken = await getAppOnlyToken();

    const html = `
<!DOCTYPE html>
<html lang="en">
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f4f4f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 0;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0"
             style="background:#fff;border-radius:8px;padding:40px;box-shadow:0 1px 4px rgba(0,0,0,.08);">
        <tr><td>
          <h2 style="margin:0 0 16px;color:#1e3a5f;font-size:22px;">Reset your password</h2>
          <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">
            You requested a password reset for your <strong>Health Trixss CRM</strong> account.
            Click the button below to set a new password. This link expires in&nbsp;<strong>1&nbsp;hour</strong>.
          </p>
          <p style="margin:0 0 28px;">
            <a href="${resetUrl}"
               style="display:inline-block;padding:12px 28px;background:#1e3a5f;color:#fff;
                      border-radius:6px;text-decoration:none;font-size:15px;font-weight:600;">
              Reset Password
            </a>
          </p>
          <p style="margin:0 0 12px;color:#6b7280;font-size:13px;line-height:1.5;">
            If you didn't request this, you can safely ignore this email — your password won't change.
          </p>
          <p style="margin:0;color:#9ca3af;font-size:12px;word-break:break-all;">
            If the button doesn't work, copy this link into your browser:<br>${resetUrl}
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

    const plainText = `Reset your Health Trixss CRM password\n\nVisit the link below to set a new password (expires in 1 hour):\n${resetUrl}\n\nIf you didn't request this, ignore this email.`;

    const payload = {
      message: {
        subject: "Reset your Health Trixss CRM password",
        body: { contentType: "HTML", content: html },
        toRecipients: [{ emailAddress: { address: toEmail } }],
      },
      saveToSentItems: false,
    };

    const sendRes = await fetch(
      `https://graph.microsoft.com/v1.0/users/${SENDER_EMAIL}/sendMail`,
      {
        method:  "POST",
        headers: {
          Authorization:  `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );

    if (!sendRes.ok) {
      const errText = await sendRes.text();
      console.error(`[Email] sendMail failed (${sendRes.status}): ${errText}`);
    } else {
      console.log(`[Email] Password reset email sent to ${toEmail}`);
    }
  } catch (err) {
    // Never propagate — failed email must not leak account existence
    console.error("[Email] Unexpected error sending password reset email:", err);
  }
}
