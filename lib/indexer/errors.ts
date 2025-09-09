export type ApiError = {
  status: number;
  message: string;
  hint?: string;
  body?: string;
  code?: string;
};

export class ApiHttpError extends Error {
  status?: number;
  hint?: string;
  body?: string;
  code?: string;

  constructor(message: string, info?: { status?: number; hint?: string; body?: string; code?: string }) {
    super(message);
    this.name = "ApiHttpError";
    if (info) {
      this.status = info.status;
      this.hint = info.hint;
      this.body = info.body;
      this.code = info.code;
    }
  }
}

export async function decodeError(res: Response): Promise<ApiError> {
  const status = res.status;
  let bodyText = "";
  try { bodyText = await res.text(); } catch {}
  let message = `HTTP ${status}`;
  let code: string | undefined;

  try {
    const j = JSON.parse(bodyText);
    if (typeof j.message === "string") message = j.message;
    if (typeof j.code === "string") code = j.code;
  } catch {
    if (bodyText) message = bodyText.slice(0, 200);
  }

  let hint: string | undefined;
  if ((status === 400 && /invalid before/i.test(message)) || code === "INVALID_BEFORE") {
    hint = "Invalid before cursor - will reset and retry";
  } else if (status === 400 && /unauthorized|api\-key/i.test(message)) {
    hint = "Check HELIUS_API_KEY environment variable";
  } else if (status === 429) {
    hint = "Rate limited - will retry with backoff";
  }

  return { status, message, hint, body: bodyText.slice(0, 200), code };
}
