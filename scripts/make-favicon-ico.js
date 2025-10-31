#!/usr/bin/env node
// Convert frontend/public/jtservices.jpg (or .png) to frontend/public/favicon.ico
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const toIco = require('to-ico');

async function main() {
  const pub = path.join(__dirname, '..', 'frontend', 'public');
  const srcs = ['jtservices.jpg', 'jtservices.png', 'logo.png', 'logo.jpg'].map(n => path.join(pub, n));
  const src = srcs.find(p => fs.existsSync(p));
  if (!src) {
    console.error('Image source not found in frontend/public (expected jtservices.jpg or jtservices.png)');
    process.exit(1);
  }
  const out = path.join(pub, 'favicon.ico');
  console.log('Generating', out, 'from', path.basename(src));
  // Generate multiple PNG sizes for ICO (16, 32, 48, 64, 128)
  const sizes = [16, 32, 48, 64, 128];
  const pngBuffers = await Promise.all(
    sizes.map(sz => sharp(src).resize(sz, sz, { fit: 'cover' }).png().toBuffer())
  );
  const ico = await toIco(pngBuffers);
  fs.writeFileSync(out, ico);
  console.log('Done:', out);
}

main().catch(err => { console.error(err?.message || err); process.exit(1); });
