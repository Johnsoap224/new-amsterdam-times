import { createHash } from "node:crypto";
import mammoth from "mammoth";
import { CanvasFactory } from "pdf-parse/worker";
import { PDFParse } from "pdf-parse";
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
const DOCUMENT_EXTENSIONS = new Set(["txt", "md", "markdown", "docx", "pdf"]);
const IMAGE_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"]
]);
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
const MAX_PDF_PAGES = 20;
const MAX_PDF_IMAGES = 20;
const MAX_PDF_IMAGE_BYTES = 16 * 1024 * 1024;
const MAX_DOCX_IMAGES = 20;
const MAX_DOCX_IMAGE_BYTES = 16 * 1024 * 1024;
const SITE_ROOT = "new-amsterdam-times-vercel-upload";

function repositoryPath(path) {
  return `${SITE_ROOT}/${path}`;
}

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

function bodyBlockMarkdown(block) {
  if (typeof block === "string") return block;
  if (block.type === "image") return `![${block.alt}](${block.src})`;
  if (block.type === "heading") return `${"#".repeat(Math.min(6, Math.max(1, Number(block.level) || 2)))} ${block.text}`;
  if (block.type === "list-item") return `${block.ordered ? "1." : "-"} ${block.text}`;
  return String(block.text || "");
}

function parseParagraphs(value) {
  return clean(value)
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => decodeCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => decodeCodePoint(parseInt(code, 16)));
}

function decodeCodePoint(value) {
  return Number.isInteger(value) && value >= 0 && value <= 0x10ffff
    ? String.fromCodePoint(value)
    : "�";
}

function docxText(html) {
  return decodeHtml(html.replace(/<br\s*\/?\s*>/gi, " ").replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function docxBlocks(html) {
  const blocks = [];
  const blockPattern = /<(h[1-6]|p|li|td|th)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  const imagePattern = /<img\b(?=[^>]*\bsrc=["'](nat-docx-image-\d+)["'])[^>]*>/gi;
  for (const match of html.matchAll(blockPattern)) {
    const tag = match[1].toLowerCase();
    const content = match[2];
    const kind = tag.startsWith("h") ? "heading" : tag === "li" ? "list-item" : "paragraph";
    const makeText = (value) => {
      const text = docxText(value);
      if (!text) return null;
      if (kind === "heading") return { type: "heading", level: Math.max(2, Number(tag.slice(1))), text };
      if (kind === "list-item") return { type: "list-item", text };
      return text;
    };
    let cursor = 0;
    for (const imageMatch of content.matchAll(imagePattern)) {
      const preceding = makeText(content.slice(cursor, imageMatch.index));
      if (preceding) blocks.push(preceding);
      const altMatch = imageMatch[0].match(/\balt=["']([^"']*)["']/i);
      blocks.push({ type: "image", token: imageMatch[1], alt: decodeHtml(altMatch?.[1] || "") });
      cursor = imageMatch.index + imageMatch[0].length;
    }
    const trailing = makeText(content.slice(cursor));
    if (trailing) blocks.push(trailing);
  }
  return blocks;
}

async function readWordDocument(buffer) {
  const images = [];
  let imageBytes = 0;
  let imageCount = 0;
  let imageError = null;
  const converted = await mammoth.convertToHtml({ buffer }, {
    convertImage: mammoth.images.imgElement(async (image) => {
      imageCount += 1;
      const token = `nat-docx-image-${imageCount}`;
      const extension = IMAGE_TYPES.get(image.contentType);
      if (!extension) {
        imageError = new Error("Use JPG, PNG, WebP, or GIF images in the Word document.");
        return { src: "nat-docx-image-unsupported" };
      }
      if (imageCount > MAX_DOCX_IMAGES) {
        imageError = new Error(`Use ${MAX_DOCX_IMAGES} images or fewer in the Word document.`);
        return { src: "nat-docx-image-limit" };
      }
      const data = Buffer.from(await image.readAsBuffer());
      imageBytes += data.length;
      if (imageBytes > MAX_DOCX_IMAGE_BYTES) {
        imageError = new Error("The Word document’s images are too large to convert.");
        return { src: "nat-docx-image-size-limit" };
      }
      images.push({ token, extension, data });
      return { src: token };
    })
  });
  if (imageError) throw Object.assign(imageError, { status: 400 });
  return { blocks: docxBlocks(converted.value), images };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]));
  }
  return value;
}

function articleHash(article) {
  const emailContent = {};
  [
    "title", "slug", "summary", "author", "date", "category", "image",
    "imageAlt", "emailSubject", "emailPreheader", "body"
  ].forEach((key) => { emailContent[key] = article[key]; });
  const stable = JSON.stringify(canonicalJson(emailContent));
  return createHash("sha256").update(stable, "utf8").digest("hex");
}

async function readDocument(file) {
  if (!file || !file.size) return { text: "", pages: [], blocks: [], images: [] };
  if (file.size > MAX_DOCUMENT_BYTES) throw Object.assign(new Error("Select a document smaller than 2 MB."), { status: 400 });
  const extension = file.name.split(".").pop().toLowerCase();
  if (!DOCUMENT_EXTENSIONS.has(extension)) {
    throw Object.assign(new Error("Select a .txt, .md, .docx, or PDF document."), { status: 400 });
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  if (extension === "pdf") {
    if (!buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
      throw Object.assign(new Error("The selected file is not a valid PDF."), { status: 400 });
    }
    const parser = new PDFParse({ data: new Uint8Array(buffer), CanvasFactory });
    try {
      const [textResult, imageResult] = await Promise.all([
        parser.getText({ lineEnforce: true }),
        parser.getImage({ imageThreshold: 0, imageBuffer: true, imageDataUrl: false })
      ]);
      if (textResult.total > MAX_PDF_PAGES) {
        throw Object.assign(new Error(`Select a PDF with ${MAX_PDF_PAGES} pages or fewer.`), { status: 400 });
      }
      const imagesByPage = new Map(imageResult.pages.map((page) => [page.pageNumber, page.images]));
      let imageCount = 0;
      let imageBytes = 0;
      const pages = textResult.pages.map((page) => {
        const images = imagesByPage.get(page.num) || [];
        imageCount += images.length;
        imageBytes += images.reduce((total, image) => total + image.data.length, 0);
        return { num: page.num, text: page.text, images };
      });
      if (imageCount > MAX_PDF_IMAGES || imageBytes > MAX_PDF_IMAGE_BYTES) {
        throw Object.assign(new Error("This PDF contains too many or too-large images to convert. Reduce its images and submit it again."), { status: 400 });
      }
      return { text: textResult.text, pages, blocks: [], images: [] };
    } catch (error) {
      if (error.status) throw error;
      throw Object.assign(new Error("The PDF could not be converted. Try a text-based PDF or paste the article text."), { status: 400 });
    } finally {
      await parser.destroy();
    }
  }
  if (extension === "docx") {
    const result = await readWordDocument(buffer);
    return { text: "", pages: [], blocks: result.blocks, images: result.images };
  }
  return { text: buffer.toString("utf8"), pages: [], blocks: [], images: [] };
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
    article.body.map(bodyBlockMarkdown).join("\n\n"),
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
  const result = await github(`/repos/${repository}/contents/${repositoryPath(path)}?ref=${encodeURIComponent(branch)}`);
  return Buffer.from(result.content.replace(/\n/g, ""), "base64").toString("utf8");
}

async function createBlob(repository, content, encoding = "utf-8") {
  const result = await github(`/repos/${repository}/git/blobs`, {
    method: "POST",
    body: JSON.stringify({ content, encoding })
  });
  return result.sha;
}

async function commitArticle(article, imageBuffer, imageExtension, inlineImages) {
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
  const blobs = await Promise.all([
    createBlob(repository, renderMarkdown(article)),
    createBlob(repository, imageBuffer.toString("base64"), "base64"),
    createBlob(repository, publicManifest),
    createBlob(repository, serverManifest),
    ...inlineImages.map((image) => createBlob(repository, image.data.toString("base64"), "base64"))
  ]);
  const [markdownSha, imageSha, publicSha, serverSha, ...inlineImageShas] = blobs;
  const entries = [
    { path: repositoryPath(markdownPath), mode: "100644", type: "blob", sha: markdownSha },
    { path: repositoryPath(imagePath), mode: "100644", type: "blob", sha: imageSha },
    { path: repositoryPath("content/articles.js"), mode: "100644", type: "blob", sha: publicSha },
    { path: repositoryPath("api/_articles-data.mjs"), mode: "100644", type: "blob", sha: serverSha }
  ];
  inlineImages.forEach((image, index) => {
    entries.push({ path: repositoryPath(image.path), mode: "100644", type: "blob", sha: inlineImageShas[index] });
  });

  if (priorFeatured) {
    const oldMarkdown = await getRepositoryFile(repository, `content/articles/${priorFeatured.slug}.md`, branch);
    const updatedMarkdown = oldMarkdown.replace(/^featured:\s*true\s*$/m, "featured: false");
    entries.push({
      path: repositoryPath(`content/articles/${priorFeatured.slug}.md`),
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
  const account = await requireAccountRole(request, ["contributor", "editor", "admin"]);
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
  const document = await readDocument(form.get("document"));
  const body = parseParagraphs(pastedBody || (document.pages.length || document.blocks.length ? "" : document.text));
  const inlineImages = [];
  const docxImages = new Map(document.images.map((image) => [image.token, image]));
  let imageNumber = 0;
  for (const page of document.pages) {
    if (!pastedBody) body.push(...parseParagraphs(page.text));
    for (const image of page.images) {
      imageNumber += 1;
      const path = `assets/articles/${slug}-image-${imageNumber}.png`;
      const alt = `Image ${imageNumber} from page ${page.num} of the submitted PDF`;
      body.push({ type: "image", src: path, alt });
      inlineImages.push({ path, data: Buffer.from(image.data) });
    }
  }
  for (const block of document.blocks) {
    if (pastedBody && block.type !== "image") continue;
    if (block.type !== "image") {
      body.push(block);
      continue;
    }
    const image = docxImages.get(block.token);
    if (!image) continue;
    imageNumber += 1;
    const path = `assets/articles/${slug}-word-image-${imageNumber}.${image.extension}`;
    body.push({
      type: "image",
      src: path,
      alt: block.alt || `Image ${imageNumber} from the submitted Word document`
    });
    inlineImages.push({ path, data: image.data });
  }

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

  const commitSha = await commitArticle(article, Buffer.from(await image.arrayBuffer()), imageExtension, inlineImages);
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
