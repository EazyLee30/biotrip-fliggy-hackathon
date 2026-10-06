import test from 'node:test';
import assert from 'node:assert/strict';
import { RequestError, submitPlanningJob } from './planning-job-submit.ts';

test('lost submission acknowledgement retries the exact same payload and idempotency key', async () => {
  const calls = [];
  const job = { id: 'only-job' };
  const result = await submitPlanningJob({ key: 'same-key', body: { consent: true, expectedVersion: 7 }, signal: new AbortController().signal,
    request: async (url, options) => { calls.push({ url, options }); if (calls.length === 1) throw new TypeError('Network error'); return { job }; },
  });
  assert.equal(result, job); assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], calls[1]); assert.equal(calls[0].options.headers['Idempotency-Key'], 'same-key');
});

test('auth, consent, conflict and quota rejections do not resubmit', async () => {
  for (const status of [400, 401, 403, 409, 429]) {
    let calls = 0; const error = new RequestError('rejected', status);
    await assert.rejects(submitPlanningJob({ body: {}, signal: new AbortController().signal,
      request: async () => { calls++; throw error; },
    }), e => e === error);
    assert.equal(calls, 1);
  }
});

test('server failure retries only once and cancellation never resubmits', async () => {
  let calls = 0;
  await assert.rejects(submitPlanningJob({ body: {}, signal: new AbortController().signal,
    request: async () => { calls++; throw new RequestError('unavailable', 503); },
  }), /unavailable/);
  assert.equal(calls, 2);
  const controller = new AbortController(); calls = 0;
  await assert.rejects(submitPlanningJob({ body: {}, signal: controller.signal,
    request: async () => { calls++; controller.abort(); throw new TypeError('offline'); },
  }));
  assert.equal(calls, 1);
});
