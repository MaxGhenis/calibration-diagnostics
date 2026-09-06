# Population selection regression

This drives an existing production server with owned headless WebKit. It switches between two immutable candidates through the global selector, checks rendered evidence and both manifest/checkpoint identities, then checks browser Back and Forward at desktop and mobile widths. The prior bug restored the previous candidate's canonical URL; pure URL-helper tests could not detect it.

Build the frontend, stage standalone static/public assets if using standalone mode, and serve the two fixture candidates through the normal quality-directory configuration. No server or source data is created by this script. The checked-in fixture names the local 17,004- and 169-household development exports; it contains only public aggregate identifiers. Supply another fixture with the same shape for other exports.

Run with an already installed playwright-core (no Chrome/CDP):

```sh
POPULATION_NAV_BASE_URL=http://127.0.0.1:4591/calibration/dashboard \
PLAYWRIGHT_CORE_PATH=/path/to/node_modules/playwright-core \
node scripts/population-navigation/verify.mjs /path/to/output.json
```

`POPULATION_NAV_FIXTURE` optionally overrides the fixture path. `POPULATION_NAV_BASE_URL` defaults to localhost:3000/calibration/dashboard. The output records failures as well as successful checks. Numerical source validation, country data availability and release eligibility are separate checks.
