export function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

export function missingEnvironment(names) {
  return names.filter((name) => !process.env[name]);
}

function constantTimeEqual(left, right) {
  const leftBytes = new TextEncoder().encode(String(left || ""));
  const rightBytes = new TextEncoder().encode(String(right || ""));
  let difference = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] || 0) ^ (rightBytes[index] || 0);
  }
  return difference === 0;
}

export function isAuthorized(request) {
  const authorization = request.headers.get("authorization") || "";
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  return Boolean(process.env.NEWSLETTER_ADMIN_SECRET && supplied)
    && constantTimeEqual(supplied, process.env.NEWSLETTER_ADMIN_SECRET);
}

export async function supabaseRequest(path, options = {}) {
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const response = await fetch(`${process.env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: secretKey,
      ...(secretKey.startsWith("eyJ") ? { Authorization: `Bearer ${secretKey}` } : {}),
      "Content-Type": "application/json",
      ...options.headers
    }
  });

  const responseText = await response.text();
  let result = null;
  try {
    result = responseText ? JSON.parse(responseText) : null;
  } catch {
    result = responseText;
  }
  if (!response.ok) {
    const error = new Error(`Supabase request failed (${response.status}): ${responseText}`);
    error.status = response.status;
    error.result = result;
    throw error;
  }
  return result;
}

export async function resendRequest(path, body, { method = "POST", idempotencyKey } = {}) {
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
    error.result = result;
    throw error;
  }
  return result;
}
