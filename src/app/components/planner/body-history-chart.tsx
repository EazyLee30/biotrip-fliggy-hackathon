"use client";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
export type FeelingPoint = { label: string; fatigue: number };
export default function BodyHistoryChart({ points }: { points: FeelingPoint[] }) {
  return <ResponsiveContainer width="100%" height={150}><LineChart data={points} margin={{ left:-25,right:14,top:8,bottom:0 }} accessibilityLayer>
    <XAxis dataKey="label" tick={{ fontSize:11,fill:"#64776b" }} axisLine={false} tickLine={false} minTickGap={28}/>
    <YAxis domain={[1,5]} ticks={[1,3,5]} tick={{ fontSize:11,fill:"#64776b" }} axisLine={false} tickLine={false}/>
    <Tooltip formatter={value=>[`${value} / 5`,"主观疲劳"]} contentStyle={{borderRadius:12,border:"1px solid #dce2d5",fontSize:13}}/>
    <Line type="linear" dataKey="fatigue" stroke="#6b815f" strokeWidth={2.5} dot={{r:4,strokeWidth:2,fill:"#f8f7f2"}} activeDot={{r:6}} isAnimationActive={false}/>
  </LineChart></ResponsiveContainer>;
}
