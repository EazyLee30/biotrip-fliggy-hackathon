import { getDatabase } from "@/lib/database";
import { JourneyError } from "@/lib/journeys";
import type { MemoryItem } from "./agent/memory-types";
import { HABITS, PACES, onboardingNotes, type OnboardingAnswers } from "./onboarding-options";
export function parseOnboarding(raw:unknown): {skip:boolean;answers:OnboardingAnswers} {
 const fail=():never=>{throw new JourneyError(400,"INVALID_ONBOARDING","请检查选项后再保存。");};
 if(!raw || typeof raw!=="object" || Array.isArray(raw))return fail();
 const v=raw as Record<string,unknown>;
 if(v.skip===true)return {skip:true,answers:{pace:"",habits:[],homeCity:"",food:""}};
 if(v.confirm!==true || typeof v.pace!=="string" || (v.pace!==""&&!PACES.some(p=>p.value===v.pace)) || !Array.isArray(v.habits) || v.habits.length>4 || v.habits.some(h=>!HABITS.some(p=>p.value===h)) || typeof v.homeCity!=="string" || v.homeCity.length>100 || typeof v.food!=="string" || v.food.length>500)return fail();
 return {skip:false,answers:{pace:v.pace,habits:[...new Set(v.habits as string[])],homeCity:v.homeCity.trim(),food:v.food.trim()}};
}
export async function onboardingStatus(accountId:string) {
 const db=getDatabase();
 const row=await db.prepare("SELECT state FROM traveler_onboarding WHERE account_id=?").bind(accountId).first<{state:string}>();
 const trips=await db.prepare("SELECT COUNT(*) AS total FROM journeys WHERE account_id=?").bind(accountId).first<{total:number}>();
 return {state:row?.state??null,needed:!row && !trips?.total};
}
export async function saveOnboarding(accountId:string,raw:unknown) {
 const {skip,answers}=parseOnboarding(raw),db=getDatabase();
 const current=await db.prepare("SELECT state FROM traveler_onboarding WHERE account_id=?").bind(accountId).first<{state:string}>();
 if(current?.state==="completed")return {saved:true};
 const statements=skip?[]:onboardingNotes(answers).map(item=>db.prepare(`INSERT OR IGNORE INTO memory_items(id,account_id,note,category,scope,enabled,source,source_id,dedupe_key)
 VALUES(?,?,?,?,'global',1,'onboarding',?,?)`).bind(crypto.randomUUID(),accountId,item.note,item.category,`${item.category}:${item.value}`,`onboarding:${item.category}:${item.value}`));
 statements.push(db.prepare("INSERT INTO traveler_onboarding(account_id,state) VALUES(?,?) ON CONFLICT(account_id) DO UPDATE SET state=CASE WHEN traveler_onboarding.state='completed' THEN 'completed' ELSE excluded.state END,updated_at=unixepoch()").bind(accountId,skip?"skipped":"completed"));
 await db.batch(statements);
 return {saved:true};
}
/** Only untouched, enabled onboarding choices may fill structured controls; edited notes remain model context. */
export function onboardingDefaults(memories:MemoryItem[]) {
 const items=memories.filter(m=>m.source==="onboarding"&&m.enabled&&m.version===1&&m.scope==="global"&&!m.expiresOn);
 const source=(category:string)=>items.find(m=>m.category===category)?.sourceId?.slice(category.length+1);
 const pace=source("pace");
 return { ...(PACES.some(p=>p.value===pace)?{paceLevel:pace as "gentle"|"balanced"|"active"}:{}),...(source("home")?{homeCities:[source("home")!]}:{}),...(source("food")?{foodPreferences:source("food")}:{}),established:items.length>0 };
}
