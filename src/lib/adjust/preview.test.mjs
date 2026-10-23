import test from "node:test";
import assert from "node:assert/strict";
import { adjustmentDifferences } from "./preview.ts";
const stop={id:"walk",date:"2026-10-19",time:"15:00",name:"湖边散步",detail:"慢慢走",fixed:false,durationMin:60};
test("preview separates additions, removals and transport changes without inventing benefits",()=>{
 const reservation={...stop,id:"booking",time:"17:00",name:"茶馆预约",fixed:true};
 const removed={...stop,id:"extra",time:"19:00"};
 const before=[stop,reservation,removed];
 const after=[{...stop,move:{mode:"taxi",minutes:12,basis:"amap"}},reservation,{...stop,id:"rest",name:"坐下休息",durationMin:20}];
 const diff=adjustmentDifferences(before,after);
 assert.deepEqual(diff.map(d=>[d.id,d.kind]),[["walk","changed"],["extra","removed"],["rest","added"]]);
 assert.match(diff[0].after,/打车 12 分钟/);
 assert.equal(diff[1].after,null);
 assert.equal(diff[2].before,null);
 assert.equal(before[0].move,undefined);
 assert.deepEqual(adjustmentDifferences(before,before),[]);
});
