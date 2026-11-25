# Tuvora Web

Tuvora's browser app. Fork of [falcononrails/NuvioWeb](https://github.com/falcononrails/NuvioWeb)
(itself a fork of alphasquare404/NuvioWeb), GPL-3.0. The source must stay public.

## What this fork changes

Kept small on purpose, so upstream merges stay cheap:

- **Backend:** `.env.example` and `local.example.properties` point at Tuvora's Supabase
  (publishable key, browser-public). No Nuvio fallback backend.
- **Watch Party:** Tuvora's Supabase counts as the official server. Invite links are
  `https://tuvora.co/party/CODE`, the same as the Tuvora apps. The code box accepts `tuvora.co`, `www.tuvora.co`,
  `tuvora://party/…` and `nuvio://party/…`.
- **Brand:** name, manifest, icons, wordmark and user-visible strings say Tuvora. Identity
  (`scripts/appMetadata.mjs`, `js/core/app/appIdentity.js`) points at `paradox-kush/TuvoraWeb`.
- **Links:** privacy, account and add-on manager links go to tuvora.co.
- **Analytics:** upstream's Umami runs only on `nuvioweb.space`, so it is off here.
- **CI:** upstream's workflows are guarded to `falcononrails/NuvioWeb` and do nothing here. The
  3-hourly upstream-review cron was removed. Docker images are named `ghcr.io/paradox-kush/tuvoraweb*`.

## Remotes

- `org` → `paradox-kush/TuvoraWeb` (push here)
- `upstream` → `falcononrails/NuvioWeb` (merge from here, never rebase)

## Run locally

```sh
cp local.example.properties local.properties
npm ci && npm run build && npm run serve   # http://localhost:4173
npm test                                    # one TMDB age test is timezone-dependent upstream; TZ=UTC npm test is all green
```
