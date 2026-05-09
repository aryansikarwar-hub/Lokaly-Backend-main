// Standalone mailer used by email-OTP flow.
// Falls back to console logging in dev when SMTP is not configured.

let _transporter = null;

function getTransporter() {
  if (_transporter) return _transporter;
  if (!process.env.SMTP_HOST && !process.env.SMTP_USER) return null;

  // eslint-disable-next-line global-require, import/no-unresolved, node/no-missing-require
  const nodemailer = require('nodemailer');

  // Gmail shortcut: if SMTP_USER ends with @gmail.com and no SMTP_HOST set
  const isGmail =
    !process.env.SMTP_HOST &&
    /@gmail\.com$/i.test(process.env.SMTP_USER || '');

  if (isGmail) {
    _transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS, // Gmail App Password (16 chars)
      },
    });
  } else {
    _transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    });
  }

  return _transporter;
}

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
              Hi ${name || 'there'}, use the code below to verify your email address. This code expires in <strong>10 minutes</strong>.
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

/**
 * Send a 6-digit OTP to the user's email.
 * In dev (no SMTP configured), the OTP is logged to console so the flow continues.
 */
async function sendOtpEmail({ to, otp, name }) {
  // Always log in dev so testing works without SMTP
  // eslint-disable-next-line no-console
  console.log(`[mailer] OTP for ${to}: ${otp}`);

  const transporter = getTransporter();
  if (!transporter) {
    // No SMTP configured — dev mode, OTP is logged above
    return { dev: true };
  }

  try {
    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM || `"Lokaly" <${process.env.SMTP_USER || 'no-reply@lokaly.local'}>`,
      to,
      subject: `Your Lokaly verification code: ${otp}`,
      text: `Your Lokaly verification code is: ${otp}\n\nThis code expires in 10 minutes.\nIf you didn't request this, you can safely ignore this email.`,
      html: otpEmailHtml({ otp, name }),
    });
    return { sent: true, messageId: info.messageId };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[mailer] send failed:', err.message);
    throw err;
  }
}

module.exports = { sendOtpEmail };