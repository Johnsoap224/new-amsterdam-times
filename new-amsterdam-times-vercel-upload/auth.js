(function () {
  "use strict";

  const STORAGE_KEY = "nat-auth-session";
  let configPromise;

  function getConfig() {
    if (!configPromise) {
      configPromise = fetch("/api/auth-config", { headers: { Accept: "application/json" } })
        .then(async (response) => {
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || "The account service is not configured yet.");
          return result;
        });
    }
    return configPromise;
  }

  function loadSession() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
  }

  function saveSession(session) {
    if (session?.access_token && session?.refresh_token) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
    return session;
  }

  async function authRequest(path, { method = "GET", body, token } = {}) {
    const config = await getConfig();
    const response = await fetch(`${config.supabaseUrl}/auth/v1${path}`, {
      method,
      headers: {
        apikey: config.publishableKey,
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(result.msg || result.message || result.error_description || "The account request failed.");
      error.status = response.status;
      throw error;
    }
    return result;
  }

  async function refreshSession(session) {
    try {
      const refreshed = await authRequest("/token?grant_type=refresh_token", {
        method: "POST",
        body: { refresh_token: session.refresh_token }
      });
      return saveSession(refreshed);
    } catch (error) {
      saveSession(null);
      throw error;
    }
  }

  async function getSession() {
    const session = loadSession();
    if (!session) return null;
    const expiresAt = Number(session.expires_at || 0) * 1000;
    if (expiresAt && expiresAt > Date.now() + 60000) return session;
    return refreshSession(session);
  }

  async function getUser(currentSession) {
    const session = currentSession || await getSession();
    if (!session) return null;
    try {
      return await authRequest("/user", { token: session.access_token });
    } catch (error) {
      if (error.status === 401) saveSession(null);
      throw error;
    }
  }

  async function getProfile(currentSession, currentUser) {
    const config = await getConfig();
    const session = currentSession || await getSession();
    const user = currentUser || await getUser(session);
    if (!session || !user) return null;
    const response = await fetch(`${config.supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=id,display_name,role,created_at&limit=1`, {
      headers: {
        apikey: config.publishableKey,
        Authorization: `Bearer ${session.access_token}`,
        Accept: "application/json"
      }
    });
    const result = await response.json().catch(() => []);
    if (!response.ok) throw new Error(result.message || "The account profile could not load.");
    return result[0] || null;
  }

  async function signUp({ displayName, email, password }) {
    const config = await getConfig();
    const result = await authRequest(`/signup?redirect_to=${encodeURIComponent(`${config.siteUrl}/login.html?confirmed=1`)}`, {
      method: "POST",
      body: { email, password, data: { display_name: displayName } }
    });
    if (result.access_token) saveSession(result);
    return result;
  }

  async function signIn({ email, password }) {
    const result = await authRequest("/token?grant_type=password", {
      method: "POST",
      body: { email, password }
    });
    return saveSession(result);
  }

  async function signInWithGoogle() {
    const config = await getConfig();
    const authorizeUrl = new URL(`${config.supabaseUrl}/auth/v1/authorize`);
    authorizeUrl.searchParams.set("provider", "google");
    authorizeUrl.searchParams.set("redirect_to", `${config.siteUrl}/login.html`);
    window.location.assign(authorizeUrl.toString());
  }

  async function requestPasswordReset(email) {
    const config = await getConfig();
    return authRequest(`/recover?redirect_to=${encodeURIComponent(`${config.siteUrl}/login.html?mode=reset`)}`, {
      method: "POST",
      body: { email }
    });
  }

  async function updatePassword(password) {
    const session = await getSession();
    if (!session) throw new Error("Your session expired. Sign in again.");
    return authRequest("/user", {
      method: "PUT",
      token: session.access_token,
      body: { password }
    });
  }

  async function signOut() {
    const session = loadSession();
    try {
      if (session?.access_token) {
        await authRequest("/logout", { method: "POST", token: session.access_token });
      }
    } finally {
      saveSession(null);
    }
  }

  function captureSessionFromUrl() {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const accessToken = hash.get("access_token");
    const refreshToken = hash.get("refresh_token");
    if (!accessToken || !refreshToken) return null;
    const session = {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: Math.floor(Date.now() / 1000) + Number(hash.get("expires_in") || 3600),
      token_type: hash.get("token_type") || "bearer",
      type: hash.get("type") || ""
    };
    saveSession(session);
    history.replaceState(null, "", `${location.pathname}${location.search}`);
    return session;
  }

  async function requireAccount(roles = []) {
    const session = await getSession();
    if (!session) return { session: null, user: null, profile: null };
    const user = await getUser(session);
    const profile = await getProfile(session, user);
    if (roles.length && !roles.includes(profile?.role)) return { session, user, profile, allowed: false };
    return { session, user, profile, allowed: true };
  }

  window.NAT_AUTH = {
    captureSessionFromUrl,
    getConfig,
    getProfile,
    getSession,
    getUser,
    requestPasswordReset,
    requireAccount,
    signIn,
    signInWithGoogle,
    signOut,
    signUp,
    updatePassword
  };
}());
