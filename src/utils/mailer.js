// mailer.js — Lokaly Email OTP Service
// Uses Resend API (free, reliable, no SMTP headache)
// Fallback: console log in dev if no API key set

const { Resend } = require('resend');

// -----------------------------------------------
// Resend client (lazy init)
// -----------------------------------------------
let _resend = null;

function getResendClient() {
  if (_resend) return _resend;
  if (!process.env.RESEND_API_KEY) return null;
  _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

// -----------------------------------------------
// Beautiful HTML Email Template
// -----------------------------------------------
function otpEmailHtml({ otp, name }) {
  return `
  <!DOCTYPE html>
  <html>
  <head><meta charset="utf-8"><title>Your Lokaly verification code</title></head>
  <body style="margin:0;padding:0;background:#FFF8F0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#FFF8F0;padding:40px 20px;">
      <tr><td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#FFFFFF;border-radius:24px;border:1px solid rgba(43,36,56,0.08);overflow:hidden;">
          <tr><td style="padding:32px 32px 8px 32px;">
            <div style="font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#FF6B6B;font-weight:600;">Lokaly</div>
            <h1 style="font-family:Georgia,serif;font-size:28px;color:#2B2438;margin:8px 0 4px 0;letter-spacing:-0.5px;">
              Verify your email
            </h1>
            <p style="color:#6B5A82;font-size:14px;margin:0 0 24px 0;line-height:1.6;">
              Hi ${name || 'there'}, use the code below to verify your email address.
              This code expires in <strong>10 minutes</strong>.
            </p>
          </td></tr>

          <tr><td align="center" style="padding:8px 32px 24px 32px;">
            <div style="display:inline-block;background:#FFF8F0;border:2px dashed rgba(43,36,56,0.15);border-radius:16px;padding:20px 32px;">
              <div style="font-family:'Courier New',monospace;font-size:36px;letter-spacing:12px;color:#2B2438;font-weight:bold;">
                ${otp}
              </div>
            </div>
          </td></tr>

          <tr><td style="padding:0 32px 32px 32px;">
            <p style="color:#6B5A82;font-size:12px;line-height:1.6;margin:0;">
              If you didn't request this, you can safely ignore this email — your account stays secure.
            </p>
            <hr style="border:none;border-top:1px solid rgba(43,36,56,0.06);margin:24px 0;">
            <p style="color:#9B8AAB;font-size:11px;margin:0;">
              Sent by Lokaly · Local love, live.
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
  </html>
  `;
}

// -----------------------------------------------
// Send OTP Email via Resend
// -----------------------------------------------
async function sendOtpEmail({ to, otp, name }) {

  // Always log in dev for debugging
  console.log(`[mailer] OTP for ${to}: ${otp}`);

  const resend = getResendClient();

  // No API key set — dev mode, OTP only in console
  if (!resend) {
    console.warn('[mailer] RESEND_API_KEY not set — running in dev/console mode');
    return { dev: true };
  }

  // FROM address:
  // - Free Resend plan → use "onboarding@resend.dev"
  // - Custom domain verified → use your own email
  const fromAddress = process.env.SMTP_FROM || 'Lokaly <onboarding@resend.dev>';

  try {
    const { data, error } = await resend.emails.send({
      from: fromAddress,
      to: [to],
      subject: `Your Lokaly verification code: ${otp}`,
      text: `Your Lokaly verification code is: ${otp}\n\nThis code expires in 10 minutes.\nIf you didn't request this, you can safely ignore this email.`,
      html: otpEmailHtml({ otp, name }),
    });

    if (error) {
      console.error('[mailer] Resend error:', error);
      throw new Error(error.message || 'Failed to send email');
    }

    console.log('[mailer] Email sent! ID:', data?.id);
    return { sent: true, messageId: data?.id };

  } catch (err) {
    console.error('[mailer] send failed:', err.message);
    throw err;
  }
}

module.exports = { sendOtpEmail };