import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { getSql } from "../../db";
import { HttpError } from "./server-http";

const SESSION_COOKIE = "festival_admin_session";
const SESSION_SECONDS = 8 * 60 * 60;
const LOGIN_WINDOW_SECONDS = 15 * 60;
const LOGIN_ATTEMPT_LIMIT = 8;
const SCRYPT_COST = 16_384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const KEY_LENGTH = 64;

export type AdminRole = "superadmin" | "admin";

export type AdminPrincipal = {
  id: number;
  username: string;
  role: AdminRole;
};

export type AdminSession = {
  principal: AdminPrincipal;
  tokenHash: string;
};

export type AdminListItem = AdminPrincipal & {
  enabled: boolean;
  createdBy: string | null;
  createdAt: string;
  lastLoginAt: string | null;
};

export const adminUsernamePattern = /^[a-z0-9][a-z0-9._-]{2,31}$/;

export function normalizeAdminUsername(value: string) {
  return value.trim().toLowerCase();
}

export function validateAdminPassword(password: string) {
  return password.length >= 1 && password.length <= 128;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function deriveKey(password: string, salt: Buffer, cost = SCRYPT_COST, blockSize = SCRYPT_BLOCK_SIZE, parallelization = SCRYPT_PARALLELIZATION) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, { N: cost, r: blockSize, p: parallelization }, (error, key) => {
      if (error) reject(error);
      else resolve(key as Buffer);
    });
  });
}

export async function hashAdminPassword(password: string) {
  if (!validateAdminPassword(password)) {
    throw new HttpError(400, "password must be between 1 and 128 characters", "ADMIN_PASSWORD_INVALID");
  }
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt);
  return ["scrypt", SCRYPT_COST, SCRYPT_BLOCK_SIZE, SCRYPT_PARALLELIZATION, salt.toString("base64url"), key.toString("base64url")].join("$");
}

export async function verifyAdminPassword(password: string, encoded: string) {
  const [algorithm, costText, blockSizeText, parallelizationText, saltText, keyText] = encoded.split("$");
  if (algorithm !== "scrypt" || !costText || !blockSizeText || !parallelizationText || !saltText || !keyText) return false;
  const cost = Number.parseInt(costText, 10);
  const blockSize = Number.parseInt(blockSizeText, 10);
  const parallelization = Number.parseInt(parallelizationText, 10);
  if (cost !== SCRYPT_COST || blockSize !== SCRYPT_BLOCK_SIZE || parallelization !== SCRYPT_PARALLELIZATION) return false;
  try {
    const expected = Buffer.from(keyText, "base64url");
    const actual = await deriveKey(password, Buffer.from(saltText, "base64url"), cost, blockSize, parallelization);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function readCookie(request: Request, name: string) {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return decodeURIComponent(part.slice(separator + 1).trim());
  }
  return "";
}

function requestIsHttps(request: Request) {
  if (process.env.TRUST_PROXY_HEADERS === "true") {
    return request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim() === "https";
  }
  return new URL(request.url).protocol === "https:";
}

export function createAdminSessionCookie(token: string, request: Request) {
  const secure = requestIsHttps(request) ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; SameSite=Lax${secure}`;
}

export function clearAdminSessionCookie(request: Request) {
  const secure = requestIsHttps(request) ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`;
}

function requestAddress(request: Request) {
  if (process.env.TRUST_PROXY_HEADERS !== "true") return "direct";
  return request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim()
    || request.headers.get("x-real-ip")?.trim()
    || "proxy-unknown";
}

async function ensureBootstrapAdmin() {
  const sql = getSql();
  const existing = await sql<{ count: number }[]>`SELECT count(*)::integer AS count FROM admins`;
  if ((existing[0]?.count ?? 0) > 0) return;

  const username = normalizeAdminUsername(process.env.ADMIN_USERNAME ?? "");
  const password = process.env.ADMIN_PASSWORD ?? "";
  if (!adminUsernamePattern.test(username) || !validateAdminPassword(password)) {
    throw new HttpError(503, "initial administrator is not configured", "ADMIN_NOT_CONFIGURED");
  }
  const passwordHash = await hashAdminPassword(password);
  await sql`
    INSERT INTO admins (username, password_hash, role, enabled, created_by)
    VALUES (${username}, ${passwordHash}, 'superadmin', true, 'bootstrap')
    ON CONFLICT (username) DO NOTHING
  `;
  await logAdminAudit("system", "admin.bootstrap", username, { role: "superadmin" });
}

async function countLoginAttempt(rateKey: string) {
  const rows = await getSql()<{ attempt_count: number }[]>`
    INSERT INTO admin_login_attempts (rate_key, window_started_at, attempt_count)
    VALUES (${rateKey}, CURRENT_TIMESTAMP, 1)
    ON CONFLICT (rate_key) DO UPDATE SET
      window_started_at = CASE
        WHEN admin_login_attempts.window_started_at <= CURRENT_TIMESTAMP - make_interval(secs => ${LOGIN_WINDOW_SECONDS}) THEN CURRENT_TIMESTAMP
        ELSE admin_login_attempts.window_started_at END,
      attempt_count = CASE
        WHEN admin_login_attempts.window_started_at <= CURRENT_TIMESTAMP - make_interval(secs => ${LOGIN_WINDOW_SECONDS}) THEN 1
        ELSE admin_login_attempts.attempt_count + 1 END
    RETURNING attempt_count
  `;
  return rows[0]?.attempt_count ?? LOGIN_ATTEMPT_LIMIT + 1;
}

export async function loginAdmin(request: Request, rawUsername: string, password: string) {
  await ensureBootstrapAdmin();
  const username = normalizeAdminUsername(rawUsername);
  const rateKey = sha256(`${requestAddress(request)}\n${username}`);
  if (await countLoginAttempt(rateKey) > LOGIN_ATTEMPT_LIMIT) {
    throw new HttpError(429, "too many login attempts", "ADMIN_LOGIN_RATE_LIMITED");
  }

  const rows = adminUsernamePattern.test(username)
    ? await getSql()<{
        id: number;
        username: string;
        password_hash: string;
        role: AdminRole;
        enabled: boolean;
      }[]>`SELECT id, username, password_hash, role, enabled FROM admins WHERE username = ${username} LIMIT 1`
    : [];
  const admin = rows[0];
  const fallbackHash = "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  const passwordMatches = await verifyAdminPassword(password, admin?.password_hash ?? fallbackHash);
  if (!admin || !admin.enabled || !passwordMatches) {
    await logAdminAudit(username || null, "admin.login_failed", username || null, { address: requestAddress(request) });
    throw new HttpError(401, "invalid username or password", "ADMIN_LOGIN_FAILED");
  }

  await getSql()`DELETE FROM admin_login_attempts WHERE rate_key = ${rateKey}`;
  await getSql()`DELETE FROM admin_sessions WHERE expires_at <= CURRENT_TIMESTAMP`;
  const token = randomBytes(32).toString("base64url");
  const csrfToken = randomBytes(24).toString("base64url");
  const tokenHash = sha256(token);
  await getSql()`
    INSERT INTO admin_sessions (token_hash, csrf_token_hash, admin_id, expires_at)
    VALUES (${tokenHash}, ${sha256(csrfToken)}, ${admin.id}, CURRENT_TIMESTAMP + make_interval(secs => ${SESSION_SECONDS}))
  `;
  await getSql()`UPDATE admins SET last_login_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ${admin.id}`;
  await logAdminAudit(admin.username, "admin.login", admin.username, {});
  return {
    principal: { id: admin.id, username: admin.username, role: admin.role } satisfies AdminPrincipal,
    token,
    csrfToken,
  };
}

export async function getAdminSession(request: Request): Promise<AdminSession | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = sha256(token);
  const rows = await getSql()<{
    id: number;
    username: string;
    role: AdminRole;
    enabled: boolean;
  }[]>`
    SELECT a.id, a.username, a.role, a.enabled
    FROM admin_sessions s
    JOIN admins a ON a.id = s.admin_id
    WHERE s.token_hash = ${tokenHash} AND s.expires_at > CURRENT_TIMESTAMP
    LIMIT 1
  `;
  const admin = rows[0];
  if (!admin?.enabled) return null;
  await getSql()`UPDATE admin_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE token_hash = ${tokenHash}`;
  return { principal: { id: admin.id, username: admin.username, role: admin.role }, tokenHash };
}

export async function requireAdminSession(request: Request, options: { csrf?: boolean; superadmin?: boolean } = {}) {
  const session = await getAdminSession(request);
  if (!session) throw new HttpError(401, "administrator login required", "AUTH_REQUIRED");
  if (options.superadmin && session.principal.role !== "superadmin") {
    throw new HttpError(403, "super administrator permission required", "SUPERADMIN_REQUIRED");
  }
  if (options.csrf) {
    const supplied = request.headers.get("x-csrf-token") ?? "";
    const rows = await getSql()<{ csrf_token_hash: string }[]>`
      SELECT csrf_token_hash FROM admin_sessions WHERE token_hash = ${session.tokenHash} LIMIT 1
    `;
    const expected = rows[0]?.csrf_token_hash ?? "";
    const actual = sha256(supplied);
    const expectedBuffer = Buffer.from(expected);
    const actualBuffer = Buffer.from(actual);
    if (!supplied || expectedBuffer.length !== actualBuffer.length || !timingSafeEqual(expectedBuffer, actualBuffer)) {
      throw new HttpError(403, "invalid CSRF token", "CSRF_REJECTED");
    }
  }
  return session;
}

export async function requireCurrentAdminPassword(principal: AdminPrincipal, password: string) {
  if (!validateAdminPassword(password)) {
    throw new HttpError(403, "current administrator password is incorrect", "ADMIN_PASSWORD_CONFIRMATION_FAILED");
  }
  const rows = await getSql()<Array<{ password_hash: string; enabled: boolean }>>`
    SELECT password_hash, enabled FROM admins WHERE id = ${principal.id} LIMIT 1
  `;
  const admin = rows[0];
  if (!admin?.enabled || !await verifyAdminPassword(password, admin.password_hash)) {
    throw new HttpError(403, "current administrator password is incorrect", "ADMIN_PASSWORD_CONFIRMATION_FAILED");
  }
}

export async function rotateAdminCsrf(session: AdminSession) {
  const csrfToken = randomBytes(24).toString("base64url");
  await getSql()`UPDATE admin_sessions SET csrf_token_hash = ${sha256(csrfToken)} WHERE token_hash = ${session.tokenHash}`;
  return csrfToken;
}

export async function logoutAdmin(session: AdminSession) {
  await getSql()`DELETE FROM admin_sessions WHERE token_hash = ${session.tokenHash}`;
  await logAdminAudit(session.principal.username, "admin.logout", session.principal.username, {});
}

export async function listAdmins(): Promise<AdminListItem[]> {
  const rows = await getSql()<{
    id: number;
    username: string;
    role: AdminRole;
    enabled: boolean;
    created_by: string | null;
    created_at: Date;
    last_login_at: Date | null;
  }[]>`
    SELECT id, username, role, enabled, created_by, created_at, last_login_at
    FROM admins ORDER BY role DESC, username ASC
  `;
  return rows.map((row) => ({
    id: row.id,
    username: row.username,
    role: row.role,
    enabled: row.enabled,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    lastLoginAt: row.last_login_at?.toISOString() ?? null,
  }));
}

export async function createAdmin(actor: AdminPrincipal, rawUsername: string, password: string) {
  const username = normalizeAdminUsername(rawUsername);
  if (!adminUsernamePattern.test(username)) {
    throw new HttpError(400, "invalid administrator username", "ADMIN_USERNAME_INVALID");
  }
  const passwordHash = await hashAdminPassword(password);
  try {
    const rows = await getSql()<{ id: number }[]>`
      INSERT INTO admins (username, password_hash, role, enabled, created_by)
      VALUES (${username}, ${passwordHash}, 'admin', true, ${actor.username})
      RETURNING id
    `;
    await logAdminAudit(actor.username, "admin.create", username, { role: "admin" });
    return { id: rows[0]!.id, username, role: "admin" as const };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      throw new HttpError(409, "administrator username already exists", "ADMIN_ALREADY_EXISTS");
    }
    throw error;
  }
}

export async function deleteAdmin(actor: AdminPrincipal, rawUsername: string) {
  const username = normalizeAdminUsername(rawUsername);
  if (username === actor.username) throw new HttpError(409, "cannot delete the current administrator", "ADMIN_DELETE_SELF");
  const rows = await getSql()<{ role: AdminRole }[]>`SELECT role FROM admins WHERE username = ${username} LIMIT 1`;
  const target = rows[0];
  if (!target) throw new HttpError(404, "administrator not found", "ADMIN_NOT_FOUND");
  if (target.role === "superadmin") throw new HttpError(403, "the bootstrap super administrator cannot be deleted", "SUPERADMIN_PROTECTED");
  await getSql()`DELETE FROM admins WHERE username = ${username}`;
  await logAdminAudit(actor.username, "admin.delete", username, {});
}

export async function logAdminAudit(actorUsername: string | null, action: string, target: string | null, detail: Record<string, unknown>) {
  await getSql()`
    INSERT INTO admin_audit_logs (actor_username, action, target, detail_json)
    VALUES (${actorUsername}, ${action}, ${target}, ${JSON.stringify(detail)})
  `;
}
