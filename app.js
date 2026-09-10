(function () {
  "use strict";

  const allArticles = window.NAT_ARTICLES || [];
  const articles = allArticles.filter((article) => article.status === "published");
  const dateFormat = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric"
  });
  const timeFormat = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit"
  });

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  })[character]);
  const articleUrl = (article) => `article.html?slug=${encodeURIComponent(article.slug)}`;
  const storyTime = (article) => timeFormat.format(new Date(article.date));
  const storyKicker = (article) => `<p class="story-kicker" data-category="${escapeHtml(article.category.toLowerCase())}">${escapeHtml(article.category)}</p>`;

  function storyImage(article, className, loading = "eager") {
    if (!article.image) return "";
    return `<a class="${className}" href="${articleUrl(article)}"><img src="${escapeHtml(article.image)}" alt="${escapeHtml(article.imageAlt)}" loading="${loading}" /></a>`;
  }

  function setSharedChrome() {
    document.querySelectorAll("[data-current-date]").forEach((node) => {
      node.textContent = dateFormat.format(new Date());
    });
    document.querySelectorAll("[data-current-time]").forEach((node) => {
      node.textContent = `${timeFormat.format(new Date())} ET`;
    });
    document.querySelectorAll("[data-current-year]").forEach((node) => {
      node.textContent = String(new Date().getFullYear());
    });

    const menuButton = document.querySelector(".menu-button");
    const nav = document.querySelector("#primary-nav");
    if (menuButton && nav) {
      menuButton.addEventListener("click", () => {
        const isOpen = menuButton.getAttribute("aria-expanded") === "true";
        menuButton.setAttribute("aria-expanded", String(!isOpen));
        nav.classList.toggle("nav-open", !isOpen);
      });
    }

    document.querySelectorAll("[data-subscribe-form]").forEach((form) => {
      const note = form.querySelector("[data-form-note]");
      const button = form.querySelector("button[type='submit']");

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const formData = new FormData(form);
        const originalLabel = button?.textContent || "Subscribe";

        if (button) {
          button.disabled = true;
          button.textContent = "Submitting…";
        }
        if (note) {
          note.className = "form-note";
          note.textContent = "Adding your address…";
        }

        try {
          const response = await fetch(form.action, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: formData.get("email"),
              website: formData.get("website")
            })
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || "We couldn’t add your address.");

          if (note) {
            note.className = "form-note form-note--success";
            note.textContent = result.message;
          }
          form.reset();
        } catch (error) {
          if (note) {
            note.className = "form-note form-note--error";
            note.textContent = error.message || "We couldn’t add your address. Please try again.";
          }
        } finally {
          if (button) {
            button.disabled = false;
            button.textContent = originalLabel;
          }
        }
      });
    });

    const subscriptionStatus = new URLSearchParams(window.location.search).get("subscription");
    if (subscriptionStatus) {
      const note = document.querySelector("[data-form-note]");
      if (note) {
        note.className = `form-note ${subscriptionStatus === "confirmed" ? "form-note--success" : "form-note--error"}`;
        note.textContent = subscriptionStatus === "confirmed"
          ? "Your subscription is confirmed. Welcome to The Weekly Rapport."
          : "That confirmation link is invalid or has expired. Please subscribe again.";
      }
    }
  }

  function renderHome() {
    const featured = articles.find((article) => article.featured) || articles[0];
    const remaining = articles.filter((article) => article !== featured);
    const leadNode = document.querySelector("[data-lead-story]");
    const secondaryNode = document.querySelector("[data-secondary-stories]");
    const latestNode = document.querySelector("[data-latest-stories]");
    const moreNode = document.querySelector("[data-more-stories]");

    if (featured && leadNode) {
      leadNode.innerHTML = `
        ${storyImage(featured, "lead-image")}
        ${storyKicker(featured)}
        <h2><a href="${articleUrl(featured)}">${escapeHtml(featured.title)}</a></h2>
        <p class="story-summary">${escapeHtml(featured.summary)}</p>
        <p class="byline">By ${escapeHtml(featured.author)}</p>
      `;
    }

    if (secondaryNode) {
      secondaryNode.innerHTML = remaining.slice(0, 2).map((article, index) => `
        <article class="secondary-story${article.image ? "" : " secondary-story--no-image"}">
          ${index === 0 ? storyImage(article, "secondary-image") : ""}
          ${storyKicker(article)}
          <h2><a href="${articleUrl(article)}">${escapeHtml(article.title)}</a></h2>
          <p class="story-summary">${escapeHtml(article.summary)}</p>
        </article>
      `).join("");
    }

    if (latestNode) {
      latestNode.innerHTML = remaining.slice(2, 6).map((article) => `
        <article class="latest-story">
          <time datetime="${escapeHtml(article.date)}">${storyTime(article)}</time>
          <h3><a href="${articleUrl(article)}">${escapeHtml(article.title)}</a></h3>
        </article>
      `).join("");
    }

    if (moreNode) {
      moreNode.innerHTML = remaining.slice(0, 6).map((article) => `
        <article class="story-card">
          ${storyImage(article, "card-image", "lazy")}
          ${storyKicker(article)}
          <h3><a href="${articleUrl(article)}">${escapeHtml(article.title)}</a></h3>
          <p class="story-summary">${escapeHtml(article.summary)}</p>
          <p class="byline">By ${escapeHtml(article.author)}</p>
        </article>
      `).join("");
    }
  }

  function renderArchive() {
    const archive = document.querySelector("[data-archive]");
    if (!archive) return;
    const requestedCategory = archive.dataset.category;
    const archiveArticles = requestedCategory
      ? articles.filter((article) => article.category.toLowerCase() === requestedCategory.toLowerCase())
      : articles;

    if (!archiveArticles.length) {
      archive.innerHTML = `<p class="archive-empty">No ${escapeHtml(requestedCategory || "").toLowerCase()} articles have been published yet.</p>`;
      return;
    }

    archive.innerHTML = archiveArticles.map((article) => `
      <article class="archive-story${article.image ? "" : " archive-story--no-image"}">
        ${storyImage(article, "archive-image", "lazy")}
        <div>
          ${storyKicker(article)}
          <h2><a href="${articleUrl(article)}">${escapeHtml(article.title)}</a></h2>
          <p class="story-summary">${escapeHtml(article.summary)}</p>
          <p class="byline">By ${escapeHtml(article.author)} · <time datetime="${escapeHtml(article.date)}">${dateFormat.format(new Date(article.date))}</time></p>
        </div>
      </article>
    `).join("");
  }

  function renderArticle() {
    const root = document.querySelector("[data-article]");
    if (!root) return;
    const parameters = new URLSearchParams(window.location.search);
    const slug = parameters.get("slug");
    const previewAllowed = parameters.get("preview") === "1";
    const article = allArticles.find((item) => item.slug === slug);

    if (!article || (article.status !== "published" && !previewAllowed)) {
      document.title = "Article Not Found — The New Amsterdam Times";
      root.innerHTML = `<div class="not-found"><p class="eyebrow">404</p><h1>We couldn’t find that article.</h1><a class="text-link" href="index.html">Return to the front page</a></div>`;
      return;
    }

    const previewBanner = article.status !== "published"
      ? `<div class="preview-banner" role="status">Preview only · Status: ${escapeHtml(article.status)}</div>`
      : "";
    const articleHero = article.image
      ? `<figure class="article-hero"><img src="${escapeHtml(article.image)}" alt="${escapeHtml(article.imageAlt)}" /><figcaption>${escapeHtml(article.imageAlt)}.</figcaption></figure>`
      : "";

    document.title = `${article.title} — The New Amsterdam Times`;
    root.innerHTML = `
      ${previewBanner}
      <header class="article-header">
        ${storyKicker(article)}
        <h1>${escapeHtml(article.title)}</h1>
        <p class="article-dek">${escapeHtml(article.summary)}</p>
        <div class="article-meta">
          <p>By <strong>${escapeHtml(article.author)}</strong></p>
          <p><time datetime="${escapeHtml(article.date)}">${dateFormat.format(new Date(article.date))}, ${storyTime(article)} ET</time></p>
        </div>
      </header>
      ${articleHero}
      <div class="article-body">
        ${article.body.map((paragraph, index) => `<p${index === 0 ? ' class="drop-cap"' : ""}>${escapeHtml(paragraph)}</p>`).join("")}
      </div>
      <aside class="article-signup" aria-label="Newsletter signup">
        <p class="eyebrow">The Weekly Rapport</p>
        <h2>Continue the conversation.</h2>
        <p>Receive our latest reporting and analysis every weekday.</p>
        <a href="index.html#subscribe">Subscribe to the newsletter</a>
      </aside>
    `;
  }

  setSharedChrome();
  if (document.body.dataset.page === "home") renderHome();
  if (document.querySelector("[data-archive]")) renderArchive();
  if (document.body.dataset.page === "article") renderArticle();
})();
