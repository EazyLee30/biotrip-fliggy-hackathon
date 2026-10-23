import { createHash, randomUUID } from "node:crypto";
import { getDatabase } from "@/lib/database";
import { getJourney, isRecord, JourneyError, onlyKeys, requireVersion } from "@/lib/journeys";
import { destinationClock } from "./adjust/request";
import { CHECK_IN_TAGS, type CheckIn } from "./adjust/types";
import type { AdjustmentOutcome, AdjustmentRecord, BodyCheckIn, Journey } from "./journey-types";
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function key(value: unknown) { if (typeof value !== "string" || !/^[\w-]{8,100}$/.test(value)) throw new JourneyError(400,"INVALID_IDEMPOTENCY_KEY","请重新提交这次记录。"); return value; }
function invalid(message = "请检查这次自评后重试。"): never { throw new JourneyError(400,"INVALID_CHECK_IN",message); }
function score(value: unknown) { if(value === null) return null; if(typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 5) return invalid(); return value; }
export function parseBodyCheckIn(raw:unknown):CheckIn {
  if(!isRecord(raw))return invalid();
  onlyKeys(raw,["fatigue","stress","tags","consent"]);
  if(raw.consent!==true || !Array.isArray(raw.tags) || raw.tags.length > CHECK_IN_TAGS.length || raw.tags.some(tag=>!CHECK_IN_TAGS.includes(tag)))return invalid();
  const check={fatigue:score(raw.fatigue),stress:score(raw.stress ?? null),tags:[...new Set(raw.tags)] as CheckIn["tags"]};
  if(check.fatigue===null && check.stress===null && !check.tags.length)return invalid("请至少选择一项此刻的感受。");
  return check;
}
function location(journey:Journey,now:Date) { const timezone=journey.draft.trip?.destinationTimezone || "Asia/Shanghai";return {timezone,localDate:destinationClock(timezone,now).date,asOf:now.toISOString()}; }
type CheckRow={id:string;journey_id:string;local_date:string;timezone:string;payload_json:string;recorded_at:number;request_hash:string};
function checkItem(row:CheckRow):BodyCheckIn { return {...JSON.parse(row.payload_json),id:row.id,journeyId:row.journey_id,localDate:row.local_date,timezone:row.timezone,recordedAt:new Date(row.recorded_at*1000).toISOString()}; }
export async function listBodyCheckIns(accountId:string,journeyId:string,now=new Date()) {
  const journey=await getJourney(accountId,journeyId),place=location(journey,now);
  const rows=await getDatabase().prepare("SELECT * FROM body_check_ins WHERE account_id=? AND journey_id=? ORDER BY recorded_at DESC,rowid DESC LIMIT 60").bind(accountId,journeyId).all<CheckRow>();
  const checkIns=rows.results.map(checkItem);
  const current=checkIns.find(item=>item.localDate===place.localDate && item.timezone===place.timezone && Date.parse(item.recordedAt)<=now.getTime()) ?? null;
  return {checkIns,current,...place};
}
export async function recordBodyCheckIn(accountId:string,journeyId:string,raw:unknown,idempotencyKey:unknown,now=new Date(),expectedVersion?:number) {
  if(expectedVersion!==undefined)requireVersion(expectedVersion);
  const value=parseBodyCheckIn(raw),requestKey=key(idempotencyKey),requestHash=digest(value);
  const journey=await getJourney(accountId,journeyId),place=location(journey,now),db=getDatabase();
  const previous=await db.prepare("SELECT * FROM body_check_ins WHERE account_id=? AND journey_id=? AND request_key=?").bind(accountId,journeyId,requestKey).first<CheckRow>();
  if(previous) { if(previous.request_hash!==requestHash)throw new JourneyError(409,"IDEMPOTENCY_CONFLICT","这次记录内容已变化，请重新提交。");return listBodyCheckIns(accountId,journeyId,now); }
  if(journey.status==="completed")throw new JourneyError(409,"JOURNEY_COMPLETED","旅程已经完成，请在新的旅程里记录此刻状态。");
  await db.prepare(`INSERT OR IGNORE INTO body_check_ins(id,account_id,journey_id,local_date,timezone,payload_json,request_key,request_hash,recorded_at)
    SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM journeys WHERE id=? AND account_id=? AND status<>'completed' AND (? IS NULL OR version=?))`).bind(randomUUID(),accountId,journeyId,place.localDate,place.timezone,JSON.stringify({...value,source:"self_report"}),requestKey,requestHash,Math.floor(now.getTime()/1000),journeyId,accountId,expectedVersion ?? null,expectedVersion ?? null).run();
  const saved=await db.prepare("SELECT request_hash FROM body_check_ins WHERE account_id=? AND journey_id=? AND request_key=?").bind(accountId,journeyId,requestKey).first<{request_hash:string}>();
  if(!saved || saved.request_hash!==requestHash)throw new JourneyError(409,"CHECK_IN_CHANGED","这次记录已变化，请刷新后重试。");
  return listBodyCheckIns(accountId,journeyId,now);
}
type AdjustmentRow={id:string;journey_id:string;payload_json:string;outcome_json:string|null;outcome_key:string|null;outcome_hash:string|null};
function adjustmentItem(row:AdjustmentRow):AdjustmentRecord { return {...JSON.parse(row.payload_json),id:row.id,journeyId:row.journey_id,outcome:row.outcome_json?JSON.parse(row.outcome_json):null}; }
export async function listAdjustmentRecords(accountId:string,journeyId:string) {
  await getJourney(accountId,journeyId);
  const rows=await getDatabase().prepare("SELECT * FROM journey_adjustments WHERE account_id=? AND journey_id=? ORDER BY applied_at DESC,rowid DESC LIMIT 60").bind(accountId,journeyId).all<AdjustmentRow>();
  return rows.results.map(adjustmentItem);
}
export async function journeyBodyContext(accountId:string,journeyId:string,now=new Date()) {
  const [body,adjustments]=await Promise.all([listBodyCheckIns(accountId,journeyId,now),listAdjustmentRecords(accountId,journeyId)]);
  const recentOutcomes=adjustments.flatMap(record=>record.outcome && record.outcome.localDate===body.localDate?[record.outcome]:[]).slice(0,5);
  return {current:body.current,recentOutcomes,pendingAdjustments:adjustments.filter(record=>!record.outcome).slice(0,3),asOf:body.asOf,localDate:body.localDate,timezone:body.timezone};
}
/** Outcomes are tied to their own adjustment, even after another adjustment has been applied. */
export async function recordAdjustmentOutcome(accountId:string,journeyId:string,adjustmentId:string,raw:unknown,idempotencyKey:unknown,now=new Date()) {
  if(!isRecord(raw))return invalid();
  onlyKeys(raw,["version","feeling","fatigue","stress","note"]);
  const version=requireVersion(raw.version),requestKey=key(idempotencyKey);
  if(!["lighter","same","still_tired"].includes(String(raw.feeling)) || raw.note!==undefined && (typeof raw.note!=="string" || raw.note.length>500))return invalid("请选择调整后的感受。");
  const value={feeling:raw.feeling as AdjustmentOutcome["feeling"],fatigue:score(raw.fatigue ?? null),stress:score(raw.stress ?? null),note:typeof raw.note==="string"?raw.note.trim():""};
  const requestHash=digest(value),journey=await getJourney(accountId,journeyId),db=getDatabase();
  const row=await db.prepare("SELECT * FROM journey_adjustments WHERE id=? AND account_id=? AND journey_id=?").bind(adjustmentId,accountId,journeyId).first<AdjustmentRow>();
  if(!row)throw new JourneyError(404,"ADJUSTMENT_NOT_FOUND","这次调整记录不存在。");
  if(row.outcome_json) { if(row.outcome_key!==requestKey || row.outcome_hash!==requestHash)throw new JourneyError(409,"OUTCOME_RECORDED","这次调整已经记录感受。"); return {journey,adjustment:adjustmentItem(row),checkIn:(await listBodyCheckIns(accountId,journeyId,now)).current}; }
  if(journey.version!==version)throw new JourneyError(409,"JOURNEY_CHANGED","行程已变化，请刷新后再记录。");
  if(!["active","completed"].includes(journey.status))throw new JourneyError(409,"JOURNEY_NOT_STARTED","开始旅行并体验调整后，再记录感受。");
  const place=location(journey,now),id=randomUUID(),outcome:AdjustmentOutcome={id,adjustmentId,journeyId,recordedAt:now.toISOString(),localDate:place.localDate,...value};
  const encoded=JSON.stringify(outcome),checkId=randomUUID();
  const statements=[
    db.prepare("UPDATE journeys SET version=version+1,updated_at=unixepoch() WHERE id=? AND account_id=? AND version=? AND EXISTS(SELECT 1 FROM journey_adjustments WHERE id=? AND account_id=? AND outcome_json IS NULL)").bind(journeyId,accountId,version,adjustmentId,accountId),
    db.prepare("UPDATE journey_adjustments SET outcome_json=?,outcome_key=?,outcome_hash=? WHERE id=? AND account_id=? AND journey_id=? AND outcome_json IS NULL AND changes()=1").bind(encoded,requestKey,requestHash,adjustmentId,accountId,journeyId),
    db.prepare(`INSERT INTO journey_feedback(id,journey_id,account_id,payload_json) SELECT ?,?,?,? WHERE changes()=1 AND EXISTS(SELECT 1 FROM journey_adjustments WHERE id=? AND account_id=? AND outcome_key=? AND outcome_hash=?)`).bind(id,journeyId,accountId,JSON.stringify({fatigue:value.fatigue,subjectiveStress:value.stress,note:`调整后的感受：${({lighter:"轻松了一些",same:"差不多",still_tired:"还是很累"})[value.feeling]}。${value.note}`,adjustmentAt:adjustmentItem(row).appliedAt}),adjustmentId,accountId,requestKey,requestHash),
  ];
  if(value.fatigue!==null || value.stress!==null)statements.push(db.prepare(`INSERT OR IGNORE INTO body_check_ins(id,account_id,journey_id,local_date,timezone,payload_json,request_key,request_hash,recorded_at)
    SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM journey_adjustments WHERE id=? AND account_id=? AND outcome_key=? AND outcome_hash=?)`).bind(checkId,accountId,journeyId,place.localDate,place.timezone,JSON.stringify({fatigue:value.fatigue,stress:value.stress,tags:[],source:"adjustment_outcome"}),`outcome:${adjustmentId}`,requestHash,Math.floor(now.getTime()/1000),adjustmentId,accountId,requestKey,requestHash));
  const results=await db.batch(statements);
  if(results[0].meta.changes!==1){
    const latest=await db.prepare("SELECT * FROM journey_adjustments WHERE id=? AND account_id=? AND journey_id=?").bind(adjustmentId,accountId,journeyId).first<AdjustmentRow>();
    if(latest?.outcome_key===requestKey && latest.outcome_hash===requestHash)return {journey:await getJourney(accountId,journeyId),adjustment:adjustmentItem(latest),checkIn:(await listBodyCheckIns(accountId,journeyId,now)).current};
    throw new JourneyError(409,"OUTCOME_CHANGED","行程或感受记录已变化，请刷新后重试。");
  }
  return {journey:await getJourney(accountId,journeyId),adjustment:{...adjustmentItem(row),outcome},checkIn:(await listBodyCheckIns(accountId,journeyId,now)).current};
}
