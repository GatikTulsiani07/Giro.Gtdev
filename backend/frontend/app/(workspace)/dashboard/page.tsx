import type { Metadata } from "next";
import { RepositoryDashboard } from "@/features/repositories/repository-dashboard";

export const metadata: Metadata = { title: "Dashboard" };
export default function DashboardPage() { return <RepositoryDashboard />; }
