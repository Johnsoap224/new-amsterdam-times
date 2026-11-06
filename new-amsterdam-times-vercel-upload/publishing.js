(async function () {
  "use strict";
  const root = document.querySelector("[data-publishing-root]");
  if (!root) return;
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[character]);
  const renderBody = (article) => article.body.map((block) => {
    if (typeof block !== "string" && block?.type === "image") {
      return `<figure class="review-inline-image"><img src="${escapeHtml(block.src)}" alt="${escapeHtml(block.alt)}" loading="lazy" /></figure>`;
    }
    if (typeof block !== "string" && block?.type === "heading") {
      const level = Math.min(6, Math.max(2, Number(block.level) || 2));
      return `<h${level}>${escapeHtml(block.text)}</h${level}>`;
    }
    if (typeof block !== "string" && block?.type === "list-item") {
      return `<p class="review-list-item">${block.ordered ? "1." : "•"} ${escapeHtml(block.text)}</p>`;
    }
    if (typeof block !== "string" && block?.type === "table" && Array.isArray(block.rows)) {
      const [header, ...rows] = block.rows;
      return `<div class="article-table-scroll" role="region" aria-label="Article data table" tabindex="0"><table class="article-data-table"><thead><tr>${header.map((cell) => `<th scope="col">${escapeHtml(cell)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${header.map((_, index) => `<td data-label="${escapeHtml(header[index])}">${escapeHtml(row[index] || "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    }
    return `<p>${escapeHtml(block)}</p>`;
  }).join("");
  const bodyEditorText = (article) => article.body.map((block) => {
    if (typeof block === "string") return block;
    if (block?.type === "image") return `![${block.alt}](${block.src})`;
    if (block?.type === "heading") return `${"#".repeat(Math.min(6, Math.max(1, Number(block.level) || 2)))} ${block.text}`;
    if (block?.type === "list-item") return `${block.ordered ? "1." : "-"} ${block.text}`;
    if (block?.type === "table" && Array.isArray(block.rows)) {
      const rows = block.rows.map((row) => Array.isArray(row) ? row : []);
      const columnCount = Math.max(0, ...rows.map((row) => row.length));
      const formatRow = (row) => `| ${Array.from({ length: columnCount }, (_, index) => String(row[index] || "").replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim()).join(" | ")} |`;
      if (!columnCount) return "";
      const [header = [], ...bodyRows] = rows;
      return [formatRow(header), `| ${Array(columnCount).fill("---").join(" | ")} |`, ...bodyRows.map(formatRow)].join("\n");
    }
    return String(block?.text || "");
  }).join("\n\n");

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
  let publishedArticles;
  let rejectedArticles;
  try {
    const response = await fetch("/api/review-articles", { headers: { Authorization: `Bearer ${account.session.access_token}` } });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "The review queue could not load.");
    articles = result.articles || [];
    publishedArticles = result.publishedArticles || [];
    rejectedArticles = result.rejectedArticles || [];
  } catch (error) {
    root.innerHTML = `<div class="review-empty review-empty--missing"><h1>The review queue could not load.</h1><p>${escapeHtml(error.message)}</p></div>`;
    return;
  }

  const selectedSlug = new URLSearchParams(window.location.search).get("slug");
  const dateFormat = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  const articleUrl = (article) => `publish.html?slug=${encodeURIComponent(article.slug)}`;

  function renderQueue() {
    const reviewCards = articles.map((article) => `
      <article class="review-card">
        ${article.image ? `<a class="review-card__image" href="${articleUrl(article)}"><img src="${escapeHtml(article.image)}" alt="${escapeHtml(article.imageAlt)}" /></a>` : ""}
        <div class="review-card__copy">
          <div class="review-card__meta"><span>Waiting for review</span><time datetime="${escapeHtml(article.date)}">${escapeHtml(dateFormat.format(new Date(article.date)))}</time></div>
          <h2><a href="${articleUrl(article)}">${escapeHtml(article.title)}</a></h2>
          <p>${escapeHtml(article.summary)}</p>
          <p class="review-card__byline">By ${escapeHtml(article.author)} · ${escapeHtml(article.category)}</p>
          <a class="review-card__action" href="${articleUrl(article)}">Review article <span aria-hidden="true">→</span></a>
        </div>
      </article>`).join("");
    const publishedCards = publishedArticles.map((article) => `
      <article class="review-card">
        ${article.image ? `<a class="review-card__image" href="${articleUrl(article)}"><img src="${escapeHtml(article.image)}" alt="${escapeHtml(article.imageAlt)}" /></a>` : ""}
        <div class="review-card__copy">
          <div class="review-card__meta"><span>Published</span><time datetime="${escapeHtml(article.date)}">${escapeHtml(dateFormat.format(new Date(article.date)))}</time></div>
          <h2><a href="${articleUrl(article)}">${escapeHtml(article.title)}</a></h2>
          <p>${escapeHtml(article.summary)}</p>
          <p class="review-card__byline">By ${escapeHtml(article.author)} · ${escapeHtml(article.category)}</p>
          <a class="review-card__action" href="${articleUrl(article)}">Manage article <span aria-hidden="true">→</span></a>
        </div>
      </article>`).join("");
    const rejectedCards = rejectedArticles.map((article) => `
      <article class="review-card review-card--rejected">
        ${article.image ? `<div class="review-card__image"><img src="${escapeHtml(article.image)}" alt="${escapeHtml(article.imageAlt)}" /></div>` : ""}
        <div class="review-card__copy">
          <div class="review-card__meta"><span>Rejected</span><time datetime="${escapeHtml(article.date)}">${escapeHtml(dateFormat.format(new Date(article.date)))}</time></div>
          <h2>${escapeHtml(article.title)}</h2>
          <p>${escapeHtml(article.summary)}</p>
          <p class="review-card__byline">By ${escapeHtml(article.author)} · ${escapeHtml(article.category)}</p>
        </div>
      </article>`).join("");
    const reviewContent = reviewCards || '<div class="review-empty"><h2>No articles need review.</h2><p>New submissions will appear here after the website completes its next deployment.</p></div>';
    const publishedContent = publishedCards || '<div class="review-empty"><p>No published articles.</p></div>';
    const rejectedContent = rejectedCards || '<div class="review-empty"><p>No rejected submissions.</p></div>';
    root.innerHTML = `<header class="publisher-intro publishing-intro"><div><p class="eyebrow">Publishing Desk</p><h1>Articles</h1><p>Review submissions or manage published articles.</p></div><a class="publisher-secondary-action" href="article-submission.html">New submission</a></header><section class="review-section" aria-labelledby="review-queue-title"><h2 id="review-queue-title">Submitted for review</h2><div class="review-queue" aria-label="Articles waiting for review">${reviewContent}</div></section><section class="review-section" aria-labelledby="published-articles-title"><h2 id="published-articles-title">Published articles</h2><div class="review-queue" aria-label="Published articles">${publishedContent}</div></section><section class="review-section" aria-labelledby="rejected-articles-title"><h2 id="rejected-articles-title">Rejected submissions</h2><div class="review-queue" aria-label="Rejected submissions">${rejectedContent}</div></section>`;
  }

  function renderDetail(article) {
    root.innerHTML = `
      <div class="review-detail-nav"><a href="publish.html"><span aria-hidden="true">←</span> Back to submitted articles</a></div>
      <article class="review-detail">
        <header class="review-detail__header"><p class="eyebrow">Article review</p><h1>${escapeHtml(article.title)}</h1><p class="review-detail__dek">${escapeHtml(article.summary)}</p>
          <dl class="review-detail__facts"><div><dt>Submitted by</dt><dd>${escapeHtml(article.author)}</dd></div><div><dt>Section</dt><dd>${escapeHtml(article.category)}</dd></div><div><dt>Submitted</dt><dd>${escapeHtml(dateFormat.format(new Date(article.date)))}</dd></div></dl>
        </header>
        ${article.image ? `<figure class="review-detail__image"><img src="${escapeHtml(article.image)}" alt="${escapeHtml(article.imageAlt)}" /><figcaption>${escapeHtml(article.imageAlt)}</figcaption></figure>` : ""}
        <div class="review-detail__body">${renderBody(article)}</div>
      </article>
      <details class="article-edit-panel">
        <summary>Edit this article</summary>
        <form data-article-edit-form>
          <label class="field"><span>Headline</span><input name="title" maxlength="180" required value="${escapeHtml(article.title)}" /><small>The article link stays the same if you change the headline.</small></label>
          <label class="field"><span>Description</span><textarea name="summary" maxlength="400" required>${escapeHtml(article.summary)}</textarea></label>
          <label class="field"><span>Author</span><input name="author" maxlength="100" required value="${escapeHtml(article.author)}" /></label>
          ${article.image ? `<label class="field"><span>Lead image description</span><input name="imageAlt" maxlength="250" required value="${escapeHtml(article.imageAlt)}" /><small>This text helps readers who use a screen reader.</small></label>` : `<input name="imageAlt" type="hidden" value="${escapeHtml(article.imageAlt || "Article image")}" />`}
          <label class="field"><span>Article text</span><textarea class="article-edit-body" name="body" maxlength="50000" required>${escapeHtml(bodyEditorText(article))}</textarea><small>Use a blank line between blocks. Start headings with #. Keep tables in Markdown table format. Keep imported images in the form ![description](image path). Check PDF table and figure placement against the source; move each block to the matching passage.</small></label>
          <div class="publication-panel__submit"><p data-edit-status aria-live="polite"></p><button type="submit">Save edits</button></div>
        </form>
      </details>
      <aside class="publication-panel" aria-labelledby="publication-settings-title">
        <div><p class="eyebrow">Final approval</p><h2 id="publication-settings-title">Publication settings</h2><p>Choosing Newsletter publishes the article to the website, then emails the subscriber list after the deployment is ready. Articles and Editorial publish to the website only.</p></div>
        <form data-publication-form><label class="field"><span>Publish in</span><select name="category" required><option value="Articles" ${article.category === "Articles" ? "selected" : ""}>Articles</option><option value="Newsletter" ${article.category === "Newsletter" ? "selected" : ""}>Newsletter</option><option value="Editorial" ${article.category === "Editorial" ? "selected" : ""}>Editorial</option></select></label><label class="check-field"><input name="featured" type="checkbox" /><span><strong>Feature this article on the home page</strong><small>This article will replace the current featured article.</small></span></label><div class="publication-panel__submit"><p data-publication-status aria-live="polite"></p><button type="submit">Publish article</button><button type="button" data-newsletter-retry hidden>Retry newsletter send</button></div></form>
      </aside>
      <aside class="publication-panel publication-panel--reject" aria-labelledby="reject-title">
        <div><p class="eyebrow">Review decision</p><h2 id="reject-title">Reject this submission</h2><p>The article will leave the review queue and appear in Rejected submissions.</p></div>
        <div class="publication-panel__submit"><p data-reject-status aria-live="polite"></p><button type="button" data-reject-article>Reject article</button></div>
      </aside>`;

    const form = root.querySelector("[data-publication-form]");
    const status = root.querySelector("[data-publication-status]");
    const button = form.querySelector("button[type='submit']");
    const retryButton = form.querySelector("[data-newsletter-retry]");
    const editForm = root.querySelector("[data-article-edit-form]");
    const editStatus = root.querySelector("[data-edit-status]");
    const rejectButton = root.querySelector("[data-reject-article]");
    const rejectStatus = root.querySelector("[data-reject-status]");
    let publishedArticleUrl = "";
    let newsletterAccessToken = "";

    editForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const saveButton = editForm.querySelector("button[type='submit']");
      const fields = new FormData(editForm);
      saveButton.disabled = true;
      saveButton.textContent = "Saving…";
      editStatus.className = "publisher-status publisher-status--working";
      editStatus.textContent = "Saving article edits…";
      try {
        const session = await window.NAT_AUTH.getSession();
        if (!session) throw new Error("Your session expired. Sign in again.");
        const response = await fetch("/api/release-article", {
          method: "POST",
          headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "edit",
            slug: article.slug,
            article: {
              title: fields.get("title"),
              summary: fields.get("summary"),
              author: fields.get("author"),
              imageAlt: fields.get("imageAlt"),
              body: fields.get("body")
            }
          })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "The article edits could not be saved.");
        Object.assign(article, result.article);
        root.querySelector(".review-detail__header h1").textContent = article.title;
        root.querySelector(".review-detail__dek").textContent = article.summary;
        root.querySelector(".review-detail__facts div:first-child dd").textContent = article.author;
        const leadImage = root.querySelector(".review-detail__image");
        if (leadImage) {
          leadImage.querySelector("img").alt = article.imageAlt;
          leadImage.querySelector("figcaption").textContent = article.imageAlt;
        }
        root.querySelector(".review-detail__body").innerHTML = renderBody(article);
        editStatus.className = "publisher-status publisher-status--success";
        editStatus.textContent = "Edits saved. Review the updated article, then publish it when ready.";
        saveButton.textContent = "Save edits";
        saveButton.disabled = false;
      } catch (error) {
        editStatus.className = "publisher-status publisher-status--error";
        editStatus.textContent = error.message || "The article edits could not be saved.";
        saveButton.textContent = "Save edits";
        saveButton.disabled = false;
      }
    });

    rejectButton.addEventListener("click", async () => {
      if (!window.confirm(`Reject “${article.title}”? The submission will leave the review queue.`)) return;
      rejectButton.disabled = true;
      rejectButton.textContent = "Rejecting…";
      rejectStatus.className = "publisher-status publisher-status--working";
      rejectStatus.textContent = "Saving the review decision…";
      try {
        const session = await window.NAT_AUTH.getSession();
        if (!session) throw new Error("Your session expired. Sign in again.");
        const response = await fetch("/api/release-article", {
          method: "POST",
          headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ action: "reject", slug: article.slug })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "The submission could not be rejected.");
        rejectButton.textContent = "Rejection saved";
        rejectStatus.className = "publisher-status publisher-status--success";
        rejectStatus.textContent = "The article will leave the review queue after deployment.";
      } catch (error) {
        rejectButton.disabled = false;
        rejectButton.textContent = "Reject article";
        rejectStatus.className = "publisher-status publisher-status--error";
        rejectStatus.textContent = error.message || "The submission could not be rejected.";
      }
    });

    async function waitForArticleDeployment(accessToken) {
      const deadline = Date.now() + 120000;
      while (Date.now() < deadline) {
        let response;
        try {
          response = await fetch("/api/review-articles", {
            headers: { Authorization: `Bearer ${accessToken}` },
            cache: "no-store"
          });
        } catch {
          await new Promise((resolve) => window.setTimeout(resolve, 2000));
          continue;
        }
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "The article queue could not be checked.");
        if (!(result.articles || []).some((item) => item.slug === article.slug)) return;
        await new Promise((resolve) => window.setTimeout(resolve, 2000));
      }
      throw new Error("The article is published, but its deployment is still in progress. The newsletter has not been sent.");
    }

    async function sendNewsletter() {
      retryButton.disabled = true;
      status.className = "publisher-status publisher-status--working";
      status.textContent = "Waiting for the article deployment before emailing subscribers…";
      try {
        await waitForArticleDeployment(newsletterAccessToken);
        const response = await fetch("/api/newsletter", {
          method: "POST",
          headers: { Authorization: `Bearer ${newsletterAccessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "send", slug: article.slug })
        });
        const result = await response.json();
        if (!response.ok) {
          const alreadySent = response.status === 409 && /status: (queued|sent|scheduled)/i.test(result.error || "");
          if (!alreadySent) throw new Error(result.error || "The newsletter could not be sent.");
        }
        retryButton.hidden = true;
        status.className = "publisher-status publisher-status--success";
        status.textContent = response.ok ? "The article is live and the newsletter is queued for subscribers." : "The newsletter was already queued for subscribers.";
      } catch (error) {
        status.className = "publisher-status publisher-status--error";
        status.textContent = `The article is live, but the newsletter was not sent: ${error.message}`;
        retryButton.hidden = false;
        retryButton.disabled = false;
      }
    }

    retryButton.addEventListener("click", async () => {
      try {
        const session = await window.NAT_AUTH.getSession();
        if (!session) throw new Error("Your session expired. Sign in again.");
        newsletterAccessToken = session.access_token;
        await sendNewsletter();
      } catch (error) {
        status.className = "publisher-status publisher-status--error";
        status.textContent = error.message || "The newsletter could not be sent.";
        retryButton.disabled = false;
      }
    });

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
          body: JSON.stringify({ slug: article.slug, category: data.get("category"), featured: data.get("featured") === "on" })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "The article publication failed.");
        publishedArticleUrl = result.articleUrl;
        if (data.get("category") === "Newsletter") {
          newsletterAccessToken = session.access_token;
          button.textContent = "Article published";
          await sendNewsletter();
          return;
        }
        button.textContent = "Article published";
        button.disabled = true;
        status.className = "publisher-status publisher-status--success";
        status.replaceChildren(document.createTextNode("The article is queued for publication. Open it after the new deployment completes. "));
        const link = document.createElement("a");
        link.href = result.articleUrl;
        link.textContent = "Open article";
        status.append(link);
      } catch (error) {
        if (publishedArticleUrl) {
          button.textContent = "Article published";
          button.disabled = true;
          status.className = "publisher-status publisher-status--error";
          status.textContent = `The article is live, but the newsletter was not sent: ${error.message}`;
          retryButton.hidden = false;
          retryButton.disabled = false;
          return;
        }
        status.className = "publisher-status publisher-status--error";
        status.textContent = error.message || "The article publication failed.";
        button.disabled = false;
        button.textContent = "Publish article";
      }
    });
  }

  function renderPublishedDetail(article) {
    root.innerHTML = `
      <div class="review-detail-nav"><a href="publish.html"><span aria-hidden="true">←</span> Back to articles</a></div>
      <article class="review-detail">
        <header class="review-detail__header"><p class="eyebrow">Published article</p><h1>${escapeHtml(article.title)}</h1><p class="review-detail__dek">${escapeHtml(article.summary)}</p>
          <dl class="review-detail__facts"><div><dt>Author</dt><dd>${escapeHtml(article.author)}</dd></div><div><dt>Section</dt><dd>${escapeHtml(article.category)}</dd></div><div><dt>Published</dt><dd>${escapeHtml(dateFormat.format(new Date(article.date)))}</dd></div></dl>
        </header>
        ${article.image ? `<figure class="review-detail__image"><img src="${escapeHtml(article.image)}" alt="${escapeHtml(article.imageAlt)}" /><figcaption>${escapeHtml(article.imageAlt)}</figcaption></figure>` : ""}
        <div class="review-detail__body">${renderBody(article)}</div>
      </article>
      <aside class="publication-panel" aria-labelledby="unpublish-title">
        <div><p class="eyebrow">Article management</p><h2 id="unpublish-title">Take this article offline</h2><p>This removes the article from the website and its archive. A newsletter email that was already sent cannot be recalled.</p></div>
        <div class="publication-panel__submit"><p data-unpublish-status aria-live="polite"></p><button type="button" data-unpublish-article>Take article offline</button></div>
      </aside>`;

    const status = root.querySelector("[data-unpublish-status]");
    const button = root.querySelector("[data-unpublish-article]");

    button.addEventListener("click", async () => {
      if (!window.confirm(`Take “${article.title}” offline and remove it from the website?`)) return;
      button.disabled = true;
      button.textContent = "Taking offline…";
      status.className = "publisher-status publisher-status--working";
      status.textContent = "Sending the unpublish request…";
      let removalQueued = false;
      try {
        const session = await window.NAT_AUTH.getSession();
        if (!session) throw new Error("Your session expired. Sign in again.");
        const response = await fetch("/api/release-article", {
          method: "POST",
          headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ action: "unpublish", slug: article.slug })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "The article could not be unpublished.");
        removalQueued = true;
        status.textContent = "The article is being removed from the website…";

        const deadline = Date.now() + 120000;
        while (Date.now() < deadline) {
          const queueResponse = await fetch("/api/review-articles", {
            headers: { Authorization: `Bearer ${session.access_token}` },
            cache: "no-store"
          });
          const queue = await queueResponse.json();
          if (!queueResponse.ok) throw new Error(queue.error || "The article status could not be checked.");
          if (!(queue.publishedArticles || []).some((item) => item.slug === article.slug)) {
            status.className = "publisher-status publisher-status--success";
            status.textContent = "The article is no longer on the website.";
            button.hidden = true;
            return;
          }
          await new Promise((resolve) => window.setTimeout(resolve, 2000));
        }
        throw new Error("The deployment is still in progress.");
      } catch (error) {
        status.className = removalQueued ? "publisher-status publisher-status--working" : "publisher-status publisher-status--error";
        status.textContent = removalQueued
          ? `The unpublish request succeeded. ${error.message} Reload this page shortly.`
          : error.message || "The article could not be unpublished.";
        button.textContent = removalQueued ? "Offline request saved" : "Take article offline";
        button.disabled = removalQueued;
      }
    });
  }

  if (!selectedSlug) return renderQueue();
  const article = [...articles, ...publishedArticles].find((item) => item.slug === selectedSlug);
  if (!article) {
    root.innerHTML = '<div class="review-empty review-empty--missing"><p class="eyebrow">Not available</p><h1>This article is not waiting for review.</h1><a class="review-card__action" href="publish.html">Back to submitted articles</a></div>';
    return;
  }
  if (article.status === "published") return renderPublishedDetail(article);
  renderDetail(article);
}());
