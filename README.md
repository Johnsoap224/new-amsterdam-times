# The New Amsterdam Times

A dependency-free first version of the publication website. It includes a responsive front page, newsletter archive, about page, working article routes, and structured sample content.

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
- `published`: included on the website and newsletter archive

After adding or editing an article, rebuild and validate the browser manifest:

```sh
python3 scripts/build_content.py
python3 scripts/build_content.py --check
```

Set `featured: true` to make a published article the front-page lead; only one published article can be featured. Images are optional and must be supplied by the user. Put supplied images under `assets/images/` and provide accurate `imageAlt` text. The publishing workflow never generates article images.

Preview a review article at:

```text
http://localhost:8080/article.html?slug=ARTICLE-SLUG&preview=1
```

The repository-specific `new-amsterdam-publisher` skill defines the checklist, preview, validation, and publication workflow Codex should follow.

## Current limitation

The subscription form is a front-end demonstration and does not save email addresses yet. Connect it to the selected newsletter provider before launch.
