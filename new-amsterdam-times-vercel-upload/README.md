# The New Amsterdam Times

A dependency-free first version of the publication website. It includes a responsive front page, filtered Newsletter and Opinion archives, an about page, working article routes, and structured sample content.

## Preview locally

From this folder, run:

```sh
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## Article publishing

Articles live as individual Markdown files under `content/articles/`. The metadata field `status` controls visibility:

- `draft`: not visible on the website
- `review`: visible only with the private `?preview=1` article URL
- `published`: included on the website and its matching category archive

After adding or editing an article, rebuild and validate the browser manifest:

```sh
python3 scripts/build_content.py
python3 scripts/build_content.py --check
```

Set `featured: true` to make a published article the front-page lead; only one published article can be featured. Images are optional and must be supplied by the user. Put supplied images under `assets/images/` and provide accurate `imageAlt` text. The publishing workflow never generates article images.

Set `category` to `Newsletter` or `Opinion`. Published articles appear in the matching archive, while both categories remain eligible for homepage placement.

Preview a review article at:

```text
http://localhost:8080/article.html?slug=ARTICLE-SLUG&preview=1
```

The repository-specific `new-amsterdam-publisher` skill defines the checklist, preview, validation, and publication workflow Codex should follow.

## Current limitation

The subscription form posts to the Vercel Function at `api/subscribe.mjs`. It stores pending subscribers in Supabase, sends a 24-hour confirmation link through Resend, and creates a Resend contact after confirmation.

Configure these variables in Vercel before deploying:

```text
SUPABASE_URL
SUPABASE_SECRET_KEY
RESEND_API_KEY
NEWSLETTER_FROM
PUBLIC_SITE_URL
RESEND_SEGMENT_ID (optional)
RESEND_TOPIC_ID (optional)
NEWSLETTER_REPLY_TO (optional)
```

The Supabase secret and Resend API key must remain server-side and must never be committed to the repository. Test the complete subscription and confirmation flow on the deployed Vercel site, because the simple local static server does not execute Vercel Functions.
