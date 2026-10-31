# Moraga live observations Worker

This directory contains the Cloudflare Worker for the KCAMORAG71 live observation endpoint.

Cloudflare Git integration deploy command:

```sh
npx wrangler deploy --config live-observations/wrangler.toml
```

Configure `XWEATHER_CLIENT_ID` and `XWEATHER_CLIENT_SECRET` as encrypted Worker secrets. The public site should use the Worker `/observations` URL once deployed and tested.

The Worker is separate from GitHub Pages and does not change the archived observation collection workflow.
