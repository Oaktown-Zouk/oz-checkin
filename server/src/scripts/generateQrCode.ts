// Generates one print-ready kiosk QR code for a given Member Contact ID, with the
// studio logo composited in the center. Usage:
//   npx tsx src/scripts/generateQrCode.ts <contactId> [outputPath]
//
// The QR payload is the bare Contact ID string — the same value
// getEligibleStudentByContactId (services/kiosk.ts) looks members up by, no URL
// wrapper. Encoded at error-correction level H (30% recoverable) specifically so a
// logo can cover part of the code without breaking scans.
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import QRCode from "qrcode";
import sharp from "sharp";

// jsqr ships a plain CommonJS build with an ESM-flavored .d.ts ("export default"),
// which trips up TS's NodeNext resolution (it resolves the import to the whole module
// namespace, not the function) — sidestep it with a plain require instead of `import`.
const require = createRequire(import.meta.url);
const jsQR = require("jsqr") as typeof import("jsqr").default;

const QR_PIXELS = 900; // 3in square at 300dpi, a phone-screen-ish print size.
const LOGO_FRACTION = 0.22; // Of the QR's width — safe headroom under ECC H.
const LOGO_PADDING = 14; // White backing around the logo so it doesn't touch modules directly.
const LOGO_PATH = path.resolve(import.meta.dirname, "../../assets/logo.png");

async function generate(contactId: string, outputPath: string) {
  const qrBuffer = await QRCode.toBuffer(contactId, {
    errorCorrectionLevel: "H",
    margin: 2,
    width: QR_PIXELS,
    // Contact ids are short, so this would otherwise pick the smallest possible
    // version (v1-2, ~21-25 modules) — too coarse a grid for a logo overlay to share
    // safely. Forcing a taller version gives the logo proportionally less of the
    // actual data grid to eat into, and keeps every printed code visually consistent.
    version: 4,
  });

  const logoSize = Math.round(QR_PIXELS * LOGO_FRACTION);
  const logo = await sharp(LOGO_PATH).resize(logoSize, logoSize, { fit: "cover" }).toBuffer();

  const backingSize = logoSize + LOGO_PADDING * 2;
  const backing = await sharp({
    create: { width: backingSize, height: backingSize, channels: 4, background: "#ffffff" },
  })
    .png()
    .toBuffer();

  const center = Math.round((QR_PIXELS - backingSize) / 2);

  const composited = await sharp(qrBuffer)
    .composite([
      { input: backing, left: center, top: center },
      { input: logo, left: center + LOGO_PADDING, top: center + LOGO_PADDING },
    ])
    .png()
    .toBuffer();

  await writeFile(outputPath, composited);

  // Round-trip verification: decode the composited image the same way the kiosk's
  // camera loop would (jsQR against raw RGBA pixel data), so a bad logo-size/padding
  // choice fails loudly here instead of silently at the tablet.
  const raw = await sharp(composited).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const decoded = jsQR(new Uint8ClampedArray(raw.data), raw.info.width, raw.info.height);

  if (!decoded) {
    throw new Error("Generated QR code failed to decode with the logo composited — reduce LOGO_FRACTION.");
  }
  if (decoded.data !== contactId) {
    throw new Error(`Decoded payload "${decoded.data}" doesn't match input contact id "${contactId}".`);
  }

  console.log(`Wrote ${outputPath} (${QR_PIXELS}x${QR_PIXELS}px) — verified it decodes back to "${contactId}".`);
}

const [, , contactId, outputArg] = process.argv;
if (!contactId) {
  console.error("Usage: npx tsx src/scripts/generateQrCode.ts <contactId> [outputPath]");
  process.exit(1);
}
const outputPath = outputArg ?? path.resolve(import.meta.dirname, `../../assets/qr-${contactId}.png`);

generate(contactId, outputPath).catch((err) => {
  console.error(err);
  process.exit(1);
});
