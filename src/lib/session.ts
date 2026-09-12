const SESSION_KEY = "cw_session_token";
const OFFICER_KEY = "cw_officer_passphrase";

export function getSessionToken(): string {
  let token = localStorage.getItem(SESSION_KEY);
  if (!token) {
    token = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, token);
  }
  return token;
}

export function getOfficerPassphrase(): string | null {
  return localStorage.getItem(OFFICER_KEY);
}

export function setOfficerPassphrase(value: string) {
  localStorage.setItem(OFFICER_KEY, value);
}

export function clearOfficerPassphrase() {
  localStorage.removeItem(OFFICER_KEY);
}
