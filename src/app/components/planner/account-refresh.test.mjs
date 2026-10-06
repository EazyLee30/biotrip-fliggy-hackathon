import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccountRefresh } from './account-refresh.ts';

test('unchanged account is not reread and failed refresh remains retryable', async () => {
  let reads = 0; const applied = [];
  const refresh = createAccountRefresh({ apply: value => applied.push(value), read: async () => { if (++reads === 1) throw new Error('offline'); return 'latest'; } });
  assert.equal(await refresh.refresh(() => true), null); refresh.changed();
  await assert.rejects(refresh.refresh(() => true), /offline/);
  assert.equal(await refresh.refresh(() => true), 'latest'); assert.equal(await refresh.refresh(() => true), null);
  assert.equal(reads, 2); assert.deepEqual(applied, ['latest']);
});

test('edits during an in-flight read are not lost or replaced by an older response', async () => {
  let release; const applied = [];
  let read = () => new Promise(resolve => { release = resolve; });
  const refresh = createAccountRefresh({ apply: value => applied.push(value), read: () => read() });
  refresh.changed(); const pending = refresh.refresh(() => true); refresh.changed(); release('old');
  await assert.rejects(pending, /账户资料刚刚更新/); assert.deepEqual(applied, []);
  read = async () => 'new'; assert.equal(await refresh.refresh(() => true), 'new'); assert.deepEqual(applied, ['new']);
});

test('unmounted account does not receive a late refresh', async () => {
  let alive = true, release;
  const refresh = createAccountRefresh({ apply: () => assert.fail('late write'), read: () => new Promise(resolve => { release = resolve; }) });
  refresh.changed(); const pending = refresh.refresh(() => alive); alive = false; release('old');
  assert.equal(await pending, null);
});
