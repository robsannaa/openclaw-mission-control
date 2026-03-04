import { redirect } from "next/navigation";
import { RouteSectionView } from "@/components/route-section-view";

export default function Page() {
  const isAgentbayHosted =
    process.env.AGENTBAY_HOSTED === "true" ||
    process.env.NEXT_PUBLIC_AGENTBAY_HOSTED === "true";

  if (isAgentbayHosted) {
    redirect("/dashboard");
  }

  return <RouteSectionView section="tailscale" />;
}
