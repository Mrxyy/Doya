import type { DocumentViewerKind } from "@/components/document-viewer";
import {
  buildApplyDocumentAnnotationsPrompt,
  type DocumentAnnotationPromptAnnotation,
} from "@/utils/document-annotation-prompt";
import type { DocumentAnnotationApplyPhase } from "@/utils/document-annotation-apply-phase";

interface OptimisticDocumentAnnotationUserMessage {
  kind: "user_message";
  id: string;
  text: string;
  timestamp: Date;
  optimistic: true;
}

type AppendOptimisticUserMessageToAgentStream = (
  serverId: string,
  agentId: string,
  message: OptimisticDocumentAnnotationUserMessage,
  options: {
    placement: "active-head";
    skipIfUserMessageExists: true;
  },
) => boolean;

interface DocumentAnnotationAgentSender {
  sendAgentMessage: (
    agentId: string,
    message: string,
    options: { messageId: string },
  ) => Promise<unknown>;
}

export interface BeginDocumentAnnotationApplyRequestInput {
  appendOptimisticUserMessageToAgentStream: AppendOptimisticUserMessageToAgentStream;
  client: DocumentAnnotationAgentSender;
  documentKind: DocumentViewerKind;
  filePath: string;
  annotations: DocumentAnnotationPromptAnnotation[];
  serverId: string;
  sourceAgentId: string;
  sourceAgentStatus: string | null;
  messageId?: string;
  timestamp?: Date;
}

export interface BeginDocumentAnnotationApplyRequestResult {
  messageId: string;
  prompt: string;
  phase: DocumentAnnotationApplyPhase;
  sendPromise: Promise<unknown>;
}

export function beginDocumentAnnotationApplyRequest(
  input: BeginDocumentAnnotationApplyRequestInput,
): BeginDocumentAnnotationApplyRequestResult {
  const messageId = input.messageId ?? generateDocumentAnnotationMessageId();
  const prompt = buildApplyDocumentAnnotationsPrompt({
    messageId,
    filePath: input.filePath,
    kind: input.documentKind,
    annotations: input.annotations,
  });
  input.appendOptimisticUserMessageToAgentStream(
    input.serverId,
    input.sourceAgentId,
    {
      kind: "user_message",
      id: messageId,
      text: prompt,
      timestamp: input.timestamp ?? new Date(),
      optimistic: true,
    },
    { placement: "active-head", skipIfUserMessageExists: true },
  );

  return {
    messageId,
    prompt,
    phase: input.sourceAgentStatus === "running" ? "running" : "waiting",
    sendPromise: input.client.sendAgentMessage(input.sourceAgentId, prompt, { messageId }),
  };
}

function generateDocumentAnnotationMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}
