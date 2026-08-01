"use client";

import { MfaSetup } from "../../MfaSetup";

export function AdminMfaSetup() {
  return <MfaSetup mandatory onDone={() => { window.location.href = "/admin"; }} />;
}
