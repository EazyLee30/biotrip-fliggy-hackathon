import * as protection from "../adjust/protection.ts";
import * as applyAdjustment from "../adjust/apply.ts";
import * as adjustmentRequest from "../adjust/request.ts";
import * as adjustmentPipeline from "./adjust-pipeline.ts";
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { loadModule, readProjectFile } from '../test-support/module-loader.mjs';
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const draft={intention:'安静恢复',consent:true,trip:{originCity:'上海',destinationCity:'杭州',departureDate:'2026-10-12',returnDate:'2026-10-12',departureTimezone:'Asia/Shanghai',destinationTimezone:'Asia/Shanghai'}};
const plan={source:'live',retrievedAt:'2026-10-04T00:00:00Z',timezone:{shiftMinutes:0,travelHours:2},healthContext:{basis:'preferences_only',provisional:true},localServices:[],plan:{headline:'杭州',summary:'从容',reason:'已核验',adjustments:[],places:[],itinerary:[{date:'2026-10-12',time:'10:00',name:'西湖',detail:'散步',fixed:false}]}};
function fixture(clock=new Date('2026-10-11T00:00:00Z')){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
 for(const name of ['0001_accounts.sql','0002_password_auth.sql','0003_journeys.sql','0007_planning_jobs.sql','0008_adjustments.sql','0013_body_journey.sql','0014_journey_collections.sql'])sqlite.exec(readProjectFile(`migrations/${name}`));
 for(const id of [A,B])sqlite.prepare('INSERT INTO accounts(id,email) VALUES(?,?)').run(id,id+'@example.invalid');
 const db={prepare(sql){const statement=sqlite.prepare(sql);let args=[];return {bind(...values){args=values;return this;},async first(){return statement.get(...args)??null;},async all(){return {results:statement.all(...args)};},async run(){if(/RETURNING/i.test(sql)){const results=statement.all(...args);return {results,meta:{changes:results.length+2}};}return {results:[],meta:{changes:Number(statement.run(...args).changes)}};}};},async batch(statements){sqlite.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
 const storage={'@/lib/database':{getDatabase:()=>db}};
 const edit=loadModule('lib/itinerary-edit.ts',{'./adjust/protection':protection,'./planner-input':loadModule('lib/planner-input.ts')});
 const journeys=loadModule('lib/journeys.ts',{...storage,'@/lib/preferences':{learnFromDraft:async()=>{},learnFromFeedback:async()=>{}},'@/lib/itinerary-edit':edit});
 const collections=loadModule('lib/journey-collections.ts',{...storage,'@/lib/journeys':journeys,'@/lib/itinerary-edit':edit});
 const lease=loadModule('lib/planning/rate-limit.ts',{...storage,'@/lib/journeys':journeys});
 const reservations=loadModule('lib/planning/reservations.ts',{'@/lib/trip-timing':loadModule('lib/trip-timing.ts',{'./planner-input':loadModule('lib/planner-input.ts')}),'@/lib/journeys':journeys,'@/lib/itinerary-edit':edit,'@/lib/planner-input':loadModule('lib/planner-input.ts'),'../adjust/protection':protection,'../adjust/request':adjustmentRequest});
 const jobs=loadModule('lib/planning/jobs.ts',{'./reservations':reservations,'@/lib/journey-collections':collections,'../adjust/apply':applyAdjustment,'../adjust/request':{...adjustmentRequest,adjustmentScope:journey=>adjustmentRequest.adjustmentScope(journey,clock)},...storage,'@/lib/journeys':journeys,'./rate-limit':lease,'@/lib/bailian':{getBailianConfig:()=>null}});
 const versions=loadModule('lib/journey-versions.ts',{...storage,'@/lib/journeys':journeys});
 const context=loadModule('lib/planning/contract.ts');const stages=loadModule('lib/planning/stages.ts');
 async function create(existing=false){let journey=await journeys.createJourney(A,{draft});if(existing)journey=await journeys.saveGeneratedJourney(A,{journeyId:journey.id,expectedVersion:journey.version,draft,generated:plan});const raw={...draft,journeyId:journey.id,expectedVersion:journey.version};const key=randomUUID();const result=await jobs.createPlanningJob(A,key,raw);return {journey,raw,key,...result,row:await jobs.jobRow(A,result.job.id)};}
 function running(id){sqlite.prepare("UPDATE planning_jobs SET state='running' WHERE id=?").run(id);}
 return {sqlite,db,storage,journeys,jobs,lease,versions,context,stages,create,running,reservations};
}
test('idempotent submission returns one task and one hourly charge; altered retries fail',async()=>{const f=fixture();try{const one=await f.create();const two=await f.jobs.createPlanningJob(A,one.key,one.raw);assert.equal(two.job.id,one.job.id);assert.equal(two.created,false);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM planning_jobs').get().n,1);await assert.rejects(f.jobs.createPlanningJob(A,one.key,{...one.raw,intention:'变化'}),{code:'IDEMPOTENCY_CONFLICT'});await assert.rejects(f.jobs.createPlanningJob(A,randomUUID(),one.raw),{code:'PLANNING_IN_PROGRESS'});await assert.rejects(f.lease.reservePlanning(A,60),{code:'PLANNING_IN_PROGRESS'});}finally{f.sqlite.close();}});
test('jobs, candidates, events and history are account-private',async()=>{const f=fixture();try{const one=await f.create();await assert.rejects(f.jobs.getPlanningJob(B,one.job.id),{code:'JOB_NOT_FOUND'});assert.equal((await f.jobs.listPlanningJobs(B)).length,0);await assert.rejects(f.versions.listJourneyVersions(B,one.journey.id),{code:'JOURNEY_NOT_FOUND'});}finally{f.sqlite.close();}});
test('initial result applies once and snapshots atomically; reading progress never reruns it',async()=>{const f=fixture();try{const one=await f.create();f.running(one.job.id);await f.jobs.finishJob(one.row,plan,draft);let saved=await f.journeys.getJourney(A,one.journey.id);assert.equal(saved.version,2);assert.equal((await f.jobs.getPlanningJob(A,one.job.id)).job.state,'completed');await f.jobs.finishJob(one.row,plan,draft);saved=await f.journeys.getJourney(A,one.journey.id);assert.equal(saved.version,2);assert.equal((await f.versions.listJourneyVersions(A,saved.id)).length,1);}finally{f.sqlite.close();}});
test('replan requires approval, preserves old plan, and applying twice is safe',async()=>{const f=fixture();try{const one=await f.create(true);f.running(one.job.id);const changed=structuredClone(plan);changed.plan.headline='新的杭州';await f.jobs.finishJob(one.row,changed,draft);assert.equal((await f.journeys.getJourney(A,one.journey.id)).plan.plan.headline,'杭州');assert.equal((await f.jobs.getPlanningJob(A,one.job.id)).job.state,'awaiting_approval');const result=await f.jobs.decidePlanningJob(A,one.job.id,'apply',one.journey.version);assert.equal(result.journey.plan.plan.headline,'新的杭州');const again=await f.jobs.decidePlanningJob(A,one.job.id,'apply',one.journey.version);assert.equal(again.journey.version,result.journey.version);assert.equal((await f.versions.listJourneyVersions(A,one.journey.id)).length,2);}finally{f.sqlite.close();}});
test('candidate discard and concurrent manual changes cannot overwrite existing arrangements',async()=>{const f=fixture();try{const one=await f.create(true);f.running(one.job.id);await f.jobs.finishJob(one.row,{...plan,retrievedAt:'2026-10-04T01:00:00Z'},draft);await f.journeys.updateJourneyItinerary(A,one.journey.id,{version:one.journey.version,operations:[{type:'edit',index:0,name:'新预约'}]});await assert.rejects(f.jobs.decidePlanningJob(A,one.job.id,'apply',one.journey.version+1),{code:'JOURNEY_CHANGED'});await f.jobs.decidePlanningJob(A,one.job.id,'discard');assert.equal((await f.journeys.getJourney(A,one.journey.id)).plan.plan.itinerary[0].name,'新预约');}finally{f.sqlite.close();}});
test('cancel wins over late completion; terminal result cannot be cancelled afterward',async()=>{const f=fixture();try{const one=await f.create();f.running(one.job.id);await f.jobs.cancelPlanningJob(A,one.job.id);await f.jobs.finishJob(one.row,plan,draft);assert.equal((await f.journeys.getJourney(A,one.journey.id)).plan,null);await f.jobs.completeCancellation(one.row);assert.equal((await f.jobs.getPlanningJob(A,one.job.id)).job.state,'cancelled');const next=await f.jobs.createPlanningJob(A,randomUUID(),one.raw);f.running(next.job.id);const row=await f.jobs.jobRow(A,next.job.id);await f.jobs.finishJob(row,plan,draft);await f.jobs.cancelPlanningJob(A,next.job.id);assert.equal((await f.jobs.getPlanningJob(A,next.job.id)).job.state,'completed');}finally{f.sqlite.close();}});
test('cursor recovery yields only new events and excludes events after cancellation',async()=>{const f=fixture();try{const one=await f.create();f.running(one.job.id);await f.jobs.jobEvent(one.job.id,'progress',{stage:'health_insight',status:'ok'});const initial=await f.jobs.getPlanningJob(A,one.job.id);await f.jobs.jobEvent(one.job.id,'recommendations',{items:[]});const next=await f.jobs.getPlanningJob(A,one.job.id,initial.events[0].seq);assert.equal(next.events.length,1);assert.equal(next.events[0].kind,'recommendations');await f.jobs.cancelPlanningJob(A,one.job.id);await f.jobs.jobEvent(one.job.id,'progress',{stage:'compose_plan'});assert.equal((await f.jobs.getPlanningJob(A,one.job.id)).events.length,2);}finally{f.sqlite.close();}});
test('history restore produces a new version, preserves rollback, rejects stale and active-job restore',async()=>{const f=fixture();try{const one=await f.create(true);f.running(one.job.id);await f.jobs.failJob(one.row,'TEST','停止');const edited=await f.journeys.updateJourneyItinerary(A,one.journey.id,{version:one.journey.version,operations:[{type:'edit',index:0,name:'喝茶'}]});const restored=await f.versions.restoreJourneyVersion(A,one.journey.id,edited.version,one.journey.version);assert.equal(restored.version,edited.version+1);assert.equal(restored.plan.plan.itinerary[0].name,'西湖');assert.equal((await f.versions.listJourneyVersions(A,restored.id)).length,3);await assert.rejects(f.versions.restoreJourneyVersion(A,restored.id,edited.version,one.journey.version),{code:'JOURNEY_CHANGED'});}finally{f.sqlite.close();}});
test('deleting a journey cascades jobs, private inputs, events, receipts and versions',async()=>{const f=fixture();try{const one=await f.create(true);f.running(one.job.id);await f.jobs.jobEvent(one.job.id,'progress',{stage:'health_insight'});await f.jobs.failJob(one.row,'TEST','停止');await f.journeys.deleteJourney(A,one.journey.id,one.journey.version);for(const table of ['planning_jobs','planning_job_events','journey_versions'])assert.equal(f.sqlite.prepare(`SELECT count(*) n FROM ${table}`).get().n,0);}finally{f.sqlite.close();}});
function workflow(f,run){
 return loadModule('workers/planning.ts',{'cloudflare:workers':{WorkflowEntrypoint:class{}},...f.storage,
  '@/lib/planning/adjust-pipeline':adjustmentPipeline,'@/lib/planning/pipeline':{runPlanning:run},'@/lib/planning/service':{preparePlanning:async()=>({input:draft,timing:{},memory:{}}),generatedPlan:()=>plan},
  '@/lib/planning/jobs':f.jobs,'@/lib/planning/contract':f.context,'@/lib/planning/stages':f.stages}).PlanningWorkflow;
}
test('durable paid stages have zero retries and persisted safe outputs replay without billing again',async()=>{const f=fixture();try{const one=await f.create();const billing=[];const options=[];
 const run=async(request)=>{for(const stage of ['health_insight','flyai_inventory','compose_plan'])await request.checkpoint(stage,async()=>{billing.push(stage);return {walkingPace:'reduced'};});return {};};
 const Worker=workflow(f,run);const cache=new Map();const step={async do(name,config,callback){if(typeof config==='function'){callback=config;config=undefined;}if(config)options.push(config);if(cache.has(name))return cache.get(name);const value=await callback();cache.set(name,value);return value;}};
 await new Worker().run({payload:{jobId:one.job.id}},step);
 assert.deepEqual(billing,['health_insight','flyai_inventory','compose_plan']);assert.equal(options.every(o=>o.retries.limit===0),true);
 // Lose the Workflow step cache, keep D1 receipts: stage callbacks must still not bill again.
 f.sqlite.prepare("UPDATE planning_jobs SET state='running',request_json=? WHERE id=?").run(JSON.stringify(one.raw),one.job.id);cache.clear();await new Worker().run({payload:{jobId:one.job.id}},step);
 assert.equal(billing.length,3);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM planning_job_stages WHERE result_json IS NOT NULL').get().n,3);
}finally{f.sqlite.close();}});
test('an interrupted upstream call is marked indeterminate, with no blind paid retry',async()=>{const f=fixture();try{const one=await f.create();f.sqlite.prepare("INSERT INTO planning_job_stages(job_id,stage,state) VALUES(?,'compose_plan','started')").run(one.job.id);let calls=0;
 const Worker=workflow(f,async request=>{await request.checkpoint('compose_plan',async()=>{calls++;return {};});return {};});
 const step={async do(name,config,callback){return (typeof config==='function'?config:callback)();}};
 await new Worker().run({payload:{jobId:one.job.id}},step);assert.equal(calls,0);assert.equal((await f.jobs.getPlanningJob(A,one.job.id)).job.state,'indeterminate');
 assert.equal(f.sqlite.prepare('SELECT request_json FROM planning_jobs WHERE id=?').get(one.job.id).request_json,'{}');
}finally{f.sqlite.close();}});

test('task timings use the first persisted recommendation across cursor reads, without provider calls',async()=>{
 const f=fixture();try{
  const one=await f.create();f.running(one.job.id);
  f.sqlite.prepare('UPDATE planning_jobs SET created_at=100,updated_at=140 WHERE id=?').run(one.job.id);
  f.sqlite.prepare('INSERT INTO planning_job_events(job_id,kind,payload_json,created_at) VALUES(?,?,?,?)').run(one.job.id,'recommendations',JSON.stringify({items:[{name:"公开推荐"}]}),112);
  f.sqlite.prepare('INSERT INTO planning_job_events(job_id,kind,payload_json,created_at) VALUES(?,?,?,?)').run(one.job.id,'progress',JSON.stringify({stage:'compose_plan',status:'ok'}),135);
  f.sqlite.prepare('INSERT INTO planning_job_events(job_id,kind,payload_json,created_at) VALUES(?,?,?,?)').run(one.job.id,'progress',JSON.stringify({stage:'complete',status:'ok'}),140);
  f.sqlite.prepare("UPDATE planning_jobs SET state='completed',updated_at=500 WHERE id=?").run(one.job.id);
  const result=await f.jobs.getPlanningJob(A,one.job.id,999999);
  assert.equal(result.events.length,0);
  assert.equal(result.job.timing.firstRecommendationsMs,12000);
  assert.equal(result.job.timing.composedMs,35000);
  assert.equal(result.job.timing.resultReadyMs,40000);
  assert.equal(result.job.timing.precision,'second');
 }finally{f.sqlite.close();}
});

test('adjustments await selection, apply only accepted IDs once, and support version restoration',async()=>{
 const f=fixture();try{
  let journey=await f.journeys.createJourney(A,{draft});
  const base=structuredClone(plan);base.plan.itinerary[0].durationMin=90;
  journey=await f.journeys.saveGeneratedJourney(A,{journeyId:journey.id,expectedVersion:journey.version,draft,generated:base});
  const raw={mode:'adjust',journeyId:journey.id,expectedVersion:journey.version};
  const created=await f.jobs.createPlanningJob(A,randomUUID(),raw);f.running(created.job.id);
  const row=await f.jobs.jobRow(A,created.job.id),activity=journey.plan.plan.itinerary[0];
  const candidate={kind:'adjustment',scope:{date:'2026-10-12',fromTime:'00:00',throughDate:'2026-10-12'},stance:'balanced',stages:[],proposals:[{id:'shorten',title:'少待一会',reason:'留时间休息',angle:'pace',tier:'instant',signals:[],effect:{basis:'estimate'},templates:[{type:'shorten',activityId:activity.id,durationMin:45}]},{id:'taxi',title:'打车去',reason:'少走路',angle:'mobility',tier:'instant',signals:[],effect:{basis:'none'},templates:[{type:'swap_move',activityId:activity.id,mode:'taxi',basis:'unverified'}]}]};
  await f.jobs.finishAdjustmentJob(row,candidate,draft);
  const waiting=(await f.jobs.getPlanningJob(A,row.id)).job;
  assert.equal(waiting.mode,'adjust');assert.equal(waiting.candidate,null);assert.equal(waiting.adjustment.proposals.length,2);
  assert.equal((await f.journeys.getJourney(A,journey.id)).version,journey.version);
  await assert.rejects(f.jobs.decidePlanningJob(A,row.id,'apply',journey.version,['unknown']),{code:'ADJUSTMENT_INFEASIBLE'});
  const result=await f.jobs.decidePlanningJob(A,row.id,'apply',journey.version,['shorten']);
  assert.equal(result.journey.plan.plan.itinerary[0].durationMin,45);assert.equal(result.journey.plan.plan.itinerary[0].move,undefined);
  assert.equal((await f.jobs.decidePlanningJob(A,row.id,'apply',journey.version,['shorten'])).journey.version,result.journey.version);
  const restored=await f.versions.restoreJourneyVersion(A,journey.id,result.journey.version,journey.version);
  assert.equal(restored.plan.plan.itinerary[0].durationMin,90);
 }finally{f.sqlite.close();}
});

test('an adjustment that crossed destination midnight cannot be applied to an expired day',async()=>{
 const f=fixture(new Date('2026-10-12T16:01:00Z'));try{
  const journey=await f.journeys.saveGeneratedJourney(A,{draft,generated:plan});
  const created=await f.jobs.createPlanningJob(A,randomUUID(),{mode:'adjust',journeyId:journey.id,expectedVersion:journey.version});f.running(created.job.id);
  const row=await f.jobs.jobRow(A,created.job.id);
  await f.jobs.finishAdjustmentJob(row,{kind:'adjustment',scope:{date:'2026-10-12',fromTime:'00:00',throughDate:'2026-10-12'},stance:'balanced',stages:[],proposals:[]},draft);
  await assert.rejects(f.jobs.decidePlanningJob(A,row.id,'apply',journey.version,[]),e=>e.code==='ADJUSTMENT_EXPIRED');
  assert.equal((await f.journeys.getJourney(A,journey.id)).version,journey.version);
 }finally{f.sqlite.close();}
});

for(const strategy of ['quick','enhanced'])test(`${strategy} finishing after destination midnight cannot apply yesterday's self-report during a multi-day trip`,async()=>{
 const now=new Date('2026-10-12T16:01:00Z'),f=fixture(now);try{
  const tripDraft={...draft,trip:{...draft.trip,returnDate:'2026-10-13'}},base=structuredClone(plan);
  base.plan.itinerary.push({date:'2026-10-13',time:'10:00',name:'第二天散步',detail:'',fixed:false});
  const journey=await f.journeys.saveGeneratedJourney(A,{draft:tripDraft,generated:base});
  const created=await f.jobs.createPlanningJob(A,randomUUID(),{mode:'adjust',journeyId:journey.id,expectedVersion:journey.version});f.running(created.job.id);
  f.sqlite.prepare('UPDATE planning_jobs SET created_at=? WHERE id=?').run(Date.parse('2026-10-12T15:59:00Z')/1000,created.job.id);
  const row=await f.jobs.jobRow(A,created.job.id);
  await f.jobs.finishAdjustmentJob(row,{kind:'adjustment',strategy,requestedAt:'2026-10-12T16:00:30Z',checkIn:{fatigue:5,stress:null,tags:[]},scope:{date:'2026-10-12',fromTime:'23:59',throughDate:'2026-10-13'},stance:'balanced',stages:[],proposals:[]},tripDraft);
  await assert.rejects(f.jobs.decidePlanningJob(A,row.id,'apply',journey.version,[],now),{code:'ADJUSTMENT_EXPIRED'});
  assert.equal((await f.journeys.getJourney(A,journey.id)).version,journey.version);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM journey_adjustments').get().n,0);
 }finally{f.sqlite.close();}
});

test('a future arrival scope cannot keep yesterday self-report valid across destination midnight',async()=>{
 const now=new Date('2026-10-11T16:01:00Z'),f=fixture(now);try{
  const journey=await f.journeys.saveGeneratedJourney(A,{draft,generated:plan});
  const created=await f.jobs.createPlanningJob(A,randomUUID(),{mode:'adjust',journeyId:journey.id,expectedVersion:journey.version});f.running(created.job.id);
  f.sqlite.prepare('UPDATE planning_jobs SET created_at=? WHERE id=?').run(Date.parse('2026-10-11T15:59:00Z')/1000,created.job.id);
  const row=await f.jobs.jobRow(A,created.job.id);
  await f.jobs.finishAdjustmentJob(row,{kind:'adjustment',strategy:'enhanced',requestedAt:'2026-10-11T16:00:30Z',scope:{date:'2026-10-12',fromTime:'00:00',throughDate:'2026-10-12'},stance:'balanced',stages:[],proposals:[]},draft);
  // Scope remains Oct 12 both before and after midnight; submission local day is the decisive guard.
  await assert.rejects(f.jobs.decidePlanningJob(A,row.id,'apply',journey.version,[],now),{code:'ADJUSTMENT_EXPIRED'});
  assert.equal((await f.journeys.getJourney(A,journey.id)).version,journey.version);
 }finally{f.sqlite.close();}
});

test('same-day approval rechecks the latest local minute instead of the candidate minute',async()=>{
 const now=new Date('2026-10-12T02:30:00Z'),f=fixture(now);try{
  const base=structuredClone(plan);base.plan.itinerary[0].durationMin=90;
  const journey=await f.journeys.saveGeneratedJourney(A,{draft,generated:base});
  const created=await f.jobs.createPlanningJob(A,randomUUID(),{mode:'adjust',journeyId:journey.id,expectedVersion:journey.version});f.running(created.job.id);
  f.sqlite.prepare('UPDATE planning_jobs SET created_at=? WHERE id=?').run(Date.parse('2026-10-12T01:00:00Z')/1000,created.job.id);
  const row=await f.jobs.jobRow(A,created.job.id),activityId=journey.plan.plan.itinerary[0].id;
  await f.jobs.finishAdjustmentJob(row,{kind:'adjustment',strategy:'quick',requestedAt:'2026-10-12T01:00:00Z',scope:{date:'2026-10-12',fromTime:'09:00',throughDate:'2026-10-12'},stance:'balanced',stages:[],proposals:[{id:'shorten',tier:'instant',angle:'pace',title:'缩短',reason:'休息',signals:[],effect:{basis:'estimate'},templates:[{type:'shorten',activityId,durationMin:45}]}]},draft);
  await assert.rejects(f.jobs.decidePlanningJob(A,row.id,'apply',journey.version,['shorten'],now),{code:'ADJUSTMENT_INFEASIBLE'});
  assert.equal((await f.journeys.getJourney(A,journey.id)).plan.plan.itinerary[0].durationMin,90);
 }finally{f.sqlite.close();}
});

async function reservationJob(f, editsFor) {
 const bookingDraft={...draft,trip:{...draft.trip,returnDate:'2026-10-13'}};
 const base=structuredClone(plan);
 base.plan.itinerary=[
  {id:'reservation_one',date:'2026-10-12',time:'10:00',name:'茶室预约',detail:'已确认三小时',fixed:true,durationMin:180,progress:{state:'planned',updatedAt:'2026-10-11T00:00:00Z'}},
  {id:'flexible_evening',date:'2026-10-12',time:'16:00',name:'散步',detail:'',fixed:false,durationMin:60},
  {id:'reservation_two',date:'2026-10-13',time:'18:00',name:'晚餐预约',detail:'靠窗',fixed:true,durationMin:60},
 ];
 let journey=await f.journeys.saveGeneratedJourney(A,{draft:bookingDraft,generated:base});
 journey=await f.journeys.updateJourney(A,journey.id,{version:journey.version,status:'active'});
 for(const item of journey.plan.plan.itinerary) journey=await f.journeys.updateActivityState(A,journey.id,item.id,{version:journey.version,state:'planned'});
 const reservationEdits=editsFor(journey), raw={...bookingDraft,journeyId:journey.id,expectedVersion:journey.version,reservationEdits};
 const created=await f.jobs.createPlanningJob(A,randomUUID(),raw);f.running(created.job.id);
 return {journey,raw,bookingDraft,reservationEdits,row:await f.jobs.jobRow(A,created.job.id)};
}
const moveBooking=j=>[{activityId:j.plan.plan.itinerary[0].id,date:'2026-10-13',time:'12:00',fixed:true}];
function movedCandidate(journey) {
 const candidate=structuredClone(journey.plan);
 Object.assign(candidate.plan.itinerary[0],{date:'2026-10-13',time:'12:00',durationMin:60,detail:'模型改写',id:'untrusted_model_id',progress:{state:'completed',updatedAt:'2026-10-12T00:00:00Z'}});
 candidate.plan.itinerary.sort((a,b)=>`${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));
 return candidate;
}
test('pending cross-day reservation changes preserve actual state until adoption, including identity, full duration and progress',async()=>{
 const f=fixture();try{
  const one=await reservationJob(f,moveBooking),before=JSON.stringify(one.journey.plan);
  await f.jobs.finishJob(one.row,movedCandidate(one.journey),one.bookingDraft);
  const waiting=await f.jobs.getPlanningJob(A,one.row.id);
  assert.equal(waiting.job.state,'awaiting_approval');
  assert.equal(JSON.stringify((await f.journeys.getJourney(A,one.journey.id)).plan),before);
  const pending=JSON.parse(f.sqlite.prepare('SELECT request_json FROM planning_jobs WHERE id=?').get(one.row.id).request_json);
  assert.deepEqual(pending.reservationEdits,one.reservationEdits);
  const booking=waiting.job.candidate.plan.itinerary.find(i=>i.id===one.reservationEdits[0].activityId);
  assert.equal(booking.date,'2026-10-13');assert.equal(booking.time,'12:00');assert.equal(booking.durationMin,180);assert.equal(booking.progress.state,'planned');assert.equal(booking.detail,'已确认三小时');
  const adopted=await f.jobs.decidePlanningJob(A,one.row.id,'apply',one.journey.version);
  assert.equal(adopted.journey.version,one.journey.version+1);
  assert.equal(adopted.journey.plan.plan.itinerary.find(i=>i.id===booking.id).date,'2026-10-13');
  assert.equal((await f.jobs.decidePlanningJob(A,one.row.id,'apply',one.journey.version)).journey.version,adopted.journey.version);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM journey_collection_items').get().n,0);
 }finally{f.sqlite.close();}
});
test('the model cannot move a second reservation beyond the explicit authorization, before or after candidate persistence',async()=>{
 const f=fixture();try{
  const one=await reservationJob(f,moveBooking),candidate=movedCandidate(one.journey);
  candidate.plan.itinerary.find(i=>i.name==='晚餐预约').time='19:00';
  await assert.rejects(f.jobs.finishJob(one.row,candidate,one.bookingDraft),{code:'ACTIVITY_PROTECTED'});
  await f.jobs.finishJob(one.row,movedCandidate(one.journey),one.bookingDraft);
  const stored=JSON.parse(f.sqlite.prepare('SELECT candidate_json FROM planning_jobs WHERE id=?').get(one.row.id).candidate_json);
  stored.plan.itinerary.find(i=>i.name==='晚餐预约').time='19:00';
  f.sqlite.prepare('UPDATE planning_jobs SET candidate_json=? WHERE id=?').run(JSON.stringify(stored),one.row.id);
  await assert.rejects(f.jobs.decidePlanningJob(A,one.row.id,'apply',one.journey.version),{code:'ACTIVITY_PROTECTED'});
  assert.equal((await f.journeys.getJourney(A,one.journey.id)).version,one.journey.version);
 }finally{f.sqlite.close();}
});
test('explicitly releasing a reservation takes effect only on adoption and preserves removed activity in backlog',async()=>{
 const f=fixture();try{
  const one=await reservationJob(f,j=>[{activityId:j.plan.plan.itinerary[0].id,date:'2026-10-12',time:'10:00',fixed:false}]);
  const candidate=structuredClone(one.journey.plan);candidate.plan.itinerary.shift();
  await f.jobs.finishJob(one.row,candidate,one.bookingDraft);
  assert.equal((await f.journeys.getJourney(A,one.journey.id)).plan.plan.itinerary[0].fixed,true);
  await f.jobs.decidePlanningJob(A,one.row.id,'apply',one.journey.version);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM journey_collection_items WHERE kind=\'backlog\'').get().n,1);
 }finally{f.sqlite.close();}
});
test('reservation candidate cannot overwrite a progress update made while it was waiting',async()=>{
 const f=fixture();try{
  const one=await reservationJob(f,moveBooking);
  await f.jobs.finishJob(one.row,movedCandidate(one.journey),one.bookingDraft);
  const completed=await f.journeys.updateActivityState(A,one.journey.id,one.reservationEdits[0].activityId,{version:one.journey.version,state:'completed'});
  await assert.rejects(f.jobs.decidePlanningJob(A,one.row.id,'apply',completed.version),{code:'JOURNEY_CHANGED'});
  const latest=await f.journeys.getJourney(A,one.journey.id);
  assert.equal(latest.plan.plan.itinerary[0].date,'2026-10-12');assert.equal(latest.plan.plan.itinerary[0].progress.state,'completed');
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM journey_collection_items').get().n,0);
 }finally{f.sqlite.close();}
});
test('a reservation move may displace flexible activities, but final adoption must preserve its complete interval',async()=>{
 const f=fixture();try{
  const one=await reservationJob(f,j=>[{activityId:j.plan.plan.itinerary[0].id,date:'2026-10-12',time:'16:00',fixed:true}]);
  const shadow=f.reservations.reservationBaseline(one.journey,one.reservationEdits).shadow;
  assert.equal(shadow.plan.plan.itinerary.filter(i=>i.time==='16:00').length,2);
  const candidate=structuredClone(one.journey.plan);Object.assign(candidate.plan.itinerary[0],{time:'16:00',durationMin:30});
  candidate.plan.itinerary[1].time='17:00';
  await assert.rejects(f.jobs.finishJob(one.row,candidate,one.bookingDraft),{code:'ACTIVITY_PROTECTED'});
  candidate.plan.itinerary[1].time='20:00';
  await f.jobs.finishJob(one.row,candidate,one.bookingDraft);
  const result=await f.jobs.decidePlanningJob(A,one.row.id,'apply',one.journey.version);
  assert.equal(result.journey.plan.plan.itinerary[0].durationMin,180);assert.equal(result.journey.plan.plan.itinerary[1].time,'20:00');
 }finally{f.sqlite.close();}
});
test('a reservation approval losing the SQL version race writes neither its plan nor backlog',async()=>{
 const f=fixture();try{
  const one=await reservationJob(f,j=>[{activityId:j.plan.plan.itinerary[0].id,date:'2026-10-12',time:'10:00',fixed:false}]);
  const candidate=structuredClone(one.journey.plan);candidate.plan.itinerary.shift();
  await f.jobs.finishJob(one.row,candidate,one.bookingDraft);
  const originalBatch=f.db.batch;f.db.batch=async statements=>{
   f.sqlite.prepare('UPDATE journeys SET version=version+1 WHERE id=?').run(one.journey.id);f.db.batch=originalBatch;return originalBatch(statements);
  };
  await assert.rejects(f.jobs.decidePlanningJob(A,one.row.id,'apply',one.journey.version),{code:'JOURNEY_CHANGED'});
  const actual=await f.journeys.getJourney(A,one.journey.id);
  assert.equal(actual.plan.plan.itinerary[0].fixed,true);assert.equal(actual.plan.plan.itinerary.length,3);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM journey_collection_items').get().n,0);
  assert.equal((await f.jobs.getPlanningJob(A,one.row.id)).job.state,'awaiting_approval');
 }finally{f.sqlite.close();}
});
test('undated fixed and completed legacy activities share one dated baseline through preparation, preview and adoption',async()=>{
 const f=fixture();try{
  const generated=structuredClone(plan);generated.plan.itinerary=[
   {date:'2026-10-12',time:'10:00',name:'已经游览',detail:'原足迹',fixed:false,durationMin:60},
   {date:'2026-10-12',time:'14:00',name:'原预约',detail:'原三小时',fixed:true,durationMin:180},
  ];
  let journey=await f.journeys.saveGeneratedJourney(A,{draft,generated});
  journey=await f.journeys.updateJourney(A,journey.id,{version:journey.version,status:'active'});
  journey=await f.journeys.updateActivityState(A,journey.id,journey.plan.plan.itinerary[0].id,{version:journey.version,state:'completed'});
  const legacy=structuredClone(journey.plan);for(const item of legacy.plan.itinerary)delete item.date;
  f.sqlite.prepare('UPDATE journeys SET plan_json=?,version=version+1 WHERE id=?').run(JSON.stringify(legacy),journey.id);
  journey=await f.journeys.getJourney(A,journey.id);
  const input={...draft,trip:{...draft.trip,itineraryText:'2026-10-12 10:00 | 已经游览 | 灵活\n2026-10-12 14:00 | 原预约 | 固定'}};
  const prepared=f.reservations.planningReservations(journey,[],input,{arrivalDate:'2026-10-12',endDate:'2026-10-12'});
  assert.equal(prepared.fixedItems.length,2);assert.ok(prepared.fixedItems.every(item=>item.date==='2026-10-12'));
  const created=await f.jobs.createPlanningJob(A,randomUUID(),{...input,journeyId:journey.id,expectedVersion:journey.version,reservationEdits:[]});f.running(created.job.id);
  const candidate=structuredClone(legacy);for(const item of candidate.plan.itinerary)item.date='2026-10-12';
  candidate.plan.itinerary[1].durationMin=60;
  await f.jobs.finishJob(await f.jobs.jobRow(A,created.job.id),candidate,prepared.input);
  assert.ok((await f.journeys.getJourney(A,journey.id)).plan.plan.itinerary.every(item=>item.date===undefined));
  const adopted=await f.jobs.decidePlanningJob(A,created.job.id,'apply',journey.version);
  assert.ok(adopted.journey.plan.plan.itinerary.every(item=>item.date==='2026-10-12'));
  assert.equal(adopted.journey.plan.plan.itinerary[0].progress.state,'completed');assert.equal(adopted.journey.plan.plan.itinerary[0].id,journey.plan.plan.itinerary[0].id);
  assert.equal(adopted.journey.plan.plan.itinerary[1].durationMin,180);
 }finally{f.sqlite.close();}
});
