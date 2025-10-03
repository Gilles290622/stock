const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  const nodemailer = require('nodemailer');
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE } = process.env;
  if (!SMTP_HOST) return null;
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 587),
    secure: String(SMTP_SECURE || 'false').toLowerCase() === 'true',
    auth: SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
  });
  return transporter;
}

async function sendMail({ to, subject, text, html, from }) {
  const t = getTransporter();
  if (!t) throw new Error('SMTP non configuré');
  const fromAddr = from || process.env.SMTP_FROM || 'no-reply@local';
  return await t.sendMail({ from: fromAddr, to, subject, text, html });
}

module.exports = { sendMail };
