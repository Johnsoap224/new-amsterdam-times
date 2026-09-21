import { json, missingEnvironment, supabaseRequest } from "./_services.mjs";

const MAX_WEBHOOK_AGE_SECONDS = 5 * 60;

function decodeBase64(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function constantTimeEqual(left, right) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  let difference = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] || 0) ^ (rightBytes[index] || 0);
  }
  return difference === 0;
}

async function verifyWebhook(request, payload) {
  const id = request.headers.get("svix-id");
  const timestamp = request.headers.get("svix-timestamp");
  const signatureHeader = request.headers.get("svix-signature") || "";
  if (!id || !timestamp || !signatureHeader) return false;

  const timestampNumber = Number(timestamp);
  if (!Number.isFinite(timestampNumber)) return false;
  if (Math.abs(Date.now() / 1000 - timestampNumber) > MAX_WEBHOOK_AGE_SECONDS) return false;

  const secret = process.env.RESEND_WEBHOOK_SECRET.replace(/^whsec_/, "");
  const key = await crypto.subtle.importKey(
    "raw",
    decodeBase64(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signed = new TextEncoder().encode(`${id}.${timestamp}.${payload}`);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, signed));
  let binary = "";
  digest.forEach((byte) => { binary += String.fromCharCode(byte); });
  const expected = btoa(binary);
  return signatureHeader.split(" ").some((entry) => {
    const [version, signature] = entry.split(",", 2);
    return version === "v1" && constantTimeEqual(signature || "", expected);
  });
}

function validEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

async function markSubscriber(email, changes) {
  await supabaseRequest(`subscribers?email=eq.${encodeURIComponent(email)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(changes)
  });
}

async function handleEvent(event) {
  if (event.type === "contact.updated") {
    const email = validEmail(event.data?.email);
    if (!email || typeof event.data?.unsubscribed !== "boolean") return;
    await markSubscriber(email, event.data.unsubscribed ? {
      delivery_status: "unsubscribed",
      unsubscribed_at: event.created_at || new Date().toISOString()
    } : {
      delivery_status: "active",
      unsubscribed_at: null
    });
    return;
  }

  if (event.type === "email.bounced" || event.type === "email.complained") {
    const email = validEmail(event.data?.to?.[0]);
    if (!email) return;
    await markSubscriber(email, {
      delivery_status: event.type === "email.complained" ? "complained" : "bounced",
      unsubscribed_at: event.created_at || new Date().toISOString()
    });
  }
}

export default {
  async fetch(request) {
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
    const missing = missingEnvironment(["SUPABASE_URL", "SUPABASE_SECRET_KEY", "RESEND_WEBHOOK_SECRET"]);
    if (missing.length) return json({ error: "Webhook service is not configured." }, 503);

    const payload = await request.text();
    if (!(await verifyWebhook(request, payload))) return json({ error: "Invalid webhook signature." }, 400);

    try {
      const event = JSON.parse(payload);
      await handleEvent(event);
      return json({ received: true });
    } catch (error) {
      console.error("Resend webhook failed", error);
      return json({ error: "Webhook processing failed." }, 500);
    }
  }
};
