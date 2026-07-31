#!/usr/bin/env python3
"""Sync OTP sales from the "Polar project" Google Sheet into polar_push_entries.

Reads the sheet (columns: divisionName, refNumber, acceptanceDate, purchasePrice),
keeps only S-prefix OTP sales accepted on/after the competition start, maps the
division to a competition team, and upserts each as a VERIFIED OTP entry keyed
on its refNumber (so re-runs never duplicate and admin voids are preserved).

Env:
  SUPABASE_URL           e.g. https://dqszbqiimbfvmmnpgpsb.supabase.co
  SUPABASE_SERVICE_KEY   service-role key (write access; bypasses RLS)
  GCP_SA_JSON            Google service-account JSON (share the sheet with its
                         client_email as Viewer)
"""
import json
import os
import sys
from datetime import datetime

import gspread
from google.oauth2.service_account import Credentials
from supabase import create_client

SHEET_ID = "1PUDT1HAdnFp2sgxxgodTlACYC6P_5ribZiomTMtd6IY"
SEASON_START = datetime(2026, 8, 1)          # count OTPs accepted on/after this
OTP_BASE = 4                                  # points per R5m bracket for a sale
BRACKET = 5_000_000

# A few known aliases from the sheet -> competition team name.
ALIASES = {
    "mozzies": "Mosquitoes",
}


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


def parse_date(raw: str):
    raw = (raw or "").strip()
    if not raw:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%Y/%m/%d"):
        try:
            return datetime.strptime(raw, fmt)
        except ValueError:
            continue
    return None


def parse_price(raw) -> float:
    try:
        return float(str(raw).replace(",", "").replace("R", "").strip())
    except (TypeError, ValueError):
        return 0.0


def points_for(price: float) -> int:
    return OTP_BASE * (int(price // BRACKET) + 1)


def main() -> None:
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

        if not ref or not ref.upper().startswith("S"):
            skipped += 1
            continue  # OTP sales only (S-prefix); rentals/other skipped
        d = parse_date(date_raw)
        if d is None or d < SEASON_START:
            skipped += 1
            continue
        key = div.lower()
        name = ALIASES.get(key, div)
        tid = team_id.get(name.strip().lower())
        if tid is None:
            unmatched[div] = unmatched.get(div, 0) + 1
            continue
        price = parse_price(price_raw)
        if price <= 0:
            skipped += 1
            continue

        records.append({
            "team_id": tid,
            "deal_type": "otp",
            "value_rand": price,
            "reference": ref,
            "signed_date": d.date().isoformat(),
            "status": "verified",
            "source": "sheet",
            "submitted_by_name": "OTP sheet",
            "created_by_name": "OTP sheet",
        })

    # De-dup within this batch on reference (sheet can hold repeats).
    seen, deduped = set(), []
    for rec in records:
        if rec["reference"] in seen:
            continue
        seen.add(rec["reference"])
        deduped.append(rec)

    if deduped:
        # Upsert on reference. `points` is a generated column (never sent) and
        # `voided` is omitted so an admin's void survives the next sync.
        for i in range(0, len(deduped), 500):
            chunk = deduped[i:i + 500]
            sb.table("polar_push_entries").upsert(chunk, on_conflict="reference").execute()

    print(f"OTP sync complete: {len(deduped)} qualifying OTP(s) upserted, {skipped} skipped.")
    if unmatched:
        print("Unmatched divisions (no competition team; skipped):")
        for name, n in sorted(unmatched.items(), key=lambda kv: -kv[1]):
            print(f"  {n:>4}  {name}")


if __name__ == "__main__":
    main()
