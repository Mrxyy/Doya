import { agentPanelRegistration } from "@/panels/agent-panel";
import { browserPanelRegistration } from "@/panels/browser-panel";
import { draftPanelRegistration } from "@/panels/draft-panel";
import { filePanelRegistration } from "@/panels/file-panel";
import { homePresetConversationPanelRegistration } from "@/panels/home-preset-conversation-panel";
import { registerPanel } from "@/panels/panel-registry";
import { pptPreviewPanelRegistration } from "@/panels/ppt-preview-panel";
import { setupPanelRegistration } from "@/panels/setup-panel";
import { terminalPanelRegistration } from "@/panels/terminal-panel";

let panelsRegistered = false;

export function ensurePanelsRegistered(): void {
  if (panelsRegistered) {
    return;
  }
  registerPanel(draftPanelRegistration);
  registerPanel(homePresetConversationPanelRegistration);
  registerPanel(agentPanelRegistration);
  registerPanel(setupPanelRegistration);
  registerPanel(terminalPanelRegistration);
  registerPanel(browserPanelRegistration);
  registerPanel(pptPreviewPanelRegistration);
  registerPanel(filePanelRegistration);
  panelsRegistered = true;
}
