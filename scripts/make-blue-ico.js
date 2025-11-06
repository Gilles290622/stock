#!/usr/bin/env node
// Generate a blue-background ICO from existing branding image into frontend/public/jtservices_blue.ico
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const toIco = require('to-ico');

async function buildBluePng(size, srcPath, bgColor) {
  // Create a square blue background
  const bg = await sharp({
    create: { width: size, height: size, channels: 4, background: bgColor }
  }).png().toBuffer();

  // Prepare the logo: fit into (size * 0.7), keep cover
  const logoSize = Math.round(size * 0.7);
  const logo = await sharp(srcPath).resize(logoSize, logoSize, { fit: 'contain', background: bgColor }).png().toBuffer();

  // Composite centered
  const left = Math.round((size - logoSize) / 2);
  const top = Math.round((size - logoSize) / 2);
  const out = await sharp(bg).composite([{ input: logo, left, top }]).png().toBuffer();
  return out;
}

async function main() {
  const pub = path.join(__dirname, '..', 'frontend', 'public');
  const srcs = ['jtservices.png', 'jtservices.jpg', 'logo.png', 'logo.jpg'].map(n => path.join(pub, n));
  const src = srcs.find(p => fs.existsSync(p));
  if (!src) {
    console.error('Image source not found in frontend/public (expected jtservices.png|jpg or logo.png|jpg)');
    process.exit(1);
  }
  const outIco = path.join(pub, 'jtservices_blue.ico');
  console.log('Generating', path.relative(process.cwd(), outIco), 'from', path.basename(src));
  const sizes = [16, 32, 48, 64, 128, 256];
  // Tailwind blue-700: #1d4ed8 (or use #1e40af for blue-800). Use blue-700 here.
  const bgColor = { r: 29, g: 78, b: 216, alpha: 1 };
  const pngBuffers = await Promise.all(sizes.map(sz => buildBluePng(sz, src, bgColor)));
  const ico = await toIco(pngBuffers);
  fs.writeFileSync(outIco, ico);
  console.log('Done:', outIco);
}

main().catch(err => { console.error(err?.message || err); process.exit(1); });
