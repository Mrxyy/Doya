import { describe, expect, it } from "vitest";

import { filterAndRankCommandAutocompleteEntries } from "./agent-command-autocomplete";

describe("filterAndRankCommandAutocompleteEntries", () => {
  const entries = [
    { source: "provider" as const, command: { name: "doya-committee" } },
    { source: "provider" as const, command: { name: "commit" } },
    { source: "provider" as const, command: { name: "doya-advisor" } },
  ];

  it("ranks command-name prefixes above later word-boundary partial matches", () => {
    const result = filterAndRankCommandAutocompleteEntries(entries, "comm");

    expect(result.map((entry) => entry.command.name)).toEqual(["commit", "doya-committee"]);
  });

  it("matches client command aliases", () => {
    const result = filterAndRankCommandAutocompleteEntries(
      [
        { source: "client" as const, command: { name: "exit", aliases: ["quit", "q"] } },
        { source: "client" as const, command: { name: "clear", aliases: ["new"] } },
      ],
      "q",
    );

    expect(result.map((entry) => entry.command.name)).toEqual(["exit"]);
  });
});
