import type { Metadata } from "next";
import { PlannerDashboard } from "../components/planner-dashboard";

export const metadata: Metadata = { title: "我的旅程 · BioTrip", robots: { index: false, follow: false } };

export default function AppPage() {
  return <PlannerDashboard />;
}
