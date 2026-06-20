import {
  View,
  Text,
  Pressable,
  Platform,
  ActivityIndicator,
  StatusBar,
  ScrollView,
  type GestureResponderEvent,
  type PressableStateCallbackType,
  type ViewStyle,
} from "react-native";
import * as Haptics from "expo-haptics";
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { slugify, validateBranchSlug, MAX_SLUG_LENGTH } from "@getdoya/protocol/branch-slug";
import { ProjectIconView } from "@/components/project-icon-view";
import { AdaptiveRenameModal } from "@/components/rename-modal";
import { saveAccountBootstrapSession, type AccountBootstrapSession } from "@/account/account-api";
import { deleteAccountProject, renameAccountProject } from "@/account/account-project-api";
import { deleteControlSession, updateControlSession } from "@/control/control-api";
import { invalidateCheckoutGitQueriesForClient } from "@/git/query-keys";
import {
  memo,
  useCallback,
  useMemo,
  useState,
  useEffect,
  useRef,
  type ReactElement,
  type MutableRefObject,
  type Ref,
} from "react";
import { router, useLocalSearchParams, usePathname, type Href } from "expo-router";
import {
  navigateToWorkspace,
  useActiveWorkspaceSelection,
  type ActiveWorkspaceSelection,
} from "@/stores/navigation-active-workspace-store";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import { type GestureType } from "react-native-gesture-handler";
import * as Clipboard from "expo-clipboard";
import { DiffStat } from "@/components/diff-stat";
import { getProviderIcon } from "@/components/provider-icons";
import {
  Archive,
  CircleAlert,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  FolderPlus,
  FolderGit2,
  GitPullRequest,
  Globe,
  Flag,
  Pin,
  Settings,
  Share2,
  SquareTerminal,
  Monitor,
  MoreVertical,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react-native";
import Svg, { Path } from "react-native-svg";
import { NestableScrollContainer } from "react-native-draggable-flatlist";
import { DraggableList, type DraggableRenderItemInfo } from "./draggable-list";
import type { DraggableListDragHandleProps } from "./draggable-list.types";
import {
  getHostRuntimeStore,
  isHostRuntimeConnected,
  type HostRuntimeConnectionStatus,
  useHostMutations,
  useHosts,
} from "@/runtime/host-runtime";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useI18n, translateNow } from "@/i18n/i18n";
import { projectIconQueryKey, projectIconToDataUri } from "@/hooks/use-project-icon-query";
import {
  buildHostAgentDetailRoute,
  buildHostNewWorkspaceRoute,
  buildProjectSettingsRoute,
  parseHostAgentRouteFromPathname,
  parseHostWorkspaceRouteFromPathname,
  parseWorkspaceOpenIntent,
} from "@/utils/host-routes";
import {
  createSidebarWorkspaceEntry,
  type SidebarProjectEntry,
  type SidebarWorkspaceEntry,
} from "@/hooks/use-sidebar-workspaces-list";
import { useSidebarOrderStore } from "@/stores/sidebar-order-store";
import { useShowShortcutBadges } from "@/hooks/use-show-shortcut-badges";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  useContextMenu,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { SyncedLoader } from "@/components/synced-loader";
import { useToast } from "@/contexts/toast-context";
import { useCheckoutGitActionsStore } from "@/git/actions-store";
import { hasVisibleOrderChanged, mergeWithRemainder } from "@/utils/sidebar-reorder";
import { decideLongPressMove } from "@/utils/sidebar-gesture-arbitration";
import { confirmDialog } from "@/utils/confirm-dialog";
import { projectIconPlaceholderLabelFromDisplayName } from "@/utils/project-display-name";
import { shouldRenderSyncedStatusLoader } from "@/utils/status-loader";
import { isEmphasizedStatusDotBucket } from "@/utils/status-dot-color";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";
import { deriveSidebarStateBucket } from "@/utils/sidebar-agent-state";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Shortcut } from "@/components/ui/shortcut";
import type { ShortcutKey } from "@/utils/format-shortcut";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import type { PrHint } from "@/git/use-pr-status-query";
import { buildSidebarProjectRowModel } from "@/utils/sidebar-project-row-model";
import { useSessionStore, type WorkspaceDescriptor } from "@/stores/session-store";
import {
  buildWorkspaceTabPersistenceKey,
  collectAllTabs,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import { useWorkspaceFields } from "@/stores/session-store-hooks";
import { redirectIfArchivingActiveWorkspace } from "@/utils/sidebar-workspace-archive-redirect";
import { openExternalUrl } from "@/utils/open-external-url";
import { restoreControlSessionToAgent } from "@/control/control-session-restore";
import {
  requireWorkspaceExecutionDirectory,
  resolveWorkspaceExecutionDirectory,
} from "@/utils/workspace-execution";
import { confirmRiskyWorktreeArchive } from "@/git/worktree-archive-warning";
import {
  archiveWorkspaceOptimistically,
  archiveWorkspacesOptimistically,
} from "@/workspace/workspace-archive";
import { WorkspaceHoverCard } from "@/components/workspace-hover-card";
import { GitHubIcon } from "@/components/icons/github-icon";
import { isWeb as platformIsWeb, isNative as platformIsNative } from "@/constants/platform";
import {
  WorkspaceTabIcon,
  type WorkspaceTabPresentation,
} from "@/screens/workspace/workspace-tab-presentation";
import { useShallow } from "zustand/shallow";

const workspaceKeyExtractor = (workspace: SidebarWorkspaceEntry) => workspace.workspaceKey;

const projectKeyExtractor = (project: SidebarProjectEntry) => project.projectKey;

const WORKSPACE_STATUS_DOT_WIDTH = 14;
const DEFAULT_STATUS_DOT_SIZE = 7;
const EMPHASIZED_STATUS_DOT_SIZE = 9;
const DEFAULT_STATUS_DOT_OFFSET = 0;
const EMPHASIZED_STATUS_DOT_OFFSET = -1;
const ThemedExternalLink = withUnistyles(ExternalLink);
const ThemedGitPullRequest = withUnistyles(GitPullRequest);
const ThemedGitHubIcon = withUnistyles(GitHubIcon);
const ThemedActivityIndicator = withUnistyles(ActivityIndicator);
const ThemedCircleAlert = withUnistyles(CircleAlert);
const ThemedSyncedLoader = withUnistyles(SyncedLoader);
const ThemedMonitor = withUnistyles(Monitor);
const ThemedFolderGit2 = withUnistyles(FolderGit2);
const ThemedFolderPlus = withUnistyles(FolderPlus);
const ThemedFlag = withUnistyles(Flag);
const ThemedGlobe = withUnistyles(Globe);
const ThemedPin = withUnistyles(Pin);
const ThemedShare2 = withUnistyles(Share2);
const ThemedSquareTerminal = withUnistyles(SquareTerminal);
const ThemedMoreVertical = withUnistyles(MoreVertical);
const ThemedTrash2 = withUnistyles(Trash2);
const ThemedSettings = withUnistyles(Settings);
const ThemedCopy = withUnistyles(Copy);
const ThemedArchive = withUnistyles(Archive);
const ThemedPencil = withUnistyles(Pencil);

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
const redColorMapping = (theme: Theme) => ({ color: theme.colors.palette.red[500] });
const amberColorMapping = (theme: Theme) => ({ color: theme.colors.palette.amber[500] });
const blueColorMapping = (theme: Theme) => ({ color: theme.colors.palette.blue[500] });
const greenColorMapping = (theme: Theme) => ({ color: theme.colors.palette.green[500] });
const purpleColorMapping = (theme: Theme) => ({ color: theme.colors.palette.purple[500] });
const syncedLoaderColorMapping = (theme: Theme) => ({
  color:
    theme.colorScheme === "light"
      ? theme.colors.palette.amber[700]
      : theme.colors.palette.amber[500],
});

function getPrIconUniMapping(state: PrHint["state"]) {
  switch (state) {
    case "merged":
      return purpleColorMapping;
    case "open":
      return greenColorMapping;
    case "closed":
      return redColorMapping;
  }
}

function NewConversationIcon({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 22 22" fill="none">
      <Path
        d="M10.25 3.49911C10.6642 3.49911 10.9999 3.83494 11 4.24911C11 4.66332 10.6642 4.99911 10.25 4.99911C9.18773 4.99911 8.43604 4.99946 7.84839 5.04745C7.26948 5.09475 6.91543 5.18427 6.63769 5.32577C6.07334 5.61336 5.61427 6.07246 5.32666 6.63681C5.18515 6.91452 5.09564 7.26861 5.04834 7.8475C5.00035 8.43513 5 9.18688 5 10.2491V10.9991C5 12.4219 5.00084 13.4292 5.08496 14.2056C5.16757 14.9679 5.32309 15.4191 5.57275 15.7628C5.75774 16.0173 5.98175 16.2414 6.23633 16.4263C6.58 16.6761 7.03114 16.8315 7.79346 16.9141C8.56998 16.9983 9.57718 16.9991 11 16.9991H11.75C12.8123 16.9991 13.564 16.9988 14.1516 16.9508C14.7306 16.9035 15.0846 16.814 15.3623 16.6725C15.9267 16.3848 16.3858 15.9258 16.6734 15.3614C16.8148 15.0837 16.9044 14.7296 16.9516 14.1507C16.9996 13.5631 17 12.8113 17 11.7491C17.0001 11.3349 17.3358 10.9991 17.75 10.9991C18.1642 10.9991 18.4999 11.3349 18.5 11.7491C18.5 12.7867 18.5007 13.6101 18.4465 14.2731C18.3916 14.9447 18.2764 15.5175 18.0093 16.0419C17.5779 16.8885 16.8895 17.577 16.0427 18.0084C15.5183 18.2756 14.9456 18.3908 14.2739 18.4456C13.611 18.4998 12.7876 18.4991 11.75 18.4991H11C9.61063 18.4991 8.50837 18.5002 7.63233 18.4053C6.74237 18.309 5.99719 18.1062 5.35522 17.64C4.97322 17.3624 4.63668 17.0259 4.35913 16.6439C3.89286 16.002 3.69017 15.2567 3.59375 14.3668C3.49886 13.4907 3.5 12.3884 3.5 10.9991V10.2491C3.5 9.21151 3.49932 8.38809 3.55347 7.72518C3.60835 7.05356 3.72355 6.48078 3.99073 5.95638C4.42216 5.10969 5.11057 4.42125 5.95728 3.98983C6.48168 3.72267 7.05442 3.60745 7.72608 3.55258C8.389 3.49842 9.21236 3.49911 10.25 3.49911ZM14.7844 4.03012C15.6631 3.15143 17.0881 3.15141 17.9668 4.03012C18.8449 4.90863 18.8449 6.33314 17.9668 7.21176L12.3703 12.8104C12.1115 13.0694 11.9224 13.2625 11.701 13.419C11.515 13.5504 11.314 13.6604 11.1033 13.7464C10.8522 13.8489 10.5873 13.9049 10.2295 13.9837L9.45313 14.1551C9.31499 14.1855 9.16132 14.2197 9.02979 14.2364C8.89792 14.2531 8.67815 14.2691 8.44531 14.1749C8.16294 14.0606 7.93929 13.8361 7.82495 13.5538C7.73091 13.3213 7.74604 13.1019 7.76269 12.97C7.77934 12.8385 7.81354 12.6842 7.84399 12.546L8.01612 11.7681C8.09479 11.4111 8.15049 11.1473 8.25269 10.8966C8.33864 10.6859 8.44886 10.4848 8.58008 10.2989C8.73634 10.0776 8.92859 9.88827 9.18726 9.62945L14.7844 4.03012ZM16.9062 5.09067C16.6133 4.79772 16.1379 4.79838 15.845 5.09139L10.2478 10.69C9.95443 10.9836 9.8708 11.0714 9.8054 11.1639C9.73993 11.2567 9.68428 11.3568 9.64138 11.462C9.59855 11.567 9.57043 11.6853 9.48096 12.0912L9.35938 12.639L9.9065 12.5189C10.313 12.4293 10.4313 12.3999 10.5364 12.357C10.6417 12.314 10.7423 12.26 10.8352 12.1944C10.9279 12.129 11.0152 12.0446 11.3091 11.7506L16.9062 6.15121C17.1987 5.85841 17.1986 5.38347 16.9062 5.09067Z"
        fill={color}
      />
    </Svg>
  );
}

function AiCreationSidebarIcon({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 22 22" fill="none">
      <Path
        d="M12.188 3.50073C14.1304 3.50745 15.2005 3.56163 16.0427 3.99072C16.8893 4.42216 17.5779 5.11064 18.0093 5.95728C18.4996 6.91981 18.5 8.17986 18.5 10.6997V11.3003L18.4993 12.188C18.4926 14.1305 18.4384 15.2005 18.0093 16.0427C17.5779 16.8894 16.8893 17.5779 16.0427 18.0093C15.2005 18.4383 14.1304 18.4926 12.188 18.4993L11.3003 18.5H10.6997C8.33728 18.5 7.08189 18.4998 6.14111 18.0957L5.95728 18.0093C5.16359 17.6049 4.50843 16.9749 4.07421 16.2002L3.99072 16.0427C3.5616 15.2005 3.50744 14.1306 3.50073 12.188L3.5 11.3003V10.6997C3.5 8.33703 3.50011 7.08193 3.9043 6.14111L3.99072 5.95728C4.39515 5.16361 5.02506 4.50841 5.7998 4.07421L5.95728 3.99072C6.91979 3.50046 8.17998 3.5 10.6997 3.5H11.3003L12.188 3.50073ZM11.8291 11.6965C11.2808 11.5937 10.7177 11.5937 10.1695 11.6965C9.57463 11.8082 8.99397 12.0909 7.57812 12.7988L5.05127 14.0623C5.05306 14.0862 5.05448 14.1099 5.05639 14.1333C5.11012 14.7909 5.20713 15.1277 5.32666 15.3623C5.61426 15.9266 6.07336 16.3858 6.63769 16.6734C6.87228 16.7928 7.20934 16.8899 7.86669 16.9436C8.54171 16.9987 9.41531 17 10.6997 17H11.3003C12.5847 17 13.4583 16.9987 14.1333 16.9436C14.7907 16.8899 15.1278 16.7929 15.3623 16.6734C15.9265 16.3858 16.3858 15.9266 16.6733 15.3623C16.7929 15.1277 16.8899 14.7908 16.9436 14.1333C16.9455 14.1101 16.9462 14.0866 16.948 14.063L14.4204 12.7988C13.0045 12.0909 12.424 11.8081 11.8291 11.6965ZM10.6997 5C9.41531 5 8.54171 5.00128 7.86669 5.0564C7.20934 5.11011 6.87228 5.2072 6.63769 5.32666C6.07336 5.61424 5.61426 6.07338 5.32666 6.63769C5.20713 6.87229 5.11012 7.20909 5.05639 7.8667C5.00125 8.54176 5 9.41508 5 10.6997V11.3003C5 11.7094 5.00024 12.0767 5.0022 12.4092L6.90723 11.4578C8.24535 10.7887 9.04302 10.3824 9.89256 10.2229C10.6237 10.0857 11.3749 10.0858 12.106 10.2229C12.9556 10.3824 13.7532 10.7887 15.0913 11.4578L16.9963 12.4099C16.9983 12.0772 17 11.7097 17 11.3003V10.6997C17 9.4151 16.9987 8.54176 16.9436 7.8667C16.8899 7.20921 16.7929 6.87228 16.6733 6.63769C16.3858 6.07341 15.9265 5.61427 15.3623 5.32666C15.1278 5.20715 14.7907 5.11013 14.1333 5.0564C13.4583 5.00125 12.5847 5 11.3003 5H10.6997ZM8.23803 6.875C8.99109 6.87507 9.60178 7.4857 9.60178 8.23877C9.60163 8.99172 8.991 9.6017 8.23803 9.60178C7.48518 9.60163 6.87441 8.99164 6.87426 8.23877C6.87426 7.48578 7.48509 6.8752 8.23803 6.875Z"
        fill={color}
      />
    </Svg>
  );
}

function ConversationBubbleIcon({ color }: { color: string }) {
  return (
    <Svg width={12} height={12} viewBox="0 0 12 12" fill="none">
      <Path
        d="M6.61865 0.949219C7.9519 0.949219 8.6187 0.949124 9.14795 1.15723C9.9232 1.46213 10.5368 2.07583 10.8418 2.85107C11.0499 3.38033 11.0503 4.04712 11.0503 5.38037C11.0503 6.71367 11.0499 7.38042 10.8418 7.90967C10.5368 8.68497 9.92325 9.29857 9.14795 9.60352C8.6187 9.81167 7.95195 9.81202 6.61865 9.81202H6.40575L3.82324 11.2583C3.28137 11.5615 2.62653 11.1123 2.71436 10.4976L2.84229 9.59912C2.07168 9.29287 1.46182 8.68167 1.15821 7.90967C0.95008 7.38042 0.950195 6.71362 0.950195 5.38037C0.950195 4.04712 0.950055 3.38033 1.15821 2.85107C1.46315 2.07581 2.07678 1.46213 2.85205 1.15723C3.38131 0.949094 4.04806 0.949219 5.38135 0.949219H6.61865ZM5.38135 1.94922C4.70161 1.94922 4.23939 1.94976 3.87989 1.97314C3.52912 1.99597 3.34616 2.03762 3.21826 2.08789C2.70146 2.29114 2.29218 2.7004 2.08887 3.21728C2.0386 3.34516 1.99695 3.52811 1.97412 3.87891C1.95074 4.23842 1.9502 4.70065 1.9502 5.38037C1.9502 6.06007 1.95074 6.52232 1.97412 6.88182C1.99695 7.23257 2.03861 7.41557 2.08887 7.54347L2.12891 7.63867C2.34206 8.10797 2.72943 8.47832 3.21143 8.66992L3.94336 8.96047L3.83252 9.74022L3.77539 10.1382L5.917 8.93947L6.145 8.81202H6.61865C7.2982 8.81202 7.76025 8.81157 8.11965 8.78807C8.4704 8.76517 8.6536 8.72322 8.78175 8.67287C9.2986 8.46957 9.70785 8.06032 9.91115 7.54347C9.9615 7.41532 10.0035 7.23212 10.0264 6.88132C10.0499 6.52197 10.0503 6.05992 10.0503 5.38037C10.0503 4.70084 10.0499 4.23878 10.0264 3.87939C10.0035 3.52857 9.9615 3.34541 9.91115 3.21728C9.7078 2.7004 9.29855 2.29114 8.78175 2.08789C8.65385 2.03763 8.47085 1.99597 8.1201 1.97314C7.7606 1.94976 7.29835 1.94922 6.61865 1.94922H5.38135ZM3.70313 4.7334C4.08973 4.7334 4.40332 5.04697 4.40332 5.43357C4.40322 5.82012 4.08966 6.13332 3.70313 6.13332C3.31671 6.13317 3.00353 5.82002 3.00342 5.43357C3.00342 5.04707 3.31664 4.73353 3.70313 4.7334ZM6.0005 4.7334C6.387 4.73353 6.7002 5.04707 6.7002 5.43357C6.7001 5.82002 6.3869 6.13317 6.0005 6.13332C5.61395 6.13332 5.3004 5.82012 5.3003 5.43357C5.3003 5.04697 5.6139 4.7334 6.0005 4.7334ZM8.29735 4.7334C8.68385 4.73353 8.99705 5.04707 8.99705 5.43357C8.99695 5.82002 8.6838 6.13317 8.29735 6.13332C7.91085 6.13332 7.59725 5.82012 7.59715 5.43357C7.59715 5.04697 7.91075 4.7334 8.29735 4.7334Z"
        fill={color}
      />
    </Svg>
  );
}

function renderNewConversationIcon(color: string): ReactElement {
  return <NewConversationIcon color={color} />;
}

function renderAiCreationSidebarIcon(color: string): ReactElement {
  return <AiCreationSidebarIcon color={color} />;
}

function useStableProjectIconData(
  data: (string | null)[],
  signature: string,
): readonly (string | null)[] {
  const stableRef = useRef<{ signature: string; data: (string | null)[] } | null>(null);
  if (stableRef.current?.signature !== signature) {
    stableRef.current = { signature, data };
  }
  return stableRef.current.data;
}

function isWorkspaceSelected(input: {
  selection: ActiveWorkspaceSelection | null;
  serverId: string | null;
  workspaceId: string;
  enabled: boolean;
}): boolean {
  return (
    input.enabled &&
    input.selection?.serverId === input.serverId &&
    input.selection.workspaceId === input.workspaceId
  );
}

function isProjectSelectedByRoute(input: {
  selection: ActiveWorkspaceSelection | null;
  agentRoute: { serverId: string; agentId: string } | null;
  project: SidebarProjectEntry;
  serverId: string | null;
  enabled: boolean;
}): boolean {
  if (
    input.enabled &&
    input.agentRoute &&
    input.project.controlAgentNodeId === input.agentRoute.serverId &&
    input.project.controlAgentId === input.agentRoute.agentId
  ) {
    return true;
  }
  if (isControlProjectSelectedByWorkspace(input)) {
    return true;
  }
  return (
    input.enabled &&
    input.selection?.serverId === input.serverId &&
    input.project.workspaces.some(
      (workspace) => workspace.workspaceId === input.selection?.workspaceId,
    )
  );
}

function isControlProjectSelectedByWorkspace(input: {
  selection: ActiveWorkspaceSelection | null;
  project: SidebarProjectEntry;
  enabled: boolean;
}): boolean {
  if (!input.enabled || !input.selection || !input.project.controlSessionId) {
    return false;
  }
  const controlNodeId = input.project.controlAgentNodeId?.trim();
  if (controlNodeId && input.selection.serverId !== controlNodeId) {
    return false;
  }
  const selectedWorkspaceId = input.selection.workspaceId.trim();
  const controlWorkspaceId = input.project.controlWorkspaceId?.trim();
  if (controlWorkspaceId && selectedWorkspaceId === controlWorkspaceId) {
    return true;
  }
  const controlCwd = input.project.controlCwd?.trim();
  if (controlCwd && selectedWorkspaceId === controlCwd) {
    return true;
  }
  return selectedWorkspaceId.includes(`/sessions/${input.project.controlSessionId}`);
}

function selectionForSelectedWorkspace(
  selected: boolean,
  workspace: SidebarWorkspaceEntry,
): ActiveWorkspaceSelection | null {
  return selected ? { serverId: workspace.serverId, workspaceId: workspace.workspaceId } : null;
}

interface SidebarWorkspaceListProps {
  projects: SidebarProjectEntry[];
  serverId: string | null;
  connectionStatus: HostRuntimeConnectionStatus;
  accountSession?: AccountBootstrapSession | null;
  collapsedProjectKeys: ReadonlySet<string>;
  onToggleProjectCollapsed: (projectKey: string) => void;
  shortcutIndexByWorkspaceKey: Map<string, number>;
  isRefreshing?: boolean;
  onRefresh?: () => void;
  onWorkspacePress?: () => void;
  onProjectMutated?: () => void;
  onAddProject?: () => void;
  onAiCreation?: () => void;
  addProjectLabel?: string;
  aiCreationLabel?: string;
  emptyProjectHint?: string;
  listFooterComponent?: ReactElement | null;
  /** Gesture ref for coordinating with parent gestures (e.g., sidebar close) */
  parentGestureRef?: MutableRefObject<GestureType | undefined>;
}

interface ProjectHeaderRowProps {
  project: SidebarProjectEntry;
  displayName: string;
  iconDataUri: string | null;
  workspace: SidebarWorkspaceEntry | null;
  conversationVisual?: boolean;
  selected?: boolean;
  chevron: "expand" | "collapse" | null;
  onPress: () => void;
  serverId: string | null;
  canCreateWorktree: boolean;
  isProjectActive?: boolean;
  onWorkspacePress?: () => void;
  onWorktreeCreated?: (workspaceId: string) => void;
  onPinProject?: () => void;
  onRenameProject?: () => void;
  shortcutNumber?: number | null;
  showShortcutBadge?: boolean;
  drag: () => void;
  isDragging: boolean;
  isArchiving?: boolean;
  menuController: ReturnType<typeof useContextMenu> | null;
  onRemoveProject?: () => void;
  removeProjectStatus?: "idle" | "pending";
  dragHandleProps?: DraggableListDragHandleProps;
  activeAgentRoute?: { serverId: string; agentId: string } | null;
}

interface WorkspaceRowInnerProps {
  workspace: SidebarWorkspaceEntry;
  selected: boolean;
  shortcutNumber: number | null;
  showShortcutBadge: boolean;
  onPress: () => void;
  drag: () => void;
  isDragging: boolean;
  isArchiving: boolean;
  isCreating?: boolean;
  dragHandleProps?: DraggableListDragHandleProps;
  menuController: ReturnType<typeof useContextMenu> | null;
  archiveLabel?: string;
  archiveStatus?: "idle" | "pending" | "success";
  archivePendingLabel?: string;
  onArchive?: () => void;
  onCopyBranchName?: () => void;
  onCopyPath?: () => void;
  onRename?: () => void;
  archiveShortcutKeys?: ShortcutKey[][] | null;
}

function getProjectRowBaseStyle({
  isDragging,
  selected,
  isHovered,
  conversationVisual,
}: {
  isDragging: boolean;
  selected: boolean;
  isHovered: boolean;
  conversationVisual: boolean;
}) {
  return [
    styles.projectRow,
    conversationVisual && styles.conversationProjectRow,
    isDragging && styles.projectRowDragging,
    selected && styles.sidebarRowSelected,
    conversationVisual && selected && styles.conversationProjectRowSelected,
    isHovered && styles.projectRowHovered,
    conversationVisual && isHovered && styles.conversationProjectRowHovered,
  ];
}

function ProjectShortcutBadge({
  show,
  shortcutNumber,
}: {
  show: boolean;
  shortcutNumber: number | null;
}) {
  if (!show || shortcutNumber === null) return null;
  return (
    <View style={styles.shortcutBadge}>
      <Text style={styles.shortcutBadgeText}>{shortcutNumber}</Text>
    </View>
  );
}

function normalizeActiveAgentRoute(
  route: ProjectHeaderRowProps["activeAgentRoute"],
): { serverId: string; agentId: string } | null {
  return route ?? null;
}

function getWorkspaceArchiveStatus(
  isWorktree: boolean,
  archiveStatus: "idle" | "pending" | "success",
  isArchivingWorkspace: boolean,
): "idle" | "pending" | "success" {
  if (isWorktree) return archiveStatus;
  if (isArchivingWorkspace) return "pending";
  return "idle";
}

function useSidebarWorkspaceEntry(
  serverId: string | null,
  workspaceId: string | null,
): SidebarWorkspaceEntry | null {
  const projectWorkspaceEntry = useCallback(
    (workspace: WorkspaceDescriptor): SidebarWorkspaceEntry =>
      createSidebarWorkspaceEntry({ serverId: serverId ?? "", workspace }),
    [serverId],
  );

  return useWorkspaceFields(serverId, workspaceId, projectWorkspaceEntry);
}

export function PrBadge({ hint }: { hint: PrHint }) {
  const [isHovered, setIsHovered] = useState(false);

  const handlePressIn = useCallback((event: GestureResponderEvent) => {
    event.stopPropagation();
  }, []);

  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      void openExternalUrl(hint.url);
    },
    [hint.url],
  );

  const handleHoverIn = useCallback(() => setIsHovered(true), []);
  const handleHoverOut = useCallback(() => setIsHovered(false), []);

  const textStyle = isHovered ? prBadgeTextHoveredCombined : prBadgeStyles.text;
  const iconUniProps = isHovered ? foregroundColorMapping : getPrIconUniMapping(hint.state);

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={translateNow("ui.pull.request.number.accessibility", {
        number: hint.number,
      })}
      hitSlop={4}
      onPressIn={handlePressIn}
      onPress={handlePress}
      onHoverIn={handleHoverIn}
      onHoverOut={handleHoverOut}
      style={prBadgePressableStyle}
    >
      {isHovered ? (
        <ThemedExternalLink size={12} uniProps={iconUniProps} />
      ) : (
        <ThemedGitPullRequest size={12} uniProps={iconUniProps} />
      )}
      <Text style={textStyle} numberOfLines={1}>
        #{hint.number}
      </Text>
    </Pressable>
  );
}

function prBadgePressableStyle({ pressed }: PressableStateCallbackType) {
  return [prBadgeStyles.badge, pressed && prBadgeStyles.badgePressed];
}

function projectKebabStyle({
  hovered = false,
}: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.projectKebabButton, hovered && styles.projectKebabButtonHovered];
}

function workspaceKebabStyle({
  hovered = false,
}: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.kebabButton, hovered && styles.kebabButtonHovered];
}

function noop() {}

const prBadgeStyles = StyleSheet.create((theme) => ({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  badgePressed: {
    opacity: 0.82,
  },
  text: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
    lineHeight: 14,
    color: theme.colors.foregroundMuted,
  },
  textHovered: {
    color: theme.colors.foreground,
  },
}));

const prBadgeTextHoveredCombined = [prBadgeStyles.text, prBadgeStyles.textHovered];

function ChecksBadge({ checks }: { checks: PrHint["checks"] }): ReactElement | null {
  if (!checks || checks.length === 0) return null;

  const failed = checks.filter((c) => c.status === "failure").length;
  if (failed === 0) return null;

  const label = `${failed} failed`;

  return (
    <View style={checksBadgeStyles.badge}>
      <ThemedGitHubIcon size={10} uniProps={redColorMapping} />
      <Text style={checksBadgeStyles.text}>{label}</Text>
    </View>
  );
}

const checksBadgeStyles = StyleSheet.create((theme) => ({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  text: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
    lineHeight: 14,
    color: theme.colors.palette.red[500],
  },
}));

function WorkspaceStatusIndicator({
  bucket,
  workspaceKind,
  loading = false,
}: {
  bucket: SidebarWorkspaceEntry["statusBucket"];
  workspaceKind: SidebarWorkspaceEntry["workspaceKind"];
  loading?: boolean;
}) {
  const shouldShowSyncedLoader = shouldRenderSyncedStatusLoader({ bucket });

  if (loading) {
    return (
      <View style={styles.workspaceStatusDot}>
        <ThemedActivityIndicator size={8} uniProps={foregroundMutedColorMapping} />
      </View>
    );
  }

  if (shouldShowSyncedLoader) {
    return (
      <View style={styles.workspaceStatusDot}>
        <ThemedSyncedLoader size={11} uniProps={syncedLoaderColorMapping} />
      </View>
    );
  }

  if (bucket === "needs_input") {
    return (
      <View style={styles.workspaceStatusDot}>
        <ThemedCircleAlert size={14} uniProps={amberColorMapping} />
      </View>
    );
  }

  let KindIcon: typeof ThemedMonitor | null;
  if (workspaceKind === "local_checkout") KindIcon = ThemedMonitor;
  else if (workspaceKind === "worktree") KindIcon = ThemedFolderGit2;
  else KindIcon = null;
  if (!KindIcon) return null;

  const dotColorStyle = getStatusDotColorStyle(bucket);
  const statusDotSize = isEmphasizedStatusDotBucket(bucket)
    ? EMPHASIZED_STATUS_DOT_SIZE
    : DEFAULT_STATUS_DOT_SIZE;
  const statusDotOffset =
    statusDotSize === EMPHASIZED_STATUS_DOT_SIZE
      ? EMPHASIZED_STATUS_DOT_OFFSET
      : DEFAULT_STATUS_DOT_OFFSET;

  return (
    <View style={styles.workspaceStatusDot}>
      <KindIcon size={14} uniProps={foregroundMutedColorMapping} />
      {dotColorStyle ? (
        <StatusDotOverlay
          dotColorStyle={dotColorStyle}
          size={statusDotSize}
          offset={statusDotOffset}
        />
      ) : null}
    </View>
  );
}

function StatusDotOverlay({
  dotColorStyle,
  size,
  offset,
}: {
  dotColorStyle: ViewStyle;
  size: number;
  offset: number;
}) {
  const overlayStyle = useMemo(
    () => [
      styles.statusDotOverlay,
      dotColorStyle,
      {
        width: size,
        height: size,
        right: offset,
        bottom: offset,
      },
    ],
    [dotColorStyle, size, offset],
  );
  return <View style={overlayStyle} />;
}

interface ControlSessionAgentTabState {
  provider: string;
  title: string | null;
  statusBucket: SidebarStateBucket | null;
  titleState: "ready" | "loading";
}

interface ControlSessionWorkspaceAgentTabs {
  serverId: string | null;
  agentIdsSignature: string;
}

function useControlSessionWorkspaceAgentTabs(
  project: SidebarProjectEntry,
): ControlSessionWorkspaceAgentTabs {
  const workspaceKey = useMemo(() => {
    const serverId = project.controlAgentNodeId?.trim();
    const workspaceId = project.controlWorkspaceId?.trim();
    if (!serverId || !workspaceId) {
      return null;
    }
    return buildWorkspaceTabPersistenceKey({ serverId, workspaceId });
  }, [project.controlAgentNodeId, project.controlWorkspaceId]);

  return useWorkspaceLayoutStore(
    useShallow((state): ControlSessionWorkspaceAgentTabs => {
      const serverId = project.controlAgentNodeId?.trim();
      if (!serverId || !workspaceKey) {
        return { serverId: serverId ?? null, agentIdsSignature: "" };
      }
      const layout = state.layoutByWorkspace[workspaceKey] ?? null;
      if (!layout) {
        return { serverId, agentIdsSignature: "" };
      }
      const agentIds = collectAllTabs(layout.root)
        .map((tab) => (tab.target.kind === "agent" ? tab.target.agentId.trim() : ""))
        .filter(Boolean);
      if (agentIds.length === 0) {
        return { serverId, agentIdsSignature: "" };
      }
      return { serverId, agentIdsSignature: Array.from(new Set(agentIds)).sort().join("\n") };
    }),
  );
}

function useControlSessionTabPresentation(input: {
  project: SidebarProjectEntry;
  selected: boolean;
  activeAgentRoute: { serverId: string; agentId: string } | null;
}): WorkspaceTabPresentation | null {
  const { project, selected, activeAgentRoute } = input;
  const workspaceAgentTabs = useControlSessionWorkspaceAgentTabs(project);
  const agentIds = useMemo(() => {
    if (selected && activeAgentRoute) {
      return [activeAgentRoute.agentId];
    }
    const fromWorkspaceTabs = workspaceAgentTabs.agentIdsSignature
      .split("\n")
      .map((value) => value.trim())
      .filter(Boolean);
    if (fromWorkspaceTabs.length > 0) {
      return fromWorkspaceTabs;
    }
    const fallbackAgentId = project.controlAgentId?.trim();
    return fallbackAgentId ? [fallbackAgentId] : [];
  }, [activeAgentRoute, project.controlAgentId, selected, workspaceAgentTabs.agentIdsSignature]);
  const serverId =
    selected && activeAgentRoute
      ? activeAgentRoute.serverId
      : (workspaceAgentTabs.serverId ?? project.controlAgentNodeId?.trim() ?? null);
  const agentState = useSessionStore(
    useShallow((state): ControlSessionAgentTabState | null => {
      if (!serverId || agentIds.length === 0) {
        return null;
      }
      const session = state.sessions[serverId];
      if (!session) {
        return null;
      }
      const tabStates = agentIds
        .map((agentId) => session.agents.get(agentId) ?? session.agentDetails.get(agentId) ?? null)
        .filter((agent): agent is NonNullable<typeof agent> => agent !== null)
        .map((agent) => ({
          provider: agent.provider,
          title: agent.title,
          bucket: deriveSidebarStateBucket({
            status: agent.status,
            pendingPermissionCount: agent.pendingPermissions.length,
            requiresAttention: agent.requiresAttention ?? false,
            attentionReason: agent.attentionReason ?? null,
          }),
        }));
      if (tabStates.length === 0) {
        return null;
      }
      const primary = selectPrimaryControlSessionTabState(tabStates);
      return {
        provider: primary.provider,
        title: primary.title,
        statusBucket: selectControlSessionAggregateStatus(tabStates.map((tab) => tab.bucket)),
        titleState: primary.title ? "ready" : "loading",
      };
    }),
  );

  return useMemo(() => {
    if (!agentState) {
      const fallbackStatusBucket = mapControlSessionStatusToSidebarBucket(
        project.controlSessionStatus,
        selected,
      );
      if (!fallbackStatusBucket) {
        return null;
      }
      return {
        key: `${project.projectKey}:control-session`,
        kind: "agent",
        label: project.projectName,
        subtitle: "",
        titleState: "ready",
        icon: SquareTerminal,
        statusBucket: fallbackStatusBucket,
      };
    }
    return {
      key: `${project.projectKey}:aggregate-tabs`,
      kind: "agent",
      label: agentState.title ?? project.projectName,
      subtitle: "",
      titleState: agentState.titleState,
      icon: getProviderIcon(agentState.provider),
      statusBucket: agentState.statusBucket,
    };
  }, [agentState, project.controlSessionStatus, project.projectKey, project.projectName, selected]);
}

function mapControlSessionStatusToSidebarBucket(
  status: SidebarProjectEntry["controlSessionStatus"],
  selected: boolean,
): SidebarStateBucket | null {
  if (selected && status === "running") {
    return "running";
  }
  if (status === "needs_input") {
    return "needs_input";
  }
  if (status === "error") {
    return "failed";
  }
  return null;
}

function selectControlSessionAggregateStatus(buckets: SidebarStateBucket[]): SidebarStateBucket {
  if (buckets.includes("needs_input")) {
    return "needs_input";
  }
  if (buckets.includes("failed")) {
    return "failed";
  }
  if (buckets.includes("running")) {
    return "running";
  }
  if (buckets.includes("attention")) {
    return "attention";
  }
  return "done";
}

function selectPrimaryControlSessionTabState<
  T extends { bucket: SidebarStateBucket; provider: string; title: string | null },
>(tabStates: T[]): T {
  const selectedBucket = selectControlSessionAggregateStatus(tabStates.map((tab) => tab.bucket));
  return tabStates.find((tab) => tab.bucket === selectedBucket) ?? tabStates[0];
}

function ProjectLeadingVisual({
  displayName,
  iconDataUri,
  workspace,
  projectKey,
  tabPresentation = null,
  conversationVisual = false,
  chevron = null,
  showChevron = false,
  isArchiving = false,
}: {
  displayName: string;
  iconDataUri: string | null;
  workspace: SidebarWorkspaceEntry | null;
  projectKey: string;
  tabPresentation?: WorkspaceTabPresentation | null;
  conversationVisual?: boolean;
  chevron?: "expand" | "collapse" | null;
  showChevron?: boolean;
  isArchiving?: boolean;
}) {
  const placeholderLabel = projectIconPlaceholderLabelFromDisplayName(displayName);
  const placeholderInitial = placeholderLabel.charAt(0).toUpperCase();
  const activeWorkspace = workspace;
  const shouldShowWorkspaceStatus =
    activeWorkspace !== null && (isArchiving || activeWorkspace.statusBucket !== "done");
  const shouldShowSyncedLoader = activeWorkspace
    ? shouldRenderSyncedStatusLoader({ bucket: activeWorkspace.statusBucket })
    : false;
  const visualSlotStyle = conversationVisual
    ? styles.conversationProjectLeadingVisualSlot
    : styles.projectLeadingVisualSlot;

  if (showChevron && chevron !== null) {
    return (
      <View style={visualSlotStyle}>
        <ProjectInlineChevron chevron={chevron} />
      </View>
    );
  }

  if (conversationVisual && tabPresentation) {
    return (
      <View style={visualSlotStyle}>
        <WorkspaceTabIcon presentation={tabPresentation} size={14} />
      </View>
    );
  }

  if (!shouldShowWorkspaceStatus || !activeWorkspace) {
    return (
      <View style={visualSlotStyle}>
        <ProjectIcon
          iconDataUri={iconDataUri}
          placeholderInitial={placeholderInitial}
          projectKey={projectKey}
          conversationVisual={conversationVisual}
        />
      </View>
    );
  }

  return (
    <ProjectLeadingVisualStatus
      iconDataUri={iconDataUri}
      placeholderInitial={placeholderInitial}
      projectKey={projectKey}
      conversationVisual={conversationVisual}
      isArchiving={isArchiving}
      shouldShowSyncedLoader={shouldShowSyncedLoader}
      activeWorkspace={activeWorkspace}
    />
  );
}

function ProjectRowTrailingActions({
  project,
  displayName,
  canCreateWorktree,
  isHovered,
  isMobileBreakpoint,
  isProjectActive,
  conversationMenu,
  onBeginWorkspaceSetup,
  onPinProject,
  onRenameProject,
  onRemoveProject,
  removeProjectStatus,
}: {
  project: SidebarProjectEntry;
  displayName: string;
  canCreateWorktree: boolean;
  isHovered: boolean;
  isMobileBreakpoint: boolean;
  isProjectActive: boolean;
  conversationMenu: boolean;
  onBeginWorkspaceSetup: () => void;
  onPinProject?: () => void;
  onRenameProject?: () => void;
  onRemoveProject?: () => void;
  removeProjectStatus: "idle" | "pending" | "success";
}) {
  const actionsVisible = isHovered || platformIsNative || isMobileBreakpoint;
  return (
    <View style={styles.projectTrailingActions}>
      {canCreateWorktree ? (
        <NewWorktreeButton
          displayName={displayName}
          onPress={onBeginWorkspaceSetup}
          visible={actionsVisible}
          showShortcutHint={isProjectActive}
          testID={`sidebar-project-new-worktree-${project.projectKey}`}
        />
      ) : null}
      {onRemoveProject ? (
        <View
          style={!actionsVisible && styles.projectKebabButtonHidden}
          pointerEvents={actionsVisible ? "auto" : "none"}
        >
          <ProjectKebabMenu
            projectKey={project.projectKey}
            conversationMenu={conversationMenu}
            onPinProject={onPinProject}
            onRenameProject={onRenameProject}
            onRemoveProject={onRemoveProject}
            removeProjectStatus={removeProjectStatus}
          />
        </View>
      ) : null}
    </View>
  );
}

const trash2LeadingIcon = <ThemedTrash2 size={14} uniProps={foregroundMutedColorMapping} />;
const settingsLeadingIcon = <ThemedSettings size={14} uniProps={foregroundMutedColorMapping} />;
const copyLeadingIcon = <ThemedCopy size={14} uniProps={foregroundMutedColorMapping} />;
const archiveLeadingIcon = <ThemedArchive size={14} uniProps={foregroundMutedColorMapping} />;
const renameLeadingIcon = <ThemedPencil size={14} uniProps={foregroundMutedColorMapping} />;
const pinLeadingIcon = <ThemedPin size={14} uniProps={foregroundMutedColorMapping} />;
const shareLeadingIcon = <ThemedShare2 size={14} uniProps={foregroundMutedColorMapping} />;
const reportLeadingIcon = <ThemedFlag size={14} uniProps={foregroundMutedColorMapping} />;
const CONVERSATION_MENU_WIDTH = 220;
const CONVERSATION_MENU_RIGHT_SHIFT = CONVERSATION_MENU_WIDTH * 0.4;

function renderKebabTriggerIcon({ hovered }: { hovered?: boolean }) {
  return (
    <ThemedMoreVertical
      size={14}
      uniProps={hovered ? foregroundColorMapping : foregroundMutedColorMapping}
    />
  );
}

function ProjectKebabMenu({
  projectKey,
  conversationMenu = false,
  onPinProject,
  onRenameProject,
  onRemoveProject,
  removeProjectStatus,
}: {
  projectKey: string;
  conversationMenu?: boolean;
  onPinProject?: () => void;
  onRenameProject?: () => void;
  onRemoveProject: () => void;
  removeProjectStatus: "idle" | "pending" | "success";
}) {
  const handleOpenProjectSettings = useCallback(() => {
    if (projectKey.trim().length === 0) return;
    router.navigate(buildProjectSettingsRoute(projectKey));
  }, [projectKey]);
  const canOpenProjectSettings = projectKey.trim().length > 0;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        hitSlop={8}
        style={projectKebabStyle}
        accessibilityRole={platformIsWeb ? undefined : "button"}
        accessibilityLabel={translateNow("ui.project.actions.qpacie")}
        testID={`sidebar-project-kebab-${projectKey}`}
      >
        {renderKebabTriggerIcon}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        width={CONVERSATION_MENU_WIDTH}
        crossAxisOffset={conversationMenu ? CONVERSATION_MENU_RIGHT_SHIFT : 0}
      >
        {conversationMenu ? (
          <>
            <DropdownMenuItem
              testID={`sidebar-project-menu-pin-${projectKey}`}
              leading={pinLeadingIcon}
              onSelect={onPinProject}
              disabled={!onPinProject}
            >
              {translateNow("ui.pin.to.top.1lvrdqa")}
            </DropdownMenuItem>
            <DropdownMenuItem
              testID={`sidebar-project-menu-share-${projectKey}`}
              leading={shareLeadingIcon}
              disabled
            >
              {translateNow("ui.share.54gkh")}
            </DropdownMenuItem>
            <DropdownMenuItem
              testID={`sidebar-project-menu-rename-${projectKey}`}
              leading={renameLeadingIcon}
              onSelect={onRenameProject}
              disabled={!onRenameProject}
            >
              {translateNow("ui.rename.14f8jfi")}
            </DropdownMenuItem>
            <DropdownMenuItem
              testID={`sidebar-project-menu-report-${projectKey}`}
              leading={reportLeadingIcon}
              disabled
            >
              {translateNow("ui.report.1tw6c3")}
            </DropdownMenuItem>
          </>
        ) : null}
        {!conversationMenu && canOpenProjectSettings ? (
          <DropdownMenuItem
            testID={`sidebar-project-menu-open-settings-${projectKey}`}
            leading={settingsLeadingIcon}
            onSelect={handleOpenProjectSettings}
          >
            {translateNow("ui.open.project.settings.ye79z4")}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          testID={`sidebar-project-menu-remove-${projectKey}`}
          leading={trash2LeadingIcon}
          status={removeProjectStatus}
          pendingLabel={translateNow("ui.removing.oue8vh")}
          onSelect={onRemoveProject}
          destructive={conversationMenu}
        >
          {conversationMenu
            ? translateNow("ui.delete.1ok3b5")
            : translateNow("ui.remove.project.ku4j31")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function WorkspaceRowRightGroup({
  workspace,
  isHovered,
  isTouchPlatform,
  showScriptsIcon,
  hasRunningService,
  isCreating,
  showShortcutBadge,
  shortcutNumber,
  archiveLabel,
  archiveStatus,
  archivePendingLabel,
  archiveShortcutKeys,
  onArchive,
  onCopyBranchName,
  onCopyPath,
  onRename,
}: {
  workspace: SidebarWorkspaceEntry;
  isHovered: boolean;
  isTouchPlatform: boolean;
  showScriptsIcon: boolean;
  hasRunningService: boolean;
  isCreating: boolean;
  showShortcutBadge: boolean;
  shortcutNumber: number | null;
  archiveLabel?: string;
  archiveStatus?: "idle" | "pending" | "success";
  archivePendingLabel?: string;
  archiveShortcutKeys?: ShortcutKey[][] | null;
  onArchive?: () => void;
  onCopyBranchName?: () => void;
  onCopyPath?: () => void;
  onRename?: () => void;
}) {
  const showKebab = Boolean(onArchive && (isHovered || isTouchPlatform));
  return (
    <View style={styles.workspaceRowRight}>
      {showScriptsIcon ? (
        <View
          testID="workspace-globe-icon"
          accessibilityLabel={translateNow("ui.scripts.available.8x55sh")}
        >
          {hasRunningService ? (
            <ThemedGlobe size={12} uniProps={blueColorMapping} />
          ) : (
            <ThemedSquareTerminal size={12} uniProps={blueColorMapping} />
          )}
        </View>
      ) : null}
      {isCreating ? (
        <Text style={styles.workspaceCreatingText}>{translateNow("ui.creating.ljb1th")}</Text>
      ) : null}
      {showKebab && onArchive ? (
        <WorkspaceKebabMenu
          workspaceKey={workspace.workspaceKey}
          onCopyPath={onCopyPath}
          onCopyBranchName={onCopyBranchName}
          onRename={onRename}
          onArchive={onArchive}
          archiveLabel={archiveLabel}
          archiveStatus={archiveStatus}
          archivePendingLabel={archivePendingLabel}
          archiveShortcutKeys={archiveShortcutKeys}
        />
      ) : null}
      {!showKebab && workspace.diffStat ? (
        <DiffStat
          additions={workspace.diffStat.additions}
          deletions={workspace.diffStat.deletions}
        />
      ) : null}
      {showShortcutBadge && shortcutNumber !== null ? (
        <View style={styles.shortcutBadge}>
          <Text style={styles.shortcutBadgeText}>{shortcutNumber}</Text>
        </View>
      ) : null}
    </View>
  );
}

function WorkspaceKebabMenu({
  workspaceKey,
  onCopyPath,
  onCopyBranchName,
  onRename,
  onArchive,
  archiveLabel,
  archiveStatus,
  archivePendingLabel,
  archiveShortcutKeys,
}: {
  workspaceKey: string;
  onCopyPath?: () => void;
  onCopyBranchName?: () => void;
  onRename?: () => void;
  onArchive: () => void;
  archiveLabel?: string;
  archiveStatus?: "idle" | "pending" | "success";
  archivePendingLabel?: string;
  archiveShortcutKeys?: ShortcutKey[][] | null;
}) {
  const archiveTrailing = useMemo(
    () => (archiveShortcutKeys ? <Shortcut chord={archiveShortcutKeys} /> : null),
    [archiveShortcutKeys],
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        hitSlop={8}
        style={workspaceKebabStyle}
        accessibilityRole={platformIsWeb ? undefined : "button"}
        accessibilityLabel={translateNow("ui.workspace.actions.hgggnm")}
        testID={`sidebar-workspace-kebab-${workspaceKey}`}
      >
        {renderKebabTriggerIcon}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" width={260}>
        {onCopyPath ? (
          <DropdownMenuItem
            testID={`sidebar-workspace-menu-copy-path-${workspaceKey}`}
            leading={copyLeadingIcon}
            onSelect={onCopyPath}
          >
            {translateNow("ui.copy.path.1l2u0uo")}
          </DropdownMenuItem>
        ) : null}
        {onCopyBranchName ? (
          <DropdownMenuItem
            testID={`sidebar-workspace-menu-copy-branch-name-${workspaceKey}`}
            leading={copyLeadingIcon}
            onSelect={onCopyBranchName}
          >
            {translateNow("ui.copy.branch.name.iu31vi")}
          </DropdownMenuItem>
        ) : null}
        {onRename ? (
          <DropdownMenuItem
            testID={`sidebar-workspace-menu-rename-${workspaceKey}`}
            leading={renameLeadingIcon}
            onSelect={onRename}
          >
            {translateNow("ui.rename.workspace.1uz145v")}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          testID={`sidebar-workspace-menu-archive-${workspaceKey}`}
          leading={archiveLeadingIcon}
          trailing={archiveTrailing}
          status={archiveStatus}
          pendingLabel={archivePendingLabel}
          onSelect={onArchive}
        >
          {archiveLabel ?? "Archive"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ProjectIcon({
  iconDataUri,
  placeholderInitial,
  projectKey,
  conversationVisual = false,
}: {
  iconDataUri: string | null;
  placeholderInitial: string;
  projectKey: string;
  conversationVisual?: boolean;
}) {
  if (conversationVisual) {
    return (
      <View style={styles.conversationProjectIconFrame}>
        <ConversationBubbleIcon color={styles.conversationProjectIcon.color} />
      </View>
    );
  }

  return (
    <ProjectIconView
      iconDataUri={iconDataUri}
      initial={placeholderInitial}
      projectKey={projectKey}
      imageStyle={styles.projectIcon}
      fallbackStyle={styles.projectIconFallback}
      textStyle={styles.projectIconFallbackText}
    />
  );
}

function ProjectLeadingVisualStatus({
  iconDataUri,
  placeholderInitial,
  projectKey,
  conversationVisual = false,
  isArchiving,
  shouldShowSyncedLoader,
  activeWorkspace,
}: {
  iconDataUri: string | null;
  placeholderInitial: string;
  projectKey: string;
  conversationVisual?: boolean;
  isArchiving: boolean;
  shouldShowSyncedLoader: boolean;
  activeWorkspace: SidebarWorkspaceEntry;
}) {
  if (isArchiving) {
    return (
      <View style={styles.projectLeadingVisualSlot}>
        <ThemedActivityIndicator size={8} uniProps={foregroundMutedColorMapping} />
      </View>
    );
  }

  if (shouldShowSyncedLoader) {
    return (
      <View style={styles.projectLeadingVisualSlot}>
        <ThemedSyncedLoader size={11} uniProps={syncedLoaderColorMapping} />
      </View>
    );
  }

  if (activeWorkspace.statusBucket === "needs_input") {
    return (
      <View style={styles.projectLeadingVisualSlot}>
        <ThemedCircleAlert size={14} uniProps={amberColorMapping} />
      </View>
    );
  }

  const dotColorStyle = getStatusDotColorStyle(activeWorkspace.statusBucket);
  const statusDotSize = isEmphasizedStatusDotBucket(activeWorkspace.statusBucket)
    ? EMPHASIZED_STATUS_DOT_SIZE
    : DEFAULT_STATUS_DOT_SIZE;
  const statusDotOffset =
    statusDotSize === EMPHASIZED_STATUS_DOT_SIZE
      ? EMPHASIZED_STATUS_DOT_OFFSET
      : DEFAULT_STATUS_DOT_OFFSET;

  return (
    <View style={styles.projectLeadingVisualSlot}>
      <ProjectIcon
        iconDataUri={iconDataUri}
        placeholderInitial={placeholderInitial}
        projectKey={projectKey}
        conversationVisual={conversationVisual}
      />
      {dotColorStyle ? (
        <StatusDotOverlay
          dotColorStyle={dotColorStyle}
          size={statusDotSize}
          offset={statusDotOffset}
        />
      ) : null}
    </View>
  );
}

function ProjectInlineChevron({ chevron }: { chevron: "expand" | "collapse" | null }) {
  if (chevron === null) {
    return null;
  }
  if (chevron === "collapse") {
    return <ChevronDown size={14} color="#9ca3af" />;
  }
  return <ChevronRight size={14} color="#9ca3af" />;
}

function NewWorktreeButton({
  displayName,
  onPress,
  visible,
  loading = false,
  testID,
  showShortcutHint = false,
}: {
  displayName: string;
  onPress: () => void;
  visible: boolean;
  loading?: boolean;
  testID: string;
  showShortcutHint?: boolean;
}) {
  const newWorktreeKeys = useShortcutKeys("new-worktree");

  const pressableStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.projectIconActionButton,
      !visible && styles.projectIconActionButtonHidden,
      (Boolean(hovered) || pressed) && !loading && styles.projectIconActionButtonHovered,
    ],
    [visible, loading],
  );

  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      onPress();
    },
    [onPress],
  );

  return (
    <View style={styles.projectTrailingControlSlot} pointerEvents={visible ? "auto" : "none"}>
      <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger asChild disabled={!visible}>
          <Pressable
            style={pressableStyle}
            onPress={handlePress}
            disabled={loading}
            accessibilityRole={platformIsWeb ? undefined : "button"}
            accessibilityLabel={translateNow("ui.create.workspace.for.accessibility", {
              name: displayName,
            })}
            testID={testID}
          >
            {({ hovered, pressed }) =>
              loading ? (
                <ThemedActivityIndicator size={14} uniProps={foregroundMutedColorMapping} />
              ) : (
                <ThemedFolderPlus
                  size={15}
                  uniProps={
                    hovered || pressed ? foregroundColorMapping : foregroundMutedColorMapping
                  }
                />
              )
            }
          </Pressable>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="center" offset={8}>
          <View style={styles.projectActionTooltipRow}>
            <Text style={styles.projectActionTooltipText}>
              {translateNow("ui.new.workspace.1enuqr9")}
            </Text>
            {showShortcutHint && newWorktreeKeys ? (
              <Shortcut chord={newWorktreeKeys} style={styles.projectActionTooltipShortcut} />
            ) : null}
          </View>
        </TooltipContent>
      </Tooltip>
    </View>
  );
}

function useLongPressDragInteraction(input: {
  drag: () => void;
  menuController: ReturnType<typeof useContextMenu> | null;
}) {
  const didLongPressRef = useRef(false);
  const dragArmedRef = useRef(false);
  const dragActivatedRef = useRef(false);
  const didStartDragRef = useRef(false);
  const scrollIntentRef = useRef(false);
  const menuOpenedRef = useRef(false);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const touchCurrentRef = useRef<{ x: number; y: number } | null>(null);
  const dragArmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contextMenuTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (dragArmTimerRef.current) {
      clearTimeout(dragArmTimerRef.current);
      dragArmTimerRef.current = null;
    }
    if (contextMenuTimerRef.current) {
      clearTimeout(contextMenuTimerRef.current);
      contextMenuTimerRef.current = null;
    }
  }, []);

  const openContextMenuAtStartPoint = useCallback(() => {
    if (!input.menuController || !touchStartRef.current) {
      return;
    }
    const statusBarHeight = Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) : 0;
    input.menuController.setAnchorRect({
      x: touchStartRef.current.x,
      y: touchStartRef.current.y + statusBarHeight,
      width: 0,
      height: 0,
    });
    input.menuController.setOpen(true);
    menuOpenedRef.current = true;
    didLongPressRef.current = true;
  }, [input.menuController]);

  const handleLongPress = useCallback(() => {
    // Manual timers own long-press behavior on mobile.
  }, []);

  useEffect(() => {
    return () => {
      clearTimers();
    };
  }, [clearTimers]);

  const armTimers = useCallback(() => {
    clearTimers();

    const DRAG_ARM_DELAY_MS = 180;
    const DRAG_ARM_STATIONARY_SLOP_PX = 4;
    const CONTEXT_MENU_DELAY_MS = 450;
    const CONTEXT_MENU_STATIONARY_SLOP_PX = 6;

    dragArmTimerRef.current = setTimeout(() => {
      if (scrollIntentRef.current || didStartDragRef.current || menuOpenedRef.current) {
        return;
      }
      const start = touchStartRef.current;
      const current = touchCurrentRef.current ?? start;
      if (!start || !current) {
        return;
      }
      const dx = current.x - start.x;
      const dy = current.y - start.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance > DRAG_ARM_STATIONARY_SLOP_PX) {
        return;
      }
      dragArmedRef.current = true;
      dragActivatedRef.current = true;
      didLongPressRef.current = true;
      void Haptics.selectionAsync().catch(() => {});
      input.drag();
    }, DRAG_ARM_DELAY_MS);

    if (!input.menuController || platformIsWeb) {
      return;
    }

    contextMenuTimerRef.current = setTimeout(() => {
      if (scrollIntentRef.current || didStartDragRef.current || menuOpenedRef.current) {
        return;
      }
      const start = touchStartRef.current;
      const current = touchCurrentRef.current ?? start;
      if (!start || !current) {
        return;
      }
      const dx = current.x - start.x;
      const dy = current.y - start.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance > CONTEXT_MENU_STATIONARY_SLOP_PX) {
        return;
      }
      void Haptics.selectionAsync().catch(() => {});
      openContextMenuAtStartPoint();
    }, CONTEXT_MENU_DELAY_MS);
  }, [clearTimers, input, openContextMenuAtStartPoint]);

  const handleDragIntent = useCallback(
    (_details: { dx: number; dy: number; distance: number }) => {
      if (!dragActivatedRef.current) {
        return;
      }
      didStartDragRef.current = true;
      didLongPressRef.current = true;
      clearTimers();
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    },
    [clearTimers],
  );

  const handleScrollIntent = useCallback(
    (_details: { dx: number; dy: number; distance: number }) => {
      scrollIntentRef.current = true;
      didLongPressRef.current = true;
      clearTimers();
    },
    [clearTimers],
  );

  const handleSwipeIntent = useCallback(
    (_details: { dx: number; dy: number; distance: number }) => {
      didLongPressRef.current = true;
      clearTimers();
    },
    [clearTimers],
  );

  const handlePressIn = useCallback(
    (event: GestureResponderEvent) => {
      didLongPressRef.current = false;
      dragArmedRef.current = false;
      dragActivatedRef.current = false;
      didStartDragRef.current = false;
      scrollIntentRef.current = false;
      menuOpenedRef.current = false;
      touchStartRef.current = {
        x: event.nativeEvent.pageX,
        y: event.nativeEvent.pageY,
      };
      touchCurrentRef.current = {
        x: event.nativeEvent.pageX,
        y: event.nativeEvent.pageY,
      };
      armTimers();
    },
    [armTimers],
  );

  const handleTouchMove = useCallback(
    (event: GestureResponderEvent) => {
      const start = touchStartRef.current;
      if (!start || didStartDragRef.current || menuOpenedRef.current) {
        return;
      }

      const touch = event?.nativeEvent?.touches?.[0] ?? event?.nativeEvent;
      const x = touch?.pageX;
      const y = touch?.pageY;
      if (typeof x !== "number" || typeof y !== "number") {
        return;
      }

      const current = { x, y };
      touchCurrentRef.current = current;
      const dx = current.x - start.x;
      const dy = current.y - start.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const decision = decideLongPressMove({
        dragArmed: dragArmedRef.current,
        didStartDrag: didStartDragRef.current,
        startPoint: start,
        currentPoint: current,
      });

      if (decision === "vertical_scroll") {
        handleScrollIntent({ dx, dy, distance });
        return;
      }

      if (decision === "horizontal_swipe" || decision === "cancel_long_press") {
        handleSwipeIntent({ dx, dy, distance });
        return;
      }

      if (decision === "start_drag") {
        handleDragIntent({ dx, dy, distance });
      }
    },
    [handleDragIntent, handleScrollIntent, handleSwipeIntent],
  );

  const handlePressOut = useCallback(() => {
    clearTimers();
    dragArmedRef.current = false;
    dragActivatedRef.current = false;
    touchStartRef.current = null;
    touchCurrentRef.current = null;
  }, [clearTimers]);

  return {
    didLongPressRef,
    handleLongPress,
    handlePressIn,
    handleTouchMove,
    handlePressOut,
  };
}

function ProjectHeaderRow({
  project,
  displayName,
  iconDataUri,
  workspace,
  conversationVisual = false,
  selected = false,
  chevron,
  onPress,
  serverId,
  canCreateWorktree,
  isProjectActive = false,
  onWorkspacePress,
  onWorktreeCreated: _onWorktreeCreated,
  onPinProject,
  onRenameProject,
  shortcutNumber = null,
  showShortcutBadge = false,
  drag,
  isDragging,
  isArchiving = false,
  menuController,
  onRemoveProject,
  removeProjectStatus = "idle",
  dragHandleProps,
  activeAgentRoute,
}: ProjectHeaderRowProps) {
  const [isHovered, setIsHovered] = useState(false);
  const isMobileBreakpoint = useIsCompactFormFactor();
  const controlSessionTabPresentation = useControlSessionTabPresentation({
    project,
    selected,
    activeAgentRoute: normalizeActiveAgentRoute(activeAgentRoute),
  });
  const handleBeginWorkspaceSetup = useCallback(() => {
    if (!serverId) {
      return;
    }
    router.navigate(
      buildHostNewWorkspaceRoute(serverId, project.iconWorkingDir, {
        displayName,
        projectId: project.projectKey,
      }) as Href,
    );
    onWorkspacePress?.();
  }, [displayName, onWorkspacePress, project.iconWorkingDir, project.projectKey, serverId]);
  const interaction = useLongPressDragInteraction({
    drag,
    menuController,
  });
  const {
    role: _dragRole,
    tabIndex: _dragTabIndex,
    "aria-roledescription": _dragRoleDescription,
    ...dragAttributes
  } = dragHandleProps?.attributes ?? {};

  const handlePress = useCallback(() => {
    if (interaction.didLongPressRef.current) {
      interaction.didLongPressRef.current = false;
      return;
    }
    onPress();
  }, [interaction.didLongPressRef, onPress]);

  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);

  const projectRowStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.projectRow,
      conversationVisual && styles.conversationProjectRow,
      isDragging && styles.projectRowDragging,
      selected && styles.sidebarRowSelected,
      conversationVisual && selected && styles.conversationProjectRowSelected,
      isHovered && styles.projectRowHovered,
      conversationVisual && isHovered && styles.conversationProjectRowHovered,
      pressed && styles.projectRowPressed,
    ],
    [conversationVisual, isDragging, selected, isHovered],
  );

  const projectRowBaseStyle = useMemo(
    () => getProjectRowBaseStyle({ isDragging, selected, isHovered, conversationVisual }),
    [conversationVisual, isDragging, selected, isHovered],
  );

  const projectRowLeftContent = (
    <View style={styles.projectRowLeft}>
      <ProjectLeadingVisual
        displayName={displayName}
        iconDataUri={iconDataUri}
        workspace={workspace}
        projectKey={project.projectKey}
        tabPresentation={controlSessionTabPresentation}
        conversationVisual={conversationVisual}
        chevron={chevron}
        showChevron={isHovered && chevron !== null}
        isArchiving={isArchiving}
      />

      <View style={styles.projectTitleGroup}>
        <Text
          style={conversationVisual ? styles.conversationProjectTitle : styles.projectTitle}
          numberOfLines={1}
        >
          {displayName}
        </Text>
      </View>
    </View>
  );

  const projectRowTrailingActions = (
    <ProjectRowTrailingActions
      project={project}
      displayName={displayName}
      canCreateWorktree={canCreateWorktree}
      isHovered={isHovered}
      isMobileBreakpoint={isMobileBreakpoint}
      isProjectActive={isProjectActive}
      conversationMenu={conversationVisual}
      onBeginWorkspaceSetup={handleBeginWorkspaceSetup}
      onPinProject={onPinProject}
      onRenameProject={onRenameProject}
      onRemoveProject={onRemoveProject}
      removeProjectStatus={removeProjectStatus}
    />
  );

  const shortcutBadge = (
    <ProjectShortcutBadge show={showShortcutBadge} shortcutNumber={shortcutNumber} />
  );

  const rowChildren = (
    <>
      {projectRowLeftContent}
      {projectRowTrailingActions}
      {shortcutBadge}
    </>
  );

  if (conversationVisual) {
    return (
      <View
        {...dragAttributes}
        {...dragHandleProps?.listeners}
        ref={dragHandleProps?.setActivatorNodeRef as unknown as Ref<View>}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
        style={projectRowBaseStyle}
      >
        <Pressable
          accessibilityRole="button"
          style={styles.conversationProjectPressable}
          onPressIn={interaction.handlePressIn}
          onTouchMove={interaction.handleTouchMove}
          onPressOut={interaction.handlePressOut}
          onPress={handlePress}
          testID={`sidebar-project-row-${project.projectKey}`}
        >
          {projectRowLeftContent}
        </Pressable>
        {projectRowTrailingActions}
        {shortcutBadge}
      </View>
    );
  }

  if (menuController) {
    return (
      <View
        {...dragAttributes}
        {...dragHandleProps?.listeners}
        ref={dragHandleProps?.setActivatorNodeRef as unknown as Ref<View>}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
      >
        <ContextMenuTrigger
          enabledOnMobile={false}
          accessibilityRole="button"
          style={projectRowStyle}
          onPressIn={interaction.handlePressIn}
          onTouchMove={interaction.handleTouchMove}
          onPressOut={interaction.handlePressOut}
          onPress={handlePress}
          testID={`sidebar-project-row-${project.projectKey}`}
        >
          {rowChildren}
        </ContextMenuTrigger>
      </View>
    );
  }

  return (
    <View
      {...dragAttributes}
      {...dragHandleProps?.listeners}
      ref={dragHandleProps?.setActivatorNodeRef as unknown as Ref<View>}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <Pressable
        accessibilityRole="button"
        style={projectRowStyle}
        onPressIn={interaction.handlePressIn}
        onTouchMove={interaction.handleTouchMove}
        onPressOut={interaction.handlePressOut}
        onPress={handlePress}
        testID={`sidebar-project-row-${project.projectKey}`}
      >
        {rowChildren}
      </Pressable>
    </View>
  );
}

function WorkspaceRowInner({
  workspace,
  selected,
  shortcutNumber,
  showShortcutBadge,
  onPress,
  drag,
  isDragging,
  isArchiving,
  isCreating = false,
  dragHandleProps,
  menuController,
  archiveLabel,
  archiveStatus = "idle",
  archivePendingLabel,
  onArchive,
  onCopyBranchName,
  onCopyPath,
  onRename,
  archiveShortcutKeys,
}: WorkspaceRowInnerProps) {
  const _isCompact = useIsCompactFormFactor();
  const [isHovered, setIsHovered] = useState(false);
  const isTouchPlatform = platformIsNative;
  const prHint = workspace.prHint;
  const interaction = useLongPressDragInteraction({
    drag,
    menuController,
  });
  const {
    role: _dragRole,
    tabIndex: _dragTabIndex,
    "aria-roledescription": _dragRoleDescription,
    ...dragAttributes
  } = dragHandleProps?.attributes ?? {};

  const handlePress = useCallback(() => {
    if (interaction.didLongPressRef.current) {
      interaction.didLongPressRef.current = false;
      return;
    }
    onPress();
  }, [interaction.didLongPressRef, onPress]);

  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);

  const workspaceRowStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.workspaceRow,
      isDragging && styles.workspaceRowDragging,
      selected && styles.sidebarRowSelected,
      isHovered && styles.workspaceRowHovered,
      pressed && styles.workspaceRowPressed,
    ],
    [isDragging, selected, isHovered],
  );

  const isDesktop = !isTouchPlatform;
  const showScriptsIcon = isDesktop && workspace.hasRunningScripts;
  const hasRunningService = workspace.scripts.some(
    (s) => s.lifecycle === "running" && (s.type ?? "service") === "service",
  );

  const accessibilityState = useMemo(() => ({ selected }), [selected]);
  const workspaceBranchTextStyle = useMemo(
    () => [
      styles.workspaceBranchText,
      isHovered && styles.workspaceBranchTextHovered,
      isCreating && styles.workspaceBranchTextCreating,
    ],
    [isHovered, isCreating],
  );
  return (
    <WorkspaceHoverCard workspace={workspace} prHint={prHint} isDragging={isDragging}>
      <View
        {...dragAttributes}
        {...dragHandleProps?.listeners}
        ref={dragHandleProps?.setActivatorNodeRef as unknown as Ref<View>}
        style={styles.workspaceRowContainer}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
      >
        <Pressable
          disabled={isArchiving}
          aria-selected={selected}
          accessibilityRole="button"
          accessibilityState={accessibilityState}
          style={workspaceRowStyle}
          onPressIn={interaction.handlePressIn}
          onTouchMove={interaction.handleTouchMove}
          onPressOut={interaction.handlePressOut}
          onPress={handlePress}
          testID={`sidebar-workspace-row-${workspace.workspaceKey}`}
        >
          <View style={styles.workspaceRowMain}>
            <View style={styles.workspaceRowLeft}>
              <WorkspaceStatusIndicator
                bucket={workspace.statusBucket}
                workspaceKind={workspace.workspaceKind}
                loading={isArchiving || isCreating}
              />
              <Text style={workspaceBranchTextStyle} numberOfLines={1}>
                {workspace.name}
              </Text>
            </View>
            <WorkspaceRowRightGroup
              workspace={workspace}
              isHovered={isHovered}
              isTouchPlatform={isTouchPlatform}
              showScriptsIcon={showScriptsIcon}
              hasRunningService={hasRunningService}
              isCreating={isCreating}
              showShortcutBadge={showShortcutBadge}
              shortcutNumber={shortcutNumber}
              archiveLabel={archiveLabel}
              archiveStatus={archiveStatus}
              archivePendingLabel={archivePendingLabel}
              archiveShortcutKeys={archiveShortcutKeys}
              onArchive={onArchive}
              onCopyBranchName={onCopyBranchName}
              onCopyPath={onCopyPath}
              onRename={onRename}
            />
          </View>
          {prHint ? (
            <View style={styles.workspacePrBadgeRow}>
              <PrBadge hint={prHint} />
              <ChecksBadge checks={prHint.checks} />
            </View>
          ) : null}
        </Pressable>
      </View>
    </WorkspaceHoverCard>
  );
}

function WorkspaceRowWithMenu({
  workspace,
  selected,
  shortcutNumber,
  showShortcutBadge,
  onPress,
  drag,
  isDragging,
  dragHandleProps,
  canCopyBranchName,
  isCreating = false,
}: {
  workspace: SidebarWorkspaceEntry;
  selected: boolean;
  shortcutNumber: number | null;
  showShortcutBadge: boolean;
  onPress: () => void;
  drag: () => void;
  isDragging: boolean;
  dragHandleProps?: DraggableListDragHandleProps;
  canCopyBranchName: boolean;
  isCreating?: boolean;
}) {
  const toast = useToast();
  const archiveWorktree = useCheckoutGitActionsStore((state) => state.archiveWorktree);
  const queryClient = useQueryClient();
  const [isArchivingWorkspace, setIsArchivingWorkspace] = useState(false);
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const workspaceDirectory = resolveWorkspaceExecutionDirectory({
    workspaceDirectory: workspace.workspaceDirectory,
  });
  const archiveStatus = useCheckoutGitActionsStore((state) =>
    workspaceDirectory
      ? state.getStatus({
          serverId: workspace.serverId,
          cwd: workspaceDirectory,
          actionId: "archive-worktree",
        })
      : "idle",
  );
  const isWorktree = workspace.workspaceKind === "worktree";
  const isArchiving = isWorktree ? workspace.archivingAt !== null : isArchivingWorkspace;
  const redirectAfterArchive = useCallback(() => {
    redirectIfArchivingActiveWorkspace({
      serverId: workspace.serverId,
      workspaceId: workspace.workspaceId,
      activeWorkspaceSelection: selectionForSelectedWorkspace(selected, workspace),
    });
  }, [selected, workspace]);

  const archiveWorktreeAfterConfirmation = useCallback(async () => {
    if (isArchiving) {
      return;
    }

    const confirmed = await confirmRiskyWorktreeArchive({
      worktreeName: workspace.name,
      isDirty: workspace.archiveHasUncommittedChanges,
      aheadOfOrigin: workspace.archiveUnpushedCommitCount,
      diffStat: workspace.diffStat,
    });

    if (!confirmed) {
      return;
    }
    let archiveDirectory: string;
    try {
      archiveDirectory = requireWorkspaceExecutionDirectory({
        workspaceId: workspace.workspaceId,
        workspaceDirectory: workspace.workspaceDirectory,
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : translateNow("ui.workspace.path.not.available"),
      );
      return;
    }

    if (!archiveDirectory) {
      toast.error(translateNow("ui.workspace.path.not.available"));
      return;
    }

    redirectAfterArchive();

    void archiveWorktree({
      serverId: workspace.serverId,
      cwd: archiveDirectory,
      worktreePath: archiveDirectory,
    }).catch((error) => {
      const message =
        error instanceof Error ? error.message : translateNow("ui.failed.to.archive.worktree");
      toast.error(message);
    });
  }, [archiveWorktree, isArchiving, redirectAfterArchive, toast, workspace]);

  const handleArchiveWorktree = useCallback(() => {
    void archiveWorktreeAfterConfirmation();
  }, [archiveWorktreeAfterConfirmation]);

  const hideWorkspaceAfterConfirmation = useCallback(async () => {
    if (isArchivingWorkspace) {
      return;
    }

    const confirmed = await confirmDialog({
      title: translateNow("ui.hide.workspace.1g07360"),
      message: translateNow("ui.hide.workspace.from.sidebar.message", { name: workspace.name }),
      confirmLabel: translateNow("ui.hide.1c7du"),
      cancelLabel: translateNow("ui.cancel.x9d2fu"),
      destructive: true,
    });
    if (!confirmed) {
      return;
    }

    const client = getHostRuntimeStore().getClient(workspace.serverId);
    if (!client) {
      toast.error(translateNow("ui.host.is.not.connected.n90cm6"));
      return;
    }

    setIsArchivingWorkspace(true);
    try {
      await archiveWorkspaceOptimistically({
        client,
        workspace,
        afterHide: redirectAfterArchive,
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : translateNow("ui.failed.to.hide.workspace"),
      );
    } finally {
      setIsArchivingWorkspace(false);
    }
  }, [isArchivingWorkspace, redirectAfterArchive, toast, workspace]);

  const handleArchiveWorkspace = useCallback(() => {
    void hideWorkspaceAfterConfirmation();
  }, [hideWorkspaceAfterConfirmation]);

  const handleCopyPath = useCallback(() => {
    let copyTargetDirectory: string;
    try {
      copyTargetDirectory = requireWorkspaceExecutionDirectory({
        workspaceId: workspace.workspaceId,
        workspaceDirectory: workspace.workspaceDirectory,
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : translateNow("ui.workspace.path.not.available"),
      );
      return;
    }
    void Clipboard.setStringAsync(copyTargetDirectory);
    toast.copied(translateNow("ui.path.copied"));
  }, [toast, workspace.workspaceDirectory, workspace.workspaceId]);

  const handleCopyBranchName = useCallback(() => {
    void Clipboard.setStringAsync(workspace.name);
    toast.copied(translateNow("ui.branch.name.copied"));
  }, [toast, workspace.name]);

  const renameMutation = useMutation({
    mutationFn: async (branch: string) => {
      const client = getHostRuntimeStore().getClient(workspace.serverId);
      if (!client) {
        throw new Error(translateNow("ui.host.is.not.connected.n90cm6"));
      }
      const targetCwd = requireWorkspaceExecutionDirectory({
        workspaceId: workspace.workspaceId,
        workspaceDirectory: workspace.workspaceDirectory,
      });
      const payload = await client.renameBranch({ cwd: targetCwd, branch });
      if (!payload.success || payload.error) {
        throw new Error(payload.error?.message ?? "Failed to rename branch");
      }
      return { targetCwd };
    },
    onSuccess: async ({ targetCwd }) => {
      await invalidateCheckoutGitQueriesForClient(queryClient, {
        serverId: workspace.serverId,
        cwd: targetCwd,
      });
    },
  });

  const handleOpenRename = useCallback(() => {
    setIsRenameOpen(true);
  }, []);

  const handleCloseRename = useCallback(() => {
    setIsRenameOpen(false);
  }, []);

  const handleSubmitRename = useCallback(
    async (value: string) => {
      await renameMutation.mutateAsync(slugify(value));
    },
    [renameMutation],
  );

  const validateRenameSlug = useCallback((value: string): string | null => {
    const result = validateBranchSlug(slugify(value));
    if (result.valid) return null;
    return result.error ?? "Invalid branch name";
  }, []);

  const archiveShortcutKeys = useShortcutKeys("archive-worktree");

  useKeyboardActionHandler({
    handlerId: `worktree-archive-${workspace.workspaceKey}`,
    actions: ["worktree.archive"],
    enabled: selected && !isArchiving,
    priority: 0,
    handle: () => {
      if (isWorktree) {
        void archiveWorktreeAfterConfirmation();
      } else {
        handleArchiveWorkspace();
      }
      return true;
    },
  });

  return (
    <>
      <WorkspaceRowInner
        workspace={workspace}
        selected={selected}
        shortcutNumber={shortcutNumber}
        showShortcutBadge={showShortcutBadge}
        onPress={onPress}
        drag={drag}
        isDragging={isDragging}
        isArchiving={isArchiving}
        isCreating={isCreating}
        dragHandleProps={dragHandleProps}
        menuController={null}
        archiveLabel={
          isWorktree
            ? translateNow("ui.archive.worktree")
            : translateNow("ui.hide.from.sidebar.8nzcv8")
        }
        archiveStatus={getWorkspaceArchiveStatus(isWorktree, archiveStatus, isArchivingWorkspace)}
        archivePendingLabel={isWorktree ? "Archiving..." : "Hiding..."}
        onArchive={isWorktree ? handleArchiveWorktree : handleArchiveWorkspace}
        onCopyBranchName={canCopyBranchName ? handleCopyBranchName : undefined}
        onCopyPath={handleCopyPath}
        onRename={canCopyBranchName ? handleOpenRename : undefined}
        archiveShortcutKeys={selected ? archiveShortcutKeys : null}
      />
      <AdaptiveRenameModal
        visible={isRenameOpen}
        title={translateNow("ui.rename.workspace.1uz145v")}
        initialValue={workspace.name}
        placeholder={translateNow("ui.branch.name.1hv0b86")}
        submitLabel={translateNow("ui.rename.14f8jfi")}
        validate={validateRenameSlug}
        maxLength={MAX_SLUG_LENGTH}
        onClose={handleCloseRename}
        onSubmit={handleSubmitRename}
        testID={`sidebar-workspace-rename-modal-${workspace.workspaceKey}`}
      />
    </>
  );
}

function NonGitProjectRowWithMenuContent({
  project,
  displayName,
  iconDataUri,
  workspace,
  conversationVisual,
  selected,
  onPress,
  shortcutNumber,
  showShortcutBadge,
  drag,
  isDragging,
  dragHandleProps,
  onPinProject,
  onRenameProject,
}: {
  project: SidebarProjectEntry;
  displayName: string;
  iconDataUri: string | null;
  workspace: SidebarWorkspaceEntry;
  conversationVisual: boolean;
  selected: boolean;
  onPress: () => void;
  shortcutNumber: number | null;
  showShortcutBadge: boolean;
  drag: () => void;
  isDragging: boolean;
  dragHandleProps?: DraggableListDragHandleProps;
  onPinProject?: () => void;
  onRenameProject?: () => void;
}) {
  const toast = useToast();
  const contextMenu = useContextMenu();
  const [isArchivingWorkspace, setIsArchivingWorkspace] = useState(false);
  const redirectAfterArchive = useCallback(() => {
    redirectIfArchivingActiveWorkspace({
      serverId: workspace.serverId,
      workspaceId: workspace.workspaceId,
      activeWorkspaceSelection: selectionForSelectedWorkspace(selected, workspace),
    });
  }, [selected, workspace]);

  const handleArchiveWorkspace = useCallback(() => {
    if (isArchivingWorkspace) {
      return;
    }

    void (async () => {
      const confirmed = await confirmDialog({
        title: translateNow("ui.hide.workspace.1g07360"),
        message: translateNow("ui.hide.workspace.from.sidebar.message", { name: workspace.name }),
        confirmLabel: translateNow("ui.hide.1c7du"),
        cancelLabel: translateNow("ui.cancel.x9d2fu"),
        destructive: true,
      });
      if (!confirmed) {
        return;
      }

      const client = getHostRuntimeStore().getClient(workspace.serverId);
      if (!client) {
        toast.error(translateNow("ui.host.is.not.connected.n90cm6"));
        return;
      }

      setIsArchivingWorkspace(true);
      void (async () => {
        try {
          await archiveWorkspaceOptimistically({
            client,
            workspace,
            afterHide: redirectAfterArchive,
          });
        } catch (error) {
          toast.error(
            error instanceof Error ? error.message : translateNow("ui.failed.to.hide.workspace"),
          );
        } finally {
          setIsArchivingWorkspace(false);
        }
      })();
    })();
  }, [isArchivingWorkspace, redirectAfterArchive, toast, workspace]);

  return (
    <>
      <ProjectHeaderRow
        project={project}
        displayName={displayName}
        iconDataUri={iconDataUri}
        workspace={workspace}
        conversationVisual={conversationVisual}
        selected={selected}
        chevron={null}
        onPress={onPress}
        serverId={null}
        canCreateWorktree={false}
        shortcutNumber={shortcutNumber}
        showShortcutBadge={showShortcutBadge}
        drag={drag}
        isDragging={isDragging}
        isArchiving={isArchivingWorkspace}
        menuController={contextMenu}
        onPinProject={onPinProject}
        onRenameProject={onRenameProject}
        dragHandleProps={dragHandleProps}
      />
      <ContextMenuContent
        align="start"
        width={220}
        mobileMode="sheet"
        testID={`sidebar-workspace-context-${workspace.workspaceKey}`}
      >
        <ContextMenuItem
          testID={`sidebar-workspace-context-${workspace.workspaceKey}-archive`}
          status={isArchivingWorkspace ? "pending" : "idle"}
          pendingLabel={translateNow("ui.hiding.1ddj78v")}
          destructive
          onSelect={handleArchiveWorkspace}
        >
          {translateNow("ui.hide.from.sidebar.8nzcv8")}
        </ContextMenuItem>
      </ContextMenuContent>
    </>
  );
}

function NonGitProjectRowWithMenu(props: {
  project: SidebarProjectEntry;
  displayName: string;
  iconDataUri: string | null;
  workspace: SidebarWorkspaceEntry;
  conversationVisual: boolean;
  selected: boolean;
  onPress: () => void;
  shortcutNumber: number | null;
  showShortcutBadge: boolean;
  drag: () => void;
  isDragging: boolean;
  dragHandleProps?: DraggableListDragHandleProps;
  onPinProject?: () => void;
  onRenameProject?: () => void;
}) {
  return (
    <ContextMenu>
      <NonGitProjectRowWithMenuContent {...props} />
    </ContextMenu>
  );
}

function FlattenedProjectRow({
  project,
  displayName,
  iconDataUri,
  conversationVisual,
  rowModel,
  onPress,
  serverId,
  onWorkspacePress,
  onWorktreeCreated,
  onPinProject,
  onRenameProject,
  shortcutNumber,
  showShortcutBadge,
  drag,
  isDragging,
  dragHandleProps,
  isProjectActive = false,
  onRemoveProject,
  removeProjectStatus,
  selectionEnabled,
  activeWorkspaceSelection,
}: {
  project: SidebarProjectEntry;
  displayName: string;
  iconDataUri: string | null;
  conversationVisual: boolean;
  rowModel: Extract<ReturnType<typeof buildSidebarProjectRowModel>, { kind: "workspace_link" }>;
  onPress: () => void;
  serverId: string | null;
  onWorkspacePress?: () => void;
  onWorktreeCreated?: (workspaceId: string) => void;
  onPinProject?: () => void;
  onRenameProject?: () => void;
  shortcutNumber: number | null;
  showShortcutBadge: boolean;
  drag: () => void;
  isDragging: boolean;
  dragHandleProps?: DraggableListDragHandleProps;
  isProjectActive?: boolean;
  onRemoveProject?: () => void;
  removeProjectStatus?: "idle" | "pending";
  selectionEnabled: boolean;
  activeWorkspaceSelection: ActiveWorkspaceSelection | null;
}) {
  const workspace = useSidebarWorkspaceEntry(serverId, rowModel.workspace.workspaceId);
  const selected = isWorkspaceSelected({
    selection: activeWorkspaceSelection,
    serverId,
    workspaceId: rowModel.workspace.workspaceId,
    enabled: selectionEnabled,
  });

  if (!workspace) {
    return null;
  }

  if (project.projectKind === "directory" && !conversationVisual) {
    return (
      <NonGitProjectRowWithMenu
        project={project}
        displayName={displayName}
        iconDataUri={iconDataUri}
        workspace={workspace}
        conversationVisual={conversationVisual}
        selected={selected}
        onPress={onPress}
        shortcutNumber={shortcutNumber}
        showShortcutBadge={showShortcutBadge}
        drag={drag}
        isDragging={isDragging}
        dragHandleProps={dragHandleProps}
        onPinProject={onPinProject}
        onRenameProject={onRenameProject}
      />
    );
  }

  return (
    <ProjectHeaderRow
      project={project}
      displayName={displayName}
      iconDataUri={iconDataUri}
      workspace={workspace}
      conversationVisual={conversationVisual}
      selected={selected}
      chevron={rowModel.chevron}
      onPress={onPress}
      serverId={serverId}
      canCreateWorktree={rowModel.trailingAction === "new_worktree"}
      isProjectActive={isProjectActive}
      onWorkspacePress={onWorkspacePress}
      onWorktreeCreated={onWorktreeCreated}
      onPinProject={onPinProject}
      onRenameProject={onRenameProject}
      shortcutNumber={shortcutNumber}
      showShortcutBadge={showShortcutBadge}
      drag={drag}
      isDragging={isDragging}
      menuController={null}
      onRemoveProject={onRemoveProject}
      removeProjectStatus={removeProjectStatus}
      dragHandleProps={dragHandleProps}
    />
  );
}

interface WorkspaceRowItemProps {
  workspace: SidebarWorkspaceEntry;
  shortcutNumber: number | null;
  showShortcutBadge: boolean;
  canCopyBranchName: boolean;
  isCreating?: boolean;
  connectionStatus: HostRuntimeConnectionStatus;
  selectionEnabled: boolean;
  serverId: string | null;
  activeWorkspaceSelection: ActiveWorkspaceSelection | null;
  onWorkspacePress?: () => void;
  drag?: () => void;
  isDragging?: boolean;
  dragHandleProps?: DraggableListDragHandleProps;
}

function WorkspaceRowItem({
  workspace,
  shortcutNumber,
  showShortcutBadge,
  canCopyBranchName,
  isCreating = false,
  connectionStatus,
  selectionEnabled,
  serverId,
  activeWorkspaceSelection,
  onWorkspacePress,
  drag,
  isDragging = false,
  dragHandleProps,
}: WorkspaceRowItemProps) {
  const toast = useToast();
  const handlePress = useCallback(() => {
    if (!serverId) {
      return;
    }
    if (connectionStatus !== "online") {
      toast.error(translateNow("ui.host.is.not.connected.n90cm6"));
      return;
    }
    onWorkspacePress?.();
    navigateToWorkspace(serverId, workspace.workspaceId);
  }, [connectionStatus, serverId, onWorkspacePress, toast, workspace.workspaceId]);

  return (
    <WorkspaceRow
      workspace={workspace}
      shortcutNumber={shortcutNumber}
      showShortcutBadge={showShortcutBadge}
      canCopyBranchName={canCopyBranchName}
      isCreating={isCreating}
      selected={isWorkspaceSelected({
        selection: activeWorkspaceSelection,
        serverId: workspace.serverId,
        workspaceId: workspace.workspaceId,
        enabled: selectionEnabled,
      })}
      onPress={handlePress}
      drag={drag ?? noop}
      isDragging={isDragging}
      dragHandleProps={dragHandleProps}
    />
  );
}

function areWorkspaceRowItemPropsEqual(
  previous: WorkspaceRowItemProps,
  next: WorkspaceRowItemProps,
): boolean {
  const previousSelected = isWorkspaceSelected({
    selection: previous.activeWorkspaceSelection,
    serverId: previous.workspace.serverId,
    workspaceId: previous.workspace.workspaceId,
    enabled: previous.selectionEnabled,
  });
  const nextSelected = isWorkspaceSelected({
    selection: next.activeWorkspaceSelection,
    serverId: next.workspace.serverId,
    workspaceId: next.workspace.workspaceId,
    enabled: next.selectionEnabled,
  });
  return (
    previous.workspace === next.workspace &&
    previous.shortcutNumber === next.shortcutNumber &&
    previous.showShortcutBadge === next.showShortcutBadge &&
    previous.canCopyBranchName === next.canCopyBranchName &&
    previous.isCreating === next.isCreating &&
    previous.connectionStatus === next.connectionStatus &&
    previous.serverId === next.serverId &&
    previous.onWorkspacePress === next.onWorkspacePress &&
    previous.drag === next.drag &&
    previous.isDragging === next.isDragging &&
    previous.dragHandleProps === next.dragHandleProps &&
    previousSelected === nextSelected
  );
}

const MemoWorkspaceRowItem = memo(WorkspaceRowItem, areWorkspaceRowItemPropsEqual);

function WorkspaceRow({
  workspace,
  shortcutNumber,
  showShortcutBadge,
  onPress,
  drag,
  isDragging,
  dragHandleProps,
  canCopyBranchName,
  isCreating = false,
  selected,
}: {
  workspace: SidebarWorkspaceEntry;
  shortcutNumber: number | null;
  showShortcutBadge: boolean;
  onPress: () => void;
  drag: () => void;
  isDragging: boolean;
  dragHandleProps?: DraggableListDragHandleProps;
  canCopyBranchName: boolean;
  isCreating?: boolean;
  selected: boolean;
}) {
  const hydratedWorkspace = useSidebarWorkspaceEntry(workspace.serverId, workspace.workspaceId);

  if (!hydratedWorkspace) {
    return null;
  }

  return (
    <WorkspaceRowWithMenu
      workspace={hydratedWorkspace}
      selected={selected}
      shortcutNumber={shortcutNumber}
      showShortcutBadge={showShortcutBadge}
      onPress={onPress}
      drag={drag}
      isDragging={isDragging}
      dragHandleProps={dragHandleProps}
      canCopyBranchName={canCopyBranchName}
      isCreating={isCreating}
    />
  );
}

function ProjectBlock({
  project,
  accountSession,
  collapsed,
  displayName,
  iconDataUri,
  serverId,
  connectionStatus,
  selectionEnabled,
  showShortcutBadges,
  shortcutIndexByWorkspaceKey,
  parentGestureRef,
  onToggleCollapsed,
  onWorkspacePress,
  onWorkspaceReorder,
  onPinProject,
  onWorktreeCreated,
  onProjectMutated,
  drag,
  isDragging,
  dragHandleProps,
  useNestable,
  creatingWorkspaceIds,
  activeWorkspaceSelection,
  activeAgentRoute,
}: {
  project: SidebarProjectEntry;
  accountSession: AccountBootstrapSession | null;
  collapsed: boolean;
  displayName: string;
  iconDataUri: string | null;
  serverId: string | null;
  connectionStatus: HostRuntimeConnectionStatus;
  selectionEnabled: boolean;
  showShortcutBadges: boolean;
  shortcutIndexByWorkspaceKey: Map<string, number>;
  parentGestureRef?: MutableRefObject<GestureType | undefined>;
  onToggleCollapsed: (projectKey: string) => void;
  onWorkspacePress?: () => void;
  onWorkspaceReorder: (projectKey: string, workspaces: SidebarWorkspaceEntry[]) => void;
  onPinProject: (projectKey: string) => void;
  onWorktreeCreated?: (workspaceId: string) => void;
  onProjectMutated?: () => void;
  drag: () => void;
  isDragging: boolean;
  dragHandleProps?: DraggableListDragHandleProps;
  useNestable: boolean;
  creatingWorkspaceIds: ReadonlySet<string>;
  activeWorkspaceSelection: ActiveWorkspaceSelection | null;
  activeAgentRoute: { serverId: string; agentId: string } | null;
}) {
  const rowModel = useMemo(
    () =>
      buildSidebarProjectRowModel({
        project,
        collapsed,
      }),
    [collapsed, project],
  );
  const conversationVisual = accountSession !== null;

  const active = isProjectSelectedByRoute({
    selection: activeWorkspaceSelection,
    agentRoute: activeAgentRoute,
    serverId,
    project,
    enabled: selectionEnabled,
  });

  const renderWorkspaceRow = useCallback(
    (
      item: SidebarWorkspaceEntry,
      input?: {
        drag?: () => void;
        isDragging?: boolean;
        dragHandleProps?: DraggableListDragHandleProps;
      },
    ) => {
      return (
        <MemoWorkspaceRowItem
          workspace={item}
          shortcutNumber={shortcutIndexByWorkspaceKey.get(item.workspaceKey) ?? null}
          showShortcutBadge={showShortcutBadges}
          canCopyBranchName={project.projectKind === "git"}
          isCreating={creatingWorkspaceIds.has(item.workspaceId)}
          connectionStatus={connectionStatus}
          selectionEnabled={selectionEnabled}
          serverId={serverId}
          activeWorkspaceSelection={activeWorkspaceSelection}
          onWorkspacePress={onWorkspacePress}
          drag={input?.drag}
          isDragging={input?.isDragging}
          dragHandleProps={input?.dragHandleProps}
        />
      );
    },
    [
      project.projectKind,
      activeWorkspaceSelection,
      connectionStatus,
      creatingWorkspaceIds,
      onWorkspacePress,
      serverId,
      selectionEnabled,
      shortcutIndexByWorkspaceKey,
      showShortcutBadges,
    ],
  );

  const renderWorkspace = useCallback(
    ({
      item,
      drag: workspaceDrag,
      isActive,
      dragHandleProps: workspaceDragHandleProps,
    }: DraggableRenderItemInfo<SidebarWorkspaceEntry>) => {
      return renderWorkspaceRow(item, {
        drag: workspaceDrag,
        isDragging: isActive,
        dragHandleProps: workspaceDragHandleProps,
      });
    },
    [renderWorkspaceRow],
  );

  const handleWorkspaceDragEnd = useCallback(
    (workspaces: SidebarWorkspaceEntry[]) => {
      onWorkspaceReorder(project.projectKey, workspaces);
    },
    [onWorkspaceReorder, project.projectKey],
  );

  const toast = useToast();
  const [isRemovingProject, setIsRemovingProject] = useState(false);
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [isOpeningControlSession, setIsOpeningControlSession] = useState(false);
  const controlSessionId = project.controlSessionId ?? null;
  const hosts = useHosts();
  const { upsertDirectConnection } = useHostMutations();

  const handleRemoveProject = useCallback(() => {
    if (isRemovingProject || !serverId) {
      return;
    }

    void (async () => {
      const confirmed = await confirmDialog({
        title: translateNow("ui.remove.project.6nvxvm"),
        message: translateNow("ui.remove.project.from.sidebar.message", { name: displayName }),
        confirmLabel: translateNow("ui.remove.14f871g"),
        cancelLabel: translateNow("ui.cancel.x9d2fu"),
        destructive: true,
      });
      if (!confirmed) {
        return;
      }

      if (!accountSession) {
        toast.error(translateNow("ui.login.required.short"));
        return;
      }

      const client = getHostRuntimeStore().getClient(serverId);
      if (project.workspaces.length > 0 && !client) {
        toast.error(translateNow("ui.host.is.not.connected.n90cm6"));
        return;
      }

      setIsRemovingProject(true);
      void (async () => {
        try {
          if (controlSessionId) {
            await deleteControlSession({
              accountSession,
              sessionId: controlSessionId,
            });
            onProjectMutated?.();
            return;
          }

          const projects = await deleteAccountProject({
            userId: accountSession.user.userId,
            workspaceId: accountSession.workspace.workspaceId,
            projectId: project.projectKey,
            accessToken: accountSession.accessToken,
          });
          await saveAccountBootstrapSession({
            ...accountSession,
            projects,
          });
          onProjectMutated?.();

          if (client && project.workspaces.length > 0) {
            const failures = await archiveWorkspacesOptimistically({
              client,
              workspaces: project.workspaces,
            });
            if (failures.length > 0) {
              toast.error(translateNow("ui.failed.to.remove.some.workspaces"));
            }
          }
        } catch (error) {
          toast.error(
            error instanceof Error ? error.message : translateNow("ui.failed.to.remove.session"),
          );
        } finally {
          setIsRemovingProject(false);
        }
      })();
    })();
  }, [
    accountSession,
    controlSessionId,
    isRemovingProject,
    onProjectMutated,
    serverId,
    displayName,
    toast,
    project,
  ]);

  const handlePinProject = useCallback(() => {
    onPinProject(project.projectKey);
  }, [onPinProject, project.projectKey]);

  const handleOpenRename = useCallback(() => {
    setIsRenameOpen(true);
  }, []);

  const handleCloseRename = useCallback(() => {
    setIsRenameOpen(false);
  }, []);

  const handleSubmitRename = useCallback(
    async (value: string) => {
      if (!accountSession) {
        toast.error(translateNow("ui.login.required.short"));
        return;
      }
      const nextDisplayName = value.trim();
      if (!nextDisplayName) {
        throw new Error(translateNow("ui.session.name.required.42zqz7"));
      }
      if (controlSessionId) {
        await updateControlSession({
          accountSession,
          sessionId: controlSessionId,
          title: nextDisplayName,
        });
        onProjectMutated?.();
        toast.show(translateNow("ui.project.renamed.1rzcbzz"), { variant: "success" });
        return;
      }
      const projects = await renameAccountProject({
        userId: accountSession.user.userId,
        workspaceId: accountSession.workspace.workspaceId,
        projectId: project.projectKey,
        accessToken: accountSession.accessToken,
        displayName: nextDisplayName,
      });
      await saveAccountBootstrapSession({
        ...accountSession,
        projects,
      });
      onProjectMutated?.();
      toast.show(translateNow("ui.project.renamed.1rzcbzz"), { variant: "success" });
    },
    [accountSession, controlSessionId, onProjectMutated, project.projectKey, toast],
  );

  const validateConversationName = useCallback((value: string): string | null => {
    return value.trim() ? null : translateNow("ui.session.name.required.42zqz7");
  }, []);

  const flattenedRowWorkspaceId =
    rowModel.kind === "workspace_link" ? rowModel.workspace.workspaceId : null;
  const handleFlattenedRowPress = useCallback(() => {
    if (!serverId || !flattenedRowWorkspaceId) {
      return;
    }
    void (async () => {
      if (connectionStatus !== "online") {
        await getHostRuntimeStore().ensureStarted(serverId);
        const snapshot = getHostRuntimeStore().getSnapshot(serverId);
        if (!isHostRuntimeConnected(snapshot)) {
          toast.error(translateNow("ui.host.is.not.connected.n90cm6"));
          return;
        }
      }
      onWorkspacePress?.();
      navigateToWorkspace(serverId, flattenedRowWorkspaceId);
    })();
  }, [connectionStatus, serverId, flattenedRowWorkspaceId, onWorkspacePress, toast]);

  const handleOpenControlSession = useCallback(() => {
    if (!controlSessionId || isOpeningControlSession) {
      return;
    }
    if (!accountSession) {
      toast.error(translateNow("ui.login.required.short"));
      return;
    }
    onWorkspacePress?.();
    setIsOpeningControlSession(true);
    void (async () => {
      try {
        if (connectionStatus !== "online" && serverId) {
          await getHostRuntimeStore().ensureStarted(serverId);
          const snapshot = getHostRuntimeStore().getSnapshot(serverId);
          if (!isHostRuntimeConnected(snapshot)) {
            toast.error(translateNow("ui.host.is.not.connected.n90cm6"));
            return;
          }
        }
        const restored = await restoreControlSessionToAgent({
          accountSession,
          sessionId: controlSessionId,
          hosts,
          upsertDirectConnection,
        });
        router.navigate(buildHostAgentDetailRoute(restored.nodeId, restored.agentId));
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : translateNow("ui.failed.to.open.workspace"),
        );
      } finally {
        setIsOpeningControlSession(false);
      }
    })();
  }, [
    accountSession,
    connectionStatus,
    controlSessionId,
    hosts,
    isOpeningControlSession,
    onWorkspacePress,
    serverId,
    toast,
    upsertDirectConnection,
  ]);

  const handleToggleCollapsed = useCallback(() => {
    onToggleCollapsed(project.projectKey);
  }, [onToggleCollapsed, project.projectKey]);

  const handleProjectHeaderPress = controlSessionId
    ? handleOpenControlSession
    : handleToggleCollapsed;

  return (
    <View style={styles.projectBlock}>
      {rowModel.kind === "workspace_link" ? (
        <FlattenedProjectRow
          project={project}
          displayName={displayName}
          iconDataUri={iconDataUri}
          conversationVisual={conversationVisual}
          rowModel={rowModel}
          onPress={handleFlattenedRowPress}
          serverId={serverId}
          onWorkspacePress={onWorkspacePress}
          onWorktreeCreated={onWorktreeCreated}
          shortcutNumber={shortcutIndexByWorkspaceKey.get(rowModel.workspace.workspaceKey) ?? null}
          showShortcutBadge={showShortcutBadges}
          drag={drag}
          isDragging={isDragging}
          dragHandleProps={dragHandleProps}
          isProjectActive={active}
          onPinProject={handlePinProject}
          onRenameProject={handleOpenRename}
          onRemoveProject={handleRemoveProject}
          removeProjectStatus={isRemovingProject ? "pending" : "idle"}
          selectionEnabled={selectionEnabled}
          activeWorkspaceSelection={activeWorkspaceSelection}
        />
      ) : (
        <>
          <ProjectHeaderRow
            project={project}
            displayName={displayName}
            iconDataUri={iconDataUri}
            workspace={null}
            conversationVisual={conversationVisual}
            selected={active}
            chevron={rowModel.chevron}
            onPress={handleProjectHeaderPress}
            serverId={serverId}
            canCreateWorktree={rowModel.trailingAction === "new_worktree"}
            isProjectActive={active}
            onWorkspacePress={onWorkspacePress}
            onWorktreeCreated={onWorktreeCreated}
            drag={drag}
            isDragging={isDragging}
            isArchiving={isRemovingProject}
            menuController={null}
            onPinProject={handlePinProject}
            onRenameProject={handleOpenRename}
            onRemoveProject={handleRemoveProject}
            removeProjectStatus={isRemovingProject ? "pending" : "idle"}
            dragHandleProps={dragHandleProps}
            activeAgentRoute={activeAgentRoute}
          />

          {!collapsed ? (
            <DraggableList
              testID={`sidebar-workspace-list-${project.projectKey}`}
              data={project.workspaces}
              keyExtractor={workspaceKeyExtractor}
              renderItem={renderWorkspace}
              onDragEnd={handleWorkspaceDragEnd}
              scrollEnabled={false}
              useDragHandle
              nestable={useNestable}
              simultaneousGestureRef={parentGestureRef}
              containerStyle={styles.workspaceListContainer}
            />
          ) : null}
        </>
      )}
      <AdaptiveRenameModal
        visible={isRenameOpen}
        title={translateNow("ui.rename.project.163b8t3")}
        initialValue={displayName}
        placeholder={translateNow("account.project.defaultName")}
        submitLabel={translateNow("ui.rename.14f8jfi")}
        validate={validateConversationName}
        maxLength={80}
        onClose={handleCloseRename}
        onSubmit={handleSubmitRename}
        testID={`sidebar-project-rename-modal-${project.projectKey}`}
      />
    </View>
  );
}

type ProjectBlockProps = Parameters<typeof ProjectBlock>[0];

function areProjectBlockPropsEqual(previous: ProjectBlockProps, next: ProjectBlockProps): boolean {
  const previousActive = isProjectSelectedByRoute({
    selection: previous.activeWorkspaceSelection,
    agentRoute: previous.activeAgentRoute,
    project: previous.project,
    serverId: previous.serverId,
    enabled: previous.selectionEnabled,
  });
  const nextActive = isProjectSelectedByRoute({
    selection: next.activeWorkspaceSelection,
    agentRoute: next.activeAgentRoute,
    project: next.project,
    serverId: next.serverId,
    enabled: next.selectionEnabled,
  });
  return (
    previous.project === next.project &&
    previous.accountSession === next.accountSession &&
    previous.collapsed === next.collapsed &&
    previous.displayName === next.displayName &&
    previous.iconDataUri === next.iconDataUri &&
    previous.serverId === next.serverId &&
    previous.connectionStatus === next.connectionStatus &&
    previous.selectionEnabled === next.selectionEnabled &&
    previous.showShortcutBadges === next.showShortcutBadges &&
    previous.shortcutIndexByWorkspaceKey === next.shortcutIndexByWorkspaceKey &&
    previous.parentGestureRef === next.parentGestureRef &&
    areProjectBlockCallbacksEqual(previous, next) &&
    previous.drag === next.drag &&
    previous.isDragging === next.isDragging &&
    previous.dragHandleProps === next.dragHandleProps &&
    previous.useNestable === next.useNestable &&
    previous.creatingWorkspaceIds === next.creatingWorkspaceIds &&
    previousActive === nextActive
  );
}

function areProjectBlockCallbacksEqual(
  previous: ProjectBlockProps,
  next: ProjectBlockProps,
): boolean {
  return (
    previous.onToggleCollapsed === next.onToggleCollapsed &&
    previous.onWorkspacePress === next.onWorkspacePress &&
    previous.onWorkspaceReorder === next.onWorkspaceReorder &&
    previous.onWorktreeCreated === next.onWorktreeCreated &&
    previous.onProjectMutated === next.onProjectMutated
  );
}

const MemoProjectBlock = memo(ProjectBlock, areProjectBlockPropsEqual);

export function SidebarWorkspaceList({
  projects,
  serverId,
  connectionStatus,
  accountSession = null,
  collapsedProjectKeys,
  onToggleProjectCollapsed,
  shortcutIndexByWorkspaceKey,
  isRefreshing: _isRefreshing = false,
  onRefresh: _onRefresh,
  onWorkspacePress,
  onAddProject,
  onAiCreation,
  addProjectLabel = "Add project",
  aiCreationLabel = "AI creation",
  emptyProjectHint = "Add a project to get started",
  listFooterComponent,
  parentGestureRef,
}: SidebarWorkspaceListProps) {
  const { t } = useI18n();
  const pathname = usePathname();
  const searchParams = useLocalSearchParams<{ open?: string | string[] }>();
  const [creatingWorkspaceIds, setCreatingWorkspaceIds] = useState<Set<string>>(() => new Set());
  const creatingWorkspaceTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  const showShortcutBadges = useShowShortcutBadges();

  const getProjectOrder = useSidebarOrderStore((state) => state.getProjectOrder);
  const setProjectOrder = useSidebarOrderStore((state) => state.setProjectOrder);
  const getWorkspaceOrder = useSidebarOrderStore((state) => state.getWorkspaceOrder);
  const setWorkspaceOrder = useSidebarOrderStore((state) => state.setWorkspaceOrder);

  const isWorkspaceRoute = useMemo(
    () => Boolean(pathname && parseHostWorkspaceRouteFromPathname(pathname)),
    [pathname],
  );
  const activeAgentRoute = useMemo(() => {
    const directAgentRoute = pathname ? parseHostAgentRouteFromPathname(pathname) : null;
    if (directAgentRoute) {
      return directAgentRoute;
    }
    const workspaceRoute = pathname ? parseHostWorkspaceRouteFromPathname(pathname) : null;
    const openValue = Array.isArray(searchParams.open) ? searchParams.open[0] : searchParams.open;
    const openIntent = parseWorkspaceOpenIntent(openValue);
    if (!workspaceRoute || openIntent?.kind !== "agent") {
      return null;
    }
    return {
      serverId: workspaceRoute.serverId,
      agentId: openIntent.agentId,
    };
  }, [pathname, searchParams.open]);
  const selectionEnabled = isWorkspaceRoute || activeAgentRoute !== null;
  const activeWorkspaceSelection = useActiveWorkspaceSelection();
  const useConversationSidebar = accountSession !== null;
  const isAiCreationActive = pathname.includes("/ai-creation");
  const isNewConversationActive = pathname.includes("/home") || pathname.includes("/open-project");
  const newConversationButtonStyle = useMemo(
    () => [
      styles.primaryConversationButton,
      isNewConversationActive && styles.primaryConversationButtonActive,
    ],
    [isNewConversationActive],
  );
  const newConversationButtonTextStyle = useMemo(
    () => [
      styles.primaryConversationButtonText,
      isNewConversationActive && styles.primaryConversationButtonTextActive,
    ],
    [isNewConversationActive],
  );
  const aiCreationButtonStyle = useMemo(
    () => [
      styles.secondaryConversationButton,
      isAiCreationActive && styles.secondaryConversationButtonActive,
    ],
    [isAiCreationActive],
  );
  const aiCreationButtonTextStyle = useMemo(
    () => [
      styles.secondaryConversationButtonText,
      isAiCreationActive && styles.secondaryConversationButtonTextActive,
    ],
    [isAiCreationActive],
  );

  const projectIconRequests = useMemo(() => {
    if (!serverId || useConversationSidebar) {
      return [];
    }
    const unique = new Map<string, { serverId: string; cwd: string }>();
    for (const project of projects) {
      const cwd = project.iconWorkingDir.trim();
      if (!cwd) {
        continue;
      }
      unique.set(`${serverId}:${cwd}`, { serverId, cwd });
    }
    return Array.from(unique.values());
  }, [projects, serverId, useConversationSidebar]);

  const projectIconQueries = useQueries({
    queries: projectIconRequests.map((request) => ({
      queryKey: projectIconQueryKey(request.serverId, request.cwd),
      queryFn: async () => {
        const client = getHostRuntimeStore().getClient(request.serverId);
        if (!client) {
          return null;
        }
        const result = await client.requestProjectIcon(request.cwd);
        return result.icon;
      },
      select: projectIconToDataUri,
      enabled: Boolean(
        getHostRuntimeStore().getClient(request.serverId) &&
        isHostRuntimeConnected(getHostRuntimeStore().getSnapshot(request.serverId)) &&
        request.cwd,
      ),
      staleTime: Infinity,
      gcTime: 1000 * 60 * 60,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    })),
  });

  const projectIconSignature = projectIconQueries.map((query) => query.data ?? "").join("\u0000");
  const projectIconData = useStableProjectIconData(
    projectIconQueries.map((query) => query.data ?? null),
    projectIconSignature,
  );

  const projectIconByProjectKey = useMemo(() => {
    const iconByServerAndCwd = new Map<string, string | null>();
    for (let index = 0; index < projectIconRequests.length; index += 1) {
      const request = projectIconRequests[index];
      if (!request) {
        continue;
      }
      iconByServerAndCwd.set(`${request.serverId}:${request.cwd}`, projectIconData[index] ?? null);
    }

    const byProject = new Map<string, string | null>();
    for (const project of projects) {
      if (useConversationSidebar) {
        byProject.set(project.projectKey, null);
        continue;
      }
      const cwd = project.iconWorkingDir.trim();
      if (!cwd || !serverId) {
        byProject.set(project.projectKey, null);
        continue;
      }
      byProject.set(project.projectKey, iconByServerAndCwd.get(`${serverId}:${cwd}`) ?? null);
    }

    return byProject;
  }, [projectIconData, projectIconRequests, projects, serverId, useConversationSidebar]);

  useEffect(() => {
    const timeouts = creatingWorkspaceTimeoutsRef.current;
    return () => {
      for (const timeout of timeouts.values()) {
        clearTimeout(timeout);
      }
      timeouts.clear();
    };
  }, []);

  useEffect(() => {
    if (creatingWorkspaceIds.size === 0) {
      return;
    }

    const visibleWorkspaceIds = new Set<string>();
    for (const project of projects) {
      for (const workspace of project.workspaces) {
        visibleWorkspaceIds.add(workspace.workspaceId);
      }
    }

    const removedWorkspaceIds = Array.from(creatingWorkspaceIds).filter(
      (workspaceId) => !visibleWorkspaceIds.has(workspaceId),
    );
    if (removedWorkspaceIds.length === 0) {
      return;
    }

    for (const workspaceId of removedWorkspaceIds) {
      const timeout = creatingWorkspaceTimeoutsRef.current.get(workspaceId);
      if (timeout) {
        clearTimeout(timeout);
        creatingWorkspaceTimeoutsRef.current.delete(workspaceId);
      }
    }

    setCreatingWorkspaceIds((current) => {
      const next = new Set(current);
      for (const workspaceId of removedWorkspaceIds) {
        next.delete(workspaceId);
      }
      return next;
    });
  }, [creatingWorkspaceIds, projects]);

  const handleProjectDragEnd = useCallback(
    (reorderedProjects: SidebarProjectEntry[]) => {
      if (!serverId) {
        return;
      }

      const reorderedProjectKeys = reorderedProjects.map((project) => project.projectKey);
      const currentProjectOrder = getProjectOrder(serverId);
      if (
        !hasVisibleOrderChanged({
          currentOrder: currentProjectOrder,
          reorderedVisibleKeys: reorderedProjectKeys,
        })
      ) {
        return;
      }

      setProjectOrder(
        serverId,
        mergeWithRemainder({
          currentOrder: currentProjectOrder,
          reorderedVisibleKeys: reorderedProjectKeys,
        }),
      );
    },
    [getProjectOrder, serverId, setProjectOrder],
  );

  const handlePinProject = useCallback(
    (projectKey: string) => {
      if (!serverId) {
        return;
      }
      const visibleProjectKeys = projects.map((project) => project.projectKey);
      const reorderedProjectKeys = [
        projectKey,
        ...visibleProjectKeys.filter((visibleProjectKey) => visibleProjectKey !== projectKey),
      ];
      setProjectOrder(
        serverId,
        mergeWithRemainder({
          currentOrder: getProjectOrder(serverId),
          reorderedVisibleKeys: reorderedProjectKeys,
        }),
      );
    },
    [getProjectOrder, projects, serverId, setProjectOrder],
  );

  const handleWorkspaceReorder = useCallback(
    (projectKey: string, reorderedWorkspaces: SidebarWorkspaceEntry[]) => {
      if (!serverId) {
        return;
      }

      const reorderedWorkspaceKeys = reorderedWorkspaces.map((workspace) => workspace.workspaceKey);
      const currentWorkspaceOrder = getWorkspaceOrder(serverId, projectKey);
      if (
        !hasVisibleOrderChanged({
          currentOrder: currentWorkspaceOrder,
          reorderedVisibleKeys: reorderedWorkspaceKeys,
        })
      ) {
        return;
      }

      setWorkspaceOrder(
        serverId,
        projectKey,
        mergeWithRemainder({
          currentOrder: currentWorkspaceOrder,
          reorderedVisibleKeys: reorderedWorkspaceKeys,
        }),
      );
    },
    [getWorkspaceOrder, serverId, setWorkspaceOrder],
  );

  const handleWorktreeCreated = useCallback((workspaceId: string) => {
    setCreatingWorkspaceIds((current) => {
      const next = new Set(current);
      next.add(workspaceId);
      return next;
    });
    const existingTimeout = creatingWorkspaceTimeoutsRef.current.get(workspaceId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }
    creatingWorkspaceTimeoutsRef.current.set(
      workspaceId,
      setTimeout(() => {
        creatingWorkspaceTimeoutsRef.current.delete(workspaceId);
        setCreatingWorkspaceIds((current) => {
          if (!current.has(workspaceId)) {
            return current;
          }
          const next = new Set(current);
          next.delete(workspaceId);
          return next;
        });
      }, 3000),
    );
  }, []);

  const renderProject = useCallback(
    ({ item, drag, isActive, dragHandleProps }: DraggableRenderItemInfo<SidebarProjectEntry>) => {
      return (
        <MemoProjectBlock
          project={item}
          accountSession={accountSession}
          collapsed={collapsedProjectKeys.has(item.projectKey)}
          displayName={item.projectName}
          iconDataUri={projectIconByProjectKey.get(item.projectKey) ?? null}
          serverId={serverId}
          connectionStatus={connectionStatus}
          selectionEnabled={selectionEnabled}
          showShortcutBadges={showShortcutBadges}
          shortcutIndexByWorkspaceKey={shortcutIndexByWorkspaceKey}
          parentGestureRef={parentGestureRef}
          onToggleCollapsed={onToggleProjectCollapsed}
          onWorkspacePress={onWorkspacePress}
          onWorkspaceReorder={handleWorkspaceReorder}
          onPinProject={handlePinProject}
          onWorktreeCreated={handleWorktreeCreated}
          onProjectMutated={_onRefresh}
          drag={drag}
          isDragging={isActive}
          dragHandleProps={dragHandleProps}
          useNestable={platformIsNative}
          creatingWorkspaceIds={creatingWorkspaceIds}
          activeWorkspaceSelection={activeWorkspaceSelection}
          activeAgentRoute={activeAgentRoute}
        />
      );
    },
    [
      collapsedProjectKeys,
      accountSession,
      activeAgentRoute,
      activeWorkspaceSelection,
      connectionStatus,
      handleWorktreeCreated,
      handlePinProject,
      handleWorkspaceReorder,
      onWorkspacePress,
      onToggleProjectCollapsed,
      parentGestureRef,
      projectIconByProjectKey,
      selectionEnabled,
      serverId,
      shortcutIndexByWorkspaceKey,
      showShortcutBadges,
      creatingWorkspaceIds,
      _onRefresh,
    ],
  );

  const projectListContent = (
    <>
      {projects.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyTitle}>{t("account.project.empty")}</Text>
          <Text style={styles.emptyText}>{emptyProjectHint}</Text>
          {useConversationSidebar ? null : (
            <Button variant="ghost" size="sm" leftIcon={Plus} onPress={onAddProject}>
              {addProjectLabel}
            </Button>
          )}
        </View>
      ) : (
        <DraggableList
          testID="sidebar-project-list"
          data={projects}
          keyExtractor={projectKeyExtractor}
          renderItem={renderProject}
          onDragEnd={handleProjectDragEnd}
          scrollEnabled={false}
          useDragHandle
          nestable={platformIsNative}
          simultaneousGestureRef={parentGestureRef}
          containerStyle={styles.projectListContainer}
        />
      )}
      {listFooterComponent}
    </>
  );

  const conversationHeader = (
    <View style={styles.conversationSidebarHeader}>
      <Button
        variant="secondary"
        size="sm"
        leftIcon={renderNewConversationIcon}
        onPress={onAddProject}
        style={newConversationButtonStyle}
        textStyle={newConversationButtonTextStyle}
      >
        {addProjectLabel}
      </Button>
      <Button
        variant="secondary"
        size="sm"
        leftIcon={renderAiCreationSidebarIcon}
        onPress={onAiCreation}
        style={aiCreationButtonStyle}
        textStyle={aiCreationButtonTextStyle}
        testID="sidebar-ai-creation"
      >
        {aiCreationLabel}
      </Button>
      <Text style={styles.historySectionLabel}>{t("sidebar.historyConversations")}</Text>
    </View>
  );

  if (useConversationSidebar) {
    return (
      <View style={styles.container}>
        <View style={styles.conversationFixedHeader}>{conversationHeader}</View>
        {platformIsNative ? (
          <NestableScrollContainer
            style={styles.list}
            contentContainerStyle={styles.conversationListContent}
            showsVerticalScrollIndicator={false}
            testID="sidebar-project-workspace-list-scroll"
          >
            {projectListContent}
          </NestableScrollContainer>
        ) : (
          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.conversationListContent}
            showsVerticalScrollIndicator={false}
            testID="sidebar-project-workspace-list-scroll"
          >
            {projectListContent}
          </ScrollView>
        )}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {platformIsNative ? (
        <NestableScrollContainer
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          testID="sidebar-project-workspace-list-scroll"
        >
          {projectListContent}
        </NestableScrollContainer>
      ) : (
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          testID="sidebar-project-workspace-list-scroll"
        >
          {projectListContent}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: theme.spacing[2],
    paddingTop: theme.spacing[1],
    paddingBottom: theme.spacing[4],
  },
  conversationFixedHeader: {
    flexShrink: 0,
    paddingHorizontal: theme.spacing[2],
    paddingTop: theme.spacing[1],
  },
  conversationListContent: {
    paddingHorizontal: theme.spacing[2],
    paddingBottom: theme.spacing[4],
  },
  conversationSidebarHeader: {
    gap: 3,
    paddingHorizontal: theme.spacing[1],
    paddingTop: 0,
    paddingBottom: theme.spacing[3],
  },
  primaryConversationButton: {
    width: "100%",
    height: 36,
    justifyContent: "flex-start",
    paddingVertical: 0,
    paddingHorizontal: theme.spacing[2],
    backgroundColor: "transparent",
    borderColor: "transparent",
    borderRadius: 10,
  },
  primaryConversationButtonText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: "500",
    lineHeight: 22,
  },
  primaryConversationButtonActive: {
    backgroundColor: theme.colors.surface0,
    borderColor: theme.colors.surface0,
    ...theme.shadow.sm,
  },
  primaryConversationButtonTextActive: {
    color: theme.colors.foreground,
  },
  secondaryConversationButton: {
    width: "100%",
    height: 36,
    justifyContent: "flex-start",
    paddingVertical: 0,
    paddingHorizontal: theme.spacing[2],
    backgroundColor: "transparent",
    borderColor: "transparent",
    borderRadius: 10,
  },
  secondaryConversationButtonActive: {
    backgroundColor: theme.colors.surface0,
    borderColor: theme.colors.surface0,
    ...theme.shadow.sm,
  },
  secondaryConversationButtonText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: "500",
    lineHeight: 22,
  },
  secondaryConversationButtonTextActive: {
    color: theme.colors.foreground,
  },
  historySectionLabel: {
    paddingHorizontal: theme.spacing[2],
    paddingTop: theme.spacing[3],
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: "500",
    lineHeight: 18,
  },
  projectListContainer: {
    width: "100%",
  },
  projectBlock: {
    marginBottom: theme.spacing[1],
  },
  workspaceListContainer: {},
  emptyContainer: {
    marginHorizontal: theme.spacing[2],
    marginTop: theme.spacing[4],
    paddingTop: theme.spacing[6],
    paddingBottom: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface0,
    alignItems: "center",
    gap: theme.spacing[3],
  },
  emptyTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    textAlign: "center",
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
  projectRow: {
    minHeight: 36,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
    marginBottom: theme.spacing[1],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    userSelect: "none",
  },
  projectRowHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  conversationProjectRow: {
    minHeight: 36,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginBottom: 2,
    borderRadius: 10,
  },
  conversationProjectRowHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  conversationProjectRowSelected: {
    backgroundColor: theme.colors.surface0,
    ...theme.shadow.sm,
  },
  projectRowPressed: {
    backgroundColor: theme.colors.surface2,
  },
  projectRowDragging: {
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    transform: [{ scale: 1.02 }],
    zIndex: 3,
    ...theme.shadow.md,
  },
  projectRowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flex: 1,
    minWidth: 0,
  },
  conversationProjectPressable: {
    flex: 1,
    minWidth: 0,
  },
  projectTitleGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flex: 1,
    minWidth: 0,
  },
  projectIcon: {
    width: "100%",
    height: "100%",
    borderRadius: theme.borderRadius.sm,
  },
  projectLeadingVisualSlot: {
    position: "relative",
    width: theme.iconSize.md,
    height: theme.iconSize.md,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  conversationProjectLeadingVisualSlot: {
    position: "relative",
    width: 19,
    height: 19,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  conversationProjectIconFrame: {
    width: 19,
    height: 19,
    borderRadius: theme.borderRadius.full,
    borderWidth: theme.borderWidth[1],
    borderColor: "rgba(0, 0, 0, 0.10)",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surface0,
  },
  conversationProjectIcon: {
    color: theme.colors.foregroundMuted,
  },
  projectIconFallback: {
    width: "100%",
    height: "100%",
    borderRadius: theme.borderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  projectIconFallbackText: {
    fontSize: 9,
  },
  projectTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: "400",
    minWidth: 0,
    flexShrink: 1,
  },
  conversationProjectTitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: "500",
    lineHeight: 22,
    minWidth: 0,
    flexShrink: 1,
  },
  projectActionButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
    flexShrink: 0,
  },
  projectActionButtonHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  projectActionButtonText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  projectIconActionButton: {
    width: 24,
    height: 24,
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  projectIconActionButtonHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  projectIconActionButtonHidden: {
    opacity: 0,
  },
  projectTrailingActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    flexShrink: 0,
  },
  projectKebabButton: {
    width: 24,
    height: 24,
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  projectKebabButtonHidden: {
    opacity: 0,
  },
  projectKebabButtonHovered: {
    backgroundColor: theme.colors.surface2,
  },
  projectTrailingControlSlot: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  projectActionTooltipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  projectActionTooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  projectActionTooltipShortcut: {},
  workspaceRow: {
    minHeight: 36,
    marginBottom: theme.spacing[1],
    paddingVertical: theme.spacing[2],
    paddingLeft: theme.spacing[3] + theme.spacing[3],
    paddingRight: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    flexDirection: "column",
    alignItems: "stretch",
    justifyContent: "center",
    gap: theme.spacing[1],
    userSelect: "none",
  },
  workspaceRowMain: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    width: "100%",
  },
  workspaceRowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flex: 1,
    minWidth: 0,
  },
  workspaceRowRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexShrink: 0,
  },
  workspaceRowHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  workspaceRowPressed: {
    backgroundColor: theme.colors.surface2,
  },
  workspaceRowDragging: {
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    transform: [{ scale: 1.02 }],
    zIndex: 3,
    ...theme.shadow.md,
  },
  sidebarRowSelected: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  workspaceRowContainer: {
    position: "relative",
  },
  workspaceStatusDot: {
    position: "relative",
    width: WORKSPACE_STATUS_DOT_WIDTH,
    height: 16,
    borderRadius: theme.borderRadius.full,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  statusDotOverlay: {
    position: "absolute",
    right: DEFAULT_STATUS_DOT_OFFSET,
    bottom: DEFAULT_STATUS_DOT_OFFSET,
    width: DEFAULT_STATUS_DOT_SIZE,
    height: DEFAULT_STATUS_DOT_SIZE,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
  },
  workspaceArchivingOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: `${theme.colors.surface0}cc`,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: theme.spacing[2],
    zIndex: 1,
  },
  workspaceArchivingText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
  },
  workspaceBranchText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: "400",
    lineHeight: 20,
    opacity: 0.76,
    flex: 1,
    minWidth: 0,
  },
  workspaceBranchTextCreating: {
    opacity: 0.92,
  },
  workspaceBranchTextHovered: {
    opacity: 1,
  },
  workspacePrBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingLeft: WORKSPACE_STATUS_DOT_WIDTH + theme.spacing[2],
  },
  workspaceCreatingText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    flexShrink: 0,
  },
  kebabButton: {
    padding: 2,
    borderRadius: 4,
    marginLeft: 2,
  },
  kebabButtonHovered: {
    backgroundColor: theme.colors.surface2,
  },
  shortcutBadge: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: theme.spacing[1],
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.colors.surface2,
    backgroundColor: theme.colors.surface0,
    flexShrink: 0,
  },
  shortcutBadgeText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
    lineHeight: 14,
  },
  statusDotNeedsInput: {
    backgroundColor: theme.colors.palette.amber[500],
    borderColor: theme.colors.surface0,
  },
  statusDotFailed: {
    backgroundColor: theme.colors.palette.red[500],
    borderColor: theme.colors.surface0,
  },
  statusDotRunning: {
    backgroundColor: theme.colors.palette.blue[500],
    borderColor: theme.colors.surface0,
  },
  statusDotAttention: {
    backgroundColor: theme.colors.palette.green[500],
    borderColor: theme.colors.surface0,
  },
}));

function getStatusDotColorStyle(bucket: SidebarStateBucket): ViewStyle | null {
  switch (bucket) {
    case "needs_input":
      return styles.statusDotNeedsInput;
    case "failed":
      return styles.statusDotFailed;
    case "running":
      return styles.statusDotRunning;
    case "attention":
      return styles.statusDotAttention;
    case "done":
      return null;
  }
}
