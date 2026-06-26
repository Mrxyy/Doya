import { useCallback, useState } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { router } from "expo-router";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ProjectIconView } from "@/components/project-icon-view";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { projectIconToDataUri, useProjectIconQuery } from "@/hooks/use-project-icon-query";
import {
  parseControlSessionProjectKey,
  useProjects,
  type ProjectHostError,
} from "@/hooks/use-projects";
import { settingsStyles } from "@/styles/settings";
import { buildHostAgentDetailRoute, buildProjectSettingsRoute } from "@/utils/host-routes";
import type { ProjectHostEntry, ProjectSummary } from "@/utils/projects";
import { translateNow } from "@/i18n/i18n";
import { loadAccountBootstrapSession } from "@/account/account-api";
import { restoreControlSessionToAgent } from "@/control/control-session-restore";
import { useHostMutations, useHosts } from "@/runtime/host-runtime";
import { useToast } from "@/contexts/toast-context";
import { ChevronRight } from "@/components/icons/lucide";

const ThemedChevronRight = withUnistyles(ChevronRight, (theme) => ({
  color: theme.colors.foregroundMuted,
  size: theme.iconSize.sm,
}));

interface ProjectsScreenProps {
  view: { kind: "projects" } | { kind: "project"; projectKey: string };
}

export default function ProjectsScreen({ view }: ProjectsScreenProps) {
  const { projects, hostErrors, isLoading } = useProjects();
  const selectedProjectKey = view.kind === "project" ? view.projectKey : null;

  if (isLoading && projects.length === 0) {
    return (
      <View style={styles.centered} testID="projects-list">
        <LoadingSpinner size="large" color={styles.spinnerColor.color} />
      </View>
    );
  }

  if (projects.length === 0) {
    return (
      <View style={styles.centered} testID="projects-list">
        <Text style={styles.emptyText}>{translateNow("ui.no.projects.yet.osio0x")}</Text>
      </View>
    );
  }

  return (
    <View testID="projects-list">
      {hostErrors.length > 0 ? <HostErrorsBanner errors={hostErrors} /> : null}
      <View style={settingsStyles.card}>
        {projects.map((project, index) => (
          <ProjectRow
            key={project.projectKey}
            project={project}
            isFirst={index === 0}
            isSelected={selectedProjectKey === project.projectKey}
          />
        ))}
      </View>
    </View>
  );
}

function HostErrorsBanner({ errors }: { errors: ProjectHostError[] }) {
  return (
    <View style={styles.errorsBanner} testID="projects-host-errors">
      {errors.map((error) => (
        <Text key={error.serverId} style={styles.errorsBannerText}>
          {`Couldn't load projects from host ${error.serverName}: ${error.message}`}
        </Text>
      ))}
    </View>
  );
}

interface ProjectRowProps {
  project: ProjectSummary;
  isFirst: boolean;
  isSelected: boolean;
}

function ProjectRow({ project, isFirst, isSelected }: ProjectRowProps) {
  const { hosts, projectKey, projectName } = project;
  const leadingHost = hosts[0];
  const connectedHosts = useHosts();
  const { upsertDirectConnection } = useHostMutations();
  const toast = useToast();
  const [isOpeningControlSession, setIsOpeningControlSession] = useState(false);

  const handleNavigate = useCallback(() => {
    const controlSessionId = parseControlSessionProjectKey(projectKey);
    if (controlSessionId) {
      if (isOpeningControlSession) {
        return;
      }
      setIsOpeningControlSession(true);
      void (async () => {
        try {
          const accountSession = await loadAccountBootstrapSession();
          if (!accountSession) {
            throw new Error(translateNow("ui.login.required.short"));
          }
          const restored = await restoreControlSessionToAgent({
            accountSession,
            sessionId: controlSessionId,
            hosts: connectedHosts,
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
      return;
    }
    router.navigate(buildProjectSettingsRoute(projectKey));
  }, [connectedHosts, isOpeningControlSession, projectKey, toast, upsertDirectConnection]);

  const rowStyle = useCallback(
    ({ pressed, hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      settingsStyles.row,
      !isFirst && settingsStyles.rowBorder,
      styles.row,
      isSelected && styles.rowSelected,
      hovered && !isSelected && styles.rowHovered,
      pressed && styles.rowPressed,
    ],
    [isFirst, isSelected],
  );

  return (
    <Pressable
      style={rowStyle}
      onPress={handleNavigate}
      accessibilityRole="button"
      accessibilityLabel={translateNow("ui.edit.project.accessibility", { name: projectName })}
      testID={`project-row-${projectKey}`}
      data-selected={isSelected ? "true" : "false"}
    >
      <View style={styles.rowMain}>
        <View style={styles.leading}>
          <ProjectRowIcon host={leadingHost} projectName={projectName} projectKey={projectKey} />
        </View>
        <Text style={settingsStyles.rowTitle} numberOfLines={1}>
          {projectName}
        </Text>
      </View>
      <ThemedChevronRight />
    </Pressable>
  );
}

function ProjectRowIcon({
  host,
  projectName,
  projectKey,
}: {
  host: ProjectHostEntry | undefined;
  projectName: string;
  projectKey: string;
}) {
  const initial = projectName.trim().charAt(0).toUpperCase() || "?";
  const { icon } = useProjectIconQuery({
    serverId: host?.serverId ?? "",
    cwd: host?.repoRoot ?? "",
  });
  return (
    <ProjectIconView
      iconDataUri={projectIconToDataUri(icon)}
      initial={initial}
      projectKey={projectKey}
      imageStyle={styles.iconImage}
      fallbackStyle={styles.iconFallback}
      textStyle={styles.iconFallbackText}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[6],
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  errorsBanner: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[3],
    marginBottom: theme.spacing[3],
    gap: theme.spacing[1],
  },
  errorsBannerText: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.xs,
  },
  row: {
    gap: theme.spacing[3],
  },
  rowMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  rowHovered: {
    backgroundColor: theme.colors.surface2,
  },
  rowPressed: {
    backgroundColor: theme.colors.surface3,
  },
  rowSelected: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  leading: {
    width: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  iconImage: {
    width: 16,
    height: 16,
    borderRadius: theme.borderRadius.sm,
  },
  iconFallback: {
    width: 16,
    height: 16,
    borderRadius: theme.borderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  iconFallbackText: {
    fontSize: theme.fontSize.xs,
  },
  spinnerColor: {
    color: theme.colors.foregroundMuted,
  },
}));
