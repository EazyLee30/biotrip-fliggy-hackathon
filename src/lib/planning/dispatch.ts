import { env } from "cloudflare:workers";
/** Dispatch reconciliation is safe because every attempt uses the same Workflow instance id. */
export async function dispatchPlanningJob(id:string) {
 try {const instance=await env.BIOTRIP_PLANNING.get(id);await instance.status();return;}catch { /* Reconcile a dispatch that was never accepted. */ }
 try {await env.BIOTRIP_PLANNING.create({id,params:{jobId:id}});}catch {
  // Another request may have won the create race. Verify, rather than create a new id.
  const instance=await env.BIOTRIP_PLANNING.get(id);await instance.status();
 }
}
