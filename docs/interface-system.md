# Interface system

The site uses one shared interface system around the original artwork. Feed cards use full, uncropped covers in stable frames; the shell stays quiet. No new external fonts, icon package, or animation dependency is required.

## Components and typography

`public/interaction.css` supplies the shared system font stack, 12/14/28 px caption/body/title scale, 8 px controls, focus ring, button states and popover shadow. Mobile inputs use 16 px to avoid focus zoom. Cover hover/focus reveals the existing View work action; likes remain separate. Touch users can see the same affordance without hover. Buttons, fields, selections and dialogs share 140–220 ms feedback. Reduced-motion disables decorative motion and smooth scrolling.

Feed layout progressively enhances CSS grid with shortest-column placement. DOM and server order remain intact, positions of earlier cards do not change when another page is appended, and cached cover ratios help preserve the visible anchor. Resize/image listeners and observers are disposed on route exit. Search, filters and server ranking semantics are unchanged.

## Language

Chinese is the default. `public/i18n.js` owns the persisted `zh-CN` / `en` preference, explicit text lookup, safe one-pass interpolation and locale-aware dates/numbers. Each feature registers its static interface strings. Never run automatic text replacement on the whole DOM: names, titles, descriptions, comments, release notes, build logs and games remain original content.

The header toggle remounts the current route with its query and scroll position. Drafts and the saved gallery view are retained. Switching language does not record a second work or card view. Active game sessions and in-flight publication/version mutations prevent a language change until they finish. Gallery/collection iframe chrome receives the same locale; immutable saved work/version references are unchanged.

Translation keys shared across modules must have the same meaning and English value. Context-specific metrics use separate keys from action verbs (for example, Started sessions versus Play). Missing translations fall back to source text instead of hiding the message. Technical build logs are not translated.

## Analytics

See `analytics-contract.md` and `analytics-design.md` for aggregation and limitations. The dashboard gives a period overview, previous-period comparison, a selectable trend, work comparison and folded secondary metrics. Unknown duration remains distinct from a real zero. Current traffic is owner/testing traffic; it is not evidence of public adoption.
