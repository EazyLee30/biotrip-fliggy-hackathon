import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DESTINATION_PHOTOS, SELECTABLE_SHARE_ASSETS, coverForDestination, coverCaption, shareCoverAsset } from './visual-assets.ts';

test('a real destination photo never becomes another destination or product illustration', () => {
  assert.equal(coverForDestination('杭州').type,'generated_ambience');
  assert.ok(SELECTABLE_SHARE_ASSETS.every(asset => asset.type === 'generated_ambience'));
  for(const destination of ['北京','亚龙湾','杭州西湖的某个商家',''])assert.equal(coverForDestination(destination).type,'generated_ambience');
  const credit=coverCaption(shareCoverAsset('hangzhou-broken-bridge'));
  assert.ok(credit.includes('Suicasmo'));assert.ok(credit.includes('CC0'));assert.ok(credit.includes('2025-05-05'));
});

test('shipped destination derivatives and archived source match their recorded fingerprints', () => {
  for(const photo of DESTINATION_PHOTOS) {
    const record=JSON.parse(readFileSync(new URL(`../../docs/assets/licenses/${photo.id}.json`,import.meta.url),'utf8'));
    const original=readFileSync(new URL(`../../docs/assets/licenses/${photo.id}-original.jpg`,import.meta.url));
    assert.equal(createHash('sha1').update(original).digest('hex'),record.expectedCommonsSha1);
    for(const derivative of record.derivatives) {
      const bytes=readFileSync(new URL(`../../public${derivative.path}`,import.meta.url));
      assert.equal(createHash('sha256').update(bytes).digest('hex'),derivative.sha256);
    }
    for(const archive of record.archivedEvidence) {
      const bytes=readFileSync(new URL(`../../${archive.path}`,import.meta.url));
      assert.equal(createHash('sha256').update(bytes).digest('hex'),archive.sha256);
    }
  }
});
