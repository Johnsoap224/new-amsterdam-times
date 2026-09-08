# The New Amsterdam Times — Project Brief

## Product

Build a website for a newsletter called **The New Amsterdam Times**.

The site should feel like a polished, traditional financial newspaper: authoritative, editorial, information-dense, and easy to scan. Use The Wall Street Journal as high-level visual inspiration, but create an original identity rather than copying its branding, layouts, or proprietary assets.

## Initial Scope

Start with the public landing page. It should:

- Present the publication name prominently in a newspaper-style masthead.
- Display published articles in a clear editorial hierarchy, including a lead story and supporting stories where appropriate.
- Let users click an article card or headline to navigate to that article's dedicated page.
- Include primary navigation for **Newsletter** and **About**.
- Make the navigation structure easy to extend with more categories later.
- Work well on desktop, tablet, and mobile.

Dedicated article pages and the full publishing workflow may be implemented after the landing page, but the initial architecture should anticipate both.

## Publishing Experience

Publishing a new article should require very little technical work. Prefer a content-driven system where an article can be added through a simple Markdown/MDX file or a lightweight CMS form rather than by editing page code.

Each article should support, at minimum:

- Title
- Slug
- Author
- Publication date
- Short summary or dek
- Body content
- Category
- Hero image and image alt text
- Featured status for landing-page placement

Article listings on the landing page should be generated automatically from published content and ordered by publication date unless an explicit featured position overrides that order.

Article images are optional and must be supplied by the user. Do not generate article images. When no image is supplied, omit the image area entirely and present only the article's text and links.

When the user asks for an article preview, follow the repository's `new-amsterdam-publisher` skill: provide the intake checklist first and wait for the checklist to be completed before creating the preview.

## Design Direction

- Original newspaper-inspired visual system
- Refined serif typography for the masthead and headlines
- Highly readable body typography
- Mostly neutral palette with restrained accent colors
- Strong grid, fine rules, generous whitespace, and clear hierarchy
- Minimal decoration and animation
- Accessible contrast, keyboard navigation, semantic markup, and useful image alt text

## Architecture Guidelines

- Keep content separate from presentation.
- Define navigation and categories from a central configuration so new sections can be added easily.
- Use reusable components for the header, navigation, article cards, article grids, and footer.
- Use stable, human-readable article URLs.
- Include sensible empty and missing-image states.
- Favor a simple, maintainable solution over unnecessary infrastructure.

## Current Priority

The first deliverable is the landing page with realistic placeholder content and working links to article routes. The page should establish the publication's visual identity and provide a clean foundation for article pages and low-effort publishing.
