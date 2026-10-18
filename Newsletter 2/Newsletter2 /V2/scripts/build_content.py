#!/usr/bin/env python3
"""Validate Markdown articles and build the browser-readable article manifest."""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ARTICLE_DIR = ROOT / "content" / "articles"
OUTPUT = ROOT / "content" / "articles.js"
REQUIRED = ("title", "slug", "summary", "author", "date", "category", "status")
VALID_STATUSES = {"draft", "review", "published"}


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

    paragraphs = [
        " ".join(block.splitlines()).strip()
        for block in re.split(r"\n\s*\n", body_text.strip())
        if block.strip()
    ]
    if not paragraphs:
        raise ArticleError("article body cannot be empty")
    article["body"] = paragraphs
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
    return "window.NAT_ARTICLES = " + json.dumps(articles, ensure_ascii=False, indent=2) + ";\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="validate without changing the manifest")
    args = parser.parse_args()

    try:
        rendered = render_manifest(load_articles())
    except ArticleError as exc:
        print(f"Article validation failed:\n{exc}", file=sys.stderr)
        return 1

    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_text(encoding="utf-8") != rendered:
            print("Article validation passed, but content/articles.js is out of date.", file=sys.stderr)
            return 1
        print("Article validation passed; the manifest is current.")
        return 0

    OUTPUT.write_text(rendered, encoding="utf-8")
    print(f"Built {len(load_articles())} articles into {OUTPUT.relative_to(ROOT)}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
