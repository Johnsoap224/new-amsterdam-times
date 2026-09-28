#!/usr/bin/env python3
"""Validate Markdown articles and build the browser-readable article manifest."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ARTICLE_DIR = ROOT / "content" / "articles"
OUTPUT = ROOT / "content" / "articles.js"
SERVER_OUTPUT = ROOT / "api" / "_articles-data.mjs"
REQUIRED = ("title", "slug", "summary", "author", "date", "category", "status")
VALID_STATUSES = {"draft", "review", "published"}
VALID_CATEGORIES = {"Newsletter", "Articles", "Opinion"}
SERVER_ONLY_FIELDS = {"emailSubject", "emailPreheader", "sendAt", "contentHash"}


class ArticleError(ValueError):
    pass


def parse_scalar(raw: str):
    value = raw.strip()
    if value.lower() in {"true", "false"}:
        return value.lower() == "true"
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
        if value[0] == '"':
            return json.loads(value)
        return value[1:-1].replace("''", "'")
    return value


def parse_article(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        raise ArticleError("must begin with a --- metadata block")

    try:
        metadata_text, body_text = text[4:].split("\n---\n", 1)
    except ValueError as exc:
        raise ArticleError("metadata block is missing its closing ---") from exc

    article = {}
    for line_number, line in enumerate(metadata_text.splitlines(), start=2):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if ":" not in line:
            raise ArticleError(f"line {line_number} must use key: value")
        key, raw_value = line.split(":", 1)
        article[key.strip()] = parse_scalar(raw_value)

    missing = [field for field in REQUIRED if not article.get(field)]
    if missing:
        raise ArticleError(f"missing required metadata: {', '.join(missing)}")

    slug = str(article["slug"])
    if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", slug):
        raise ArticleError("slug must contain lowercase letters, numbers, and hyphens only")

    status = str(article["status"])
    if status not in VALID_STATUSES:
        raise ArticleError(f"status must be one of: {', '.join(sorted(VALID_STATUSES))}")

    category = str(article["category"])
    if category not in VALID_CATEGORIES:
        raise ArticleError(f"category must be one of: {', '.join(sorted(VALID_CATEGORIES))}")

    try:
        datetime.fromisoformat(str(article["date"]).replace("Z", "+00:00"))
    except ValueError as exc:
        raise ArticleError("date must be valid ISO format") from exc

    article["featured"] = bool(article.get("featured", False))
    image = str(article.get("image", "")).strip()
    image_alt = str(article.get("imageAlt", "")).strip()
    if image and not image_alt:
        raise ArticleError("imageAlt is required when image is provided")
    if image:
        image_path = ROOT / image.lstrip("/")
        if not image_path.is_file():
            raise ArticleError(f"image does not exist: {image}")
    article["image"] = image
    article["imageAlt"] = image_alt
    image_fit = str(article.get("imageFit", "cover")).strip()
    if image_fit not in {"cover", "contain"}:
        raise ArticleError("imageFit must be cover or contain")
    article["imageFit"] = image_fit

    email_subject = str(article.get("emailSubject", article["title"])).strip()
    email_preheader = str(article.get("emailPreheader", article["summary"])).strip()
    if not email_subject:
        raise ArticleError("emailSubject cannot be empty when provided")
    if len(email_subject) > 160:
        raise ArticleError("emailSubject must be 160 characters or fewer")
    if len(email_preheader) > 250:
        raise ArticleError("emailPreheader must be 250 characters or fewer")
    article["emailSubject"] = email_subject
    article["emailPreheader"] = email_preheader

    send_at = str(article.get("sendAt", "")).strip()
    if send_at:
        try:
            datetime.fromisoformat(send_at.replace("Z", "+00:00"))
        except ValueError as exc:
            raise ArticleError("sendAt must be valid ISO format") from exc
    article["sendAt"] = send_at

    paragraphs = [
        " ".join(block.splitlines()).strip()
        for block in re.split(r"\n\s*\n", body_text.strip())
        if block.strip()
    ]
    if not paragraphs:
        raise ArticleError("article body cannot be empty")
    article["body"] = paragraphs
    email_content = {
        key: article[key]
        for key in (
            "title", "slug", "summary", "author", "date", "category", "image",
            "imageAlt", "emailSubject", "emailPreheader", "body"
        )
    }
    article["contentHash"] = hashlib.sha256(
        json.dumps(email_content, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()
    return article


def load_articles() -> list[dict]:
    errors = []
    articles = []
    for path in sorted(ARTICLE_DIR.glob("*.md")):
        try:
            articles.append(parse_article(path))
        except ArticleError as exc:
            errors.append(f"{path.relative_to(ROOT)}: {exc}")

    slugs = [article["slug"] for article in articles]
    duplicate_slugs = sorted({slug for slug in slugs if slugs.count(slug) > 1})
    if duplicate_slugs:
        errors.append(f"duplicate slugs: {', '.join(duplicate_slugs)}")

    featured = [
        article["slug"]
        for article in articles
        if article["status"] == "published" and article["featured"]
    ]
    if len(featured) > 1:
        errors.append(f"only one published article may be featured: {', '.join(featured)}")

    if errors:
        raise ArticleError("\n".join(errors))

    return sorted(articles, key=lambda article: article["date"], reverse=True)


def render_manifest(articles: list[dict]) -> str:
    public_articles = [
        {key: value for key, value in article.items() if key not in SERVER_ONLY_FIELDS}
        for article in articles
    ]
    return "window.NAT_ARTICLES = " + json.dumps(public_articles, ensure_ascii=False, indent=2) + ";\n"


def render_server_manifest(articles: list[dict]) -> str:
    return "export default " + json.dumps(articles, ensure_ascii=False, indent=2) + ";\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="validate without changing the manifest")
    args = parser.parse_args()

    try:
        articles = load_articles()
        rendered = render_manifest(articles)
        server_rendered = render_server_manifest(articles)
    except ArticleError as exc:
        print(f"Article validation failed:\n{exc}", file=sys.stderr)
        return 1

    if args.check:
        outputs_current = (
            OUTPUT.exists()
            and OUTPUT.read_text(encoding="utf-8") == rendered
            and SERVER_OUTPUT.exists()
            and SERVER_OUTPUT.read_text(encoding="utf-8") == server_rendered
        )
        if not outputs_current:
            print("Article validation passed, but generated article manifests are out of date.", file=sys.stderr)
            return 1
        print("Article validation passed; both manifests are current.")
        return 0

    OUTPUT.write_text(rendered, encoding="utf-8")
    SERVER_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    SERVER_OUTPUT.write_text(server_rendered, encoding="utf-8")
    print(
        f"Built {len(articles)} articles into {OUTPUT.relative_to(ROOT)} "
        f"and {SERVER_OUTPUT.relative_to(ROOT)}."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
