import app from "vinext/server/fetch-handler";
import jobs from "./planning";
export { PlanningWorkflow } from "./planning";
// The workflow has its own durable execution; sharing this deployment reuses existing secrets.
const worker = { ...app, scheduled: jobs.scheduled };
export default worker;
