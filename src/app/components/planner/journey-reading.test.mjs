import test from 'node:test';
import assert from 'node:assert/strict';
import { upcomingActivity } from './journey-reading.ts';
const item=(date,time,name)=>({date,time,name,detail:'',fixed:false});
test('next activity follows destination day, not device day or previous starts',()=>{
 const items=[item('2026-10-05','08:00','过去'),item('2026-10-05','10:00','下一项'),item('2026-10-06','01:00','明天')];
 assert.equal(upcomingActivity(items,Date.parse('2026-10-05T01:00:00Z'),'Asia/Shanghai').name,'下一项');
 assert.equal(upcomingActivity(items,Date.parse('2026-10-05T15:00:00Z'),'Asia/Shanghai'),null);
});
test('next activity sorts starts and does not infer completion',()=>{
 const items=[item('2026-10-05','15:00','晚些'),item('2026-10-05','09:00','此刻')];
 assert.equal(upcomingActivity(items,Date.parse('2026-10-05T01:00:00Z'),'Asia/Shanghai').name,'此刻');
});
