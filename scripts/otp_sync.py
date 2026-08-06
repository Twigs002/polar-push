#!/usr/bin/env python3
"""Sync OTP sales + rentals from the "Polar project" Google Sheet into polar_push_entries.

Reads the sheet (columns: divisionName, refNumber, acceptanceDate, purchasePrice)
and upserts, for the competition window (01 Aug - 30 Sep 2026):
  * S-prefix rows  -> VERIFIED 'otp'   entries  (sales)
  * R-prefix rows  -> VERIFIED 'lease' entries  (rentals; the DB scores leases on
                                                 DOUBLE their value)
Each is keyed on its refNumber so re-runs never duplicate and admin voids/rejects
are preserved. Rental divisions come through as "Rentals - <Team>" - the leading
"Rentals" label is stripped before matching the division to a competition team.

Env:
  SUPABASE_URL           e.g. https://dqszbqiimbfvmmnpgpsb.supabase.co
  SUPABASE_SERVICE_KEY   service-role key (write access; bypasses RLS)
  GCP_SA_JSON            Google service-account JSON (share the sheet with its
                         client_email as Viewer)
"""
import json
import os
import re
import sys
from datetime import datetime

import gspread
from google.oauth2.service_account import Credentials
from supabase import create_client

SHEET_ID = "1PUDT1HAdnFp2sgxxgodTlACYC6P_5ribZiomTMtd6IY"
SEASON_START = datetime(2026, 8, 1)          # count deals accepted on/after this
SEASON_END = datetime(2026, 9, 30)           # ...up to and including this day
OTP_BASE = 4                                  # points per R5m bracket for a sale
BRACKET = 5_000_000

# ref prefix -> competition deal type. S = sale (OTP), R = rental (lease).
# Everything else (e.g. C = commercial) is not part of the competition.
DEAL_TYPE_BY_PREFIX = {"S": "otp", "R": "lease"}

# A few known aliases from the sheet -> competition team name.
ALIASES = {
    "mozzies": "Mosquitoes",
}


def team_name_from_division(div: str) -> str:
    """Normalise a sheet divisionName to a competition team name.

    Rentals arrive as "Rentals - <Team>" (with messy spacing/dashes, e.g.
    "Rentals- Navy Seals", "Rentals -Teen Titans", "Rentals -  Gucci Girls").
    Strip the leading "Rentals" label and collapse whitespace so the remainder
    matches the bare team name; sales divisions pass through unchanged.
    """
    s = re.sub(r"\s+", " ", str(div or "")).strip()
    s = re.sub(r"(?i)^rentals\b\s*-?\s*", "", s).strip()
    return s


def _need(name: str) -> str:
    v = os.environ.get(name)
    if not v:
        sys.exit(f"Missing required env var: {name}")
    return v


def gspread_client() -> gspread.Client:
    creds = Credentials.from_service_account_info(
        json.loads(_need("GCP_SA_JSON")),
        scopes=[
            "https://www.googleapis.com/auth/spreadsheets.readonly",
            "https://www.googleapis.com/auth/drive.readonly",
        ],
    )
    return gspread.authorize(creds)


def supabase():
    return create_client(_need("SUPABASE_URL"), _need("SUPABASE_SERVICE_KEY"))


# Accepted date formats. ISO first, then ZA front-office display formats.
# NB: day-first (%d/%m/%Y) is deliberate — this is a South African sheet, so
# 01/08/2026 means 1 August, not 8 January.
_DATE_FORMATS = (
    "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d", "%Y/%m/%d",
    "%d/%m/%Y", "%d/%m/%y", "%d-%m-%Y",
    "%d %B %Y", "%d %b %Y",
)


def parse_date(raw: str):
    raw = re.sub(r"\s+", " ", str(raw or "")).strip()
    if not raw:
        return None
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(raw, fmt)
        except ValueError:
            continue
    return None


def parse_price(raw) -> float:
    # Strip currency symbol and any thousands grouping (spaces, NBSP,
    # commas: "R5 000 000", "5,000,000"); keep the decimal point.
    s = re.sub(r"[^\d.]", "", str(raw))
    try:
        return float(s) if s not in ("", ".") else 0.0
    except (TypeError, ValueError):
        return 0.0


def main() -> None:
    # Not armed yet? Skip cleanly (green run) instead of failing every schedule.
    if not (os.environ.get("SUPABASE_SERVICE_KEY") and os.environ.get("GCP_SA_JSON")):
        print("OTP sync not configured yet (missing GCP_SA_JSON / SUPABASE_SERVICE_KEY); skipping.")
        return
    sb = supabase()

    # team name (lowercased) -> id
    teams = sb.table("polar_push_teams").select("id,name").execute().data or []
    team_id = {t["name"].strip().lower(): t["id"] for t in teams}

    gc = gspread_client()
    ws = gc.open_by_key(SHEET_ID).get_worksheet(0)
    rows = ws.get_all_values()
    if not rows:
        print("Sheet is empty; nothing to sync.")
        return
    body = rows[1:]  # drop header

    records, skipped, unmatched = [], 0, {}
    for r in body:
        div = (r[0] if len(r) > 0 else "").strip()
        ref = (r[1] if len(r) > 1 else "").strip()
        date_raw = r[2] if len(r) > 2 else ""
        price_raw = r[3] if len(r) > 3 else ""

        deal_type = DEAL_TYPE_BY_PREFIX.get(ref[:1].upper()) if ref else None
        if deal_type is None:
            skipped += 1
            continue  # sales (S) + rentals (R) only; commercial/other skipped
        d = parse_date(date_raw)
        if d is None or d < SEASON_START or d.date() > SEASON_END.date():
            skipped += 1
            continue
        base = team_name_from_division(div)
        name = ALIASES.get(base.lower(), base)
        tid = team_id.get(name.strip().lower())
        if tid is None:
            unmatched[div] = unmatched.get(div, 0) + 1
            continue
        price = parse_price(price_raw)
        if price <= 0:
            skipped += 1
            continue

        label = "Rental sheet" if deal_type == "lease" else "OTP sheet"
        records.append({
            "team_id": tid,
            "deal_type": deal_type,
            "value_rand": price,
            "reference": ref,
            "signed_date": d.date().isoformat(),
            "status": "verified",
            "source": "sheet",
            "submitted_by_name": label,
            "created_by_name": label,
        })

    # De-dup within this batch on reference (sheet can hold repeats).
    seen, deduped = set(), []
    for rec in records:
        if rec["reference"] in seen:
            continue
        seen.add(rec["reference"])
        deduped.append(rec)

    # Preserve admin decisions: if an admin has REJECTED a sheet OTP, keep it
    # rejected rather than re-verifying it every run. (voided/points survive by
    # omission; value_rand/team_id remain sheet-driven by design.)
    rejected = set()
    refs = [rec["reference"] for rec in deduped]
    for i in range(0, len(refs), 200):
        part = refs[i:i + 200]
        existing = (sb.table("polar_push_entries")
                    .select("reference,status").in_("reference", part).execute().data or [])
        rejected.update(row["reference"] for row in existing if row.get("status") == "rejected")
    for rec in deduped:
        if rec["reference"] in rejected:
            rec["status"] = "rejected"

    if deduped:
        # Upsert on reference. `points` is a generated column (never sent) and
        # `voided` is omitted so an admin's void survives the next sync.
        for i in range(0, len(deduped), 500):
            chunk = deduped[i:i + 500]
            sb.table("polar_push_entries").upsert(chunk, on_conflict="reference").execute()

    n_otp = sum(1 for rec in deduped if rec["deal_type"] == "otp")
    n_lease = sum(1 for rec in deduped if rec["deal_type"] == "lease")
    print(f"Sync complete: {len(deduped)} upserted "
          f"({n_otp} OTP, {n_lease} rental), {skipped} skipped.")
    if unmatched:
        print("Unmatched divisions (no competition team; skipped):")
        for name, n in sorted(unmatched.items(), key=lambda kv: -kv[1]):
            print(f"  {n:>4}  {name}")


if __name__ == "__main__":
    main()
