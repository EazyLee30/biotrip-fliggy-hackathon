import test from 'node:test';
import assert from 'node:assert/strict';
import { filmResponse } from './film-stream.ts';

function asset() {
  let n=0;
  return new Response(new ReadableStream({pull(c) { if(n===4) {c.close();return;} c.enqueue(new Uint8Array([n*3,n*3+1,n*3+2])); n++; }}),{headers:{'Content-Length':'12',ETag:'"film-v3"'}});
}
async function response(range, method='GET', extra={}) { return filmResponse(new Request('https://example.com/api/film/v3',{method,headers:{...(range?{Range:range}:{}),...extra}}),asset()); }
test('film seeks across stream chunks and returns the exact requested bytes', async()=>{
 const r=await response('bytes=2-7');assert.equal(r.status,206);assert.equal(r.headers.get('content-range'),'bytes 2-7/12');assert.equal(r.headers.get('content-length'),'6');assert.deepEqual([...new Uint8Array(await r.arrayBuffer())],[2,3,4,5,6,7]);
});
test('film supports Safari metadata probes, open ranges, suffixes and clipped endings',async()=>{
 for(const [range,expected] of [['bytes=0-1',[0,1]],['bytes=10-',[10,11]],['bytes=-2',[10,11]],['bytes=10-100',[10,11]]]) { const r=await response(range);assert.equal(r.status,206);assert.deepEqual([...new Uint8Array(await r.arrayBuffer())],expected); }
});
test('film rejects impossible ranges without sending the full movie',async()=>{
 for(const range of ['bytes=12-','bytes=4-2','bytes=-0','bytes=9007199254740993-']) { const r=await response(range);assert.equal(r.status,416);assert.equal(r.headers.get('content-range'),'bytes */12');assert.equal((await r.arrayBuffer()).byteLength,0); }
});
test('film HEAD reports interval length with no body',async()=>{
 const r=await response('bytes=3-7','HEAD');assert.equal(r.status,206);assert.equal(r.headers.get('content-length'),'5');assert.equal((await r.arrayBuffer()).byteLength,0);
});
test('film full responses and unmatched If-Range remain complete',async()=>{
 for(const range of [null,'bytes=1-2,4-5']) {const r=await response(range);assert.equal(r.status,200);assert.equal((await r.arrayBuffer()).byteLength,12);}
 const r=await response('bytes=0-1','GET',{'If-Range':'"old"'});assert.equal(r.status,200);assert.equal((await r.arrayBuffer()).byteLength,12);
});
test('film cancels the upstream stream when the viewer disconnects',async()=>{
 let cancelled=false;const upstream=new Response(new ReadableStream({pull(c){c.enqueue(new Uint8Array([1,2,3]));},cancel(){cancelled=true;}}),{headers:{'Content-Length':'12'}});
 const r=await filmResponse(new Request('https://example.com',{headers:{Range:'bytes=1-10'}}),upstream);const reader=r.body.getReader();await reader.read();await reader.cancel();assert.equal(cancelled,true);
});
test('film uses release size when the production binding omits Content-Length',async()=>{
 const source=asset();source.headers.delete('content-length');
 const r=await filmResponse(new Request('https://example.com',{headers:{Range:'bytes=9-'}}),source,12);
 assert.equal(r.status,206);assert.equal(r.headers.get('content-range'),'bytes 9-11/12');assert.deepEqual([...new Uint8Array(await r.arrayBuffer())],[9,10,11]);
});
test('film refuses a release size that disagrees with the served asset',async()=>{
 const r=await filmResponse(new Request('https://example.com'),asset(),15);assert.equal(r.status,503);
});
