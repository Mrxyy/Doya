import type { ControlSessionRecord } from "@/control/control-api";
import { translateNow } from "@/i18n/i18n";

export function getControlSessionDisplayTitle(input: {
  session: Pick<ControlSessionRecord, "id" | "title">;
  agentTitle?: string | null;
}): string {
  const agentTitle = input.agentTitle?.trim() ?? "";
  if (agentTitle && !isGeneratedControlSessionTitle(agentTitle, input.session.id)) {
    return agentTitle;
  }

  const sessionTitle = input.session.title.trim();
  if (sessionTitle && !isGeneratedControlSessionTitle(sessionTitle, input.session.id)) {
    return sessionTitle;
  }

  return translateNow("account.project.defaultName");
}

export function isGeneratedControlSessionTitle(title: string, sessionId: string): boolean {
  return title === sessionId || /^ses_[0-9a-f-]{12,}$/i.test(title);
}
