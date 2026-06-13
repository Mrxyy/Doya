import { z } from "zod";

export function normalizeLifecycleCommands(commands: unknown): string[] {
  if (typeof commands === "string") {
    return commands.trim().length > 0 ? [commands] : [];
  }
  if (!Array.isArray(commands)) {
    return [];
  }
  return commands.filter((command): command is string => {
    return typeof command === "string" && command.trim().length > 0;
  });
}

export const DoyaLifecycleCommandRawSchema = z.union([z.string(), z.array(z.string())]);

export const DoyaScriptEntryRawSchema = z
  .object({
    type: z.unknown().optional(),
    command: z.unknown().optional(),
    port: z.unknown().optional(),
  })
  .passthrough();

export const DoyaWorktreeConfigRawSchema = z
  .object({
    setup: DoyaLifecycleCommandRawSchema.optional(),
    teardown: DoyaLifecycleCommandRawSchema.optional(),
    terminals: z.unknown().optional(),
  })
  .passthrough();

export const DoyaMetadataGenerationEntrySchema = z
  .object({
    instructions: z.string().optional(),
  })
  .passthrough()
  .catch({});

export const DoyaMetadataGenerationSchema = z
  .object({
    agentTitle: DoyaMetadataGenerationEntrySchema.optional(),
    branchName: DoyaMetadataGenerationEntrySchema.optional(),
    commitMessage: DoyaMetadataGenerationEntrySchema.optional(),
    pullRequest: DoyaMetadataGenerationEntrySchema.optional(),
  })
  .passthrough()
  .catch({});

export const DoyaConfigRawSchema = z
  .object({
    worktree: DoyaWorktreeConfigRawSchema.optional(),
    scripts: z.record(z.string(), DoyaScriptEntryRawSchema).optional(),
    metadataGeneration: DoyaMetadataGenerationSchema.optional(),
  })
  .passthrough();

export const WorktreeConfigSchema = DoyaWorktreeConfigRawSchema.extend({
  setup: z.unknown().transform(normalizeLifecycleCommands),
  teardown: z.unknown().transform(normalizeLifecycleCommands),
})
  .passthrough()
  .catch({ setup: [], teardown: [] });

export const ScriptEntrySchema = DoyaScriptEntryRawSchema.catch({});

export const DoyaConfigSchema = DoyaConfigRawSchema.extend({
  worktree: WorktreeConfigSchema.optional(),
  scripts: z.record(z.string(), ScriptEntrySchema).optional().catch({}),
  metadataGeneration: DoyaMetadataGenerationSchema.optional(),
})
  .passthrough()
  .catch({});

export const DoyaConfigRevisionSchema = z.object({
  mtimeMs: z.number(),
  size: z.number(),
});

export const ProjectConfigRpcErrorSchema = z.discriminatedUnion("code", [
  z.object({ code: z.literal("project_not_found") }),
  z.object({ code: z.literal("invalid_project_config") }),
  z.object({
    code: z.literal("stale_project_config"),
    currentRevision: DoyaConfigRevisionSchema.nullable(),
  }),
  z.object({ code: z.literal("write_failed") }),
]);

export type DoyaScriptEntryRaw = z.infer<typeof DoyaScriptEntryRawSchema>;
export type DoyaMetadataGenerationEntry = z.infer<typeof DoyaMetadataGenerationEntrySchema>;
export type DoyaMetadataGeneration = z.infer<typeof DoyaMetadataGenerationSchema>;
export type DoyaConfigRaw = z.infer<typeof DoyaConfigRawSchema>;
export type DoyaConfig = z.infer<typeof DoyaConfigSchema>;
export type DoyaConfigRevision = z.infer<typeof DoyaConfigRevisionSchema>;
export type ProjectConfigRpcError = z.infer<typeof ProjectConfigRpcErrorSchema>;
