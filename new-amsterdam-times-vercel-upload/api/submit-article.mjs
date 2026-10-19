import { createHash } from "node:crypto";
import mammoth from "mammoth";
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
const CATEGORIES = new Set(["Articles", "Editorial"]);
const DOCUMENT_EXTENSIONS = new Set(["txt", "md", "markdown", "docx"]);
const IMAGE_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"]
]);
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;

function clean(value) {
  return String(value || "").trim();
}

function slugify(value) {
  return clean(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

function yamlString(value) {
  return JSON.stringify(clean(value));
}

function parseParagraphs(value) {
  return clean(value)
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);
}

function articleHash(article) {
  const emailContent = {};
  [
    "title", "slug", "summary", "author", "date", "category", "image",
    "imageAlt", "emailSubject", "emailPreheader", "body"
  ].forEach((key) => { emailContent[key] = article[key]; });
  const stable = JSON.stringify(emailContent, Object.keys(emailContent).sort());
  return createHash("sha256").update(stable, "utf8").digest("hex");
}

async function readDocument(file) {
  if (!file || !file.size) return "";
  if (file.size > MAX_DOCUMENT_BYTES) throw Object.assign(new Error("Select a document smaller than 2 MB."), { status: 400 });
  const extension = file.name.split(".").pop().toLowerCase();
  if (!DOCUMENT_EXTENSIONS.has(extension)) {
    throw Object.assign(new Error("Select a .txt, .md, or .docx document."), { status: 400 });
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  if (extension === "docx") {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }
  return buffer.toString("utf8");
}

function parseManifest(source, prefix, suffix) {
  if (!source.startsWith(prefix) || !source.trimEnd().endsWith(suffix)) {
    throw new Error("The article list has an unsupported format.");
  }
  const jsonText = source.slice(prefix.length, source.trimEnd().length - suffix.length);
  return JSON.parse(jsonText);
}

function publicArticle(article) {
  const { emailSubject, emailPreheader, sendAt, contentHash, ...result } = article;
  return result;
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

async function createBlob(repository, content, encoding = "utf-8") {
  const result = await github(`/repos/${repository}/git/blobs`, {
    method: "POST",
    body: JSON.stringify({ content, encoding })
  });
  return result.sha;
}

async function commitArticle(article, imageBuffer, imageExtension) {
  const repository = process.env.PUBLISH_GITHUB_REPOSITORY;
  const branch = process.env.PUBLISH_GITHUB_BRANCH;
  const [reference, publicSource, serverSource] = await Promise.all([
    github(`/repos/${repository}/git/ref/heads/${encodeURIComponent(branch)}`),
    getRepositoryFile(repository, "content/articles.js", branch),
    getRepositoryFile(repository, "api/_articles-data.mjs", branch)
  ]);
  const commit = await github(`/repos/${repository}/git/commits/${reference.object.sha}`);
  const publicArticles = parseManifest(publicSource, "window.NAT_ARTICLES = ", ";");
  const serverArticles = parseManifest(serverSource, "export default ", ";");

  if (serverArticles.some((item) => item.slug === article.slug)) {
    throw Object.assign(new Error("An article already uses this web address."), { status: 409 });
  }

  const priorFeatured = article.featured && article.status === "published"
    ? serverArticles.find((item) => item.featured && item.status === "published")
    : null;
  if (priorFeatured) {
    publicArticles.forEach((item) => { if (item.slug === priorFeatured.slug) item.featured = false; });
    serverArticles.forEach((item) => { if (item.slug === priorFeatured.slug) item.featured = false; });
  }

  serverArticles.push(article);
  publicArticles.sort((left, right) => right.date.localeCompare(left.date));
  serverArticles.sort((left, right) => right.date.localeCompare(left.date));

  const publicManifest = `window.NAT_ARTICLES = ${JSON.stringify(publicArticles, null, 2)};\n`;
  const serverManifest = `export default ${JSON.stringify(serverArticles, null, 2)};\n`;
  const imagePath = `assets/images/${article.slug}.${imageExtension}`;
  const markdownPath = `content/articles/${article.slug}.md`;
  const entries = await Promise.all([
    createBlob(repository, renderMarkdown(article)),
    createBlob(repository, imageBuffer.toString("base64"), "base64"),
    createBlob(repository, publicManifest),
    createBlob(repository, serverManifest)
  ]).then(([markdownSha, imageSha, publicSha, serverSha]) => [
    { path: markdownPath, mode: "100644", type: "blob", sha: markdownSha },
    { path: imagePath, mode: "100644", type: "blob", sha: imageSha },
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
    body: JSON.stringify({ base_tree: commit.tree.sha, tree: entries })
  });
  const newCommit = await github(`/repos/${repository}/git/commits`, {
    method: "POST",
    body: JSON.stringify({
      message: `${article.status === "published" ? "Publish" : "Add review draft"}: ${article.title}`,
      tree: tree.sha,
      parents: [reference.object.sha]
    })
  });
  await github(`/repos/${repository}/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: newCommit.sha, force: false })
  });
  return newCommit.sha;
}

async function handleRequest(request) {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const account = await requireAccountRole(request, ["contributor", "editor"]);
  if (!account.authorized) return json({ error: account.error }, account.status);

  const form = await request.formData();
  const title = clean(form.get("title"));
  const summary = clean(form.get("summary"));
  const author = clean(form.get("author"));
  const category = clean(form.get("category"));
  const status = "review";
  const date = new Date().toISOString();
  const slug = slugify(title);
  const imageAlt = clean(form.get("imageAlt"));
  const imageFit = clean(form.get("imageFit")) || "cover";
  const featured = false;
  const image = form.get("image");
  const pastedBody = clean(form.get("body"));
  const documentBody = pastedBody ? "" : await readDocument(form.get("document"));
  const body = parseParagraphs(pastedBody || documentBody);

  if (!title || !summary || !author || !slug || !imageAlt || !body.length) {
    return json({ error: "Complete every required field and add the article text." }, 400);
  }
  if (!CATEGORIES.has(category)) return json({ error: "Select a valid section." }, 400);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return json({ error: "Enter a valid web address." }, 400);
  if (!image || !image.size || !IMAGE_TYPES.has(image.type)) return json({ error: "Select a valid lead image." }, 400);
  if (image.size > MAX_IMAGE_BYTES) return json({ error: "Select an image smaller than 4 MB." }, 400);
  if (!new Set(["cover", "contain"]).has(imageFit)) return json({ error: "Select a valid image display option." }, 400);
  if (title.length > 180 || summary.length > 400 || author.length > 100 || imageAlt.length > 250) {
    return json({ error: "One or more fields contain too much text." }, 400);
  }

  const imageExtension = IMAGE_TYPES.get(image.type);
  const imagePath = `assets/images/${slug}.${imageExtension}`;
  const article = {
    title,
    slug,
    summary,
    author,
    date,
    category,
    image: imagePath,
    imageAlt,
    featured,
    status,
    imageFit,
    emailSubject: title,
    emailPreheader: summary,
    sendAt: "",
    body
  };
  article.contentHash = articleHash(article);

  const commitSha = await commitArticle(article, Buffer.from(await image.arrayBuffer()), imageExtension);
  return json({
    message: "The article is ready for review.",
    status,
    slug,
    commitSha
  }, 201);
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
      console.error("Article submission failed", error);
      const exposed = error.status && error.status < 500;
      return json({ error: exposed ? error.message : "The article submission failed." }, error.status || 500);
    }
  }
};
