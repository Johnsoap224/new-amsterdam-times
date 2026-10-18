(async function () {
  "use strict";

  const form = document.querySelector("[data-publisher-form]");
  if (!form) return;
  const guard = document.querySelector("[data-auth-guard]");
  let account;
  try {
    account = await window.NAT_AUTH.requireAccount(["contributor", "editor", "admin"]);
  } catch (error) {
    guard.innerHTML = `<div class="review-empty"><h1>The account service could not load.</h1><p>${error.message}</p></div>`;
    return;
  }
  if (!account.session) {
    window.location.replace(`login.html?next=${encodeURIComponent("article-submission.html")}`);
    return;
  }
  if (!account.allowed) {
    guard.innerHTML = '<div class="review-empty"><h1>This account cannot submit articles.</h1><p>Ask an editor to check your account.</p></div>';
    return;
  }
  guard.hidden = true;
  document.querySelectorAll("[data-submission-content]").forEach((node) => { node.hidden = false; });

  const documentInput = form.elements.document;
  const imageInput = form.elements.image;
  const statusNode = form.querySelector("[data-publisher-status]");
  const submitButton = form.querySelector("[data-submit-button]");
  const imagePreview = form.querySelector("[data-image-preview]");
  let previewUrl = "";

  function showStatus(message, type, link) {
    statusNode.className = `publisher-status publisher-status--${type}`;
    statusNode.replaceChildren(document.createTextNode(message));
    if (link) {
      const anchor = document.createElement("a");
      anchor.href = link;
      anchor.textContent = "Open article";
      statusNode.append(" ", anchor);
    }
  }

  function showFileName(input, selector, fallback) {
    const target = form.querySelector(selector);
    target.textContent = input.files[0]?.name || fallback;
  }

  function setDroppedFile(input, file) {
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function configureDropZone(selector, input, acceptsFile) {
    const zone = form.querySelector(selector);
    ["dragenter", "dragover"].forEach((eventName) => {
      zone.addEventListener(eventName, (event) => {
        event.preventDefault();
        zone.classList.add("is-dragging");
      });
    });
    ["dragleave", "drop"].forEach((eventName) => {
      zone.addEventListener(eventName, (event) => {
        event.preventDefault();
        zone.classList.remove("is-dragging");
      });
    });
    zone.addEventListener("drop", (event) => {
      const file = event.dataTransfer.files[0];
      if (file && acceptsFile(file)) setDroppedFile(input, file);
    });
  }

  documentInput.addEventListener("change", () => {
    showFileName(documentInput, "[data-document-name]", "No document selected");
  });

  imageInput.addEventListener("change", () => {
    showFileName(imageInput, "[data-image-name]", "No image selected");
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    const file = imageInput.files[0];
    imagePreview.hidden = !file;
    if (file) {
      previewUrl = URL.createObjectURL(file);
      imagePreview.querySelector("img").src = previewUrl;
    }
  });

  configureDropZone("[data-document-drop]", documentInput, (file) => /\.(txt|md|markdown|docx)$/i.test(file.name));
  configureDropZone("[data-image-drop]", imageInput, (file) => /^image\/(jpeg|png|webp|gif)$/.test(file.type));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    statusNode.className = "publisher-status";
    statusNode.textContent = "";

    const body = form.elements.body.value.trim();
    if (!body && !documentInput.files.length) {
      form.elements.body.setCustomValidity("Paste the article text or select a document.");
    } else {
      form.elements.body.setCustomValidity("");
    }

    if (!form.reportValidity()) {
      showStatus("Complete the marked fields before you submit the article.", "error");
      return;
    }

    const image = imageInput.files[0];
    if (image.size > 4 * 1024 * 1024) {
      showStatus("Select an image smaller than 4 MB.", "error");
      imageInput.focus();
      return;
    }

    const data = new FormData(form);

    submitButton.disabled = true;
    submitButton.textContent = "Submitting…";
    showStatus("Uploading the article and image…", "working");

    try {
      const session = await window.NAT_AUTH.getSession();
      if (!session) {
        window.location.href = `login.html?next=${encodeURIComponent("article-submission.html")}`;
        return;
      }
      const response = await fetch("/api/submit-article", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: data
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The article submission failed.");

      showStatus("The article is ready for editor review.", "success");
    } catch (error) {
      showStatus(error.message || "The submission failed. Check the marked fields and try again.", "error");
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "Submit article";
    }
  });
}());
