#!/usr/bin/env python3
"""Copy submitted mandate documents into per-team Google Drive subfolders.

For each polar_push_entries row that has a document but no drive_file_id yet
(and isn't rejected), this downloads the file from the Supabase Storage bucket
and uploads it into `<parent folder>/<team>/`, named by the property address
and mandate type, then records the Drive file id so it's never re-uploaded.

Env:
  SUPABASE_URL, SUPABASE_SERVICE_KEY   Supabase (service-role; reads Storage + DB)
  GCP_SA_JSON                          Google service-account JSON (Drive write)
  MANDATES_DRIVE_FOLDER_ID             id of the parent "Polar Push Mandates" folder
                                       (create it in Drive and share it with the
                                       service-account email as Editor)
"""
import io
import json
import os
import sys

from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseUpload
from supabase import create_client

BUCKET = "polar-mandates"
TYPE_LABEL = {
    "sole": "Sole mandate", "dual": "Dual mandate", "open": "Signed open mandate",
    "otp": "Sale (OTP)", "lease": "Lease",
}


def _need(name: str) -> str:
    v = os.environ.get(name)
    if not v:
        sys.exit(f"Missing required env var: {name}")
    return v


def supabase():
    return create_client(_need("SUPABASE_URL"), _need("SUPABASE_SERVICE_KEY"))


def drive():
    creds = Credentials.from_service_account_info(
        json.loads(_need("GCP_SA_JSON")),
        scopes=["https://www.googleapis.com/auth/drive"],
    )
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def esc(s: str) -> str:
    return (s or "").replace("\\", "\\\\").replace("'", "\\'")


def get_or_create_subfolder(dv, parent_id: str, name: str, cache: dict) -> str:
    if name in cache:
        return cache[name]
    q = (
        f"'{parent_id}' in parents and name = '{esc(name)}' "
        "and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
    )
    found = dv.files().list(q=q, fields="files(id)", pageSize=1,
                            supportsAllDrives=True, includeItemsFromAllDrives=True).execute()
    files = found.get("files", [])
    if files:
        cache[name] = files[0]["id"]
        return cache[name]
    meta = {"name": name, "mimeType": "application/vnd.google-apps.folder", "parents": [parent_id]}
    folder = dv.files().create(body=meta, fields="id", supportsAllDrives=True).execute()
    cache[name] = folder["id"]
    return cache[name]


def filename_for(entry: str, ext: str) -> str:
    return entry + (("." + ext) if ext else "")


def main() -> None:
    # Not armed yet? Skip cleanly (green run) instead of failing every schedule.
    if not (os.environ.get("SUPABASE_SERVICE_KEY") and os.environ.get("GCP_SA_JSON")
            and os.environ.get("MANDATES_DRIVE_FOLDER_ID")):
        print("Drive sync not configured yet (missing GCP_SA_JSON / SUPABASE_SERVICE_KEY / "
              "MANDATES_DRIVE_FOLDER_ID); skipping.")
        return
    parent = _need("MANDATES_DRIVE_FOLDER_ID")
    sb = supabase()
    dv = drive()

    teams = {t["id"]: t["name"] for t in (sb.table("polar_push_teams").select("id,name").execute().data or [])}

    rows = (sb.table("polar_push_entries")
            .select("id,team_id,deal_type,property_address,document_path,document_name,drive_file_id,status")
            .not_.is_("document_path", "null")
            .is_("drive_file_id", "null")
            .neq("status", "rejected")
            .execute().data or [])

    if not rows:
        print("No new mandate documents to copy to Drive.")
        return

    folder_cache: dict = {}
    done, failed = 0, 0
    for e in rows:
        try:
            team = teams.get(e["team_id"], "Unassigned")
            ext = (e.get("document_path") or "").rsplit(".", 1)
            ext = ext[1].lower() if len(ext) == 2 else ""
            addr = (e.get("property_address") or "").strip() or "mandate"
            label = f"{addr} ({TYPE_LABEL.get(e['deal_type'], e['deal_type'])})"
            fname = filename_for(label, ext)

            blob = sb.storage.from_(BUCKET).download(e["document_path"])  # bytes
            sub = get_or_create_subfolder(dv, parent, team, folder_cache)
            media = MediaIoBaseUpload(io.BytesIO(blob), mimetype="application/octet-stream", resumable=False)
            created = dv.files().create(
                body={"name": fname, "parents": [sub]}, media_body=media,
                fields="id", supportsAllDrives=True,
            ).execute()
            sb.table("polar_push_entries").update({"drive_file_id": created["id"]}).eq("id", e["id"]).execute()
            done += 1
        except Exception as ex:  # noqa: BLE001 - keep going on a single bad row
            failed += 1
            print(f"  ! failed for entry {e.get('id')}: {ex}")

    print(f"Mandate Drive sync complete: {done} copied, {failed} failed.")


if __name__ == "__main__":
    main()
