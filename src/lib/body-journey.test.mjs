import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {loadModule,readProjectFile,plain} from './test-support/module-loader.mjs';
import * as protection from './adjust/protection.ts';
import * as request from './adjust/request.ts';
import * as apply from './adjust/apply.ts';
import * as status from './adjust/status.ts';
import * as tags from './adjust/tags.ts';
import * as rules from './adjust/rules.ts';
import * as validate from './adjust/validate.ts';
import * as learning from './adjust/learning.ts';
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',date='2026-10-19';
const clock=new Date('2026-10-19T07:00:00Z');
const draft={intention:'安静恢复',consent:true,trip:{originCity:'上海',destinationCity:'杭州',departureDate:date,returnDate:date,departureTimezone:'Asia/Shanghai',destinationTimezone:'Asia/Shanghai'}};
const item=(id,time,name,extra={})=>({id,date,time,name,detail:'',fixed:false,durationMin:60,...extra});
const plan={source:'live',retrievedAt:clock.toISOString(),timezone:{shiftMinutes:0,travelHours:2},healthContext:{basis:'preferences_only',provisional:true},localServices:[],plan:{headline:'杭州',summary:'从容',reason:'旅行',adjustments:[],places:[],itinerary:[item('booking','14:00','固定演出',{fixed:true,durationMin:180}),item('walk','18:00','西湖徒步',{durationMin:90}),item('night','20:00','湖边漫步')]}};
function fixture(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
 for(const migration of ['0001_accounts.sql','0002_password_auth.sql','0003_journeys.sql','0007_planning_jobs.sql','0008_adjustments.sql','0013_body_journey.sql','0014_journey_collections.sql'])sqlite.exec(readProjectFile(`migrations/${migration}`));
 for(const id of [A,B])sqlite.prepare('INSERT INTO accounts(id,email) VALUES(?,?)').run(id,id+'@example.invalid');
 const hooks={beforeRun:null};
 const db={prepare(sql){const stmt=sqlite.prepare(sql);let args=[];return {bind(...a){args=a;return this;},async first(){hooks.beforeRun?.(sql);return stmt.get(...args)??null;},async all(){return {results:stmt.all(...args)};},async run(){hooks.beforeRun?.(sql);if(/RETURNING/.test(sql)){const results=stmt.all(...args);return {results,meta:{changes:results.length}};}return {results:[],meta:{changes:Number(stmt.run(...args).changes)}};}};},async batch(statements){sqlite.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 const storage={'@/lib/database':{getDatabase:()=>db}};
 const edit=loadModule('lib/itinerary-edit.ts',{'./planner-input':loadModule('lib/planner-input.ts'),'./adjust/protection':protection});
 let collections;
 const journeys=loadModule('lib/journeys.ts',{...storage,'@/lib/preferences':{learnFromDraft:async()=>{},learnFromFeedback:async()=>{}},'@/lib/itinerary-edit':edit,'@/lib/journey-collections':{backlogInsertStatements:(...args)=>collections.backlogInsertStatements(...args)}},{Date:class extends Date{constructor(...args){super(...(args.length?args:[clock]));}}});
 collections=loadModule('lib/journey-collections.ts',{...storage,'@/lib/journeys':journeys});
 const body=loadModule('lib/body-journey.ts',{...storage,'@/lib/journeys':journeys,'./adjust/request':request,'./adjust/types':types});
 const rate=loadModule('lib/planning/rate-limit.ts',{...storage,'@/lib/journeys':journeys});
 const reservations=loadModule('lib/planning/reservations.ts',{'@/lib/trip-timing':loadModule('lib/trip-timing.ts',{'./planner-input':loadModule('lib/planner-input.ts')}),'@/lib/journeys':journeys,'@/lib/itinerary-edit':edit,'@/lib/planner-input':loadModule('lib/planner-input.ts'),'../adjust/protection':protection,'../adjust/request':request},{Date:class extends Date{constructor(...args){super(...(args.length?args:[clock]));}}});
 const jobs=loadModule('lib/planning/jobs.ts',{...storage,'./reservations':reservations,'@/lib/journeys':journeys,'@/lib/journey-collections':collections,'../adjust/apply':apply,'../adjust/request':{...request,adjustmentScope:j=>request.adjustmentScope(j,clock)},'./rate-limit':rate,'@/lib/bailian':{getBailianConfig:()=>null}});
 const quick=loadModule('lib/adjust/quick.ts',{...storage,'@/lib/journeys':journeys,'@/lib/planning/jobs':jobs,'@/lib/body-journey':body,'./request':request,'./status':status,'./tags':tags,'./rules':rules,'./validate':validate,'./learning':learning});
 const versions=loadModule('lib/journey-versions.ts',{...storage,'@/lib/journeys':journeys});
 async function journey(){let j=await journeys.saveGeneratedJourney(A,{draft,generated:plan});return journeys.updateJourney(A,j.id,{version:j.version,status:'active'});}
 const count=table=>sqlite.prepare(`SELECT count(*) n FROM ${table}`).get().n;
 return {sqlite,db,hooks,journeys,body,jobs,quick,versions,collections,journey,count};
}
import * as types from './adjust/types.ts';
const raw=j=>({mode:'adjust',journeyId:j.id,expectedVersion:j.version,consent:true,includeWhoop:false,includeMemory:false,checkIn:{fatigue:4,stress:null,tags:['legs_tired']},stance:'balanced',scope:request.adjustmentScope(j,clock)});

test('check-ins survive reload, keep local-day provenance and enforce consent, ownership, idempotency and version',async()=>{
 const f=fixture();try{
  const j=await f.journey(),key=randomUUID(),value={fatigue:4,stress:2,tags:['legs_tired'],consent:true};
  const saved=await f.body.recordBodyCheckIn(A,j.id,value,key,clock,j.version);
  assert.equal(saved.current.fatigue,4);assert.equal(saved.current.source,'self_report');assert.equal(saved.current.localDate,date);
  assert.equal((await f.body.recordBodyCheckIn(A,j.id,value,key,clock)).checkIns.length,1);
  await assert.rejects(f.body.recordBodyCheckIn(A,j.id,{...value,fatigue:2},key,clock),{code:'IDEMPOTENCY_CONFLICT'});
  await assert.rejects(f.body.recordBodyCheckIn(A,j.id,{...value,consent:false},randomUUID(),clock));
  await assert.rejects(f.body.listBodyCheckIns(B,j.id,clock),{code:'JOURNEY_NOT_FOUND'});
  const next=await f.body.listBodyCheckIns(A,j.id,new Date('2026-10-19T16:01:00Z'));
  assert.equal(next.current,null);assert.equal(next.checkIns.length,1);
  await assert.rejects(f.body.recordBodyCheckIn(A,j.id,value,randomUUID(),clock,j.version-1),{code:'CHECK_IN_CHANGED'});
  assert.equal(f.count('body_check_ins'),1);
 }finally{f.sqlite.close();}
});

test('quick adjustment needs no provider/quota, starts after the whole current reservation, and applies exactly once',async()=>{
 const f=fixture();try{
  let j=await f.journey();const key=randomUUID();
  const result=await f.quick.createQuickAdjustment(A,j.id,raw(j),key,clock);
  assert.equal(result.job.state,'awaiting_approval');assert.equal(result.job.adjustment.strategy,'quick');assert.equal(f.count('auth_rate_limits'),0);
  assert.ok(result.job.adjustment.proposals.length>0);
  const pause=result.job.adjustment.proposals.find(p=>p.templates.some(t=>t.type==='add_stop'));assert.ok(pause);
  assert.equal((await f.quick.createQuickAdjustment(A,j.id,raw(j),key,clock)).job.id,result.job.id);
  const before=structuredClone(j.plan.plan.itinerary[0]);
  const applied=await f.jobs.decidePlanningJob(A,result.job.id,'apply',j.version,[pause.id]);j=applied.journey;
  assert.deepEqual(plain(j.plan.plan.itinerary[0]),before);
  assert.ok(j.plan.plan.itinerary.find(i=>i.kind==='rest').time>='17:00');
  assert.equal((await f.body.listAdjustmentRecords(A,j.id)).length,1);
  assert.equal((await f.jobs.decidePlanningJob(A,result.job.id,'apply',j.version-1,[pause.id])).journey.version,j.version);
  assert.equal(f.count('journey_adjustments'),1);
 }finally{f.sqlite.close();}
});

test('stale quick submission and approval cannot overwrite a manual change',async()=>{
 const f=fixture();try{
  let j=await f.journey();const submitted=raw(j);
  const result=await f.quick.createQuickAdjustment(A,j.id,submitted,randomUUID(),clock);
  j=await f.journeys.updateJourneyItinerary(A,j.id,{version:j.version,operations:[{type:'edit',index:2,name:'用户保留的晚间散步'}]});
  await assert.rejects(f.jobs.decidePlanningJob(A,result.job.id,'apply',j.version,result.job.adjustment.proposals.slice(0,1).map(p=>p.id)),{code:'JOURNEY_CHANGED'});
  await assert.rejects(f.quick.createQuickAdjustment(A,j.id,submitted,randomUUID(),clock),{code:'INVALID_ADJUSTMENT_REQUEST'});
  assert.equal(f.count('journey_adjustments'),0);
 }finally{f.sqlite.close();}
});

test('actual completed and current activities are protected in manual edits, regeneration, restoration and suggestions',async()=>{
 const f=fixture();try{
  let j=await f.journey();const snapshot=j.version-1;
  const walk=j.plan.plan.itinerary[1];
  j=await f.journeys.updateActivityState(A,j.id,walk.id,{version:j.version,state:'completed'},clock);
  await assert.rejects(f.journeys.updateJourneyItinerary(A,j.id,{version:j.version,operations:[{type:'remove',index:1}]}),{code:'ACTIVITY_PROTECTED'});
  const altered=structuredClone(j.plan);altered.plan.itinerary[1].name='模型改掉已完成活动';
  await assert.rejects(f.journeys.saveGeneratedJourney(A,{journeyId:j.id,expectedVersion:j.version,draft:j.draft,generated:altered}),{code:'ACTIVITY_PROTECTED'});
  const restored=await f.versions.restoreJourneyVersion(A,j.id,j.version,snapshot);
  assert.equal(restored.plan.plan.itinerary.find(i=>i.id===walk.id).progress.state,'completed');
  const quick=await f.quick.createQuickAdjustment(A,j.id,raw(j),randomUUID(),clock);
  assert.ok(quick.job.adjustment.proposals.every(p=>p.templates.every(t=>t.activityId!==walk.id)));
  j=await f.journeys.updateActivityState(A,j.id,j.plan.plan.itinerary[0].id,{version:j.version,state:'in_progress'},clock);
  await assert.rejects(f.journeys.updateActivityState(A,j.id,j.plan.plan.itinerary[2].id,{version:j.version,state:'in_progress'},clock),{code:'ACTIVITY_IN_PROGRESS'});
 }finally{f.sqlite.close();}
});

test('manual removal preserves the original activity in backlog atomically; a lost version race writes nothing',async()=>{
 const f=fixture();try{
  let j=await f.journey(),removed=j.plan.plan.itinerary[2];
  j=await f.journeys.updateJourneyItinerary(A,j.id,{version:j.version,operations:[{type:'remove',index:2}]});
  const backlog=await f.collections.listJourneyCollections(A,j.id);assert.equal(backlog.length,1);assert.deepEqual(plain(backlog[0].activity),plain(removed));
  f.hooks.beforeRun=sql=>{if(sql.startsWith('UPDATE journeys SET draft_json')){f.hooks.beforeRun=null;f.sqlite.prepare('UPDATE journeys SET version=version+1 WHERE id=?').run(j.id);}};
  await assert.rejects(f.journeys.updateJourneyItinerary(A,j.id,{version:j.version,operations:[{type:'remove',index:1}]}),{code:'JOURNEY_CHANGED'});
  assert.equal(f.count('journey_collection_items'),1);
 }finally{f.sqlite.close();}
});

test('outcomes belong to independent adjustments, update current self-report, and steer later same-day suggestions',async()=>{
 const f=fixture();try{
  let j=await f.journey();
  const first=await f.quick.createQuickAdjustment(A,j.id,raw(j),randomUUID(),clock);
  const move=first.job.adjustment.proposals.find(p=>p.angle==='mobility');
  j=(await f.jobs.decidePlanningJob(A,first.job.id,'apply',j.version,[move.id])).journey;
  const second=await f.quick.createQuickAdjustment(A,j.id,raw(j),randomUUID(),clock);
  const pause=second.job.adjustment.proposals.find(p=>p.templates.some(t=>t.type==='add_stop'));
  j=(await f.jobs.decidePlanningJob(A,second.job.id,'apply',j.version,[pause.id])).journey;
  const key=randomUUID(),value={version:j.version,feeling:'still_tired',fatigue:5,stress:null,note:'还是累'};
  const outcome=await f.body.recordAdjustmentOutcome(A,j.id,first.job.id,value,key,clock);
  assert.equal(outcome.adjustment.id,first.job.id);assert.equal(outcome.checkIn.fatigue,5);assert.equal(outcome.checkIn.source,'adjustment_outcome');
  const again=await f.body.recordAdjustmentOutcome(A,j.id,first.job.id,value,key,clock);assert.equal(again.journey.version,outcome.journey.version);
  assert.equal(f.count('journey_feedback'),1);assert.equal(f.count('body_check_ins'),1);
  const records=await f.body.listAdjustmentRecords(A,j.id);assert.equal(records.length,2);assert.equal(records.filter(r=>r.outcome).length,1);
  const ordered=learning.rankProposalsByOutcomes([move,pause],records,date);assert.equal(ordered[0].id,pause.id);
  assert.equal(learning.rankProposalsByOutcomes([move,pause],records,'2026-10-20')[0].id,move.id);
  assert.equal((await f.body.journeyBodyContext(A,j.id,clock)).pendingAdjustments.length,1);
 }finally{f.sqlite.close();}
});

test('adjustment removals and records commit together, while a lost approval race stores neither',async()=>{
 const f=fixture();try{
  let j=await f.journey();const input={...raw(j),checkIn:{fatigue:4,stress:null,tags:['poor_sleep']}};
  const quick=await f.quick.createQuickAdjustment(A,j.id,input,randomUUID(),clock);
  const end=quick.job.adjustment.proposals.find(p=>p.templates.some(t=>t.type==='end_early'));assert.ok(end);
  const removed=j.plan.plan.itinerary.at(-1);
  j=(await f.jobs.decidePlanningJob(A,quick.job.id,'apply',j.version,[end.id])).journey;
  assert.equal(f.count('journey_adjustments'),1);assert.equal(f.count('journey_collection_items'),1);
  assert.deepEqual(plain((await f.collections.listJourneyCollections(A,j.id))[0].activity),plain(removed));
  const next=await f.quick.createQuickAdjustment(A,j.id,raw(j),randomUUID(),clock);
  f.hooks.beforeRun=sql=>{if(sql.startsWith('UPDATE journeys SET draft_json')){f.hooks.beforeRun=null;f.sqlite.prepare('UPDATE journeys SET version=version+1 WHERE id=?').run(j.id);}};
  await assert.rejects(f.jobs.decidePlanningJob(A,next.job.id,'apply',j.version,[next.job.adjustment.proposals[0].id]),{code:'JOURNEY_CHANGED'});
  assert.equal(f.count('journey_adjustments'),1);assert.equal(f.count('journey_collection_items'),1);
 }finally{f.sqlite.close();}
});

test('an outcome losing a version race writes no feedback or self-report; legacy feedback updates the same history',async()=>{
 const f=fixture();try{
  let j=await f.journey();const quick=await f.quick.createQuickAdjustment(A,j.id,raw(j),randomUUID(),clock);
  j=(await f.jobs.decidePlanningJob(A,quick.job.id,'apply',j.version,[quick.job.adjustment.proposals.find(p=>p.angle==='mobility').id])).journey;
  f.hooks.beforeRun=sql=>{if(sql.startsWith('UPDATE journeys SET version=version+1')){f.hooks.beforeRun=null;f.sqlite.prepare('UPDATE journeys SET version=version+1 WHERE id=?').run(j.id);}};
  await assert.rejects(f.body.recordAdjustmentOutcome(A,j.id,quick.job.id,{version:j.version,feeling:'lighter',fatigue:2},randomUUID(),clock),{code:'OUTCOME_CHANGED'});
  assert.equal(f.count('journey_feedback'),0);assert.equal(f.count('body_check_ins'),0);
  j=await f.journeys.getJourney(A,j.id);
  await f.journeys.recordJourneyFeedback(A,j.id,{version:j.version,adjustmentAt:j.plan.bodyAdjustment.updatedAt,fatigue:2,note:'轻松了一些'});
  const history=await f.body.listAdjustmentRecords(A,j.id);assert.equal(history[0].outcome.feeling,'lighter');
  assert.equal((await f.body.listBodyCheckIns(A,j.id,new Date())).checkIns[0].fatigue,2);
 }finally{f.sqlite.close();}
});

test('restore keeps current progress and refuses a historical change to a completed activity or fixed interval',async()=>{
 const f=fixture();try{
  let j=await f.journey();const originalVersion=j.version-1;
  j=await f.journeys.updateJourneyItinerary(A,j.id,{version:j.version,operations:[{type:'edit',index:1,name:'用户确认的新活动'}]});
  j=await f.journeys.updateActivityState(A,j.id,j.plan.plan.itinerary[1].id,{version:j.version,state:'completed'},clock);
  await assert.rejects(f.versions.restoreJourneyVersion(A,j.id,j.version,originalVersion),{code:'ACTIVITY_PROTECTED'});
  assert.equal((await f.journeys.getJourney(A,j.id)).plan.plan.itinerary[1].progress.state,'completed');
 }finally{f.sqlite.close();}
});

test('different selections racing for the same quick job cannot add the losing selection to backlog',async()=>{
 const f=fixture();try{
  let j=await f.journey();const quick=await f.quick.createQuickAdjustment(A,j.id,{...raw(j),checkIn:{fatigue:4,stress:null,tags:['poor_sleep']}},randomUUID(),clock);
  const keep=quick.job.adjustment.proposals.find(p=>p.angle==='mobility'),remove=quick.job.adjustment.proposals.find(p=>p.templates.some(t=>t.type==='end_early'));
  const winning=apply.applyAdjustments(j.plan,quick.job.adjustment,[keep.id],j.draft.trip,'15:00');
  winning.bodyAdjustment.id=quick.job.id;winning.manualAdjustment.id='winner-mutation';
  const record={id:quick.job.id,jobId:quick.job.id,journeyId:j.id,appliedAt:clock.toISOString(),localDate:date,beforeVersion:j.version,afterVersion:j.version+1,fatigueBefore:4,changes:[keep],outcome:null};
  f.hooks.beforeRun=sql=>{if(sql.startsWith('UPDATE journeys SET draft_json')){
    f.hooks.beforeRun=null;
    f.sqlite.prepare('UPDATE journeys SET plan_json=?,version=version+1 WHERE id=?').run(JSON.stringify(winning),j.id);
    f.sqlite.prepare("UPDATE planning_jobs SET state='completed' WHERE id=?").run(quick.job.id);
    f.sqlite.prepare('INSERT INTO journey_adjustments(id,account_id,journey_id,job_id,payload_json) VALUES(?,?,?,?,?)').run(quick.job.id,A,j.id,quick.job.id,JSON.stringify(record));
  }};
  await assert.rejects(f.jobs.decidePlanningJob(A,quick.job.id,'apply',j.version,[remove.id]),{code:'JOURNEY_CHANGED'});
  assert.equal(f.count('journey_collection_items'),0);
  assert.equal(f.count('journey_adjustments'),1);
  assert.equal((await f.journeys.getJourney(A,j.id)).plan.plan.itinerary.length,3);
 }finally{f.sqlite.close();}
});

test('full replan confirmation also saves removed future activities in backlog',async()=>{
 const f=fixture();try{
  let j=await f.journey();const old=j.plan.plan.itinerary.at(-1);
  const created=await f.jobs.createPlanningJob(A,randomUUID(),{...draft,journeyId:j.id,expectedVersion:j.version});
  f.sqlite.prepare("UPDATE planning_jobs SET state='running' WHERE id=?").run(created.job.id);
  const candidate=structuredClone(j.plan);candidate.plan.itinerary.pop();
  await f.jobs.finishJob(await f.jobs.jobRow(A,created.job.id),candidate,j.draft);
  j=(await f.jobs.decidePlanningJob(A,created.job.id,'apply',j.version,undefined,clock)).journey;
  assert.equal(j.plan.plan.itinerary.length,2);assert.equal(f.count('journey_adjustments'),0);
  assert.deepEqual(plain((await f.collections.listJourneyCollections(A,j.id))[0].activity),plain(old));
 }finally{f.sqlite.close();}
});

test('empty quick suggestions are terminal and never block the next replan',async()=>{
 const f=fixture();try{
  const j=await f.journey(),input={...raw(j),checkIn:{fatigue:1,stress:null,tags:[]}},key=randomUUID();
  const result=await f.quick.createQuickAdjustment(A,j.id,input,key,clock);
  assert.equal(result.job.adjustment.proposals.length,0);assert.equal(result.job.state,'completed');
  assert.equal((await f.quick.createQuickAdjustment(A,j.id,input,key,clock)).job.id,result.job.id);
  assert.equal((await f.journeys.getJourney(A,j.id)).version,j.version);assert.equal(f.count('journey_adjustments'),0);
  const next=await f.jobs.createPlanningJob(A,randomUUID(),{...draft,journeyId:j.id,expectedVersion:j.version});
  assert.equal(next.job.state,'queued');
 }finally{f.sqlite.close();}
});

test('a breathing-only quick result does not require approval or occupy the planning slot',async()=>{
 const f=fixture();try{
  const j=await f.journey(),input={...raw(j),scope:{...raw(j).scope,fromTime:'22:00'},checkIn:{fatigue:1,stress:4,tags:[]}};
  const result=await f.quick.createQuickAdjustment(A,j.id,input,randomUUID(),clock);
  assert.ok(result.job.adjustment.proposals.length);assert.ok(result.job.adjustment.proposals.every(p=>p.templates.length===0));assert.equal(result.job.state,'completed');
  const next=await f.quick.createQuickAdjustment(A,j.id,raw(j),randomUUID(),clock);assert.equal(next.job.state,'awaiting_approval');
 }finally{f.sqlite.close();}
});
