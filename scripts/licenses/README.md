# Runtime package license fallbacks

The pinned Rapier and fontkit npm packages omit standalone license files. These version-specific fallbacks are included by `build-notices.mjs`, which fails if a new missing-license package/version appears.

- Rapier 0.19.3: exact upstream license from https://raw.githubusercontent.com/dimforge/rapier.js/v0.19.3/LICENSE.
- Fontkit 1.1.1: its distributed README and package metadata declare MIT; authors are credited without inventing an upstream copyright year. MIT permission terms follow https://spdx.org/licenses/MIT.html. The build script also preserves copyright-bearing comment blocks from its bundled sources, including Brotli's Apache notice. The full Apache terms are included with Rapier above.

All other runtime notices are copied from installed packages under the exact lock. No license fetch is needed during a build.
