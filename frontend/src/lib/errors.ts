export class LocalClientError extends Error {
  constructor() {
    super();
    this.message = 'Could not connect to the local client. Please make sure it is running and try again.'
    this.name = 'LocalClientError';
  }
}

export class AppRequestError extends Error {
  code: string;
  status?: number;
  details?: string;
  retryable: boolean;

  constructor({
    message,
    code,
    status,
    details,
    retryable = true,
  }: {
    message: string;
    code: string;
    status?: number;
    details?: string;
    retryable?: boolean;
  }) {
    super(message);
    this.name = "AppRequestError";
    this.code = code;
    this.status = status;
    this.details = details;
    this.retryable = retryable;
  }
}

export type AppErrorInfo = {
  title: string;
  message: string;
  code: string;
  status?: number;
  details?: string;
  retryable: boolean;
};

function friendlyTransportError(message: string, fallbackCode: string, fallbackMessage: string) {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("context deadline exceeded")
    || normalized.includes("timed out")
    || normalized.includes("timeout")
  ) {
    return {
      message: "Riot took too long to respond. Cached data is still available; try again in a moment.",
      code: "VV-UPSTREAM-TIMEOUT",
    };
  }
  if (normalized.includes("failed to fetch") || normalized.includes("network")) {
    return {
      message: "The service could not be reached. Check your connection and try again.",
      code: "VV-NETWORK",
    };
  }
  const safeMessage = message.length > 180 || /https?:\/\//i.test(message) ? fallbackMessage : message;
  return { message: safeMessage, code: fallbackCode };
}

export function toAppErrorInfo(
  reason: unknown,
  fallbackCode = "VV-UNKNOWN",
  fallbackMessage = "Something did not load correctly.",
): AppErrorInfo {
  if (reason instanceof AppRequestError) {
    const friendly = friendlyTransportError(reason.message, reason.code, fallbackMessage);
    return {
      title: reason.status === 401 || reason.status === 403 ? "Session needs attention" : "Could not load this section",
      message: friendly.message,
      code: friendly.code,
      status: reason.status,
      details: [reason.message, reason.details].filter(Boolean).join("\n"),
      retryable: reason.retryable,
    };
  }
  if (reason instanceof LocalClientError) {
    return {
      title: "Riot Client unavailable",
      message: reason.message,
      code: "VV-LOCAL-CLIENT",
      retryable: true,
    };
  }
  const rawMessage = reason instanceof Error ? reason.message : fallbackMessage;
  const friendly = friendlyTransportError(rawMessage, fallbackCode, fallbackMessage);
  return {
    title: "Could not load this section",
    message: friendly.message,
    code: friendly.code,
    details: reason instanceof Error ? `${reason.name}\n${reason.message}` : undefined,
    retryable: true,
  };
}
