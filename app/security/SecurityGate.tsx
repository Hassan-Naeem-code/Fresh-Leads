"use client";

import { MfaSetup } from "../MfaSetup";

// Enrolment, then straight on to wherever they were going. A full navigation rather
// than a router push, because the two factor cookie was set on the last response.
export function SecurityGate({ next }: { next: string }) {
  return <MfaSetup mandatory onDone={() => { window.location.href = next; }} />;
}
