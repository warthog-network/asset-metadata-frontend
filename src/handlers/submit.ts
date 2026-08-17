// POST /api/submit — translates multipart/form-data into a SubmitInput,
// delegates to `submission.submit()`, returns JSON.

import { submit, type SubmitInput } from "../lib/submission";

export async function handleSubmit(req: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch (err) {
    console.warn("submit: malformed multipart:", err);
    return Response.json(
      { ok: false, error: "could not parse form data" },
      { status: 400 },
    );
  }

  // FormData.get("logo") / get("banner") returns an empty File (0 bytes)
  // when no file was selected — not null. Coerce empty files to null so
  // the submission validator (which checks dimensions and format) doesn't
  // reject empty payloads as "not a PNG or JPEG".
  const logoFile = form.get("logo") as File | null;
  const bannerFile = form.get("banner") as File | null;
  const logo = logoFile && logoFile.size > 0 ? logoFile : null;
  const banner = bannerFile && bannerFile.size > 0 ? bannerFile : null;

  const input: SubmitInput = {
    asset_hash: ((form.get("asset_hash") as string | null) ?? "").trim(),
    name: ((form.get("name") as string | null) ?? "").trim(),
    description: ((form.get("description") as string | null) ?? "").trim(),
    website: ((form.get("website") as string | null) ?? "").trim(),
    telegram: ((form.get("telegram") as string | null) ?? "").trim(),
    discord: ((form.get("discord") as string | null) ?? "").trim(),
    twitter: ((form.get("twitter") as string | null) ?? "").trim(),
    logo,
    banner,
  };

  // submission.submit() never throws. The handler just translates Result → HTTP.
  const result = await submit(input);

  if (result.ok) {
    return Response.json(result, { status: 201 });
  }
  return Response.json(result, { status: result.status });
}
