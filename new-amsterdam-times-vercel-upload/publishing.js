(async function () {
  "use strict";
  const root = document.querySelector("[data-publishing-root]");
  if (!root) return;
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[character]);

  let account;
  try {
    account = await window.NAT_AUTH.requireAccount(["editor", "admin"]);
  } catch (error) {
    root.innerHTML = `<div class="review-empty review-empty--missing"><h1>The account service could not load.</h1><p>${escapeHtml(error.message)}</p></div>`;
    return;
  }
  if (!account.session) {
    window.location.replace(`login.html?next=${encodeURIComponent(`publish.html${window.location.search}`)}`);
    return;
  }
  if (!account.allowed) {
    root.innerHTML = '<div class="review-empty review-empty--missing"><p class="eyebrow">Restricted access</p><h1>Only editors and administrators can open the Publishing Desk.</h1><a class="review-card__action" href="account.html">Back to your account</a></div>';
    return;
  }

  let articles;
  try {
    const response = await fetch("/api/review-articles", { headers: { Authorization: `Bearer ${account.session.access_token}` } });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "The review queue could not load.");
    articles = result.articles || [];
  } catch (error) {
    root.innerHTML = `<div class="review-empty review-empty--missing"><h1>The review queue could not load.</h1><p>${escapeHtml(error.message)}</p></div>`;
    return;
  }

  const selectedSlug = new URLSearchParams(window.location.search).get("slug");
  const dateFormat = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  const articleUrl = (article) => `publish.html?slug=${encodeURIComponent(article.slug)}`;

  function renderQueue() {
    const cards = articles.length ? articles.map((article) => `
      <article class="review-card">
        ${article.image ? `<a class="review-card__image" href="${articleUrl(article)}"><img src="${escapeHtml(article.image)}" alt="${escapeHtml(article.imageAlt)}" /></a>` : ""}
        <div class="review-card__copy">
          <div class="review-card__meta"><span>Waiting for review</span><time datetime="${escapeHtml(article.date)}">${escapeHtml(dateFormat.format(new Date(article.date)))}</time></div>
          <h2><a href="${articleUrl(article)}">${escapeHtml(article.title)}</a></h2>
          <p>${escapeHtml(article.summary)}</p>
          <p class="review-card__byline">By ${escapeHtml(article.author)} · ${escapeHtml(article.category)}</p>
          <a class="review-card__action" href="${articleUrl(article)}">Review article <span aria-hidden="true">→</span></a>
        </div>
      </article>`).join("") : '<div class="review-empty"><p class="eyebrow">Queue clear</p><h2>No articles need review.</h2><p>New submissions will appear here after the website completes its next deployment.</p></div>';
    root.innerHTML = `<header class="publisher-intro publishing-intro"><div><p class="eyebrow">Publishing Desk</p><h1>Submitted articles</h1><p>Review each submitted article before you publish it on the website.</p></div><a class="publisher-secondary-action" href="article-submission.html">New submission</a></header><section class="review-queue" aria-label="Articles waiting for review">${cards}</section>`;
  }

  function renderDetail(article) {
    root.innerHTML = `
      <div class="review-detail-nav"><a href="publish.html"><span aria-hidden="true">←</span> Back to submitted articles</a></div>
      <article class="review-detail">
        <header class="review-detail__header"><p class="eyebrow">Article review</p><h1>${escapeHtml(article.title)}</h1><p class="review-detail__dek">${escapeHtml(article.summary)}</p>
          <dl class="review-detail__facts"><div><dt>Submitted by</dt><dd>${escapeHtml(article.author)}</dd></div><div><dt>Section</dt><dd>${escapeHtml(article.category)}</dd></div><div><dt>Submitted</dt><dd>${escapeHtml(dateFormat.format(new Date(article.date)))}</dd></div></dl>
        </header>
        ${article.image ? `<figure class="review-detail__image"><img src="${escapeHtml(article.image)}" alt="${escapeHtml(article.imageAlt)}" /><figcaption>${escapeHtml(article.imageAlt)}</figcaption></figure>` : ""}
        <div class="review-detail__body">${article.body.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}</div>
      </article>
      <aside class="publication-panel" aria-labelledby="publication-settings-title">
        <div><p class="eyebrow">Final approval</p><h2 id="publication-settings-title">Publication settings</h2><p>Publishing makes this article public on the website. It does not send an email to subscribers.</p></div>
        <form data-publication-form><label class="check-field"><input name="featured" type="checkbox" /><span><strong>Feature this article on the home page</strong><small>This article will replace the current featured article.</small></span></label><div class="publication-panel__submit"><p data-publication-status aria-live="polite"></p><button type="submit">Publish article</button></div></form>
      </aside>`;

    const form = root.querySelector("[data-publication-form]");
    const status = root.querySelector("[data-publication-status]");
    const button = form.querySelector("button[type='submit']");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      button.disabled = true;
      button.textContent = "Publishing…";
      status.className = "publisher-status publisher-status--working";
      status.textContent = "Publishing the article…";
      try {
        const session = await window.NAT_AUTH.getSession();
        if (!session) throw new Error("Your session expired. Sign in again.");
        const response = await fetch("/api/release-article", {
          method: "POST",
          headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ slug: article.slug, featured: data.get("featured") === "on" })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "The article publication failed.");
        status.className = "publisher-status publisher-status--success";
        status.replaceChildren(document.createTextNode("The article is queued for publication. Open it after the new deployment completes. "));
        const link = document.createElement("a");
        link.href = result.articleUrl;
        link.textContent = "Open article";
        status.append(link);
      } catch (error) {
        status.className = "publisher-status publisher-status--error";
        status.textContent = error.message || "The article publication failed.";
        button.disabled = false;
        button.textContent = "Publish article";
      }
    });
  }

  if (!selectedSlug) return renderQueue();
  const article = articles.find((item) => item.slug === selectedSlug);
  if (!article) {
    root.innerHTML = '<div class="review-empty review-empty--missing"><p class="eyebrow">Not available</p><h1>This article is not waiting for review.</h1><a class="review-card__action" href="publish.html">Back to submitted articles</a></div>';
    return;
  }
  renderDetail(article);
}());
