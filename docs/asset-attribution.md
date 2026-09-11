# Asset attribution

The practice venue, field markings, robot chassis, drivetrain components, materials and animations are original procedural work authored for FRC Driver Lab. No photographs, textures, robot CAD or seasonal FRC field models are downloaded at runtime.

## Embedded report font

- **DejaVu Sans**: `public/fonts/DejaVuSans.ttf` (unmodified). Upstream: https://dejavu-fonts.github.io/. The Bitstream Vera font license permits redistribution and embedding; DejaVu changes are public domain and Arev-derived glyph notices also apply. The complete upstream copyright and permission notice ships in `public/fonts/LICENSE-DejaVu.txt`.
- Source of the bundled copy: the local Poppler runtime's DejaVu Sans distribution. This is a redistributable application asset, not an operating-system font dependency.
- PDF generation embeds a subset of this locally bundled font. There is no font CDN or remote PDF conversion service. The font covers Latin, Greek, Cyrillic and additional Unicode characters. A character outside its glyph coverage is represented explicitly as `[U+XXXX]` in PDF; the HTML report preserves the original text and uses the browser's available fonts. This avoids silently omitting names or printing replacement boxes.

## Software

Runtime dependencies and their exact versions are pinned in `package.json` and `package-lock.json`. React, Three.js, Rapier, pdf-lib, fontkit, Lucide and Zod use their declared upstream package licenses. The full upstream runtime notices are also bundled in `public/THIRD_PARTY_NOTICES.txt` and deployed with the site. Every production build regenerates this file with `node scripts/build-notices.mjs`. Version-specific fallbacks for packages omitting license files and their sources are documented in `scripts/licenses/README.md`. These are software dependencies, not licensed images or robot assets. Lucide icons, if used, are distributed under the ISC license. See each installed package's license for its complete terms.

FIRST and FRC are names used to identify the intended robotics education context. This independent simulator does not imply FIRST endorsement, certification, robot fidelity or official assessment status.
