import articles from "./_articles-data.mjs";
import { canonicalArticleUrl, renderNewsletter } from "./_email-template.mjs";
import {
  isAuthorized,
  json,
  missingEnvironment,
  resendRequest,
  supabaseRequest
} from "./_services.mjs";

const MODES = new Set(["test", "send", "schedule"]);
const REQUIRED_ENVIRONMENT = [
  "SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
  "RESEND_API_KEY",
  "RESEND_SEGMENT_ID",
  "NEWSLETTER_FROM",
  "NEWSLETTER_ADMIN_SECRET",
  "PUBLIC_SITE_URL"
];

function validSchedule(value) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp <= Date.now()) return null;
  return new Date(timestamp).toISOString();
}

async function verifyPublishedUrl(article) {
  const url = canonicalArticleUrl(article);
  let response = await fetch(url, { method: "HEAD", redirect: "follow" });
  if (response.status === 405) response = await fetch(url, { method: "GET", redirect: "follow" });
  if (!response.ok) throw new Error(`Published article URL returned ${response.status}: ${url}`);
}

async function reserveSend(article, mode, scheduledAt) {
  const existing = await supabaseRequest(
    `newsletter_sends?slug=eq.${encodeURIComponent(article.slug)}&select=id,status,resend_broadcast_id&limit=1`
  );
  if (existing[0] && existing[0].status !== "failed") {
    const error = new Error(`This article already has a newsletter send in status: ${existing[0].status}.`);
    error.status = 409;
    throw error;
  }

  const record = {
    slug: article.slug,
    content_hash: article.contentHash,
    mode,
    status: "preparing",
    scheduled_at: scheduledAt,
    last_error: null
  };
  if (existing[0]) {
    const rows = await supabaseRequest(`newsletter_sends?id=eq.${existing[0].id}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(record)
    });
    return rows[0];
  }

  const rows = await supabaseRequest("newsletter_sends", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(record)
  });
  return rows[0];
}

async function updateSend(id, changes) {
  await supabaseRequest(`newsletter_sends?id=eq.${id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(changes)
  });
}

async function handleRequest(request) {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!isAuthorized(request)) return json({ error: "Unauthorized." }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "A JSON request body is required." }, 400);
  }

  const mode = String(body.mode || "");
  const slug = String(body.slug || "");
  if (!MODES.has(mode)) return json({ error: "mode must be test, send, or schedule." }, 400);
  const article = articles.find((item) => item.slug === slug);
  if (!article || article.status !== "published") {
    return json({ error: "Only a published article can be emailed." }, 400);
  }

  if (mode === "test") {
    if (!process.env.NEWSLETTER_TEST_RECIPIENT) {
      return json({ error: "NEWSLETTER_TEST_RECIPIENT is not configured." }, 503);
    }
    const email = renderNewsletter(article, { test: true });
    const result = await resendRequest("emails", {
      from: process.env.NEWSLETTER_FROM,
      to: [process.env.NEWSLETTER_TEST_RECIPIENT],
      subject: `[TEST] ${email.subject}`,
      html: email.html,
      text: email.text,
      ...(process.env.NEWSLETTER_REPLY_TO ? { reply_to: process.env.NEWSLETTER_REPLY_TO } : {})
    });
    return json({ message: "Test email sent.", emailId: result.id, articleUrl: email.canonicalUrl });
  }

  const scheduledAt = mode === "schedule" ? validSchedule(body.scheduledAt || article.sendAt) : null;
  if (mode === "schedule" && !scheduledAt) {
    return json({ error: "A future ISO-formatted scheduledAt value is required." }, 400);
  }

  await verifyPublishedUrl(article);
  const reservation = await reserveSend(article, mode, scheduledAt);
  try {
    const email = renderNewsletter(article);
    const result = await resendRequest("broadcasts", {
      segment_id: process.env.RESEND_SEGMENT_ID,
      from: process.env.NEWSLETTER_FROM,
      subject: email.subject,
      name: `${article.title} — ${article.date.slice(0, 10)}`,
      html: email.html,
      text: email.text,
      send: true,
      ...(scheduledAt ? { scheduled_at: scheduledAt } : {})
    }, { idempotencyKey: `newsletter-${article.slug}` });

    const status = scheduledAt ? "scheduled" : "queued";
    await updateSend(reservation.id, {
      status,
      resend_broadcast_id: result.id
    });
    return json({
      message: scheduledAt ? "Newsletter scheduled." : "Newsletter queued for subscribers.",
      status,
      broadcastId: result.id,
      scheduledAt,
      articleUrl: email.canonicalUrl
    });
  } catch (error) {
    await updateSend(reservation.id, { status: "failed", last_error: String(error.message).slice(0, 2000) });
    throw error;
  }
}

export default {
  async fetch(request) {
    const missing = missingEnvironment(REQUIRED_ENVIRONMENT);
    if (missing.length) {
      console.error(`Missing newsletter configuration: ${missing.join(", ")}`);
      return json({ error: "The newsletter service is not configured yet." }, 503);
    }
    try {
      return await handleRequest(request);
    } catch (error) {
      console.error("Newsletter request failed", error);
      return json({ error: error.status === 409 ? error.message : "The newsletter request failed." }, error.status || 500);
    }
  }
};
