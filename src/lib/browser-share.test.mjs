import test from 'node:test';
import assert from 'node:assert/strict';
import { shareThroughSystem } from './browser-share.ts';

test('system sharing starts synchronously with the exact approved payload', async () => {
  const payload={title:'公开旅程',url:'https://biotrip.eazylee.si/share/test123'}; let called=false;
  const pending=shareThroughSystem({share: data=>{assert.equal(data,payload);called=true;return Promise.resolve();}},payload);
  assert.equal(called,true); assert.equal(await pending,'shared');
});
test('cancelling a native sheet is not reported as failure or retried', async () => {
  let calls=0;
  assert.equal(await shareThroughSystem({share: async()=>{calls++;throw {name:'AbortError'};}},{url:'https://biotrip.eazylee.si/share/test123'}),'cancelled');
  assert.equal(calls,1);
});
test('unsupported or denied file sharing retains the download fallback without invoking share', async () => {
  const data={files:[new File(['poster'],'poster.png',{type:'image/png'})]};
  for(const browser of [{},{canShare:()=>false,share:()=>assert.fail()},{canShare:()=>{throw new DOMException('Denied','NotAllowedError');},share:()=>assert.fail()}]) {
    assert.ok(['unsupported','failed'].includes(await shareThroughSystem(browser,data)));
  }
});
test('supported file sharing preserves prepared PNG files and handles permission errors', async () => {
  const files=[new File(['poster'],'poster.png',{type:'image/png'})];let received;
  assert.equal(await shareThroughSystem({canShare:data=>data.files===files,share:async data=>{received=data;}},{title:'海报',files}),'shared');
  assert.equal(received.files,files);
  assert.equal(await shareThroughSystem({share:async()=>{throw new DOMException('Denied','NotAllowedError');}},{url:'https://biotrip.eazylee.si/share/test123'}),'failed');
});
