import { NextResponse } from "next/server";
import { getAccess } from "./access";

// The same rule as requireSubscription, for routes rather than pages.
//
// The pages redirect a browser; an API call gets a 402 and a reason. Both read the
// decision from getAccess, so there is one definition of what the yearly fee opens and
// no way for the screen and the endpoint to disagree.

export async function toolsGate(userId: string): Promise<NextResponse | null> {
  const access = await getAccess(userId);
  if (access.canUseTools) return null;
  return NextResponse.json(
    {
      error:
        "This is part of the yearly plan. Your free credits cover searching and opening leads.",
      code: "subscription_required",
    },
    { status: 402 }
  );
}
