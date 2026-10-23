import assert from 'node:assert/strict';
import {test} from 'node:test';
import {assertNoNewOverlaps,assertProtectedActivities} from './protection.ts';
import {reflow} from './reflow.ts';
import {instantProposals} from './rules.ts';
import {bodyStatus} from './status.ts';
const date='2026-10-19',trip={departureDate:date,returnDate:date},scope={date,fromTime:'15:00',throughDate:date};
const booking={id:'booking',date,time:'14:00',durationMin:180,name:'固定预约',detail:'',fixed:true};
test('fixed occupied intervals cannot be overlapped, shortened or shifted even when their start is in the past',()=>{
 const newStop={id:'pause',date,time:'15:00',durationMin:30,name:'休息',detail:'',fixed:false};
 assert.throws(()=>assertNoNewOverlaps([booking],[booking,newStop]),{code:'ACTIVITY_PROTECTED'});
 assert.throws(()=>assertProtectedActivities([booking],[{...booking,durationMin:30}],{clock:{date,time:'15:00'},fixed:true}),{code:'ACTIVITY_PROTECTED'});
 const output=reflow([booking],[{type:'add_stop',date,time:'15:00',durationMin:30,name:'休息',detail:'',kind:'rest',effort:1}],trip,scope);
 assert.deepEqual(output.itinerary[0],booking);assert.equal(output.itinerary[1].time,'17:00');
});
test('a verified transfer must fit between whole activity intervals',()=>{
 const from={...booking,fixed:false,durationMin:60},to={id:'next',date,time:'15:15',durationMin:60,name:'下一站',detail:'',fixed:false};
 assert.throws(()=>assertNoNewOverlaps([from,to],[from,{...to,move:{mode:'taxi',minutes:20,basis:'amap'}}]),{code:'ACTIVITY_PROTECTED'});
 assert.doesNotThrow(()=>assertNoNewOverlaps([from,to],[from,{...to,move:{mode:'taxi',minutes:10,basis:'amap'}}]));
});
test('quiet or current reservations cannot erase every useful quick rest option',()=>{
 const proposals=instantProposals({itinerary:[booking],trip,scope,stance:'balanced',status:bodyStatus({checkIn:{fatigue:5,stress:null,tags:[]}})});
 assert.ok(proposals.length);assert.ok(proposals[0].templates.some(t=>t.type==='add_stop'));
 const preview=reflow([booking],proposals[0].templates,trip,scope);assert.equal(preview.itinerary[1].time,'17:00');
});
import {rankProposalsByOutcomes} from './learning.ts';
test('an unsuccessful rest does not penalize a meal just because both insert a stop',()=>{
 const rest={id:'rest',angle:'pace',reason:'休息',templates:[{type:'add_stop',kind:'rest'}]},meal={id:'meal',angle:'food',reason:'吃饭',templates:[{type:'add_stop',kind:'meal'}]};
 const records=[{changes:[rest],outcome:{localDate:date,feeling:'still_tired'}}];
 const ranked=rankProposalsByOutcomes([rest,meal],records,date);
 assert.equal(ranked[0].id,'meal');assert.equal(ranked[0].reason,'吃饭');
});
