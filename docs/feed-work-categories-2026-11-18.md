# Feed hierarchy and work categories

The Feed now starts with search and content categories: All, Personal sites, Games, Other. The redundant header Feed link and visible Explore heading are removed; the brand returns home, and the accessible page heading remains. Following is a reversible filter beside sorting instead of a separate navigation row. Existing masonry and natural cover ratios remain.

Category is independent of `source` (HTML / URL). A URL can be a game; a self-contained HTML file can be a personal site. Authors choose the category when publishing and may change it under the work's display settings. Existing clients that omit the field remain compatible and create Other works. Existing source-filter API requests remain supported; the new UI uses `category`.

## Data and deployment

- Apply additive migration `0017_work_categories.sql` before deploying this application version. It adds a constrained category column and an index to `ft_work_discovery`. Existing explicitly declared games retain that type; other unclassified works default to Other. No category is inferred from hosting method.
- Author category changes share the discovery revision with visibility changes, enforce ownership and active-work status, and reject stale writes. Work revisions, cover jobs, content versions, metadata and saved card snapshots are unaffected.
- Both public and signed-in discovery apply the same category predicate to results and counts. Search, following, author scope and sorting compose with it. Cursors include the category and reject cross-category reuse. Public DTO adds only the category enum.
- Publish idempotency includes an explicitly supplied category; legacy requests retain their previous hash shape. A retry cannot overwrite a later author classification.
- Planned production classification of the three verified listed works: Bingo Website → website (`7cdc2587-38d4-452a-81a7-e18389b818aa`); 隔窗有雨 → game (`b9ea7882-0aaf-4e86-8044-6a00ac5d38ca`); Orbit → game (`138f3ca2-2df0-4dfc-acba-57af0a2c1d76`). Use an explicit guarded update and readback, never a global source-based backfill.
- The old application can run with the added column if rollback is needed. Keep the additive migration and author classifications.

## Validation

- 567 tests passed, including real router/SQLite tests for mixed-source category pagination/counts, cursor isolation, public DTO, invalid input, publication retries, owner/conflict/archived protections, and preservation of visibility/versions/cards.
- Updated historical migration tests seed historical SQL data before migration instead of running the new category-aware application against an obsolete schema. Optional cover-table failure tests still remove the feature's actual tables and verify publication succeeds.
- `npm run check`, production standalone build, and Wrangler deployment dry run passed.
- Browser: Chinese/English Feed; Personal sites returns the single local website; Games + Orbit search returns one result; author display settings successfully save a changed category; publish form requires a category independently of source.
- A 390px iframe harness of the real local app has clientWidth = scrollWidth = 390; search/categories/secondary controls wrap without horizontal overflow. This is a viewport check, not physical phone testing.

The live release and production verification are recorded in the project Notion update.
