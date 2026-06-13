import { describe, expect, it } from "vitest";

import {
  CreateAgentRequestMessageSchema,
  CreateDoyaWorktreeRequestSchema,
  SendAgentMessageRequestSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "./messages.js";

describe("shared messages attachments", () => {
  it("keeps valid file attachments for workspace-materialized workflows", () => {
    const parsed = CreateAgentRequestMessageSchema.parse({
      type: "create_agent_request",
      requestId: "req-file",
      config: { provider: "codex", cwd: "/tmp/repo" },
      attachments: [
        {
          type: "file",
          mimeType: "application/pdf",
          title: "report.pdf",
          data: "SGVsbG8=",
        },
      ],
    });

    expect(parsed.attachments).toEqual([
      {
        type: "file",
        mimeType: "application/pdf",
        title: "report.pdf",
        data: "SGVsbG8=",
      },
    ]);
  });

  it("keeps valid source-path file attachments for daemon-materialized workflows", () => {
    const parsed = CreateAgentRequestMessageSchema.parse({
      type: "create_agent_request",
      requestId: "req-file-path",
      config: { provider: "codex", cwd: "/tmp/repo" },
      attachments: [
        {
          type: "file",
          mimeType: "application/pdf",
          title: "report.pdf",
          sourcePath: "/tmp/doya-attachments/report.pdf",
        },
      ],
    });

    expect(parsed.attachments).toEqual([
      {
        type: "file",
        mimeType: "application/pdf",
        title: "report.pdf",
        sourcePath: "/tmp/doya-attachments/report.pdf",
      },
    ]);
  });

  it("parses workspace attachment materialization requests and responses", () => {
    const request = SessionInboundMessageSchema.parse({
      type: "workspace.attachments.materialize.request",
      requestId: "req-materialize",
      agentId: "agent-1",
      files: [
        {
          fileName: "report.docx",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          data: "SGVsbG8=",
        },
      ],
    });

    expect(request).toEqual({
      type: "workspace.attachments.materialize.request",
      requestId: "req-materialize",
      agentId: "agent-1",
      files: [
        {
          fileName: "report.docx",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          data: "SGVsbG8=",
        },
      ],
    });

    const response = SessionOutboundMessageSchema.parse({
      type: "workspace.attachments.materialize.response",
      payload: {
        requestId: "req-materialize",
        cwd: "/tmp/repo",
        files: [
          {
            title: "report.docx",
            mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            path: "attachments/123-report.docx",
          },
        ],
        error: null,
      },
    });

    expect(response.payload.files[0]?.path).toBe("attachments/123-report.docx");
  });

  it("keeps valid review attachments", () => {
    const parsed = SendAgentMessageRequestSchema.parse({
      type: "send_agent_message_request",
      requestId: "req-review",
      agentId: "agent-1",
      text: "Please address these comments",
      attachments: [
        {
          type: "review",
          mimeType: "application/doya-review",
          cwd: "/tmp/repo",
          mode: "base",
          baseRef: "main",
          comments: [
            {
              filePath: "src/index.ts",
              side: "new",
              lineNumber: 42,
              body: "Please guard this nullable value.",
              context: {
                hunkHeader: "@@ -40,3 +40,4 @@",
                targetLine: {
                  oldLineNumber: null,
                  newLineNumber: 42,
                  type: "add",
                  content: "const value = maybeNull.name;",
                },
                lines: [
                  {
                    oldLineNumber: 41,
                    newLineNumber: 41,
                    type: "context",
                    content: "const before = true;",
                  },
                  {
                    oldLineNumber: null,
                    newLineNumber: 42,
                    type: "add",
                    content: "const value = maybeNull.name;",
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(parsed.attachments).toEqual([
      {
        type: "review",
        mimeType: "application/doya-review",
        cwd: "/tmp/repo",
        mode: "base",
        baseRef: "main",
        comments: [
          {
            filePath: "src/index.ts",
            side: "new",
            lineNumber: 42,
            body: "Please guard this nullable value.",
            context: {
              hunkHeader: "@@ -40,3 +40,4 @@",
              targetLine: {
                oldLineNumber: null,
                newLineNumber: 42,
                type: "add",
                content: "const value = maybeNull.name;",
              },
              lines: [
                {
                  oldLineNumber: 41,
                  newLineNumber: 41,
                  type: "context",
                  content: "const before = true;",
                },
                {
                  oldLineNumber: null,
                  newLineNumber: 42,
                  type: "add",
                  content: "const value = maybeNull.name;",
                },
              ],
            },
          },
        ],
      },
    ]);
  });

  it("normalizes legacy review attachment MIME types", () => {
    const parsed = SendAgentMessageRequestSchema.parse({
      type: "send_agent_message_request",
      requestId: "req-review-legacy",
      agentId: "agent-1",
      text: "Please address this comment",
      attachments: [
        {
          type: "review",
          mimeType: "application/doya-review",
          cwd: "/tmp/repo",
          mode: "uncommitted",
          comments: [],
        },
      ],
    });

    expect(parsed.attachments?.[0]?.mimeType).toBe("application/doya-review");
  });

  it("drops malformed review attachments while keeping valid attachments", () => {
    const parsed = SendAgentMessageRequestSchema.parse({
      type: "send_agent_message_request",
      requestId: "req-bad-review",
      agentId: "agent-1",
      text: "Review",
      attachments: [
        {
          type: "review",
          mimeType: "application/doya-review",
          cwd: "/tmp/repo",
          mode: "uncommitted",
          comments: [
            {
              filePath: "src/index.ts",
              side: "new",
              lineNumber: "42",
              body: "This line number is malformed.",
              context: {
                hunkHeader: "@@ -40,3 +40,4 @@",
                targetLine: {
                  oldLineNumber: null,
                  newLineNumber: 42,
                  type: "add",
                  content: "const value = maybeNull.name;",
                },
                lines: [],
              },
            },
          ],
        },
        {
          type: "github_issue",
          mimeType: "application/github-issue",
          number: 55,
          title: "Improve startup error details",
          url: "https://github.com/getdoya/doya/issues/55",
        },
      ],
    });

    expect(parsed.attachments).toEqual([
      {
        type: "github_issue",
        mimeType: "application/github-issue",
        number: 55,
        title: "Improve startup error details",
        url: "https://github.com/getdoya/doya/issues/55",
      },
    ]);
  });

  it("keeps known attachments and drops unknown create-agent attachments", () => {
    const parsed = CreateAgentRequestMessageSchema.parse({
      type: "create_agent_request",
      requestId: "req-1",
      config: {
        provider: "codex",
        cwd: "/tmp/repo",
      },
      initialPrompt: "Review this PR",
      attachments: [
        {
          type: "github_pr",
          mimeType: "application/github-pr",
          number: 123,
          title: "Fix race in worktree setup",
          url: "https://github.com/getdoya/doya/pull/123",
          body: "Body",
          baseRefName: "main",
          headRefName: "fix/worktree-race",
        },
        {
          type: "future_attachment",
          mimeType: "application/future",
          foo: "bar",
        },
      ],
    });

    expect(parsed.attachments).toEqual([
      {
        type: "github_pr",
        mimeType: "application/github-pr",
        number: 123,
        title: "Fix race in worktree setup",
        url: "https://github.com/getdoya/doya/pull/123",
        body: "Body",
        baseRefName: "main",
        headRefName: "fix/worktree-race",
      },
    ]);
  });

  it("keeps known attachments and drops unknown send-message attachments", () => {
    const parsed = SendAgentMessageRequestSchema.parse({
      type: "send_agent_message_request",
      requestId: "req-2",
      agentId: "agent-1",
      text: "Review",
      attachments: [
        {
          type: "github_issue",
          mimeType: "application/github-issue",
          number: 55,
          title: "Improve startup error details",
          url: "https://github.com/getdoya/doya/issues/55",
          body: "Body",
        },
        {
          type: "future_attachment",
          mimeType: "application/future",
          foo: "bar",
        },
      ],
    });

    expect(parsed.attachments).toEqual([
      {
        type: "github_issue",
        mimeType: "application/github-issue",
        number: 55,
        title: "Improve startup error details",
        url: "https://github.com/getdoya/doya/issues/55",
        body: "Body",
      },
    ]);
  });

  it("keeps known firstAgentContext attachments and drops unknown ones", () => {
    const parsed = CreateDoyaWorktreeRequestSchema.parse({
      type: "create_doya_worktree_request",
      requestId: "req-3",
      cwd: "/tmp/repo",
      firstAgentContext: {
        prompt: "Investigate flaky test",
        attachments: [
          {
            type: "github_pr",
            mimeType: "application/github-pr",
            number: 99,
            title: "Fork-safe PR checkout",
            url: "https://github.com/getdoya/doya/pull/99",
          },
          {
            type: "future_attachment",
            mimeType: "application/future",
            foo: "bar",
          },
        ],
      },
    });

    expect(parsed.firstAgentContext?.attachments).toEqual([
      {
        type: "github_pr",
        mimeType: "application/github-pr",
        number: 99,
        title: "Fork-safe PR checkout",
        url: "https://github.com/getdoya/doya/pull/99",
      },
    ]);
    expect(parsed.firstAgentContext?.prompt).toBe("Investigate flaky test");
  });

  it("parses worktree-create payloads without a firstAgentContext", () => {
    const parsed = CreateDoyaWorktreeRequestSchema.parse({
      type: "create_doya_worktree_request",
      requestId: "req-4",
      cwd: "/tmp/repo",
    });

    expect(parsed).toEqual({
      type: "create_doya_worktree_request",
      requestId: "req-4",
      cwd: "/tmp/repo",
    });
  });

  it("accepts and strips create-worktree intent fields compatibly", () => {
    const parsed = CreateDoyaWorktreeRequestSchema.parse({
      type: "create_doya_worktree_request",
      requestId: "req-5",
      cwd: "/tmp/repo",
      action: "checkout",
      refName: "feature/ref-picker",
      githubPrNumber: 42,
      futureField: "ignored",
    });

    expect(parsed).toEqual({
      type: "create_doya_worktree_request",
      requestId: "req-5",
      cwd: "/tmp/repo",
      action: "checkout",
      refName: "feature/ref-picker",
      githubPrNumber: 42,
    });
  });

  it("accepts optional create-agent git intent fields and strips unknown git fields", () => {
    const parsed = CreateAgentRequestMessageSchema.parse({
      type: "create_agent_request",
      requestId: "req-6",
      config: {
        provider: "codex",
        cwd: "/tmp/repo",
      },
      attachments: [],
      git: {
        createWorktree: true,
        worktreeSlug: "review-42",
        action: "checkout",
        refName: "head-ref",
        githubPrNumber: 42,
        futureGitField: "ignored",
      },
    });

    expect(parsed.git).toEqual({
      createWorktree: true,
      worktreeSlug: "review-42",
      action: "checkout",
      refName: "head-ref",
      githubPrNumber: 42,
    });
  });
});
