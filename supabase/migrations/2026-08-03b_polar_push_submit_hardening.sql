-- Operation Polar Push - harden the broker submit policy.
-- =================================================================
-- Applied live via the SQL editor; recorded here for repo/prod parity.
--
-- Bug (audit M1): the non-admin submit WITH CHECK only required
--   status='pending' and voided=false and <active staff>
-- so a staffer with the anon key + their JWT could POST directly with no
-- document and an arbitrary deal_type (e.g. deal_type='otp', value=500000000),
-- breaking the "every mandate has a signed doc" and "OTPs come from the sheet"
-- invariants and letting the pending queue be poisoned. (It still could not
-- score - admin verification gates points, and status='pending' already blocks
-- self-verifying inserts.)
--
-- Fix: brokers may only insert a PENDING MANDATE (sole/dual/open) that carries
-- a signed document. Admins (polar_is_admin) and the service-role sheet sync
-- are unaffected.

drop policy if exists "polar_entries: submit" on public.polar_push_entries;
create policy "polar_entries: submit" on public.polar_push_entries for insert to authenticated
with check (
  public.polar_is_admin()
  or (
    status = 'pending'
    and voided = false
    and deal_type in ('sole', 'dual', 'open')   -- brokers submit mandates; OTP/lease come from the sheet sync
    and document_path is not null               -- the signed mandate must be attached
    and exists (
      select 1 from public.staff s
      where s.auth_user_id = auth.uid() and coalesce(s.active, true)
    )
  )
);
