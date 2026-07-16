import type { Metadata } from "next";
import { DashboardScreen } from "@/features/repositories/dashboard-screen";

export const metadata: Metadata = { title: "Dashboard" };
export default function DashboardPage() { return <DashboardScreen />; }
