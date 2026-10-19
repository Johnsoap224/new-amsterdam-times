import { json, missingEnvironment } from "./_services.mjs";

const REQUIRED_ENVIRONMENT = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "PUBLIC_SITE_URL"];

export default {
  async fetch(request) {
    if (request.method !== "GET") return json({ error: "Method not allowed." }, 405);
    const missing = missingEnvironment(REQUIRED_ENVIRONMENT);
    if (missing.length) {
      console.error(`Missing account configuration: ${missing.join(", ")}`);
      return json({ error: "The account service is not configured yet." }, 503);
    }
    return json({
      supabaseUrl: process.env.SUPABASE_URL.replace(/\/$/, ""),
      publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY,
      siteUrl: process.env.PUBLIC_SITE_URL.replace(/\/$/, "")
    });
  }
};
