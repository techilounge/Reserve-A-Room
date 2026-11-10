# Phase 10: WordPress calendar discovery

Status: **discovery in progress; provider and staging contract not verified**.
Observed on 2026-11-09 using read-only public pages and WordPress REST metadata.
No website content was created, edited, imported, deleted, or synchronized.

## Observed website surfaces

- [Events archive](https://stonehillchurch.org/events/) renders The Events Calendar
  month view, including distinct occurrence links for a recurring Prayer Meeting
  and a series link. Its public page loads assets under `the-events-calendar` and
  `events-calendar-pro`; frontend asset versions indicate 6.18.3.1 and 7.8.0
  respectively. Filter Bar assets indicate 5.6.2. Asset query strings are evidence,
  not a substitute for an administrator checking installed/active plugin versions.
- [Church events page](https://stonehillchurch.org/our-events/) embeds an
  Essential Addons for Elementor Event Calendar widget. The rendered widget's
  `data-events` was empty for November 2026 even though the archive showed Prayer
  Meeting occurrences. This does **not** prove separate databases: widget source,
  filtering, caching or configuration may explain the difference. Essential Addons
  supports multiple source types, including manual entries, Google Calendar and
  The Events Calendar. [Vendor overview](https://essential-addons.com/event-calendar/).
- The owner must identify which page or pages are the intended publication target
  and whether the widget and any homepage event listing share that target's source.

## Public API observations

- The public [WordPress REST index](https://stonehillchurch.org/wp-json/) advertises
  `tribe/events/v1` and `tec/v1` event collections and individual-event routes. It
  lists create, update and delete methods, but advertised methods alone do not prove
  an integration account is authorized, supported, idempotent, or safe to use.
- A read-only GET of the [legacy events collection](https://stonehillchurch.org/wp-json/tribe/events/v1/events)
  returned public occurrence records with numeric IDs, global IDs, local and UTC
  times, timezone, all-day status, title, description and URLs. Recurring instances
  have distinct public IDs and URLs in this response; mutation behavior for series
  and individual occurrences is unverified.
- A read-only GET of `/wp-json/tec/v1/events` returned
  `missing_experimental_endpoint_acknowledgement`. No header override or write was
  attempted. Do not infer that this experimental endpoint is ready for integration.
- The REST index returned an empty `authentication` list. That does **not** prove
  which login methods work: application passwords, security plugins, capabilities,
  proxies and staging access need administrator verification. WordPress documents
  [application-password authentication](https://developer.wordpress.org/rest-api/using-the-rest-api/authentication/),
  but do not create or share credentials until the staging method is agreed.
- The public event response includes meeting access information in existing event
  content. Ask the website owner to confirm that its public exposure is intended;
  never copy such content or access details into fixtures, logs, or this repository.

## Timezone discrepancy to investigate

On the same date, the archive displayed the November 11 recurring Prayer Meeting as
8:00–9:00 PM, while its event API returned 7:00–8:00 PM in `America/Chicago` and
01:00–02:00 UTC the following day. The REST index exposed a blank named timezone
and fixed `gmt_offset` of `-5`; this is a possible explanation, not a confirmed
diagnosis. An administrator should compare the actual WordPress and calendar-plugin
timezone settings and the intended event time before changing anything. Do not
silently adopt a fixed offset for future sync, especially across DST.

## Owner/staging discovery checklist

1. Identify the intended public calendar page(s) and the authoritative source for
   the Elementor widget. In WordPress, inspect **Pages → Events → Edit with
   Elementor → Event Calendar widget → Content/Events**; record its selected source
   and relevant calendar identifier, without saving changes.
2. In **Plugins → Installed Plugins**, record exact active versions of The Events
   Calendar, Events Calendar Pro, Filter Bar, Essential Addons, and any security/API
   plugins that affect authentication. Asset versions above are only hints.
3. In **Settings → General** and The Events Calendar settings, inspect the configured
   timezone and event time-display mode. Confirm the intended Prayer Meeting time and
   investigate the displayed/API mismatch; make changes only with separate authorization.
4. Provide the URL of an **isolated staging site** or identify who can provision one.
   Confirm its database, host and credentials are separate, outbound mail/webhooks are
   disabled, and staging contains disposable, non-sensitive events only. Do not
   assume a clone is isolated, and do not use production events as test fixtures.
5. In staging, identify an approved least-privilege API account and verify the
   supported authentication method and capabilities. Never paste passwords, tokens,
   application passwords, meeting links or personal data in chat or repository files.
6. After confirming staging isolation, test disposable staging-only events for
   create, update, cancellation/unpublish, delete, recurrence and per-occurrence
   behavior. Record request/response **schemas and redacted examples**, event IDs,
   provider error classes, retry/idempotency support, and whether a timeout after a
   successful create can be reconciled without duplication. No production writes.
7. Choose the provider contract only after the source and capabilities are confirmed.
   Design deterministic local logical-occurrence identity to external identity;
   prevent stale jobs from republishing withdrawn events, distinguish safe retry from
   uncertain create outcomes, and ensure provider failures cannot roll back approvals.
8. Implement and test only a gated dry-run/staging foundation, then stop for review.
   Live publishing, production migration, import/reconciliation and Phase 11 remain
   unauthorized. Representative calendar-client checks, real email-provider delivery,
   realistic-scale conflict profiling, and hosted-runtime validation remain release gates.
