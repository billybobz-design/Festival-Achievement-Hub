import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

export type AdminOperationLogEntry = {
  action: "activity.create" | "activity.delete";
  status: "authorized" | "completed";
  actor: string;
  eventId: string;
  eventName: string;
  source?: "manual" | "activity-package";
};

export function getAdminOperationLogPath() {
  const configured = process.env.ADMIN_OPERATION_LOG_PATH?.trim();
  if (configured) {
    if (!path.isAbsolute(configured)) throw new Error("ADMIN_OPERATION_LOG_PATH must be an absolute path");
    return configured;
  }
  return path.join(process.cwd(), "data", "admin-operations.jsonl");
}

export async function appendAdminOperationLog(entry: AdminOperationLogEntry) {
  const filePath = getAdminOperationLogPath();
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const line = JSON.stringify({ timestamp: new Date().toISOString(), ...entry });
  await appendFile(filePath, `${line}\n`, { encoding: "utf8", mode: 0o600 });
}
