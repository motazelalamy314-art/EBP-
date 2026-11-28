import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGeminiGenerateUrl,
  callGeminiWithFallback,
  normalizeGeminiModelId,
  parseSafeJsonResponse,
  parseUpstreamAiError,
  withRetryBackoff,
  withTimeout,
} from './aiResilience';

test('parseUpstreamAiError preserves exact HTTP status code and raw Google error.message', () => {
  const raw503 = new Error(
    '{"error":{"code":503,"message":"This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.","status":"UNAVAILABLE"}}'
  );
  const parsed = parseUpstreamAiError(raw503);
  assert.equal(parsed.status, 503);
  assert.equal(parsed.retryable, true);
  assert.ok(parsed.message.includes('HTTP 503'));
  assert.ok(parsed.message.includes('This model is currently experiencing high demand.'));
  assert.equal(parsed.message.includes('{"error"'), false);
});

test('parseUpstreamAiError preserves exact 400/401/403 raw messages without generic replacement', () => {
  const invalidKey = parseUpstreamAiError(
    new Error('{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}')
  );
  assert.equal(invalidKey.status, 400);
  assert.equal(invalidKey.retryable, false);
  assert.ok(invalidKey.message.includes('HTTP 400 (INVALID_ARGUMENT)'));
  assert.ok(invalidKey.message.includes('API key not valid. Please pass a valid API key.'));

  const unsupported = parseUpstreamAiError(
    new Error('{"error":{"code":401,"message":"API key not valid","details":[{"reason":"ACCESS_TOKEN_TYPE_UNSUPPORTED"}]}}')
  );
  assert.equal(unsupported.status, 401);
  assert.equal(unsupported.retryable, false);
  assert.ok(unsupported.message.includes('HTTP 401'));
  assert.ok(unsupported.message.includes('ACCESS_TOKEN_TYPE_UNSUPPORTED'));
  assert.ok(unsupported.message.includes('API key not valid'));
});

test('withRetryBackoff retries transient 503 errors and succeeds when upstream recovers', async () => {
  let calls = 0;
  const result = await withRetryBackoff(
    async () => {
      calls += 1;
      if (calls < 3) {
        throw new Error(
          '{"error":{"code":503,"message":"high demand","status":"UNAVAILABLE"}}'
        );
      }
      return 'ok';
    },
    { maxAttempts: 3, baseDelayMs: 1, sleepFn: async () => {} }
  );

  assert.equal(result, 'ok');
  assert.equal(calls, 3);
});

test('withRetryBackoff does not retry non-retryable 404 or 400 errors', async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      withRetryBackoff(
        async () => {
          calls += 1;
          throw new Error('NOT_FOUND: model not found');
        },
        { maxAttempts: 3, baseDelayMs: 1, sleepFn: async () => {} }
      ),
    /NOT_FOUND/
  );
  assert.equal(calls, 1);
});

test('withTimeout rejects stalled operations as retryable 504 TIMEOUT', async () => {
  await assert.rejects(
    () =>
      withTimeout(
        () => new Promise((resolve) => setTimeout(() => resolve('late'), 200)),
        15
      ),
    (err: Error) => {
      const parsed = parseUpstreamAiError(err);
      return parsed.status === 504 && parsed.retryable === true;
    }
  );
});

test('callGeminiWithFallback switches to fallback model when primary hits 503 or timeout', async () => {
  const seenModels: string[] = [];
  const res = await callGeminiWithFallback({
    primaryModel: 'gemini-4-hydrogen',
    fallbackModel: 'gemini-2.5-flash',
    maxAttempts: 1,
    baseDelayMs: 1,
    timeoutMs: 100,
    sleepFn: async () => {},
    operation: async (model) => {
      seenModels.push(model);
      if (model === 'gemini-4-hydrogen') {
        throw new Error('TIMEOUT: stalled');
      }
      return 'ocr-ok';
    },
  });

  assert.deepEqual(seenModels, ['gemini-4-hydrogen', 'gemini-2.5-flash']);
  assert.equal(res.result, 'ocr-ok');
  assert.equal(res.usedModel, 'gemini-2.5-flash');
  assert.equal(res.fallbackUsed, true);
});

test('parseSafeJsonResponse converts text/HTML 404 pages like "The page could not be found" into clear errors', async () => {
  await assert.rejects(
    () =>
      parseSafeJsonResponse(
        {
          ok: false,
          status: 404,
          statusText: 'Not Found',
          text: async () => 'The page could not be found',
        },
        'فشل الاتصال بالخادم'
      ),
    (err: Error) => {
      assert.ok(err.message.includes('404'));
      assert.ok(err.message.includes('The page could not be found'));
      assert.equal(err.message.includes('Unexpected token'), false);
      return true;
    }
  );

  await assert.rejects(
    () =>
      parseSafeJsonResponse(
        {
          ok: true,
          status: 200,
          statusText: 'OK',
          text: async () => '<!doctype html><html><body>Not JSON</body></html>',
        },
        'فشل'
      ),
    /غير JSON/
  );

  const valid = await parseSafeJsonResponse<{ ok: boolean; message: string }>(
    {
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => '{"ok":true,"message":"تم الاتصال بنجاح"}',
    },
    'فشل'
  );
  assert.equal(valid.ok, true);
  assert.equal(valid.message, 'تم الاتصال بنجاح');
});

test('normalizeGeminiModelId replaces empty or deprecated models with gemini-2.5-flash', () => {
  assert.equal(normalizeGeminiModelId(''), 'gemini-2.5-flash');
  assert.equal(normalizeGeminiModelId('gemini-1.5-flash'), 'gemini-2.5-flash');
  assert.equal(normalizeGeminiModelId('gemini-2.0-flash'), 'gemini-2.5-flash');
  assert.equal(normalizeGeminiModelId('gemini-pro'), 'gemini-2.5-flash');
  assert.equal(normalizeGeminiModelId('gemini-4-hydrogen'), 'gemini-4-hydrogen');
  assert.equal(normalizeGeminiModelId('gemini-3-flash-preview'), 'gemini-3-flash-preview');
  assert.equal(normalizeGeminiModelId('gemini-2.5-pro'), 'gemini-2.5-pro');
});

test('buildGeminiGenerateUrl sends ALL Gemini keys (AQ. and AIza) to generativelanguage.googleapis.com v1beta', () => {
  const aqUrl = buildGeminiGenerateUrl('gemini-2.5-flash', 'AQ.test-token-123');
  assert.equal(
    aqUrl,
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=AQ.test-token-123'
  );
  assert.equal(aqUrl.includes('aiplatform.googleapis.com'), false);

  const aizaUrl = buildGeminiGenerateUrl('gemini-3-flash-preview', 'AIzaSyTestKey123');
  assert.equal(
    aizaUrl,
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=AIzaSyTestKey123'
  );
});
