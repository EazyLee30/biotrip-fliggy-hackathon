import * as protection from "./adjust/protection.ts";
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModule, plain } from './test-support/module-loader.mjs';
const edit=loadModule('lib/itinerary-edit.ts',{'./adjust/protection':protection,'./planner-input':loadModule('lib/planner-input.ts')});
const diff=loadModule('lib/itinerary-diff.ts');
const item=(time,name='散步')=>({date:'2026-10-12',time,name,detail:'自然步道',fixed:false});
const generated=rows=>({source:'live',plan:{itinerary:rows}});
const trip={departureDate:'2026-10-12',returnDate:'2026-10-12'};
test('legacy identities are deterministic, duplicates distinct, and reads do not mutate old snapshots',()=>{
 const raw=generated([item('10:00'),item('10:00')]);const one=edit.withActivityIds(raw,'journey-a');
 assert.deepEqual(plain(one),plain(edit.withActivityIds(raw,'journey-a')));
 assert.notEqual(one.plan.itinerary[0].id,one.plan.itinerary[1].id);
 assert.equal(raw.plan.itinerary[0].id,undefined);
 assert.notEqual(one.plan.itinerary[0].id,edit.withActivityIds(raw,'journey-b').plan.itinerary[0].id);
});
test('rename, retime and reorder preserve identities instead of recognizing a new activity',()=>{
 const rows=edit.withActivityIds(generated([item('10:00','散步'),item('12:00','喝茶')]),'journey-a').plan.itinerary;
 const edited=edit.applyItineraryOperations(rows,[{type:'edit',index:0,activityId:rows[0].id,time:'11:00',name:'步道漫游'}],trip).itinerary;
 assert.equal(edited[0].id,rows[0].id);
 const moved=edit.applyItineraryOperations(edited,[{type:'move',index:0,activityId:rows[0].id,toIndex:1,toActivityId:rows[1].id}],trip).itinerary;
 assert.equal(moved[1].id,rows[0].id);assert.equal(moved[0].id,rows[1].id);
 const changes=diff.compareItineraries(rows,moved);assert.equal(changes.added.length,0);assert.equal(changes.removed.length,0);assert.equal(changes.changed.length,2);
});
test('an activity id mismatching its position is rejected, including reorder targets',()=>{
 const rows=edit.withActivityIds(generated([item('10:00'),item('12:00','喝茶')]),'journey-a').plan.itinerary;
 assert.throws(()=>edit.applyItineraryOperations(rows,[{type:'edit',index:0,activityId:rows[1].id,name:'错项'}],trip),/位置已变化/);
 assert.throws(()=>edit.applyItineraryOperations(rows,[{type:'move',index:0,activityId:rows[0].id,toIndex:1,toActivityId:rows[0].id}],trip),/目标活动已变化/);
});
test('a client-created addition retains identity through preview and server replay',()=>{
 const rows=edit.withActivityIds(generated([item('10:00')]),'journey-a').plan.itinerary;
 const operations=[{type:'add',id:'new_activity_123',date:'2026-10-12',time:'11:00',name:'喝茶',detail:'茶馆',fixed:false},{type:'edit',index:1,activityId:'new_activity_123',name:'下午茶'}];
 const preview=edit.applyItineraryOperations(rows,operations,trip);const saved=edit.applyItineraryOperations(rows,operations,trip);
 assert.deepEqual(plain(preview),plain(saved));assert.equal(saved.itinerary[1].id,'new_activity_123');
 assert.throws(()=>edit.applyItineraryOperations(rows,[{...operations[0],id:rows[0].id}],trip),/重复/);
});
test('new generations inherit only unambiguous existing activity identities and ignore model ids',()=>{
 const old=edit.withActivityIds(generated([item('10:00'),item('12:00','喝茶')]),'journey-a');
 const next=edit.identifyGeneratedActivities(generated([{...item('11:00'),id:'model_invented_id'},item('12:00','喝茶'),{...item('14:00','新体验'),id:old.plan.itinerary[0].id}]),'journey-a',old);
 assert.equal(next.plan.itinerary[0].id,old.plan.itinerary[0].id);
 assert.equal(next.plan.itinerary[1].id,old.plan.itinerary[1].id);
 assert.notEqual(next.plan.itinerary[2].id,old.plan.itinerary[0].id);
 const duplicate=edit.identifyGeneratedActivities(generated([item('11:00'),item('13:00')]),'journey-a',old);
 assert.ok(duplicate.plan.itinerary.every(row=>row.id!==old.plan.itinerary[0].id));
});
test('legacy difference matching pairs each repeated activity once',()=>{
 const compared=diff.compareItineraries([item('10:00'),item('10:00')],[item('10:00')]);
 assert.equal(compared.retained.length,1);assert.equal(compared.removed.length,1);
});
