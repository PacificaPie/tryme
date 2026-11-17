# Funtrack interface system

Scope: light/dark/system appearance, components and motion, honest loading,
discovery and work detail, creator analytics, card discovery and creation.
This document defines the intended behavior; deployment and verification are
recorded separately. Existing works, immutable versions/cards and event
definitions remain authoritative.

## Appearance and hierarchy

- Use semantic surface, text, border, focus and status tokens. Light uses warm
  white surfaces; dark uses distinct charcoal levels, not inverted content.
- Uploaded covers, games and artwork inside authored 3D scenes retain their own
  colors. Navigation, frames, controls, empty states and forms follow appearance.
- Follow the OS by default; explicit light/dark choice persists. Apply before
  first paint and synchronize tabs. Never remount authentication while typing.
- One primary action per step; secondary metadata and management are disclosed
  on demand. A focus ring must be visible in either theme. Touch targets should
  remain usable without hover, including long English labels and 360px screens.

## Interaction inventory

| Interaction | Feedback | Timing / behavior |
| --- | --- | --- |
| Hover / pointer exit | Tone, border, small shadow; work entry reveals its action | 140–220ms; fine pointer only |
| Keyboard focus | 2px focus ring, 4px offset | Immediate; no hidden hover-only requirement |
| Press / release | 1px depression, subtle scale | 100–140ms; disabled controls do not move |
| Select / deselect | Persistent border or filled segment plus native checked/pressed state | 140ms; never color alone |
| Tabs / navigation | Selected indicator follows destination; content enters a few pixels | 220ms; no blocking animation |
| Returning to Feed | Restore cached ordering and scroll position | No repeat entrance animation |
| New Feed items | Short opacity/position entrance | 300ms; capped 140ms stagger; no layout shift |
| Menu / popover | Anchored panel fades in; outside press and Escape close | 140ms; Escape returns focus |
| Dialog | Dim backdrop, short fade and 6px movement | 180ms; native dialog focus and Escape |
| Disclosure | Explicit expand/collapse state | Content available immediately; no artificial delay |
| Form editing / validation | Focus border, local error, preserved inputs | Immediate; no shake animation |
| Submit / retry | Disable duplicate submission and show actual request state | Ends only on response; error restores action |
| Like / unlike | Pressed state and small settle after confirmed update | 240ms; retain dedup/retry rules |
| Share / copy | Confirm copy only after clipboard success | Cancel remains cancel |
| Fast route loading | Keep previous view inert briefly, then replace | No skeleton for requests under 160ms |
| Slow route loading | Destination-shaped skeleton and three quiet play tiles | At 160ms; retry after 6.5s; no fake percentage |
| Feed loading | Masonry-shaped placeholders and same loading motif | Preserve results when refreshing |
| Game loading | Same motif until sandbox bridge reports readiness | Retain timeout/retry; loading is not a play |
| Build / upload | Actual server stage; retry or cancellation where supported | No simulated progress or completion |
| Fullscreen / exit | Existing iframe expands without being recreated | Preserve game and session state |
| Card steps / back | Visible step order; selected works and profile persist | User controlled; no mandatory intro |
| 3D interaction | Existing drag/click threshold, accessible HTML fallback | User controlled; respect reduced motion |
| Notices / success | Brief nonblocking confirmation | 160ms entry; aria-live status |
| Reduced motion | Static loading shapes, instant state changes | All nonessential transitions disabled |

## Information changes

Work detail prioritizes name, author and play action, then the description and
discussion. Version, date, source and creator management live in one disclosure.
A work opened from an immutable card explicitly identifies its saved version.

Analytics prioritizes aggregate visitors/plays/time, the selected time range,
trend and play funnel. Duration sample coverage stays visible. Advanced filters
are folded; self-exclusion describes activity rather than ownership. No inferred
retention, fake diagnoses or uncollected metrics are added.

Cards separate the public browse page from the creation task. The intended flow
is select works → choose a real template → preview/generate → save/share, with
back navigation and draft retention. New templates must render selected works,
support small screens and link to the same pinned version snapshots as existing
templates, rather than merely changing a thumbnail.

References: [reduced motion](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion)
and [view transition considerations](https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API).
Use CSS/local state transitions for this version; no dependency on the newer
view-transition API and no captured screenshot overlays above live games.

## Acceptance matrix

Verify desktop and 360px, Chinese and English, light/dark/system, keyboard and
reduced motion. Cover Feed/search/no results; detail/play/fullscreen/return;
studio works/upload/edit/versions/feedback; analytics empty/data/filter/error;
cards public/zero works/select/reorder/templates/preview/save/shared old cards;
signed-out and actual authentication form. Exercise quick/slow/stale route
loading and failed submissions without corrupting drafts or sessions.
