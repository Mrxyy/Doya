import { Redirect, useLocalSearchParams } from "expo-router";
import { useMemo } from "react";

export default function InviteCodeRedirect() {
  const params = useLocalSearchParams<{ code?: string | string[] }>();
  const inviteCode = useMemo(() => normalizeInviteCode(params.code), [params.code]);
  const encodedInviteCode = encodeURIComponent(inviteCode);
  return <Redirect href={encodedInviteCode ? `/?invite=${encodedInviteCode}` : "/"} />;
}

function normalizeInviteCode(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim().toUpperCase() ?? "";
}
