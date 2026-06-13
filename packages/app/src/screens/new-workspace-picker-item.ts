import type { CreateDoyaWorktreeInput } from "@getdoya/client/internal/daemon-client";
import type { GitHubSearchItem } from "@getdoya/protocol/messages";

export type PickerItem =
  | { kind: "branch"; name: string }
  | {
      kind: "github-pr";
      item: GitHubSearchItem;
    };

export type PickerCheckoutRequest = Pick<
  CreateDoyaWorktreeInput,
  "action" | "refName" | "githubPrNumber"
>;

export function pickerItemToCheckoutRequest(
  item: PickerItem | null,
): PickerCheckoutRequest | undefined {
  if (!item) return undefined;
  switch (item.kind) {
    case "branch":
      return { action: "branch-off", refName: item.name };
    case "github-pr":
      return {
        action: "checkout",
        refName: item.item.headRefName ?? "",
        githubPrNumber: item.item.number,
      };
  }
}
