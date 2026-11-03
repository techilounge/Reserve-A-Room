-- These frequencies have no interval in the reservation recurrence contract.
-- Protect both draft writes and immutable submission inserts, including callers
-- that bypass the planner UI. Do not rewrite any pre-existing draft or snapshot:
-- NOT VALID preserves history, while all new/updated rows must obey the rule.
alter table public.calendar_event_schedules
  add constraint calendar_schedules_fixed_interval_check
  check (kind <> 'recurring' or frequency not in ('weekdays', 'yearly_date', 'yearly_nth_weekday')
    or interval_count is not distinct from 1) not valid;

alter table public.calendar_event_submissions
  add constraint calendar_submissions_fixed_interval_check
  check (schedule_kind <> 'recurring' or frequency not in ('weekdays', 'yearly_date', 'yearly_nth_weekday')
    or interval_count is not distinct from 1) not valid;
