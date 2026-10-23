import type { AdjustmentRecord } from "../journey-types";
import type { Proposal } from "./types";
/** A recent outcome changes suggestions within this journey, never infers a lasting trait. */
export function rankProposalsByOutcomes(proposals:Proposal[],records:AdjustmentRecord[],localDate:string):Proposal[] {
  const recent=records.filter(record=>record.outcome?.localDate===localDate).slice(0,5);
  const score=(proposal:Proposal)=>recent.reduce((total,record)=>{
    const same=record.changes.some(change=>change.angle===proposal.angle && change.templates.some(old=>proposal.templates.some(next=>old.type===next.type)));
    return total+(same?(record.outcome?.feeling==="lighter"?2:record.outcome?.feeling==="still_tired"?-3:-1):record.outcome?.feeling==="still_tired"&&proposal.angle==="pace"?1:0);
  },0);
  return proposals.map((proposal,index)=>({proposal,index,score:score(proposal)})).sort((a,b)=>b.score-a.score||a.index-b.index).map(({proposal,score})=>score<0?{...proposal,reason:`刚才类似调整后，你仍觉得不够轻松，可以优先看看其他方式。${proposal.reason}`}:proposal);
}
