(function () {
  "use strict";

  const root = document.querySelector("[data-account-root]");

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;"
    })[character]);
  }

  async function initialize() {
    const account = await window.NAT_AUTH.requireAccount(["contributor", "editor", "admin"]);
    if (!account.session) {
      window.location.replace("login.html?next=account.html");
      return;
    }
    if (!account.allowed || !account.profile) {
      root.innerHTML = '<p class="account-message account-message--error">Your account profile could not load.</p>';
      return;
    }

    const canPublish = ["editor", "admin"].includes(account.profile.role);
    const roleLabel = account.profile.role === "admin" ? "Administrator" : account.profile.role === "editor" ? "Editor" : "Contributor";
    root.innerHTML = `
      <header class="account-card__header">
        <p class="eyebrow">Account details</p>
        <h1>Your account</h1>
      </header>
      <dl class="account-details">
        <div><dt>Name</dt><dd>${escapeHtml(account.profile.display_name)}</dd></div>
        <div><dt>Email</dt><dd>${escapeHtml(account.user.email)}</dd></div>
        <div><dt>Role</dt><dd>${roleLabel}</dd></div>
      </dl>
      <div class="account-actions">
        <a class="account-primary-button" href="article-submission.html">Submit an article</a>
        ${canPublish ? '<a class="account-secondary-button" href="publish.html">Open Publishing Desk</a>' : ""}
        <button class="account-text-button" type="button" data-sign-out>Sign out</button>
      </div>
      <p class="account-message" data-account-message aria-live="polite"></p>
    `;

    root.querySelector("[data-sign-out]").addEventListener("click", async () => {
      const button = root.querySelector("[data-sign-out]");
      button.disabled = true;
      try {
        await window.NAT_AUTH.signOut();
        window.location.replace("login.html");
      } catch (error) {
        const message = root.querySelector("[data-account-message]");
        message.className = "account-message account-message--error";
        message.textContent = error.message || "The sign out request failed.";
        button.disabled = false;
      }
    });
  }

  initialize().catch((error) => {
    root.innerHTML = `<p class="account-message account-message--error">${escapeHtml(error.message || "The account could not load.")}</p>`;
  });
}());
