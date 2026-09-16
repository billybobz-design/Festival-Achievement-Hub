import { apiError, HttpError, noStoreJson, readJson, requireSameOrigin } from "../../../lib/server-http";
import { MAX_PACKAGE_BYTES, parseActivityPackage } from "../../../lib/activity-package";
import { importActivityPackage } from "../../../../db/activity-packages";
import { newFestivalSchema } from "../../../lib/validation";
import { createFestival, FestivalAlreadyExistsError, listFestivals } from "../../../../db/claims";
import { requireAdminSession } from "../../../lib/admin-auth";

export async function GET(request: Request) {
  try {
    await requireAdminSession(request);
    return noStoreJson({ festivals: await listFestivals() });
  } catch (error) {
    return apiError(error, "festival list lookup failed");
  }
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    await requireAdminSession(request, { csrf: true });
    if (request.headers.get("content-type")?.startsWith("multipart/form-data")) {
      if (Number(request.headers.get("content-length") ?? 0) > MAX_PACKAGE_BYTES + 1024 * 1024) {
        throw new HttpError(413, "activity package is too large", "PAYLOAD_TOO_LARGE");
      }
      const form = await request.formData();
      const file = form.get("package");
      if (!file || typeof file === "string") throw new HttpError(400, "missing ZIP activity package", "PACKAGE_MISSING");
      if (!file.name.toLowerCase().endsWith(".zip")) throw new HttpError(400, "activity package must be a ZIP file", "PACKAGE_INVALID");
      if (file.size > MAX_PACKAGE_BYTES) throw new HttpError(413, "activity package is too large", "PAYLOAD_TOO_LARGE");
      const parsed = await parseActivityPackage(new Uint8Array(await file.arrayBuffer()));
      const result = await importActivityPackage(parsed.config.eventId, parsed.manifest, parsed.config, parsed.files, true);
      return noStoreJson(result, { status: 201 });
    }
    const input = newFestivalSchema.parse(await readJson(request, 16 * 1024));
    const config = await createFestival(input);
    return noStoreJson({ config }, { status: 201 });
  } catch (error) {
    if (error instanceof FestivalAlreadyExistsError) {
      return noStoreJson({ code: "EVENT_ALREADY_EXISTS", error: error.message }, { status: 409 });
    }
    return apiError(error, "festival creation failed");
  }
}
