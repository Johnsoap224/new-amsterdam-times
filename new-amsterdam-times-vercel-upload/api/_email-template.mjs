function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  })[character]);
}

function siteUrl() {
  return `${process.env.PUBLIC_SITE_URL.replace(/\/$/, "")}/`;
}

export function canonicalArticleUrl(article) {
  const url = new URL("article.html", siteUrl());
  url.searchParams.set("slug", article.slug);
  return url.toString();
}

function trackedArticleUrl(article) {
  const url = new URL(canonicalArticleUrl(article));
  url.searchParams.set("utm_source", "newsletter");
  url.searchParams.set("utm_medium", "email");
  url.searchParams.set("utm_campaign", article.slug);
  return url.toString();
}

function absoluteImageUrl(article) {
  return article.image ? new URL(article.image.replace(/^\//, ""), siteUrl()).toString() : "";
}

function formattedDate(value) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York"
  }).format(new Date(value));
}

export function renderNewsletter(article, { test = false } = {}) {
  const articleUrl = trackedArticleUrl(article);
  const canonicalUrl = canonicalArticleUrl(article);
  const imageUrl = absoluteImageUrl(article);
  const unsubscribeUrl = test ? canonicalUrl : "{{{RESEND_UNSUBSCRIBE_URL}}}";
  const preheader = article.emailPreheader || article.summary;
  const bodyHtml = article.body.map((paragraph) => `
    <p style="margin:0 0 22px;font-family:Georgia,'Times New Roman',serif;font-size:18px;line-height:1.65;color:#222222;">${escapeHtml(paragraph)}</p>`).join("");
  const imageHtml = imageUrl ? `
    <tr><td style="padding:0 0 28px;">
      <img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(article.imageAlt)}" width="640" style="display:block;width:100%;max-width:640px;height:auto;border:0;" />
    </td></tr>` : "";
  const testBanner = test ? `
    <tr><td style="padding:10px 24px;background:#fff3cd;color:#5e4900;font:700 12px Arial,sans-serif;text-align:center;letter-spacing:.06em;text-transform:uppercase;">Test email — not sent to subscribers</td></tr>` : "";

  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(article.emailSubject)}</title></head>
<body style="margin:0;padding:0;background:#f4f1ea;color:#171717;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f1ea;">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:640px;background:#ffffff;border-top:5px solid #173f5f;">
        ${testBanner}
        <tr><td style="padding:32px 30px 22px;text-align:center;border-bottom:1px solid #c9c5bc;">
          <a href="${escapeHtml(siteUrl())}" style="color:#171717;text-decoration:none;font-family:Georgia,'Times New Roman',serif;font-size:31px;font-weight:700;letter-spacing:-.02em;">The New Amsterdam Times</a>
        </td></tr>
        <tr><td style="padding:34px 30px 24px;">
          <p style="margin:0 0 12px;font:700 12px Arial,sans-serif;letter-spacing:.09em;text-transform:uppercase;color:${article.category === "Opinion" ? "#a67b2d" : "#173f5f"};">${escapeHtml(article.category)}</p>
          <h1 style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;font-size:40px;line-height:1.08;letter-spacing:-.025em;color:#171717;">${escapeHtml(article.title)}</h1>
          <p style="margin:0 0 20px;font-family:Georgia,'Times New Roman',serif;font-size:20px;line-height:1.45;color:#55514a;">${escapeHtml(article.summary)}</p>
          <p style="margin:0;font:700 12px Arial,sans-serif;letter-spacing:.03em;text-transform:uppercase;color:#55514a;">By ${escapeHtml(article.author)} &nbsp;·&nbsp; ${escapeHtml(formattedDate(article.date))}</p>
        </td></tr>
        ${imageHtml}
        <tr><td style="padding:4px 30px 12px;">${bodyHtml}</td></tr>
        <tr><td style="padding:10px 30px 38px;text-align:center;">
          <a href="${escapeHtml(articleUrl)}" style="display:inline-block;padding:14px 22px;background:#173f5f;color:#ffffff;text-decoration:none;font:700 14px Arial,sans-serif;">Read this article online</a>
          <p style="margin:16px 0 0;font:12px/1.5 Arial,sans-serif;color:#77716a;word-break:break-all;"><a href="${escapeHtml(canonicalUrl)}" style="color:#55514a;">${escapeHtml(canonicalUrl)}</a></p>
        </td></tr>
        <tr><td style="padding:24px 30px;background:#efede7;border-top:1px solid #d8d4cb;text-align:center;font:12px/1.55 Arial,sans-serif;color:#69645d;">
          <p style="margin:0 0 8px;">You are receiving this because you confirmed a subscription to The New Amsterdam Times.</p>
          ${test ? '<p style="margin:0;">The unsubscribe link is activated only in a subscriber Broadcast.</p>' : `<p style="margin:0;"><a href="${unsubscribeUrl}" style="color:#173f5f;">Unsubscribe or manage preferences</a></p>`}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = [
    "THE NEW AMSTERDAM TIMES",
    "",
    article.category.toUpperCase(),
    article.title,
    article.summary,
    `By ${article.author} · ${formattedDate(article.date)}`,
    "",
    ...article.body.flatMap((paragraph) => [paragraph, ""]),
    `Read this article online: ${canonicalUrl}`,
    "",
    "You are receiving this because you confirmed a subscription to The New Amsterdam Times.",
    test ? "This is a test email." : `Unsubscribe or manage preferences: ${unsubscribeUrl}`
  ].join("\n");

  return {
    subject: article.emailSubject || article.title,
    html,
    text,
    canonicalUrl
  };
}
