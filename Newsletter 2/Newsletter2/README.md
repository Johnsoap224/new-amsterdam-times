# The New Amsterdam Times

A dependency-free first version of the publication website. It includes a responsive front page, filtered Newsletter, Articles and Editorial archives, an about page, working article routes, and structured sample content.

## Preview locally

From this folder, run:

```sh
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## Article publishing

Articles live as individual Markdown files under `content/articles/`. The metadata field `status` controls visibility:

- `draft`: not visible on the website
- `review`: visible only to editors in the Publishing Desk
- `published`: included on the website and its matching category archive

After adding or editing an article, rebuild and validate the browser manifest:

```sh
python3 scripts/build_content.py
python3 scripts/build_content.py --check
```

Set `featured: true` to make a published article the front-page lead; only one published article can be featured. Images are optional and must be supplied by the user. Put supplied images under `assets/images/` and provide accurate `imageAlt` text. The publishing workflow never generates article images.

Set `category` to `Newsletter`, `Articles` or `Editorial`. Published articles appear in the matching archive, while every category remains eligible for homepage placement.

The repository-specific `new-amsterdam-publisher` skill defines the checklist, preview, validation, and publication workflow Codex should follow.

## Subscriber delivery

The subscription form posts to the Vercel Function at `api/subscribe.mjs`. It stores pending subscribers in Supabase, sends a 24-hour confirmation link through Resend, and creates a Resend contact after confirmation.

Published Markdown articles can also be delivered as full-text newsletters. `scripts/build_content.py` generates both the browser manifest and a server-only ES module under `api/` for `api/newsletter.mjs`. The email includes the complete article, an optional user-supplied image, a canonical website link, a plain-text version, and Resend's unsubscribe link.

Website publication never triggers an email automatically. The safe release sequence is:

1. Publish and deploy the article.
2. Verify its public URL.
3. Send a test to `NEWSLETTER_TEST_RECIPIENT`.
4. Explicitly send now or schedule the subscriber Broadcast.

Apply `supabase/migrations/001_newsletter_delivery.sql` in the Supabase SQL editor before using newsletter delivery. It creates the server-only send ledger that prevents duplicate sends and adds a delivery status field to subscribers.

Configure these variables in Vercel before deploying:

```text
SUPABASE_URL
SUPABASE_SECRET_KEY
SUPABASE_PUBLISHABLE_KEY
RESEND_API_KEY
NEWSLETTER_FROM
PUBLIC_SITE_URL
RESEND_SEGMENT_ID
RESEND_TOPIC_ID (optional)
NEWSLETTER_REPLY_TO (optional)
NEWSLETTER_TEST_RECIPIENT
NEWSLETTER_ADMIN_SECRET
RESEND_WEBHOOK_SECRET
```

`RESEND_SEGMENT_ID` is required for subscriber Broadcasts even though it remains optional for the basic confirmation flow. Use a long, randomly generated `NEWSLETTER_ADMIN_SECRET`; it protects the send endpoint.

Copy `.env.example` into your deployment provider's environment settings—do not commit a populated `.env` file.

## Article submission and publishing

Open `article-submission.html` on the deployed website. Paste the article or select a TXT, Markdown, or DOCX file. Add the lead image and article details, then submit the article.

Sign in with a contributor or editor account before you submit an article. The submission endpoint creates one Git commit. The commit contains the Markdown article, lead image, and server-only article list. Each new article has review status. The website starts a new deployment from that commit.

Open `publish.html` with an editor account to see articles that need review. Select an article to read its complete text and examine its image and details. You can make the article the featured home page article. Publishing changes its status, updates its date, adds it to the public article list, and starts a new website deployment. This action never sends a subscriber email.

Add these settings to Vercel before you use the page:

- `PUBLISH_GITHUB_TOKEN`: A fine-grained GitHub token with Contents read and write access to this repository.
- `PUBLISH_GITHUB_REPOSITORY`: The repository name in `owner/repository` format.
- `PUBLISH_GITHUB_BRANCH`: The deployment branch, such as `main`.
- `SUPABASE_URL`: The Supabase project URL.
- `SUPABASE_SECRET_KEY`: The server-side Supabase secret key.
- `SUPABASE_PUBLISHABLE_KEY`: The browser-safe Supabase publishable key.
- `PUBLIC_SITE_URL`: The public website address.

The server checks the signed-in account for every submission, review, and publication request. A person cannot bypass the assigned role by opening an endpoint directly.

## User accounts

The website has two account roles:

- `contributor`: Can submit articles.
- `editor`: Can submit, review, and publish articles.

There is no reader role. Every new account starts as a contributor.

Apply `supabase/migrations/002_user_accounts.sql` in the Supabase SQL editor. Then enable email and password authentication. Set the Supabase site URL to `PUBLIC_SITE_URL`. Add `PUBLIC_SITE_URL/login.html` to the allowed redirect URLs.

Promote an account to editor after the person creates and confirms the account:

```sql
update public.profiles
set role = 'editor'
where id = (
  select id from auth.users where email = 'editor@example.com'
);
```

Configure custom SMTP in Supabase before launch. You can use the same verified Resend domain, but use a suitable account email address as the sender. Test account confirmation and password reset links on the deployed website.

### Test, send, or schedule

With `PUBLIC_SITE_URL` and `NEWSLETTER_ADMIN_SECRET` available in the shell:

```sh
python3 scripts/newsletter.py test ARTICLE-SLUG
python3 scripts/newsletter.py send ARTICLE-SLUG --confirm
python3 scripts/newsletter.py schedule ARTICLE-SLUG --at 2026-09-22T08:00:00-04:00 --confirm
```

Only published articles are accepted. Production sends are recorded by slug in Supabase; a second send of the same article is rejected. A failed attempt may be retried safely with the same Resend idempotency key.

### Resend setup

In Resend:

1. Verify the sending domain and configure `NEWSLETTER_FROM`.
2. Create a subscriber Segment and set `RESEND_SEGMENT_ID`.
3. Optionally create a Topic and set `RESEND_TOPIC_ID` for preference management.
4. Create a webhook pointing to `https://YOUR_SITE/api/resend-webhook` for `contact.updated`, `email.bounced`, and `email.complained`.
5. Save the webhook signing secret as `RESEND_WEBHOOK_SECRET`.

The signed webhook mirrors unsubscribes, bounces, complaints, and resubscriptions into the Supabase subscriber record. Resend remains authoritative for suppressing recipients from Broadcasts.

The Supabase secret and Resend API key must remain server-side and must never be committed to the repository. Test the complete subscription and confirmation flow on the deployed Vercel site, because the simple local static server does not execute Vercel Functions.
