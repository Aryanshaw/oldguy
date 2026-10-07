# Vendored files

`gsap.min.js` is GSAP 3.14.2, copied unchanged from `dist/gsap.min.js` in the npm package
`gsap@3.14.2` (tarball integrity `sha512-P8/mMxVLU7o4+55+1TCnQrPmgjPKnwkzkXOK1asnR9Jg2lna4tEY5qBJjMmAaOBDDZWtlRjBXjLa0w53G/uBLA==`).
Its sha256 is pinned in `tests/chapter.test.cjs`.

`yap narrate` copies it into each chapter folder, and the chapter's `index.html` loads it from there
(`<script src="gsap.min.js">`), so checking and rendering a chapter need no network. Before this, the page loaded it
from `cdn.jsdelivr.net`, which failed wherever that host is blocked. It is a separate file rather than inlined
because the Hyperframes lint scans inline scripts and flags GSAP's own `Math.random()` and `Date.now()`.
`build.json` fingerprints the copy like every other built file.

GSAP is used under its own license (the "no charge" Standard License, https://gsap.com/standard-license), whose
notice stays at the top of the file.

To upgrade: take `dist/gsap.min.js` from the new npm tarball, check the tarball against the registry's integrity
value, and update the version above and the sha256 in the test.
