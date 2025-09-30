// Minimal Wave API helper (placeholder). In production, fill with real endpoints and auth.
const fetch = global.fetch || require('node-fetch');

async function createPaymentIntent({ amount, currency = 'XOF', phone, reference }) {
  // Placeholder: do not call external API without credentials.
  // Return a simulated intent with a reference.
  const ref = reference || ('wave_' + Date.now());
  return { ok: true, reference: ref };
}

function verifyWebhookSignature(req) {
  // Placeholder: implement signature verification using process.env.WAVE_WEBHOOK_SECRET
  return true;
}

module.exports = { createPaymentIntent, verifyWebhookSignature };
