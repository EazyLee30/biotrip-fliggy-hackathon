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
function fixture(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
 for(const name of ['0001_accounts.sql','0002_password_auth.sql','0003_journeys.sql','0007_planning_jobs.sql','0008_adjustments.sql'])sqlite.exec(readProjectFile(`migrations/${name}`));
 for(const id of [A,B])sqlite.prepare('INSERT INTO accounts(id,email) VALUES(?,?)').run(id,id+'@example.invalid');
 const db={prepare(sql){const statement=sqlite.prepare(sql);let args=[];return {bind(...values){args=values;return this;},async first(){return statement.get(...args)??null;},async all(){return {results:statement.all(...args)};},async run(){if(/RETURNING/i.test(sql)){const results=statement.all(...args);return {results,meta:{changes:results.length+2}};}return {results:[],meta:{changes:Number(statement.run(...args).changes)}};}};},async batch(statements){sqlite.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
 const storage={'@/lib/database':{getDatabase:()=>db}};
 const edit=loadModule('lib/itinerary-edit.ts',{'./planner-input':loadModule('lib/planner-input.ts')});
 const journeys=loadModule('lib/journeys.ts',{...storage,'@/lib/preferences':{learnFromDraft:async()=>{},learnFromFeedback:async()=>{}},'@/lib/itinerary-edit':edit});
 const lease=loadModule('lib/planning/rate-limit.ts',{...storage,'@/lib/journeys':journeys});
 const jobs=loadModule('lib/planning/jobs.ts',{'../adjust/apply':applyAdjustment,'../adjust/request':adjustmentRequest,...storage,'@/lib/journeys':journeys,'./rate-limit':lease,'@/lib/bailian':{getBailianConfig:()=>null}});
 const versions=loadModule('lib/journey-versions.ts',{...storage,'@/lib/journeys':journeys});
 const context=loadModule('lib/planning/contract.ts');const stages=loadModule('lib/planning/stages.ts');
 async function create(existing=false){let journey=await journeys.createJourney(A,{draft});if(existing)journey=await journeys.saveGeneratedJourney(A,{journeyId:journey.id,expectedVersion:journey.version,draft,generated:plan});const raw={...draft,journeyId:journey.id,expectedVersion:journey.version};const key=randomUUID();const result=await jobs.createPlanningJob(A,key,raw);return {journey,raw,key,...result,row:await jobs.jobRow(A,result.job.id)};}
 function running(id){sqlite.prepare("UPDATE planning_jobs SET state='running' WHERE id=?").run(id);}
 return {sqlite,db,storage,journeys,jobs,lease,versions,context,stages,create,running};
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
