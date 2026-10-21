# Hosted Instrument app

`app.mystormdesk.com` serves `site/` through the existing Cloudflare Pages project
`stormdesk`. `mystormdesk.com` and `www.mystormdesk.com` serve `marketing/` through
the existing project `mystormdesk`. The production source branch is `cpp-rework`.
The marketing project uses its GitHub integration; the app project uses direct
upload. Keep both on the same reviewed source revision.

The browser uses the Instrument design from the native C++/Qt application:
compact gauges, sun times, the severity-colored NWS banner and full-width HookEcho
radar. A browser cannot run the Qt Widgets desktop executable. The hosted app is
the browser companion, with direct forecast/Tempest access or a paired household
host; the desktop collector remains C++. Never include local settings, station
credentials or archives in either upload.

Validate from the repository root before publishing:

```sh
node scripts/check-browser-compat.mjs
node scripts/check-themes.mjs
node scripts/check-field-instruments.mjs
node scripts/check-shell-cache.mjs
node marketing/tests/carbon-preview.mjs
node marketing/tests/color-studio.mjs
CHROME=chromium bash .github/ci/selftest.sh
```

For the token-import flow, serve `site/` on loopback port 8097 and run
`node scripts/check-instrument-onboarding.cjs` with Playwright available. It uses
isolated browser contexts and fixture credentials to verify single/multiple station
selection, station coordinates/elevation, token-edit invalidation and KFWS selection
without airport TDWR. These fixtures never enter the deployed directories.

Use an authenticated Wrangler session, then deploy the committed directories:

```sh
wrangler pages deploy site --project-name stormdesk --branch cpp-rework
wrangler pages deploy marketing --project-name mystormdesk --branch cpp-rework
```

Confirm each deployment is Production and check both custom domains. Fresh
visitors should see setup; returning to the same origin retains saved station,
theme and scaling preferences. A changed shell-cache version and revalidated code
assets deliver updates without deleting user settings. Native `.wdbak` backups
and the separate Lite companion remain available.

For rollback, use the prior Production deployment in each existing Pages project.
The rollout replaces static application assets; it does not migrate user data or
alter DNS. If moving production back to another source branch, change the Pages
production branch too so the next Git push cannot restore the wrong version.

The screenshots on the product website are recorded live forecast/radar views,
not live widgets. The 4.5.2 installers remain labeled as legacy; they do not contain
the native Qt migration build.
