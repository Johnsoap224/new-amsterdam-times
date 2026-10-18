(function () {
  "use strict";

  const forms = Array.from(document.querySelectorAll("[data-auth-form]"));
  const tabs = document.querySelector("[data-account-tabs]");
  const message = document.querySelector("[data-account-message]");
  const oauth = document.querySelector("[data-account-oauth]");
  const googleButton = document.querySelector("[data-google-sign-in]");
  const parameters = new URLSearchParams(window.location.search);

  function safeNext() {
    const next = parameters.get("next") || "account.html";
    return /^[a-z0-9-]+\.html(?:\?.*)?$/i.test(next) ? next : "account.html";
  }

  function showMessage(text, type = "info") {
    message.className = `account-message account-message--${type}`;
    message.textContent = text;
  }

  function setMode(mode) {
    forms.forEach((form) => { form.hidden = form.dataset.authForm !== mode; });
    if (tabs) {
      tabs.hidden = mode === "forgot" || mode === "reset";
      tabs.querySelectorAll("[data-mode]").forEach((button) => {
        button.setAttribute("aria-selected", String(button.dataset.mode === mode));
      });
    }
    if (oauth) oauth.hidden = mode === "forgot" || mode === "reset";
    message.textContent = "";
    message.className = "account-message";
    document.querySelector(`[data-auth-form="${mode}"] input`)?.focus();
  }

  function setBusy(form, busy) {
    const button = form.querySelector("button[type='submit']");
    button.disabled = busy;
    if (!button.dataset.label) button.dataset.label = button.textContent;
    button.textContent = busy ? "Please wait…" : button.dataset.label;
  }

  function friendlyError(error) {
    const value = String(error?.message || "").toLowerCase();
    if (value.includes("invalid login") || value.includes("invalid credentials")) {
      return "The email address or password is incorrect.";
    }
    if (value.includes("email not confirmed")) return "Confirm your email address before you sign in.";
    if (value.includes("already registered") || value.includes("already exists")) return "An account already uses this email address.";
    return error?.message || "The account request failed.";
  }

  tabs?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-mode]");
    if (button) setMode(button.dataset.mode);
  });
  document.querySelectorAll("[data-mode-link]").forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.modeLink));
  });

  googleButton?.addEventListener("click", async () => {
    googleButton.disabled = true;
    googleButton.classList.add("is-busy");
    try {
      await window.NAT_AUTH.signInWithGoogle();
    } catch (error) {
      showMessage(friendlyError(error), "error");
      googleButton.disabled = false;
      googleButton.classList.remove("is-busy");
    }
  });

  const signInForm = document.querySelector('[data-auth-form="signin"]');
  signInForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setBusy(signInForm, true);
    try {
      const data = new FormData(signInForm);
      await window.NAT_AUTH.signIn({ email: data.get("email"), password: data.get("password") });
      window.location.href = safeNext();
    } catch (error) {
      showMessage(friendlyError(error), "error");
      setBusy(signInForm, false);
    }
  });

  const signUpForm = document.querySelector('[data-auth-form="signup"]');
  signUpForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(signUpForm);
    if (String(data.get("password")).length < 8) {
      showMessage("Use at least eight characters for the password.", "error");
      return;
    }
    if (data.get("password") !== data.get("confirmPassword")) {
      showMessage("The passwords do not match.", "error");
      return;
    }
    setBusy(signUpForm, true);
    try {
      const result = await window.NAT_AUTH.signUp({
        displayName: data.get("displayName"),
        email: data.get("email"),
        password: data.get("password")
      });
      if (result.access_token) {
        window.location.href = "account.html";
        return;
      }
      signUpForm.reset();
      showMessage("Check your email to confirm your account. Then return here to sign in.", "success");
    } catch (error) {
      showMessage(friendlyError(error), "error");
    } finally {
      setBusy(signUpForm, false);
    }
  });

  const forgotForm = document.querySelector('[data-auth-form="forgot"]');
  forgotForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setBusy(forgotForm, true);
    try {
      const data = new FormData(forgotForm);
      await window.NAT_AUTH.requestPasswordReset(data.get("email"));
      forgotForm.reset();
      showMessage("We sent a password reset link if an account uses that email address.", "success");
    } catch (error) {
      showMessage(friendlyError(error), "error");
    } finally {
      setBusy(forgotForm, false);
    }
  });

  const resetForm = document.querySelector('[data-auth-form="reset"]');
  resetForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(resetForm);
    if (String(data.get("password")).length < 8) {
      showMessage("Use at least eight characters for the password.", "error");
      return;
    }
    if (data.get("password") !== data.get("confirmPassword")) {
      showMessage("The passwords do not match.", "error");
      return;
    }
    setBusy(resetForm, true);
    try {
      await window.NAT_AUTH.updatePassword(data.get("password"));
      await window.NAT_AUTH.signOut();
      setMode("signin");
      showMessage("Your password is updated. Sign in with the new password.", "success");
    } catch (error) {
      showMessage(friendlyError(error), "error");
      setBusy(resetForm, false);
    }
  });

  async function initialize() {
    const captured = window.NAT_AUTH.captureSessionFromUrl();
    const requestedMode = captured?.type === "recovery" ? "reset" : parameters.get("mode");
    if (requestedMode === "reset" && !await window.NAT_AUTH.getSession()) {
      setMode("forgot");
      showMessage("Your reset link is invalid or expired. Request a new link.", "error");
      return;
    }
    if (requestedMode === "reset") {
      setMode("reset");
      return;
    }
    if (captured || parameters.get("confirmed") === "1") {
      if (await window.NAT_AUTH.getSession()) {
        window.location.href = safeNext();
        return;
      }
      showMessage("Your account is ready. Sign in to continue.", "success");
    }
    setMode(parameters.get("mode") === "signup" ? "signup" : "signin");
  }

  initialize().catch((error) => showMessage(friendlyError(error), "error"));
}());
