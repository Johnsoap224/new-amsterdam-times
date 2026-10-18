#!/usr/bin/env python3
"""Send a test, send now, or schedule a published article newsletter."""

from __future__ import annotations

import argparse
import json
import os
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("test", "send", "schedule"))
    parser.add_argument("slug", help="Published article slug")
    parser.add_argument("--at", dest="scheduled_at", help="ISO date/time for schedule mode")
    parser.add_argument(
        "--confirm",
        action="store_true",
        help="Required for a production send or schedule",
    )
    args = parser.parse_args()

    if args.mode in {"send", "schedule"} and not args.confirm:
        parser.error("production sends require --confirm")
    if args.mode == "schedule" and not args.scheduled_at:
        parser.error("schedule mode requires --at")

    site_url = os.environ.get("PUBLIC_SITE_URL", "").rstrip("/")
    endpoint = os.environ.get("NEWSLETTER_ENDPOINT") or (
        f"{site_url}/api/newsletter" if site_url else ""
    )
    admin_secret = os.environ.get("NEWSLETTER_ADMIN_SECRET", "")
    if not endpoint or not admin_secret:
        print(
            "Set PUBLIC_SITE_URL (or NEWSLETTER_ENDPOINT) and NEWSLETTER_ADMIN_SECRET.",
            file=sys.stderr,
        )
        return 2

    payload = {"mode": args.mode, "slug": args.slug}
    if args.scheduled_at:
        payload["scheduledAt"] = args.scheduled_at
    request = Request(
        endpoint,
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {admin_secret}",
            "Content-Type": "application/json",
        },
    )

    try:
        with urlopen(request, timeout=30) as response:
            result = json.load(response)
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        print(f"Newsletter request failed ({exc.code}): {detail}", file=sys.stderr)
        return 1
    except URLError as exc:
        print(f"Could not reach the newsletter service: {exc.reason}", file=sys.stderr)
        return 1

    print(result.get("message", "Newsletter request completed."))
    if result.get("broadcastId"):
        print(f"Broadcast: {result['broadcastId']}")
    if result.get("articleUrl"):
        print(f"Article: {result['articleUrl']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
