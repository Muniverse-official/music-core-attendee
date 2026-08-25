#!/usr/bin/env python3
"""Purge attendee personal data after verification and guidance are complete.

Dry-run by default. Writes require --apply and the exact --confirm value shown by
this tool. Uses SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
"""
from __future__ import annotations

import argparse
import json
import os
import urllib.error
import urllib.parse
import urllib.request


def request(url: str, key: str, method: str = "GET") -> tuple[int, str]:
    req = urllib.request.Request(url, method=method)
    req.add_header("apikey", key)
    req.add_header("Authorization", f"Bearer {key}")
    req.add_header("Prefer", "return=representation")
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return response.status, response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Supabase HTTP {exc.code}: {body[:500]}") from exc


def count_rows(base: str, key: str, table: str, filters: dict[str, str]) -> int:
    params = {"select": "id", **filters}
    _, body = request(f"{base}/rest/v1/{table}?{urllib.parse.urlencode(params)}", key)
    rows = json.loads(body or "[]")
    return len(rows) if isinstance(rows, list) else 0


def delete_rows(base: str, key: str, table: str, filters: dict[str, str]) -> None:
    query = urllib.parse.urlencode(filters)
    request(f"{base}/rest/v1/{table}?{query}", key, method="DELETE")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--kind", choices=("fans-pick", "music-core"), required=True)
    parser.add_argument("--event-date", help="YYYY-MM-DD; required for Music Core")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--confirm", default="")
    args = parser.parse_args()

    if args.kind == "music-core" and (not args.event_date or len(args.event_date) != 10):
        raise SystemExit("--event-date YYYY-MM-DD is required for Music Core")

    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not base or not key:
        raise SystemExit("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")

    if args.kind == "fans-pick":
        confirmation = "PURGE_FANS_PICK"
        plan = [
            ("cover_pick_attendees", {}),
            ("cover_pick_verification_sessions", {}),
            ("cover_pick_winners", {}),
        ]
    else:
        confirmation = f"PURGE_MUSIC_CORE_{args.event_date}"
        winner_filter = {"event_date": f"eq.{args.event_date}"}
        _, body = request(
            f"{base}/rest/v1/music_core_winners?{urllib.parse.urlencode({'select':'id', **winner_filter})}",
            key,
        )
        winner_ids = [str(row["id"]) for row in json.loads(body or "[]")]
        in_filter = f"in.({','.join(winner_ids)})" if winner_ids else "eq.__no_match__"
        plan = [
            ("music_core_attendees", {"event_date": f"eq.{args.event_date}"}),
            ("music_core_verification_sessions", {"winner_id": in_filter}),
            ("music_core_winners", winner_filter),
        ]

    print("Purge plan:")
    for table, filters in plan:
        print(f"- {table}: {count_rows(base, key, table, filters)} row(s)")
    print(f"Required confirmation: {confirmation}")

    if not args.apply:
        print("Dry run only. Re-run with --apply and --confirm.")
        return 0
    if args.confirm != confirmation:
        raise SystemExit("Confirmation value does not match; nothing deleted")

    for table, filters in plan:
        delete_rows(base, key, table, filters)
    print("Purge complete. Clear the corresponding Google Sheet rows with the Apps Script purge function as well.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
