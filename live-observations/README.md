# Moraga live observations Worker

This directory contains the Cloudflare Worker for the KCAMORAG71 live observation endpoint.

Cloudflare Git integration deploy command:

```sh
npx wrangler deploy --config live-observations/wrangler.toml
```

Configure `XWEATHER_CLIENT_ID` and `XWEATHER_CLIENT_SECRET` as encrypted Worker secrets. The public site should use the Worker `/observations` URL once deployed and tested.

The Worker is separate from GitHub Pages and does not change the archived observation collection workflow.

## Push alerts

`push.js` adds NWS alert push notifications:

- `GET /push/key` returns the VAPID public key (generated once inside the Durable Object; no secret to configure).
- `POST /push/subscribe` with `{subscription, towns}` saves a phone's subscription for the listed towns; `POST /push/unsubscribe` removes it.
- A cron trigger (`*/2 * * * *`) checks `api.weather.gov/alerts/active?point=` for each town and sends each new alert once. Updates/extensions of an alert already sent are not re-sent; an upgrade (e.g. advisory → warning) is.

Storage is the SQLite-backed Durable Object `AlertPush` (free plan); `wrangler deploy` creates it from the migration in `wrangler.toml`.
