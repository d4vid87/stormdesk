# Web deployment

The stable web app is the repository's `site/` directory, deployed to Cloudflare Pages project **stormdesk**, with production branch **main** and domain **app.mystormdesk.com**. The **mystormdesk** project is the separate marketing site; do not deploy the application there.

After CI passes and the change is merged to `main`, deploy the matching checkout:

```sh
npx wrangler pages deploy site --project-name stormdesk --branch main --commit-hash "$(git rev-parse HEAD)"
```

Verify the production URL, the gauge style selector and live HookEcho radar. A branch other than `main` creates a preview deployment. Keep the preceding successful production deployment available in Cloudflare Pages for rollback.

Web deployments do not replace native installers or update a user's local collector. Versioned native releases use `.github/workflows/release.yml`; server-only features require a matching desktop/server build. Existing settings, weather archives and the lightweight browser interface remain compatible.
