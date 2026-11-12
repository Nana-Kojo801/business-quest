# Business Quest

A fantasy RPG that teaches a business administration degree through play. Runs in the browser, phone-first in portrait.

**Live build:** https://nana-kojo801.github.io/business-quest/

## Development

```sh
npm install
npm run dev        # local dev server
npm run build      # typecheck + production build
npm test           # Playwright smoke tests (phone portrait + desktop)
```

Every push runs the tests in GitHub Actions; pushes to the default branch also deploy to the live build.
