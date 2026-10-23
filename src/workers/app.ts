import app from "vinext/server/fetch-handler";
import jobs from "./planning";
import { drainSessionCleanups } from "../lib/bailian-session-cleanup";
export { PlanningWorkflow } from "./planning";
// The workflow has its own durable execution; sharing this deployment reuses existing secrets.
const worker = { ...app, async scheduled() { await Promise.all([jobs.scheduled(), drainSessionCleanups()]); } };
export default worker;
