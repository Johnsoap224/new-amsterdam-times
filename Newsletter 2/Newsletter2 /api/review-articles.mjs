import articles from "./_articles-data.mjs";
import { json, missingEnvironment, requireAccountRole } from "./_services.mjs";

const REQUIRED_ENVIRONMENT = [
  "SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_PUBLISHABLE_KEY"
];

function reviewArticle(article) {
  const { emailSubject, emailPreheader, sendAt, contentHash, ...safeArticle } = article;
  return safeArticle;
}

export default {
  async fetch(request) {
    if (request.method !== "GET") return json({ error: "Method not allowed." }, 405);
    const missing = missingEnvironment(REQUIRED_ENVIRONMENT);
    if (missing.length) {
      console.error(`Missing account configuration: ${missing.join(", ")}`);
      return json({ error: "The account service is not configured yet." }, 503);
    }
    try {
      const account = await requireAccountRole(request, ["editor", "admin"]);
      if (!account.authorized) {
        const error = account.status === 403 ? "Only editors and administrators can review submitted articles." : account.error;
        return json({ error }, account.status);
      }
      return json({
        articles: articles
          .filter((article) => article.status === "review")
          .sort((left, right) => right.date.localeCompare(left.date))
          .map(reviewArticle)
      });
    } catch (error) {
      console.error("Review queue failed", error);
      return json({ error: "The review queue could not load." }, 500);
    }
  }
};
