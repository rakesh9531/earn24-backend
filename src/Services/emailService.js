const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '465', 10),
    secure: (process.env.SMTP_SECURE === 'true' || process.env.SMTP_PORT === '465'),
    auth: {
        user: process.env.SMTP_USER || 'earn24world@gmail.com',
        pass: (process.env.SMTP_PASS || '').replace(/\s+/g, '') // remove spaces from app password if present
    }
});

/**
 * Send 6-digit OTP verification email with branded HTML template
 */
async function sendOtpEmail(toEmail, otpCode) {
    const fromAddress = process.env.SMTP_FROM || `"Earn24" <${process.env.SMTP_USER || 'earn24world@gmail.com'}>`;

    const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Earn24 Verification Code</title>
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #1e293b; }
            .card { max-width: 520px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.05); }
            .header { background: linear-gradient(135deg, #0d9488 0%, #0f766e 100%); padding: 32px 24px; text-align: center; }
            .header h1 { margin: 0; color: #ffffff; font-size: 28px; font-weight: 800; letter-spacing: 0.5px; }
            .header p { margin: 6px 0 0 0; color: #ccfbf1; font-size: 13px; font-weight: 500; }
            .body { padding: 32px 28px; }
            .greeting { font-size: 16px; font-weight: 600; color: #0f172a; margin-bottom: 12px; }
            .desc { font-size: 14px; color: #475569; line-height: 1.6; margin-bottom: 24px; }
            .otp-container { text-align: center; margin: 28px 0; background: #f0fdfa; border: 2px dashed #0d9488; border-radius: 12px; padding: 20px 16px; }
            .otp-code { font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace; font-size: 34px; font-weight: 800; letter-spacing: 8px; color: #0f766e; display: inline-block; margin: 0; }
            .otp-badge { display: block; font-size: 11px; color: #0d9488; font-weight: 700; text-transform: uppercase; margin-top: 6px; letter-spacing: 1px; }
            .warning-box { background: #fffbeb; border-left: 4px solid #f59e0b; padding: 12px 16px; border-radius: 6px; font-size: 12px; color: #92400e; line-height: 1.5; margin-top: 24px; }
            .footer { padding: 20px 24px; background: #f8fafc; border-top: 1px solid #f1f5f9; text-align: center; font-size: 12px; color: #94a3b8; }
            .footer a { color: #0d9488; text-decoration: none; }
        </style>
    </head>
    <body>
        <div class="card">
            <div class="header">
                <h1>EARN24</h1>
                <p>Fast & Secure Verification</p>
            </div>
            <div class="body">
                <div class="greeting">Hello,</div>
                <div class="desc">
                    Thank you for signing up on <strong>Earn24</strong>. Please use the following 6-digit verification code to complete your registration or verification.
                </div>

                <div class="otp-container">
                    <div class="otp-code">${otpCode}</div>
                    <span class="otp-badge">Verification Code</span>
                </div>

                <div class="warning-box">
                    <strong>⏰ Important:</strong> This code is valid for <strong>10 minutes</strong>. Never share this code with anyone, including Earn24 staff.
                </div>
            </div>
            <div class="footer">
                &copy; ${new Date().getFullYear()} Earn24 Technologies. All rights reserved.<br>
                If you didn't request this email, please ignore this message.
            </div>
        </div>
    </body>
    </html>
    `;

    const info = await transporter.sendMail({
        from: fromAddress,
        to: toEmail,
        subject: `Your Earn24 Verification Code: ${otpCode}`,
        text: `Your Earn24 verification code is: ${otpCode}. It is valid for 10 minutes.`,
        html: htmlContent
    });

    console.log(`[SMTP] Verification email sent to ${toEmail}. Message ID: ${info.messageId}`);
    return info;
}

/**
 * Generic email sending helper
 */
async function sendEmail({ to, subject, text, html }) {
    const fromAddress = process.env.SMTP_FROM || `"Earn24" <${process.env.SMTP_USER || 'earn24world@gmail.com'}>`;
    return transporter.sendMail({
        from: fromAddress,
        to,
        subject,
        text,
        html
    });
}

/**
 * Verify SMTP connection
 */
async function verifyConnection() {
    return transporter.verify();
}

module.exports = {
    transporter,
    sendOtpEmail,
    sendEmail,
    verifyConnection
};
