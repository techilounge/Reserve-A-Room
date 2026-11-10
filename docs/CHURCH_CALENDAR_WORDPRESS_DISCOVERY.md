# Phase 10: WordPress calendar discovery

Status: **discovery in progress; provider and staging contract not verified**.
Observed on 2026-11-09 using read-only public pages and WordPress REST metadata.
No website content was created, edited, imported, deleted, or synchronized.

The owner selected `/events/` as the initial publishing destination and requires a
provider-neutral publishing layer. Reserve-A-Room remains authoritative; the existing
JSON and ICS feeds must remain independent of every external publisher. A future site
may instead consume the JSON feed directly, without synchronization.

The owner confirmed that no staging site currently exists. The hosting provider or
website maintainer must be identified before choosing how to provision one. A separate
local test installation could exercise generic adapter behavior, but does not by itself
verify the church site's installed plugin versions, configuration, hooks or permissions.

Ask the host or site maintainer for an isolated staging copy with a separate database
and URL, access restricted to the testing team, real outgoing mail and external
integrations disabled or redirected, and scheduled jobs disabled or isolated. Use
disposable test events only and do not promote staging changes to production.
WordPress recommends these safeguards in its [staging guide](https://make.wordpress.org/hosting/handbook/reliability/staging/).
Setting `WP_ENVIRONMENT_TYPE` to `staging` identifies the environment to WordPress;
it does not independently guarantee that every plugin or integration is isolated.

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
- `/events/` is the selected initial publication target. Whether the Elementor widget
  or homepage event listing also uses that source remains unknown and must not be
  assumed or changed as part of this work.

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
- The vendor's current v1 source documents [create](https://docs.theeventscalendar.com/reference/classes/tribe__events__rest__v1__endpoints__single_event/create/)
  returning an event response with HTTP 201, [update](https://docs.theeventscalendar.com/reference/classes/tribe__events__rest__v1__endpoints__single_event/update/)
  returning HTTP 200, and [delete](https://docs.theeventscalendar.com/reference/classes/tribe__events__rest__v1__endpoints__single_event/delete/)
  normally moving a post to Trash, with filters able to override that behavior. These
  describe upstream code, not verified behavior of the church's installed version,
  hooks, account capabilities, recurring series, or staging installation. In particular,
  do not equate this delete operation with the owner's public cancellation policy.
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

1. The owner selected `/events/`. If the site owner later wants the Elementor widget
   included, inspect **Pages → Events → Edit with Elementor → Event Calendar widget →
   Content/Events** and record its selected source without saving changes. That widget
   is not the initial integration target.
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

## Provider-neutral implementation contract

This is the owner-approved design direction, not a claim that the provider's write
API or staging environment has been verified. Do not add provider-specific schema or
live dispatch before the discovery gate above is satisfied.

- **Boundary:** public approved occurrence state flows from Reserve-A-Room into a
  provider-neutral publishing layer, then an adapter. The first adapter targets
  The Events Calendar behind `/events/`. WordPress-specific URLs, credentials,
  request fields, IDs, error interpretation and provider metadata stay inside that
  adapter/mapping boundary. Calendar approval, cancellation, publication history,
  JSON and ICS must work without an adapter or a reachable provider.
- **Contract:** define a `CalendarPublisher` capability with create, update, cancel,
  unpublish and health-check operations, using canonical occurrence data and opaque
  provider references. Express unsupported operations and provider capabilities
  explicitly; do not assume that deleting, cancelling, unpublishing or recreating an
  occurrence have equivalent provider behavior. Implement the Events Calendar adapter
  only against verified staging behavior. Preserve timezone, all-day exclusive-end
  meaning, stable local logical occurrence identity, and visibility semantics.
- **Generic records:** once justified by discovery, use append-only migrations for
  generic provider/destination, external-calendar and external-event identity,
  event/logical-occurrence identity, desired revision/state and applied revision,
  operation, job status, attempt count, lease, next attempt, timestamps, sanitized
  response/reference and bounded error classification. Scope uniqueness by provider,
  destination and logical occurrence; enforce external-ID uniqueness within its
  actual provider/destination namespace. Provider-specific details belong in bounded,
  sanitized adapter metadata, never in core domain records or public feed payloads.
- **Reliability:** derive eligible work from approved public state/publication history
  in a separate, replayable producer so external availability and queue-worker failure
  cannot roll back a Church Calendar approval. Advance a durable checkpoint only in
  the transaction that persists its corresponding jobs. Enforce ordered processing
  and current-state rechecks for each occurrence/destination, bounded retry/backoff,
  lease recovery, audit and staff-visible failures. Never allow a stale publish job
  to overwrite a later withdrawal. A lease timeout does not cancel an in-flight
  provider request: if a create may have succeeded but its response was lost, mark
  the outcome uncertain and reconcile using a verified provider-side correlation or
  idempotency mechanism before retrying. Do not invent exactly-once guarantees.
- **Security and rollout:** the first implementation is explicitly dry-run/staging
  only and must be unable to issue writes to production even with misconfigured
  credentials. Confirm the staging hostname, database, account permissions, mail and
  webhooks are isolated before any staging mutation. Keep credentials server-only,
  prevent SSRF/redirect credential leakage, redact logs, bound retained provider
  metadata and use synthetic fixtures. The adapter must never forward planner data,
  internal notes, private URLs or unapproved content.
- **Required verification:** publication, ordinary changed time/title, individual
  cancellation, whole-event withdrawal, public-to-internal, removed occurrence,
  republication, duplicate jobs, stale or reordered work, crash/lease recovery,
  ambiguous provider outcomes, bounded retries, partial failures, safe audit and
  redaction, unsupported provider capabilities, DST/all-day dates, authorization,
  concurrency and disabled live-dispatch behavior. Validate the real provider
  contract only with disposable staging records. The website's existing production
  events must not be imported, modified or overwritten in Phase 10.
