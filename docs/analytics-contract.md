# Analytics contract

`GET /api/analytics` remains authenticated and owner-scoped. Query:

- `days=1..90` (default7; UI presets7/30/90), **or** both `from=YYYY-MM-DD&to=YYYY-MM-DD`; UTC calendar dates from1970-01-01, both inclusive, at most90 days, no future date.
- Optional owned `work=workId`; optional `version=versionId` requires work and must belong to it.
- `excludeSelf=1` excludes the requesting creator from every actor-based measure. Default0.
- `granularity=day|week`, default day. Weeks start Monday in UTC; edge weeks include only selected dates.

Response:

```text
{
  meta:{from,to,previousFrom,previousTo,granularity,timezone:'UTC',excludeSelf,
        scope:'all_works'|'work'|'version',partialToday},
  summary:Metrics, previous:Metrics,
  series:[{date,...Metrics}],
  byWork:[{workId,name,source,currentVersionId,...Metrics}],
  versions:[{id,label,isCurrent}],
  funnel:{visitors,opened,started,supported},
  coverage:{endedStarts,durationSamples,unknownDurationEnds,unendedStarts,
            durationCoverage,versionSocialMetricsAvailable,funnelHostedOnly:true},
  receipts:[...], byDay:[...]
}
Metrics={pv,uv,opens,players,starts,completions,totalActiveMs,avgActiveMs,
         durationSamples,endedStarts,comments,likes,outboundClicks,returningPlayers}
```

`meta` dates and `series.date` are date strings, not timestamps. Weekly `date` is its Monday and can precede `meta.from`. The previous period is the immediately preceding equal number of calendar days. Today is partial, and previous comparisons must label that limitation. Series includes every intersecting bucket, even empty ones. UV/player measures are distinct within each bucket; weekly/overall figures are not sums of daily UV. `byWork` includes all owned works even with zero activity, or only the selected work. Fetch work selector options from the existing owned-work/discover API; `versions` is the selected work's actual versions, newest ordinal first, or[] when no work is selected.

PV/UV count `work_view` by server `received_at`; outboundClicks use outbound events. UV deduplicates the same actor across works. `opens` counts sessions created in the period; `starts` counts those sessions having play_start; `players` deduplicates their actors. Completion and ending measures use the same session-created cohort, including a later accepted completion/end. Completion means client-reported completion, **not verified winning**. `returningPlayers` means cohort actors with play_start on at least two distinct UTC days within the period, not next-day retention.

Duration is available only for a started cohort session with an end event whose `result_json` contains `{timingVersion:1,activeMs:<integer 0..3600000>}`, also bounded by that end's elapsed_ms. `totalActiveMs` sums these samples; `avgActiveMs=totalActiveMs/durationSamples`. Both are null when there are no valid samples. Legacy elapsed_ms, incomplete sessions, and hidden-tab wall time are never substituted. `endedStarts` counts started sessions with an accepted end; coverage reports sampled, unsampled ended, and unended starts. `durationCoverage` is durationSamples/endedStarts or null when no ended start exists.

Comments include roots and replies created in the period. Likes count currently retained like rows created in the period; deleted likes cannot be reconstructed. These tables have no version attribution: with a version filter, comments/likes are null and `versionSocialMetricsAvailable=false`. External-link works have null gameplay measures (opens,players,starts,completions,totalActiveMs,avgActiveMs,durationSamples,endedStarts,returningPlayers), while PV/UV/comments/likes/outboundClicks remain meaningful.

Funnel uses the same period and selected scope, restricted to hosted HTML works: visitors are distinct work-view actors; opened is their intersection with session-open actors **on the same work**; started is their intersection with started sessions on that work. It then deduplicates actors across works. Thus visiting A and opening B alone is not conversion; started≤opened≤visitors. External-only selection returns zero funnel values with `supported:false`; other PV/UV metrics still include external works. With a version filter, all legs are restricted to that version. Funnel is aggregate period overlap, not a claim of ordered causal conversion.

Compatibility fields retained for existing clients: summary/byWork views=pv, feedback (private-feedback count), ends (all ended cohort sessions), cardViews (only all-work scope); byDay retains views/starts and follows requested buckets (legacy requests default to day); receipts remain bounded to30 owner-scoped event/feedback records and carry their real versionId. Top-level `scope:'work_period'` is retained; new clients use meta.scope. New clients should use Metrics and meta. No synthetic insight text, inferred cost, or fabricated duration is added.

Invalid ranges/filter values return422. An unknown work returns404 WORK_NOT_FOUND; a foreign work returns403 NOT_OWNER; version without work returns422 WORK_REQUIRED; unknown/cross-work versions return422 INVALID_VERSION. The query uses parameterized SQL aggregates and one read batch; no migration or raw-event export is required.

Implementation verification: nine SQLite service tests cover distinct counts, cohorts, time samples, filters, ranges and authorization. This D1 runtime accepts at most five terms in an individual compound SELECT (five succeeded, six/seven failed in direct read-only probes). Facts are therefore split into materialized groups of two/four terms, then combined in two terms; period/series/work expansion has three terms. The final query returned200 with real local D1 data after this fix. Node SQLite alone does not reproduce D1's lower limit; the local HTTP integration harness remains required before release.
