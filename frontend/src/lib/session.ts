const SESSION_KEY = "cw-session-token";

/** One anonymous token per browser session — used only to cap "I see this
 * too" confirmations at one per report per person, never tied to identity. */
export function getSessionToken(): string {
  let token = localStorage.getItem(SESSION_KEY);
  if (!token) {
    token = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, token);
  }
  return token;
}
