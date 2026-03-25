// Brevo Transactional Email Service
// Uses Brevo REST API v3 to send interview invitation emails

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
const BREVO_API_KEY = import.meta.env.VITE_BREVO_API_KEY;
const SENDER_EMAIL = import.meta.env.VITE_BREVO_SENDER_EMAIL;
const SENDER_NAME = import.meta.env.VITE_BREVO_SENDER_NAME || 'InterviewXpert';

/**
 * Derives a human-readable name from an email address.
 * e.g., "john.doe@gmail.com" → "John Doe"
 */
function deriveNameFromEmail(email: string): string {
  const localPart = email.split('@')[0];
  return localPart
    .replace(/[._-]/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Generates the professional HTML email template for interview invitations.
 */
function getEmailTemplate(candidateName: string, jobTitle: string, interviewLink: string, accessCode: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Interview Invitation</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f6f9;font-family:'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f6f9;padding:40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
          
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#6366f1 0%,#8b5cf6 50%,#a855f7 100%);padding:40px 40px 30px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:28px;font-weight:700;letter-spacing:-0.5px;">InterviewXpert</h1>
              <p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:14px;font-weight:400;">AI-Powered Interview Platform</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px;">
              <h2 style="margin:0 0 8px;color:#1f2937;font-size:22px;font-weight:600;">You're Invited! 🎉</h2>
              <p style="margin:0 0 24px;color:#6b7280;font-size:15px;line-height:1.6;">
                Hi <strong style="color:#1f2937;">${candidateName}</strong>,
              </p>
              <p style="margin:0 0 24px;color:#4b5563;font-size:15px;line-height:1.7;">
                You have been selected for an interview for the position of <strong style="color:#6366f1;">${jobTitle}</strong>. Please use the link and access code below to begin your AI-powered interview at your convenience.
              </p>

              <!-- Access Code Box -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                <tr>
                  <td style="background-color:#f5f3ff;border:1px solid #e0e7ff;border-radius:12px;padding:20px;text-align:center;">
                    <p style="margin:0 0 6px;color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Your Access Code</p>
                    <p style="margin:0;color:#4f46e5;font-size:32px;font-weight:700;letter-spacing:4px;font-family:'Courier New',monospace;">${accessCode}</p>
                  </td>
                </tr>
              </table>

              <!-- CTA Button -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                <tr>
                  <td align="center">
                    <a href="${interviewLink}" target="_blank" style="display:inline-block;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#ffffff;text-decoration:none;padding:16px 48px;border-radius:12px;font-size:16px;font-weight:600;letter-spacing:0.3px;box-shadow:0 4px 14px rgba(99,102,241,0.4);">
                      Start Interview →
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Link fallback -->
              <p style="margin:0 0 8px;color:#9ca3af;font-size:12px;">If the button doesn't work, copy and paste this link into your browser:</p>
              <p style="margin:0 0 28px;color:#6366f1;font-size:13px;word-break:break-all;">${interviewLink}</p>

              <hr style="border:none;border-top:1px solid #e5e7eb;margin:0 0 24px;" />

              <!-- Tips -->
              <p style="margin:0 0 12px;color:#374151;font-size:14px;font-weight:600;">📋 Before You Start:</p>
              <ul style="margin:0 0 0 16px;padding:0;color:#6b7280;font-size:14px;line-height:2;">
                <li>Ensure you have a stable internet connection</li>
                <li>Allow camera and microphone access when prompted</li>
                <li>Find a quiet, well-lit environment</li>
                <li>Keep your resume handy for reference</li>
              </ul>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#f9fafb;padding:24px 40px;border-top:1px solid #e5e7eb;">
              <p style="margin:0 0 4px;color:#6b7280;font-size:13px;text-align:center;">
                Best of luck! — <strong>The InterviewXpert Team</strong>
              </p>
              <p style="margin:0;color:#9ca3af;font-size:11px;text-align:center;">
                This is an automated message. Please do not reply to this email.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export interface SendEmailResult {
  success: boolean;
  totalEmails: number;
  messageIds?: string[];
  error?: string;
}

/**
 * Core function: sends a single email via Brevo REST API.
 * Uses the simple, documented POST /v3/smtp/email format:
 * { sender, to, subject, htmlContent }
 */
async function sendSingleEmail(
  recipientEmail: string,
  recipientName: string,
  subject: string,
  htmlContent: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (!BREVO_API_KEY) {
    console.error('[Brevo] API key is missing. Check VITE_BREVO_API_KEY in .env');
    return { success: false, error: 'Brevo API key is not configured.' };
  }
  if (!SENDER_EMAIL) {
    console.error('[Brevo] Sender email is missing. Check VITE_BREVO_SENDER_EMAIL in .env');
    return { success: false, error: 'Brevo sender email is not configured.' };
  }

  const payload = {
    sender: { email: SENDER_EMAIL, name: SENDER_NAME },
    to: [{ email: recipientEmail, name: recipientName }],
    subject: subject,
    htmlContent: htmlContent,
  };

  console.log('[Brevo] Sending email to:', recipientEmail, '| Subject:', subject);

  try {
    const response = await fetch(BREVO_API_URL, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': BREVO_API_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    console.log('[Brevo] Response status:', response.status, '| Data:', JSON.stringify(data));

    if (!response.ok) {
      const errorMsg = data.message || `Brevo API returned ${response.status}`;
      console.error('[Brevo] API Error:', errorMsg, data);
      return { success: false, error: errorMsg };
    }

    console.log('[Brevo] ✅ Email sent successfully! MessageId:', data.messageId);
    return { success: true, messageId: data.messageId };
  } catch (err: any) {
    console.error('[Brevo] Network/fetch error:', err);
    return { success: false, error: err.message || 'Network error sending email' };
  }
}

/**
 * Sends interview invitation emails to a list of candidate emails.
 * Sends one email per candidate for maximum reliability.
 */
export async function sendInterviewInvitations(
  candidateEmails: string[],
  jobTitle: string,
  interviewLink: string,
  accessCode: string
): Promise<SendEmailResult> {
  if (!candidateEmails.length) {
    return { success: false, totalEmails: 0, error: 'No candidate emails provided.' };
  }

  const allMessageIds: string[] = [];
  let lastError = '';

  for (const email of candidateEmails) {
    const candidateName = deriveNameFromEmail(email);
    const htmlContent = getEmailTemplate(candidateName, jobTitle, interviewLink, accessCode);
    const subject = `Interview Invitation — ${jobTitle} | InterviewXpert`;

    const result = await sendSingleEmail(email, candidateName, subject, htmlContent);

    if (result.success && result.messageId) {
      allMessageIds.push(result.messageId);
    } else {
      lastError = result.error || 'Unknown error';
    }
  }

  if (allMessageIds.length > 0) {
    return {
      success: true,
      totalEmails: allMessageIds.length,
      messageIds: allMessageIds,
      error: lastError || undefined,
    };
  }

  return { success: false, totalEmails: 0, error: lastError || 'Failed to send emails.' };
}
