// Generates every web/PWA brand asset from the two official source images in
// assets/branding/. Re-run after replacing either source file:
//
//   npm run brand:generate
//
// Outputs are committed so builds never depend on this script.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "..");
const src = (f) => path.join(root, "assets/branding", f);
const out = (f) => path.join(root, f);

const LOGO = src("logo-source.png");
const MARK = src("favicon-source.png");

const BRAND_NAVY = "#031e47";

// Palette PNGs are ~4x smaller than truecolor for this artwork with no visible banding.
const PNG_OPTIONS = { palette: true, quality: 95, effort: 10, compressionLevel: 9 };

// The source mark is a rounded tile drawn on an opaque black square. These values
// are measured from favicon-source.png (1254px): corner radius ≈ 250px, and an
// inset of 90px fully clears the black corners.
const MARK_SOURCE_SIZE = 1254;
const MARK_CORNER_RADIUS = 252;
const MARK_SAFE_INSET = 90;

// In the trimmed logo, the wordmark starts to the right of this x position.
const LOGO_WORDMARK_START_RATIO = 0.29;

async function ensureDirs() {
  for (const dir of ["public/branding", "public/icons", "src/app"]) {
    await mkdir(out(dir), { recursive: true });
  }
}

function roundedMask(size, radius) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
       <rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="#fff"/>
     </svg>`,
  );
}

/** Mark with transparent rounded corners (for favicons, "any" icons, header). */
async function roundedMark(size) {
  const masked = await sharp(MARK)
    .ensureAlpha()
    .composite([{ input: roundedMask(MARK_SOURCE_SIZE, MARK_CORNER_RADIUS), blend: "dest-in" }])
    .png()
    .toBuffer();
  return sharp(masked).resize(size, size).png(PNG_OPTIONS).toBuffer();
}

/** Opaque full-bleed square (black corners cropped away) — for iOS, which rounds itself. */
async function opaqueMark(size) {
  const inner = MARK_SOURCE_SIZE - MARK_SAFE_INSET * 2;
  return sharp(MARK)
    .extract({ left: MARK_SAFE_INSET, top: MARK_SAFE_INSET, width: inner, height: inner })
    .resize(size, size)
    .flatten({ background: BRAND_NAVY })
    .png(PNG_OPTIONS)
    .toBuffer();
}

/**
 * Maskable icon: artwork must sit inside the central 80% "safe zone" circle.
 * The opaque mark is scaled to 84% with feathered edges over a navy background,
 * which keeps the cross fully visible under circular masks.
 */
async function maskableMark(size) {
  const scale = 0.84;
  const innerSize = Math.round(size * scale);
  const feather = Math.round(innerSize * 0.05);
  const featherMask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${innerSize}" height="${innerSize}">
       <defs><filter id="f"><feGaussianBlur stdDeviation="${feather / 2}"/></filter></defs>
       <rect x="${feather}" y="${feather}" width="${innerSize - feather * 2}" height="${innerSize - feather * 2}"
             rx="${feather * 2}" fill="#fff" filter="url(#f)"/>
     </svg>`,
  );
  const inner = await sharp(await opaqueMark(innerSize))
    .ensureAlpha()
    .composite([{ input: featherMask, blend: "dest-in" }])
    .png()
    .toBuffer();
  const offset = Math.round((size - innerSize) / 2);
  return sharp({
    create: { width: size, height: size, channels: 4, background: BRAND_NAVY },
  })
    .composite([{ input: inner, left: offset, top: offset }])
    .png(PNG_OPTIONS)
    .toBuffer();
}

/** ICO container holding a single embedded PNG (supported by all modern browsers). */
function pngToIco(png, size) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size >= 256 ? 0 : size, 0);
  entry.writeUInt8(size >= 256 ? 0 : size, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(6 + 16, 12);
  return Buffer.concat([header, entry, png]);
}

async function trimmedLogo() {
  return sharp(LOGO).trim({ threshold: 10 }).png().toBuffer({ resolveWithObject: true });
}

/**
 * Dark-mode logo: recolors the navy wordmark to near-white so it stays legible on
 * dark backgrounds. The church artwork on the left and all gold pixels are untouched.
 */
async function darkLogo(trimmedPng) {
  const { data, info } = await sharp(trimmedPng)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const wordmarkStart = Math.floor(info.width * LOGO_WORDMARK_START_RATIO);
  for (let y = 0; y < info.height; y++) {
    for (let x = wordmarkStart; x < info.width; x++) {
      const i = (y * info.width + x) * 4;
      const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
      if (a === 0) continue;
      const isBlueish = b > r + 25 && b >= g;
      const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      if (isBlueish && luminance < 0.45) {
        data[i] = 246;
        data[i + 1] = 248;
        data[i + 2] = 252;
      }
    }
  }
  return sharp(data, { raw: info }).png(PNG_OPTIONS).toBuffer();
}

async function openGraph(darkLogoPng) {
  const width = 1200;
  const height = 630;
  const logo = await sharp(darkLogoPng).resize({ width: 980 }).png().toBuffer();
  const meta = await sharp(logo).metadata();
  return sharp({ create: { width, height, channels: 4, background: BRAND_NAVY } })
    .composite([
      {
        input: logo,
        left: Math.round((width - meta.width) / 2),
        top: Math.round((height - meta.height) / 2),
      },
    ])
    .png(PNG_OPTIONS)
    .toBuffer();
}

async function main() {
  await ensureDirs();

  const trimmed = await trimmedLogo();
  const logoLight = await sharp(trimmed.data).resize({ width: 1200 }).png(PNG_OPTIONS).toBuffer();
  const logoDarkFull = await darkLogo(trimmed.data);
  const logoDark = await sharp(logoDarkFull).resize({ width: 1200 }).png(PNG_OPTIONS).toBuffer();

  const files = {
    "public/branding/stonehill-logo.png": logoLight,
    "public/branding/stonehill-logo-dark.png": logoDark,
    "public/branding/stonehill-mark.png": await roundedMark(256),
    "public/icons/icon-192.png": await roundedMark(192),
    "public/icons/icon-512.png": await roundedMark(512),
    "public/icons/icon-maskable-192.png": await maskableMark(192),
    "public/icons/icon-maskable-512.png": await maskableMark(512),
    "src/app/icon.png": await roundedMark(192),
    "src/app/apple-icon.png": await opaqueMark(180),
    "src/app/favicon.ico": pngToIco(await roundedMark(48), 48),
    "src/app/opengraph-image.png": await openGraph(logoDarkFull),
  };

  for (const [file, buffer] of Object.entries(files)) {
    await writeFile(out(file), buffer);
    console.log(`wrote ${file} (${(buffer.length / 1024).toFixed(1)} KB)`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
