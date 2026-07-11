# crashpath demo: quotes

A deliberately buggy TypeScript quote-screening app, shipped the way production
JS actually crashes: **minified**. `dist/bundle.js` throws
`RangeError: spread …bps exceeds limit …` and the stack points at
`bundle.js:1:<col>` — useless on its own.

`trace.txt` is a **pre-recorded** real crash from running the bundle.
crashpath reads `dist/bundle.js.map` and rewrites the frames back to
`src/app.ts` / `src/pricing.ts` (badged *via-sourcemap*), which is the §5.3
demo moment. Paths are sanitized to `/home/dev/quotes/...`; suffix matching
resolves them against this directory. The app is never executed by the demo.
