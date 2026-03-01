import { readDashboardData } from "@/lib/blob/store";
import Dashboard from "@/components/Dashboard";

export const dynamic = "force-dynamic";

export default async function Home() {
  const data = await readDashboardData();
  return <Dashboard initialData={data} />;
}
