export const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite';

export const DEPRECATED_GEMINI_MODELS = new Set<string>([
  'gemini-1.5-flash',
  'gemini-1.5-pro',
  'gemini-pro',
  'gemini-2.0-flash',
  'gemini-2.0-pro',
  'gemini-2.0-flash-thinking',
]);

export function normalizeGeminiModelId(modelId?: string): string {
  const trimmed = (modelId || '').trim();
  if (!trimmed || DEPRECATED_GEMINI_MODELS.has(trimmed.toLowerCase())) {
    return DEFAULT_GEMINI_MODEL;
  }
  return trimmed;
}

export interface SafeResponseShape {
  ok: boolean;
  status: number;
  statusText: string;
  text: () => Promise<string>;
}

/**
 * Safely reads response.text() before JSON.parse() and validates response.ok
 * so HTML/text 404 or proxy error pages produce a clear error message instead of
 * `Unexpected token ..., is not valid JSON`.
 */
export async function parseSafeJsonResponse<T extends Record<string, unknown>>(
  response: SafeResponseShape,
  fallbackErrorMessage: string
): Promise<T> {
  let rawText = '';
  try {
    rawText = await response.text();
  } catch {
    if (!response.ok) {
      throw new Error(`${fallbackErrorMessage} (${response.status} ${response.statusText})`);
    }
    throw new Error(fallbackErrorMessage);
  }

  const trimmed = rawText.trim();
  let parsed: unknown = null;
  let jsonParseFailed = false;

  if (trimmed.length > 0) {
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      jsonParseFailed = true;
    }
  }

  if (!response.ok) {
    if (parsed && typeof parsed === 'object') {
      const obj = parsed as { error?: unknown; message?: unknown };
      if (typeof obj.error === 'string' && obj.error.trim()) {
        throw new Error(obj.error.trim());
      }
      if (
        obj.error &&
        typeof obj.error === 'object' &&
        typeof (obj.error as { message?: unknown }).message === 'string'
      ) {
        throw new Error(String((obj.error as { message: string }).message).trim());
      }
      if (typeof obj.message === 'string' && obj.message.trim()) {
        throw new Error(obj.message.trim());
      }
    }

    const plainSnippet = trimmed
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 180);

    if (response.status === 404) {
      throw new Error(
        `نقطة الاتصال غير موجودة على الخادم (404)${plainSnippet ? `: ${plainSnippet}` : '.'}`
      );
    }

    throw new Error(
      `${fallbackErrorMessage} (${response.status})${plainSnippet ? `: ${plainSnippet}` : ''}`
    );
  }

  if (jsonParseFailed || parsed === null || typeof parsed !== 'object') {
    const plainSnippet = trimmed
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 180);
    throw new Error(
      `استجاب الخادم بتنسيق غير JSON${plainSnippet ? `: ${plainSnippet}` : '.'}`
    );
  }

  return parsed as T;
}

export interface ParsedAiError {
  status: number;
  retryable: boolean;
  message: string;
}

function extractRawErrorDetails(err: unknown): {
  rawText: string;
  numericStatus?: number;
  statusCodeText?: string;
} {
  if (!err) {
    return { rawText: '' };
  }

  const obj = err as {
    status?: number;
    code?: number;
    message?: string;
    error?: { code?: number; message?: string; status?: string };
  };

  let rawText = err instanceof Error ? err.message : String(err);
  let numericStatus = typeof obj.status === 'number' ? obj.status : typeof obj.code === 'number' ? obj.code : undefined;
  let statusCodeText = obj.error?.status;

  if (obj.error?.code && !numericStatus) {
    numericStatus = obj.error.code;
  }
  if (obj.error?.message) {
    rawText = obj.error.message;
  }

  // Handle stringified JSON error payloads like `{"error":{"code":503,"message":"...","status":"UNAVAILABLE"}}`
  const jsonMatch = rawText.match(/\{[\s\S]*"error"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as {
        error?: {
          code?: number;
          message?: string;
          status?: string;
          details?: Array<{ reason?: string }>;
        };
      };
      if (parsed?.error) {
        if (typeof parsed.error.code === 'number') {
          numericStatus = parsed.error.code;
        }
        const detailReasons = Array.isArray(parsed.error.details)
          ? parsed.error.details.map((d) => d?.reason || '').filter(Boolean).join(' ')
          : '';
        if (parsed.error.status || detailReasons) {
          statusCodeText = `${parsed.error.status || ''} ${detailReasons}`.trim();
        }
        if (parsed.error.message) {
          rawText = parsed.error.message;
        }
      }
    } catch {
      // Ignore malformed JSON snippet
    }
  }

  return { rawText, numericStatus, statusCodeText };
}

export function parseUpstreamAiError(err: unknown): ParsedAiError {
  const { rawText, numericStatus, statusCodeText } = extractRawErrorDetails(err);
  const upper = `${rawText} ${statusCodeText || ''}`.toUpperCase();

  if (
    numericStatus === 503 ||
    upper.includes('UNAVAILABLE') ||
    upper.includes('HIGH DEMAND') ||
    upper.includes('OVERLOADED') ||
    upper.includes('503')
  ) {
    return {
      status: 503,
      retryable: true,
      message:
        'النموذج المحدد يشهد ضغطاً مؤقتاً حالياً (503). أعد المحاولة بعد لحظات أو اختر نموذجاً آخر مثل gemini-3.1-flash-lite من القائمة.',
    };
  }

  if (
    numericStatus === 429 ||
    upper.includes('RESOURCE_EXHAUSTED') ||
    upper.includes('RATE LIMIT') ||
    upper.includes('429')
  ) {
    return {
      status: 429,
      retryable: true,
      message:
        'تم تجاوز حد الاستخدام المسموح حالياً (429). انتظر قليلاً ثم حاول مرة أخرى أو بدّل النموذج.',
    };
  }

  if (upper.includes('ACCESS_TOKEN_TYPE_UNSUPPORTED')) {
    return {
      status: 401,
      retryable: false,
      message:
        'مفتاح GEMINI_API_KEY المضبوط على الخادم غير صالح لهذا المسار (401: ACCESS_TOKEN_TYPE_UNSUPPORTED). يرجى استخدام مفتاح Gemini API صالح (AIza...) في متغيرات بيئة الخادم/الاستضافة، أو التبديل لمزود آخر من الإعدادات.',
    };
  }

  if (
    numericStatus === 401 ||
    numericStatus === 403 ||
    upper.includes('API_KEY_INVALID') ||
    upper.includes('PERMISSION_DENIED') ||
    upper.includes('INVALID API KEY')
  ) {
    return {
      status: 400,
      retryable: false,
      message:
        'مفتاح GEMINI_API_KEY على الخادم غير صالح أو مرفوض. تأكد من صلاحية المفتاح في متغيرات بيئة الخادم/الاستضافة، أو التبديل لمزود OpenAI-Compatible / Ollama من الإعدادات.',
    };
  }

  if (numericStatus === 404 || upper.includes('NOT_FOUND') || upper.includes('404')) {
    return {
      status: 404,
      retryable: false,
      message:
        'النموذج المحدد غير متاح أو غير مدعوم. اختر نموذجاً صحيحاً من الإعدادات (مثل gemini-3.1-flash-lite أو gemini-4-hydrogen).',
    };
  }

  if (
    numericStatus === 500 ||
    numericStatus === 502 ||
    numericStatus === 504 ||
    upper.includes('TIMEOUT') ||
    upper.includes('TIMED OUT') ||
    upper.includes('ABORTED')
  ) {
    return {
      status: numericStatus === 500 || numericStatus === 502 ? numericStatus : 504,
      retryable: true,
      message: 'استغرق الخادم وقتاً أطول من المعتاد أو حدث انقطاع مؤقت. يرجى إعادة المحاولة.',
    };
  }

  return {
    status: numericStatus && numericStatus >= 400 && numericStatus < 600 ? numericStatus : 500,
    retryable: false,
    message: rawText || 'حدث خطأ غير متوقع أثناء الاتصال بالذكاء الاصطناعي.',
  };
}

export async function withTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  timeoutLabel = 'TIMEOUT: انتهت مهلة انتظار استجابة الذكاء الاصطناعي.'
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return operation();
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error(timeoutLabel));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

export async function withRetryBackoff<T>(
  operation: () => Promise<T>,
  options: {
    maxAttempts?: number;
    baseDelayMs?: number;
    timeoutMs?: number;
    sleepFn?: (ms: number) => Promise<void>;
  } = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 700;
  const timeoutMs = options.timeoutMs ?? 0;
  const sleep =
    options.sleepFn ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await (timeoutMs > 0 ? withTimeout(operation, timeoutMs) : operation());
    } catch (err) {
      lastError = err;
      const parsed = parseUpstreamAiError(err);
      const skip = Boolean((err as { skipPrimaryRetry?: boolean } | null)?.skipPrimaryRetry);
      if (skip || !parsed.retryable || attempt >= maxAttempts) {
        throw err;
      }
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      await sleep(delay);
    }
  }

  throw lastError;
}

export async function callGeminiWithFallback<T>(params: {
  primaryModel: string;
  fallbackModel?: string;
  operation: (model: string) => Promise<T>;
  maxAttempts?: number;
  baseDelayMs?: number;
  timeoutMs?: number;
  sleepFn?: (ms: number) => Promise<void>;
}): Promise<{ result: T; usedModel: string; fallbackUsed: boolean }> {
  const {
    primaryModel,
    fallbackModel = DEFAULT_GEMINI_MODEL,
    operation,
    maxAttempts = 2,
    baseDelayMs = 600,
    timeoutMs = 15000,
    sleepFn,
  } = params;

  const effectivePrimaryTimeout =
    !fallbackModel || fallbackModel === primaryModel ? Math.max(timeoutMs, 45000) : timeoutMs;

  try {
    const result = await withRetryBackoff(
      async () => {
        try {
          return await withTimeout(() => operation(primaryModel), effectivePrimaryTimeout);
        } catch (innerErr) {
          const parsedInner = parseUpstreamAiError(innerErr);
          if (parsedInner.status === 504 && fallbackModel && fallbackModel !== primaryModel) {
            // Escalate timeout directly to fallback model without waiting another full timeout
            const escalated = new Error(parsedInner.message);
            (escalated as { status?: number; skipPrimaryRetry?: boolean }).status = 504;
            (escalated as { skipPrimaryRetry?: boolean }).skipPrimaryRetry = true;
            throw escalated;
          }
          throw innerErr;
        }
      },
      {
        maxAttempts,
        baseDelayMs,
        sleepFn,
      }
    );
    return { result, usedModel: primaryModel, fallbackUsed: false };
  } catch (err) {
    const parsed = parseUpstreamAiError(err);
    if (!parsed.retryable || !fallbackModel || fallbackModel === primaryModel) {
      throw err;
    }

    const result = await withRetryBackoff(() => operation(fallbackModel), {
      maxAttempts: 2,
      baseDelayMs,
      timeoutMs: Math.max(timeoutMs, 45000),
      sleepFn,
    });
    return { result, usedModel: fallbackModel, fallbackUsed: true };
  }
}
