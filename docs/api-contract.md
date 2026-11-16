# Funtrack API contract

All endpoints require Sites-injected `oai-authenticated-user-id` and `oai-authenticated-user-email`; missing identity returns 401. No production mock identity is accepted. Local tests must explicitly supply these headers. Every POST also requires an exact same-origin `Origin` (never `null`) and `X-Funtrack-CSRF: 1`. Browser requests use same-origin credentials. Errors are JSON `{error:{code,message}}`, with 400/401/403/404/409/413/415/422/429/503 as appropriate. Responses are `Cache-Control: no-store` unless an immutable media response states otherwise.

`Work = {id,authorId,authorName,name,desc,source:'html'|'url',versionId,version,coverUrl,url?,createdAt}`. IDs are opaque strings. `version` initially is `v1`. Missing cover is `coverUrl:''`. HTML launch is `/game/:versionId`, obtained when creating a session. Existing URL works never report inferred gameplay starts.

| Method / path | Request | Response |
| --- | --- | --- |
| GET `/api/me` | — | `{user:{id,name,bio}}` |
| GET `/api/works` | optional `mine=1` | `{works:Work[]}`; bounded newest first |
| GET `/api/works/:id` | — | `{work:Work}` |
| POST `/api/works` | multipart `name` (1–80), `desc` (1–500), `source` (`html` or `url`), `file` (HTML only), optional `cover`, `url` (URL only); required `Idempotency-Key` of 8–128 URL-safe ASCII characters | 201 `{work}`; same completed key/body returns 200 `{work}`; reused key with different content returns 409 |
| GET `/media/:versionId` or `/api/media/:versionId` | — | Version's cover bytes or 404 |
| GET `/game/:versionId` | — | Isolated uploaded HTML, or 404; version must be HTML |
| POST `/api/sessions` | `{workId,versionId}` | 201 `{id,token,gameUrl,expiresAt}`; HTML only; parent keeps token in memory |
| POST `/api/sessions/:id/events` | `{token,events:[{id,type,seq,elapsedMs?,result?}]}` | `{accepted:[{id,type,workId,receivedAt}],duplicates:[id]}` |
| POST `/api/events` | `{eventId,type:'work_view'|'outbound_click',workId,versionId?}` or `{eventId,type:'card_view',cardId}` | `{receipt:{id,type,workId?,cardId?,receivedAt},duplicate:boolean}` |
| GET `/api/feedback` | optional `work=workId` | `{feedback:[{id,workId,workName,versionId,text,type,authorId,authorName,createdAt}]}` for current user's works only |
| POST `/api/feedback` | `{workId,versionId?,text,type:'喜欢'|'建议'|'问题',eventId?}`; text 1–1000 | 201 `{feedback,receipt:{id,type:'feedback',workId,receivedAt}}`; eventId enables retries |
| GET `/api/analytics` | `days=7` (1–30), optional `work=workId` | `{summary:{views,starts,ends,feedback,cardViews,outboundClicks},byWork:[{workId,name,versionId,source,views,starts,ends,feedback,outboundClicks}],byDay:[{date,views,starts}],receipts:[{id,type,workId?,cardId?,receivedAt}]}` |
| GET `/api/cards` | — | `{cards:Card[]}`; latest published snapshot per author |
| GET `/api/cards/:id` | `id=me` resolves current user's latest snapshot | `{card}` or 404 |
| POST `/api/cards` | `{workIds,template:'fold'|'wall',name,bio}`; 1–30 distinct owned works; name 1–80, bio ≤500; optional `Idempotency-Key` | 201 `{card}`; same key/body returns 200; changed body 409 |

`Card = {id,authorId,name,bio,template,workIds,works:Work[],createdAt}`. Publishing appends an immutable snapshot; generating/changing a client draft has no server effect. Only owned works may be included. No AI calls occur.

Write receipts and session `accepted` items additionally include `clientEventId`, matching the input event ID for client queue acknowledgement. Their `id` is the durable server record ID; `duplicates` contains the client event IDs. Clients must clear pending events using `clientEventId`, not the server ID.

Uploads: self-contained `.html`/`.htm`, MIME `text/html`, UTF-8, at most 1 MiB; cover PNG/JPEG/WebP, at most 2 MiB, matching MIME and magic bytes. R2 writes must finish before a work/version is committed. An unsuccessful upload is never listed as published. HTML external dependencies are blocked by the game CSP. POST multipart body limit is 4 MiB.

Session events: types are only `play_start`, `game_complete`, `session_end`; max 20 events per batch. IDs are 8–128 URL-safe characters, seq is an integer 1–10000, elapsedMs is 0–3,600,000. Session expires after 60 minutes and belongs to the requesting user and exact work version. Duplicate event IDs, sequence numbers, and repeated start/end/completion are not counted again. Start must precede completion. An unplayed session may end without a start; ending never implies a start. `result` may contain a finite numeric `score` and `label` ≤120 characters. Server `receivedAt` is authoritative for receipt time. Accepted client events are self-reported, never verified engagement or verified human counts.

The game response enforces `CSP: sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; child-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'`, plus HTML content type, nosniff, no-store and no-referrer. SDK reads random `bridge` from URL hash and sends `{channel:'funtrack-game',version:1,bridge,type:'ready'|'input'|'complete',result?}` to the exact server-injected parent origin. First trusted input is reported without keys or coordinates. `window.funtrack.complete({score,label})` reports one completion. Parent validates exact iframe window, opaque origin `null` and bridge. Ingest token, user identity and authentication data never enter the child HTML or its URL.

Analytics use server receipt timestamps and UTC date buckets. `views` means stored work-view events; `starts` means sessions with an accepted play_start; `ends` means session_end. URL works return `starts:null, ends:null` in byWork. Feedback counts persistent feedback records. Empty datasets return zeros/empty receipts, not seeded numbers. Latest receipt list is bounded to 30. Optional versionId on page events and feedback must belong to the stated work; omission selects its current version. Private Site access is unchanged.
