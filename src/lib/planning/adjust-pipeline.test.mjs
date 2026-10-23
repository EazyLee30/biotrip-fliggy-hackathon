import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runAdjustments } from './adjust-pipeline.ts';
import { abstractHealth } from './adjust-health.ts';
import { resolveAccepted } from '../adjust/validate.ts';
const date='2026-10-12';
const itinerary=[{id:'activity-walk',date,time:'14:00',name:'西湖徒步',detail:'步行游览',fixed:false,durationMin:90},{id:'activity-meal',date,time:'18:00',name:'晚餐',detail:'',fixed:false},{id:'activity-booking',date,time:'20:00',name:'固定演出',detail:'',fixed:true}];
function request(provider){const trip={destinationCity:'杭州',departureDate:date,returnDate:date,requestedServices:['local_food','massage'],planningStyle:'flexible'};return {provider,journey:{draft:{trip},plan:{timezone:{shiftMinutes:0},plan:{itinerary}}},adjustment:{scope:{date,fromTime:'13:00',throughDate:date},stance:'balanced',checkIn:{fatigue:4,stress:4,tags:['hungry']}},input:{trip,intention:'安静恢复',ambientPreferences:[],colorTone:'未指定',profileMemoryNotes:''},signal:new AbortController().signal,progress(){},timing:{},fixedItems:itinerary.filter(i=>i.fixed),includeWhoop:false,isNearOrOngoingTrip:true,accountId:'test-account',requestId:'test-task'};}
test('all failed advisors preserve useful rules and expose degraded provenance',async()=>{const fail=async()=>{throw new Error('offline');};const result=await runAdjustments(request({healthInsight:fail,reliefInventory:fail,localResearch:fail,composeAdjustments:fail}));assert.ok(result.proposals.length>=2);assert.ok(result.proposals.every(p=>p.tier==='instant'));assert.equal(result.stages.every(s=>['degraded','skipped'].includes(s.status)),true);});
test('independent advisors overlap; retrieval cannot read self-report or raw health; invented prices are not bound',async()=>{let started=0;const inputs={};const gate=()=>new Promise(resolve=>{started++;setTimeout(()=>{assert.equal(started,2);resolve();},10);});const provider={async healthInsight(ctx){inputs.health=ctx.input;await gate();return {walkingPace:'reduced',breakFrequency:'frequent',sensoryFilters:[],basis:'self_report',whoopUnavailable:false};},async reliefInventory(ctx){inputs.relief=ctx.input;await gate();return {sources:[{name:'真实足疗',url:'https://a.feizhu.com/1',category:'按摩',price:'¥128'}]};},async localResearch(ctx){inputs.local=ctx.input;await gate();return {services:[]};},async composeAdjustments(ctx,gathered){inputs.compose=ctx.input;return {proposals:[{angle:'relief',title:'坐下来放松',reason:'把一项灵活安排换成休闲',template:'replace_stop',activity_id:'activity-walk',source_index:0,source_name:gathered.sources[0].name,costCny:1}]};}};const result=await runAdjustments(request(provider));assert.deepEqual(Object.keys(inputs.relief).sort(),['itinerary','trip']);assert.equal(inputs.local.selfReport,undefined);assert.equal(inputs.compose.healthMetrics,undefined);assert.deepEqual(result.proposals.find(p=>p.tier==='advisor').effect.costCny,[128,128]);});
test('abstract health exports only closed enums',()=>{assert.deepEqual(abstractHealth({energy:'low',needs:['rest','recovery score 12'],metrics:{score:12}}),{energy:'low',needs:['rest']});});
test('cancellation does not become a successful candidate',async()=>{const controller=new AbortController();const req=request({healthInsight:async()=>null,reliefInventory:async()=>{controller.abort();throw new Error('cancelled');},localResearch:async()=>null});await assert.rejects(runAdjustments({...req,signal:controller.signal}));});
test('verified mobility upgrades suggestions even when composition fails and never receives health data', async () => {
  const fail = async () => { throw new Error('offline'); };
  let mapInput;
  const req = request({ healthInsight: fail, reliefInventory: fail, localResearch: fail, composeAdjustments: fail,
    async mobility(ctx) { mapInput = ctx.input; return { requestedLegs: 1, routes: [{ toActivityId: 'activity-meal', fromActivityId: 'activity-walk', walkMinutes: 28, taxiMinutes: 9, taxiCostCny: 18, km: 2.1 }] }; },
  });
  const result = await runAdjustments(req);
  assert.deepEqual(Object.keys(mapInput).sort(), ['itinerary', 'trip']);
  const mapped = result.proposals.find(proposal => proposal.effect.basis === 'amap');
  assert.equal(mapped.templates[0].minutes, 9); assert.deepEqual(mapped.effect.costCny, [18,18]);
  assert.equal(mapped.templates[0].fromActivityId, 'activity-walk');
  assert.equal(result.stages.find(stage => stage.stage === 'mobility').status, 'ok');
});
test('map and composer proposals have separate identities and accepting the map resolves its verified route', async () => {
  const req = request({
    async mobility() { return { requestedLegs: 1, routes: [{ toActivityId: 'activity-meal', fromActivityId: 'activity-walk', walkMinutes: 69, taxiMinutes: 29, km: 5.5 }] }; },
    async composeAdjustments() { return { proposals: [{ angle: 'mobility', title: '另一项交通建议', reason: '选择较轻松的交通方式', template: 'swap_move', activity_id: 'activity-walk', mode: 'taxi', source_index: -1 }] }; },
  });
  const result = await runAdjustments(req);
  assert.equal(new Set(result.proposals.map(proposal => proposal.id)).size, result.proposals.length);
  const mapped = result.proposals.find(proposal => proposal.effect.basis === 'amap');
  const chosen = resolveAccepted(result.proposals, [mapped.id], itinerary, req.input.trip, req.adjustment.scope);
  assert.equal(chosen.proposals[0].templates[0].activityId, 'activity-meal');
  assert.equal(chosen.proposals[0].templates[0].minutes, 29);
});
test('single-purpose needs only invoke the relevant retrieval and never pay to compose empty evidence',async()=>{
  const calls=[];let intents;
  const provider={healthInsight:async()=>{calls.push('health');return null;},reliefInventory:async ctx=>{calls.push('inventory');intents=ctx.searchIntents;return {sources:[]};},localResearch:async()=>{calls.push('local');return {services:[]};},mobility:async()=>{calls.push('mobility');return {routes:[]};},composeAdjustments:async()=>{calls.push('compose');return null;}};
  let req=request(provider);req.adjustment.checkIn={fatigue:null,stress:null,tags:['hungry']};
  await runAdjustments(req);assert.deepEqual(calls,['inventory']);assert.equal(intents.length,1);assert.match(intents[0].query,/餐食/);assert.doesNotMatch(intents[0].query,/疲劳|压力|fatigue|stress/);
  calls.length=0;req=request(provider);req.adjustment.checkIn={fatigue:4,stress:null,tags:['legs_tired']};
  await runAdjustments(req);assert.deepEqual(calls,['mobility']);
});
