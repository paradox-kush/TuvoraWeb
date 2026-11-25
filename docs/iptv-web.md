# Live TV in Tuvora Web

Phase 1 of IPTV / Live TV for the browser app. The native apps (Android, iPhone/iPad, Android TV,
Desktop, Apple TV) remain the full Live TV experience; the web shows what a browser can honestly reach
and hands everything else to the apps or an external player.

## What a browser can and cannot do

| Limit | Effect |
| --- | --- |
| Mixed content | An https page cannot fetch or play `http://` anything. |
| CORS | A provider that sends no `Access-Control-Allow-Origin` cannot be read (the failure is a bare `TypeError`). |
| Forbidden headers | A page cannot set `User-Agent`, `Cookie` or arbitrary headers without a CORS preflight the provider must allow. Stalker portals need `Authorization`, a MAC cookie and device headers. Per-playlist user agents (the WAF HTTP 456 fix) are impossible. |
| Device files | `m3u_file` playlist bytes never sync; only the file name does. |
| Containers | HLS plays through hls.js. Raw MPEG-TS needs mpegts.js (not bundled yet), so an Xtream panel that only allows `.ts` falls back. |

## Measured on prod (2026-11-24)

Counts only. Probes carried no user credentials (dummy Xtream credentials, M3U path without its query),
sent `Origin: https://watch.tuvora.co`, and no host or URL was recorded.

| Source | Playlists | https | Can list in a browser | Can play directly |
| --- | --- | --- | --- | --- |
| Xtream | 3,707 (60%) | 12% | ~12% (every https panel sampled sent CORS) | up to ~12%, needs m3u8 output; edge redirect scheme not verifiable without real credentials |
| M3U URL | 1,786 (29%) | 83% | ~65-79% (61% are public GitHub lists, CORS `*`) | about half the channels in those lists (55% of sampled streams were https + CORS) |
| Stalker | 547 (9%) | 2% | 0% | 0% |
| M3U file | 123 (2%) | n/a | 0% | 0% |
| **All** | **6,163** | | **~27%** | **~15-20%, mostly free lists** |
| Paid providers only | ~4,450 | | ~10% | ≤10% |

Of the reachable Xtream panels, 85% send CORS on `player_api.php`: the blocker for paid providers is
mixed content (http-only panels), not CORS. A self-hosted web build served over plain http would list
~85% of Xtream panels.

## Endpoints used

| What | Endpoint | Who |
| --- | --- | --- |
| Synced playlists | `POST /rest/v1/rpc/sync_pull_iptv_playlists_v2 {p_profile_id}` (same RPC as the apps) | Tuvora backend, user session |
| Xtream login / formats | `player_api.php?username&password` (`user_info.allowed_output_formats`) | provider, bare `fetch`, no Tuvora token |
| Xtream groups / channels | `player_api.php?…&action=get_live_categories`, `get_live_streams` | provider |
| Xtream now/next | `player_api.php?…&action=get_short_epg&stream_id&limit=4`, only for visible rows | provider |
| Xtream stream | `/live/{user}/{pass}/{id}.m3u8` when allowed, else `.ts` | provider, via the player |
| M3U | the playlist URL | provider |

Backend pieces a browser can use without touching providers (not wired in phase 1):

- **EPG mirror control plane** (`epg-sync`): `storage/v1/object/public/epg/manifest.json` and
  `channels-index.json.gz` — public, CORS `*`. The feeds it lists are fetched from their origins:
  `github.com` and `epg.pw` send CORS `*`; `epgshare01.online` and `open-epg.com` do not. This is the
  route to a guide for M3U playlists (phase 2): match `tvg-id` / name against the index, then stream
  only the CORS-friendly feeds through `DecompressionStream("gzip")`.
- **IPTV overlay sync** (`sync_pull_iptv_overlay_delta` / `sync_push_iptv_overlay`): hide / pin /
  reorder / rename keyed on the canon-v1 channel identity (`fp:v1:…`). Using it needs a JS port of
  canon v1 (`research/canon-v1/canon_v1.mjs` is the reference implementation the apps' golden tests
  are pinned to).
- No cached channel lists exist server-side (by design: no playlist bytes are stored).

## Behaviour

- Every load goes through `runBoundedLoad` (playlists 25 s, channel list 25 s, now/next 20 s) and ends
  Loaded, Empty or Failed. A blocked fetch is "this provider doesn't allow web browsers", never "no
  channels". Failed loads are re-asked only by Retry.
- Now/next is delta-shaped and visibility-bound: `planNowNextFetch` asks only for visible rows whose
  programme is missing or over, and the screen wakes once at the earliest programme end while visible.
- Playing hands off to the player (`itemType: "channel"`), which owns hls.js and the browser fallback
  (external players, copy link). Live channels get no "Open in Tuvora app" link until the apps have a
  live route (below).
- Favourites are local per profile in phase 1, keyed by the apps' content id
  (`xtream:{playlist}:live:{channel}`).

## Proposed app route for live channels

`AppUrlBridge` only knows `tuvora://meta`, `party`, `s` (setup) and friends. Proposed:

```
tuvora://live?p=<playlistRef>&c=<entityId>&n=<channel name>
https://tuvora.co/live?p=…&c=…&n=…   (universal-link twin, like /party)
```

- `p`: first 16 hex of SHA-256 of the playlist's `playlist_key`. The key itself must not travel: legacy
  keys were backfilled from `base_url|username`, so they can carry a login. The app hashes its own
  playlist keys to find the match.
- `c`: the canon-v1 entity id (`fp:v1:…`) — already a hash, stable across provider `stream_id`
  renumbering, and the same on every platform.
- `n`: the channel name, for a "can't find this channel" message and a name-match fallback.
- Opens Live TV on that playlist with the channel playing; unknown playlist → Live TV home with a toast.

The web emits this link only once the apps handle it (all five platforms, per the parity rule).

## Not in phase 1

Guide grid beyond now/next, M3U guides (EPG mirror), catch-up, Stalker (impossible without a relay),
mpegts.js for `.ts`-only panels, synced favourites, the overlay (hidden/renamed channels).
