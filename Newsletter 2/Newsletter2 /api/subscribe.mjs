const TOKEN_LIFETIME_MS = 24 * 60 * 60 * 1000;

const requiredEnvironment = [
  "SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
  "RESEND_API_KEY",
  "NEWSLETTER_FROM",
  "PUBLIC_SITE_URL"
];

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

function normalizedEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  })[character]);
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hashToken(token) {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function configurationError() {
  const missing = requiredEnvironment.filter((name) => !process.env[name]);
  return missing.length ? `Missing server configuration: ${missing.join(", ")}` : null;
}

async function supabaseRequest(path, options = {}) {
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const response = await fetch(`${process.env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: secretKey,
      // Legacy service-role keys are JWTs and also require the Authorization header.
      // New sb_secret_* keys authenticate through the apikey header alone.
      ...(secretKey.startsWith("eyJ") ? { Authorization: `Bearer ${secretKey}` } : {}),
      "Content-Type": "application/json",
      ...options.headers
    }
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Subscriber database request failed (${response.status}): ${detail}`);
  }
  const responseText = await response.text();
  if (!responseText) return null;
  return JSON.parse(responseText);
}

async function resendRequest(path, body, { method = "POST", idempotencyKey } = {}) {
  const response = await fetch(`https://api.resend.com/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {})
    },
    body: JSON.stringify(body)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`Resend request failed (${response.status}): ${result.message || "Unknown error"}`);
    error.status = response.status;
    throw error;
  }
  return result;
}

async function subscribe(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Please enter a valid email address." }, 400);
  }

  // A filled honeypot is treated as success so automated submissions receive no useful signal.
  if (body.website) {
    return json({ message: "Check your inbox to confirm your subscription." });
  }

  const email = normalizedEmail(body.email);
  if (!email) return json({ error: "Please enter a valid email address." }, 400);

  const encodedEmail = encodeURIComponent(email);
  const existing = await supabaseRequest(
    `subscribers?email=eq.${encodedEmail}&select=id,status,confirmation_expires_at&limit=1`
  );
  if (existing[0]?.status === "active") {
    return json({ message: "Check your inbox for subscription details." });
  }

  // Avoid repeatedly emailing the same address when the form is submitted more than once.
  const existingExpiry = new Date(existing[0]?.confirmation_expires_at || 0).getTime();
  if (existing[0]?.status === "pending" && existingExpiry > Date.now() + 23 * 60 * 60 * 1000) {
    return json({ message: "Check your inbox to confirm your subscription." });
  }

  const token = randomToken();
  const tokenHash = await hashToken(token);
  const expiresAt = new Date(Date.now() + TOKEN_LIFETIME_MS).toISOString();
  const record = {
    email,
    status: "pending",
    confirmation_token_hash: tokenHash,
    confirmation_expires_at: expiresAt,
    consented_at: null,
    unsubscribed_at: null,
    source: "website"
  };

  await supabaseRequest("subscribers?on_conflict=email", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(record)
  });

  const siteUrl = process.env.PUBLIC_SITE_URL.replace(/\/$/, "");
  const confirmationUrl = `${siteUrl}/api/subscribe?token=${encodeURIComponent(token)}`;
  const safeUrl = escapeHtml(confirmationUrl);
  try {
    await resendRequest("emails", {
      from: process.env.NEWSLETTER_FROM,
      to: [email],
      subject: "Confirm your subscription to The New Amsterdam Times",
      ...(process.env.NEWSLETTER_REPLY_TO ? { reply_to: process.env.NEWSLETTER_REPLY_TO } : {}),
      html: `
        <div style="max-width:600px;margin:auto;padding:32px;color:#171717;font-family:Georgia,serif">
          <p style="font:700 12px Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#a67b2d">The New Amsterdam Times</p>
          <h1 style="font-size:36px;line-height:1.05">Confirm your subscription</h1>
          <p style="font-size:18px;line-height:1.55">Click below to confirm that you want to receive The New Amsterdam Times.</p>
          <p style="margin:30px 0"><a href="${safeUrl}" style="display:inline-block;padding:13px 20px;color:#fff;background:#171717;text-decoration:none;font:700 14px Arial,sans-serif">Confirm subscription</a></p>
          <p style="color:#666;font-size:14px;line-height:1.45">This link expires in 24 hours. If you did not request this, you can ignore this email.</p>
        </div>`,
      text: `Confirm your subscription to The New Amsterdam Times: ${confirmationUrl}\n\nThis link expires in 24 hours. If you did not request this, ignore this email.`
    }, { idempotencyKey: `confirm-${tokenHash}` });
  } catch (error) {
    // Let the visitor retry immediately if the delivery provider rejected the email.
    try {
      await supabaseRequest(`subscribers?email=eq.${encodedEmail}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          confirmation_token_hash: null,
          confirmation_expires_at: null
        })
      });
    } catch (cleanupError) {
      console.error("Could not clear the failed confirmation token", cleanupError);
    }
    error.publicMessage = "We couldn’t send the confirmation email. Please try again shortly.";
    throw error;
  }

  return json({ message: "Check your inbox to confirm your subscription." });
}

async function confirm(request) {
  const token = new URL(request.url).searchParams.get("token");
  const siteUrl = process.env.PUBLIC_SITE_URL.replace(/\/$/, "");
  const failureUrl = `${siteUrl}/?subscription=invalid#subscribe`;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return Response.redirect(failureUrl, 303);

  const tokenHash = await hashToken(token);
  const rows = await supabaseRequest(`subscribers?confirmation_token_hash=eq.${tokenHash}&select=*&limit=1`);
  const subscriber = rows[0];
  if (!subscriber || new Date(subscriber.confirmation_expires_at).getTime() < Date.now()) {
    return Response.redirect(failureUrl, 303);
  }

  let contact;
  try {
    contact = await resendRequest("contacts", {
      email: subscriber.email,
      unsubscribed: false,
      ...(process.env.RESEND_SEGMENT_ID ? { segments: [{ id: process.env.RESEND_SEGMENT_ID }] } : {}),
      ...(process.env.RESEND_TOPIC_ID ? {
        topics: [{ id: process.env.RESEND_TOPIC_ID, subscription: "opt_in" }]
      } : {})
    });
  } catch (error) {
    // A returning subscriber may already exist in Resend. Reactivate that contact instead.
    if (error.status !== 409) throw error;
    contact = await resendRequest(`contacts/${encodeURIComponent(subscriber.email)}`, {
      unsubscribed: false
    }, { method: "PATCH" });
  }

  await supabaseRequest(`subscribers?id=eq.${subscriber.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      status: "active",
      consented_at: new Date().toISOString(),
      confirmation_token_hash: null,
      confirmation_expires_at: null,
      resend_contact_id: contact.id || null
    })
  });

  return Response.redirect(`${siteUrl}/?subscription=confirmed#subscribe`, 303);
}

export default {
  async fetch(request) {
    const missingConfiguration = configurationError();
    if (missingConfiguration) {
      console.error(missingConfiguration);
      return json({ error: "The subscription service is not configured yet." }, 503);
    }

    try {
      if (request.method === "POST") return await subscribe(request);
      if (request.method === "GET") return await confirm(request);
      return json({ error: "Method not allowed." }, 405);
    } catch (error) {
      console.error("Subscription request failed", error);
      return json({
        error: error.publicMessage || "We couldn’t process your subscription. Please try again."
      }, 500);
    }
  }
};
