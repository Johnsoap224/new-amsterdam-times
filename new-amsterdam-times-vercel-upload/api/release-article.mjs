import { createHash } from "node:crypto";
import { json, missingEnvironment, requireAccountRole } from "./_services.mjs";

const REQUIRED_ENVIRONMENT = [
  "PUBLISH_GITHUB_TOKEN",
  "PUBLISH_GITHUB_REPOSITORY",
  "PUBLISH_GITHUB_BRANCH",
  "PUBLIC_SITE_URL",
  "SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_PUBLISHABLE_KEY"
];

function yamlString(value) {
  return JSON.stringify(String(value || "").trim());
}

function parseManifest(source, prefix, suffix) {
  if (!source.startsWith(prefix) || !source.trimEnd().endsWith(suffix)) {
    throw new Error("The article list has an unsupported format.");
  }
  const jsonText = source.slice(prefix.length, source.trimEnd().length - suffix.length);
  return JSON.parse(jsonText);
}

function renderMarkdown(article) {
  return [
    "---",
    `title: ${yamlString(article.title)}`,
    `slug: ${article.slug}`,
    `summary: ${yamlString(article.summary)}`,
    `author: ${yamlString(article.author)}`,
    `date: ${article.date}`,
    `category: ${article.category}`,
    `image: ${yamlString(article.image)}`,
    `imageAlt: ${yamlString(article.imageAlt)}`,
    `imageFit: ${article.imageFit}`,
    `featured: ${article.featured}`,
    `status: ${article.status}`,
    `emailSubject: ${yamlString(article.emailSubject)}`,
    `emailPreheader: ${yamlString(article.emailPreheader)}`,
    "---",
    "",
    article.body.join("\n\n"),
    ""
  ].join("\n");
}

function contentHash(article) {
  const emailContent = {};
  [
    "title", "slug", "summary", "author", "date", "category", "image",
    "imageAlt", "emailSubject", "emailPreheader", "body"
  ].forEach((key) => { emailContent[key] = article[key]; });
  const stable = JSON.stringify(emailContent, Object.keys(emailContent).sort());
  return createHash("sha256").update(stable, "utf8").digest("hex");
}

function publicArticle(article) {
  const { emailSubject, emailPreheader, sendAt, contentHash: privateHash, ...result } = article;
  return result;
}

async function github(path, options = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${process.env.PUBLISH_GITHUB_TOKEN}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...options.headers
    }
  });
  const text = await response.text();
  const result = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = new Error(`GitHub returned ${response.status}: ${result?.message || "Unknown error"}`);
    error.status = response.status === 401 || response.status === 403 ? 503 : response.status;
    throw error;
  }
  return result;
}

async function getRepositoryFile(repository, path, branch) {
  const result = await github(`/repos/${repository}/contents/${path}?ref=${encodeURIComponent(branch)}`);
  return Buffer.from(result.content.replace(/\n/g, ""), "base64").toString("utf8");
}

async function createBlob(repository, content) {
  const result = await github(`/repos/${repository}/git/blobs`, {
    method: "POST",
    body: JSON.stringify({ content, encoding: "utf-8" })
  });
  return result.sha;
}

async function publishArticle(slug, featured) {
  const repository = process.env.PUBLISH_GITHUB_REPOSITORY;
  const branch = process.env.PUBLISH_GITHUB_BRANCH;
  const [reference, publicSource, serverSource] = await Promise.all([
    github(`/repos/${repository}/git/ref/heads/${encodeURIComponent(branch)}`),
    getRepositoryFile(repository, "content/articles.js", branch),
    getRepositoryFile(repository, "api/_articles-data.mjs", branch)
  ]);
  const currentCommit = await github(`/repos/${repository}/git/commits/${reference.object.sha}`);
  const publicArticles = parseManifest(publicSource, "window.NAT_ARTICLES = ", ";");
  const serverArticles = parseManifest(serverSource, "export default ", ";");
  const serverArticle = serverArticles.find((article) => article.slug === slug);
  const publicIndex = publicArticles.findIndex((article) => article.slug === slug);

  if (!serverArticle || serverArticle.status !== "review") {
    throw Object.assign(new Error("This article is not waiting for review."), { status: 409 });
  }

  const priorFeatured = featured
    ? serverArticles.find((article) => article.featured && article.status === "published")
    : null;
  if (priorFeatured) {
    publicArticles.forEach((article) => { if (article.slug === priorFeatured.slug) article.featured = false; });
    serverArticles.forEach((article) => { if (article.slug === priorFeatured.slug) article.featured = false; });
  }

  serverArticle.status = "published";
  serverArticle.featured = featured;
  serverArticle.date = new Date().toISOString();
  serverArticle.contentHash = contentHash(serverArticle);
  if (publicIndex >= 0) publicArticles[publicIndex] = publicArticle(serverArticle);
  else publicArticles.push(publicArticle(serverArticle));
  publicArticles.sort((left, right) => right.date.localeCompare(left.date));
  serverArticles.sort((left, right) => right.date.localeCompare(left.date));

  const publicManifest = `window.NAT_ARTICLES = ${JSON.stringify(publicArticles, null, 2)};\n`;
  const serverManifest = `export default ${JSON.stringify(serverArticles, null, 2)};\n`;
  const entries = await Promise.all([
    createBlob(repository, renderMarkdown(serverArticle)),
    createBlob(repository, publicManifest),
    createBlob(repository, serverManifest)
  ]).then(([articleSha, publicSha, serverSha]) => [
    { path: `content/articles/${slug}.md`, mode: "100644", type: "blob", sha: articleSha },
    { path: "content/articles.js", mode: "100644", type: "blob", sha: publicSha },
    { path: "api/_articles-data.mjs", mode: "100644", type: "blob", sha: serverSha }
  ]);

  if (priorFeatured) {
    const oldMarkdown = await getRepositoryFile(repository, `content/articles/${priorFeatured.slug}.md`, branch);
    const updatedMarkdown = oldMarkdown.replace(/^featured:\s*true\s*$/m, "featured: false");
    entries.push({
      path: `content/articles/${priorFeatured.slug}.md`,
      mode: "100644",
      type: "blob",
      sha: await createBlob(repository, updatedMarkdown)
    });
  }

  const tree = await github(`/repos/${repository}/git/trees`, {
    method: "POST",
    body: JSON.stringify({ base_tree: currentCommit.tree.sha, tree: entries })
  });
  const newCommit = await github(`/repos/${repository}/git/commits`, {
    method: "POST",
    body: JSON.stringify({
      message: `Publish: ${serverArticle.title}`,
      tree: tree.sha,
      parents: [reference.object.sha]
    })
  });
  await github(`/repos/${repository}/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: newCommit.sha, force: false })
  });
  return { article: serverArticle, commitSha: newCommit.sha };
}

async function handleRequest(request) {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const account = await requireAccountRole(request, ["editor", "admin"]);
  if (!account.authorized) {
    const error = account.status === 403 ? "Only editors and administrators can publish articles." : account.error;
    return json({ error }, account.status);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "A JSON request body is required." }, 400);
  }
  const slug = String(body.slug || "").trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return json({ error: "Select a valid article." }, 400);

  const result = await publishArticle(slug, body.featured === true);
  const baseUrl = process.env.PUBLIC_SITE_URL.replace(/\/$/, "");
  return json({
    message: "The article is queued for publication.",
    commitSha: result.commitSha,
    articleUrl: `${baseUrl}/article.html?slug=${encodeURIComponent(slug)}`
  });
}

export default {
  async fetch(request) {
    const missing = missingEnvironment(REQUIRED_ENVIRONMENT);
    if (missing.length) {
      console.error(`Missing publishing configuration: ${missing.join(", ")}`);
      return json({ error: "The publishing service is not configured yet." }, 503);
    }
    try {
      return await handleRequest(request);
    } catch (error) {
      console.error("Article publication failed", error);
      const exposed = error.status && error.status < 500;
      return json({ error: exposed ? error.message : "The article publication failed." }, error.status || 500);
    }
  }
};
