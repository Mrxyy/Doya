import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export interface AccountUserRecord {
  userId: string;
  email: string;
  accessToken: string;
  createdAt: string;
  disabledAt: string | null;
}

export interface AccountWorkspaceRecord {
  workspaceId: string;
  ownerUserId: string;
  displayName: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface AccountProjectRecord {
  projectId: string;
  workspaceId: string;
  ownerUserId: string;
  displayName: string;
  cwd: string;
  createdAt: string;
  deletedAt: string | null;
}

interface AccountSnapshot {
  users: AccountUserRecord[];
  workspaces: AccountWorkspaceRecord[];
  projects: AccountProjectRecord[];
}

export interface AccountAuthResult {
  user: AccountUserRecord;
  workspace: AccountWorkspaceRecord;
  projects: AccountProjectRecord[];
  accessToken: string;
}

const EMPTY_SNAPSHOT: AccountSnapshot = {
  users: [],
  workspaces: [],
  projects: [],
};

export class AccountControlPlaneError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

export class AccountControlPlane {
  private readonly filePath: string;
  private readonly workspacesRoot: string;
  private readonly now: () => Date;
  private loaded = false;
  private snapshot: AccountSnapshot = { ...EMPTY_SNAPSHOT };
  private persistQueue: Promise<void> = Promise.resolve();

  constructor(options: { paseoHome: string; now?: () => Date }) {
    const accountRoot = path.join(options.paseoHome, "accounts");
    this.filePath = path.join(accountRoot, "accounts.json");
    this.workspacesRoot = path.join(accountRoot, "workspaces");
    this.now = options.now ?? (() => new Date());
  }

  async register(input: { email: string; displayName?: string }): Promise<AccountAuthResult> {
    const email = normalizeEmail(input.email);
    if (!email) {
      throw new AccountControlPlaneError("邮箱不能为空");
    }

    const existingUser = await this.findActiveUserByEmail(email);
    if (existingUser) {
      return this.createAuthResult(await this.refreshAccessToken(existingUser));
    }

    const timestamp = this.timestamp();
    const user: AccountUserRecord = {
      userId: `usr_${randomUUID()}`,
      email,
      accessToken: randomUUID(),
      createdAt: timestamp,
      disabledAt: null,
    };
    const workspaceId = `ws_${randomUUID()}`;
    const workspace: AccountWorkspaceRecord = {
      workspaceId,
      ownerUserId: user.userId,
      displayName: input.displayName?.trim() || "我的工作区",
      cwd: path.join(this.workspacesRoot, workspaceId),
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
    };
    await mkdir(workspace.cwd, { recursive: true });

    await this.load();
    this.snapshot.users = upsertById(this.snapshot.users, user, (record) => record.userId);
    this.snapshot.workspaces = upsertById(
      this.snapshot.workspaces,
      workspace,
      (record) => record.workspaceId,
    );
    await this.enqueuePersist();
    await this.ensureDefaultProject({
      userId: user.userId,
      workspace,
    });

    return this.createAuthResult(user);
  }

  async login(input: { email: string }): Promise<AccountAuthResult> {
    const user = await this.findActiveUserByEmail(input.email);
    if (!user) {
      throw new AccountControlPlaneError("用户不存在，请先注册", 404);
    }
    return this.createAuthResult(await this.refreshAccessToken(user));
  }

  async getSession(input: { userId: string; accessToken: string }): Promise<AccountAuthResult> {
    const user = await this.requireUserAccess(input);
    return this.createAuthResult(user);
  }

  async createProject(input: {
    userId: string;
    workspaceId: string;
    accessToken: string;
    displayName: string;
  }): Promise<AccountProjectRecord> {
    const workspace = await this.requireWorkspaceAccess(input);
    const displayName = input.displayName.trim();
    if (!displayName) {
      throw new AccountControlPlaneError("项目名称不能为空");
    }

    const projectId = `prj_${randomUUID()}`;
    const cwd = path.join(
      workspace.cwd,
      "projects",
      `${slugifyProjectName(displayName)}-${projectId.replace(/^prj_/, "").slice(0, 8)}`,
    );
    await mkdir(cwd, { recursive: true });

    const project: AccountProjectRecord = {
      projectId,
      workspaceId: workspace.workspaceId,
      ownerUserId: input.userId,
      displayName,
      cwd,
      createdAt: this.timestamp(),
      deletedAt: null,
    };

    await this.load();
    this.snapshot.projects = upsertById(
      this.snapshot.projects,
      project,
      (record) => record.projectId,
    );
    await this.enqueuePersist();

    return project;
  }

  async deleteProject(input: {
    userId: string;
    workspaceId: string;
    projectId: string;
    accessToken: string;
  }): Promise<AccountProjectRecord[]> {
    const workspace = await this.requireWorkspaceAccess(input);
    await this.load();
    const project = this.snapshot.projects.find(
      (record) => record.projectId === input.projectId && record.deletedAt === null,
    );
    if (!project) {
      throw new AccountControlPlaneError("项目不存在", 404);
    }
    if (
      project.ownerUserId !== input.userId ||
      project.workspaceId !== workspace.workspaceId ||
      !isSameOrChildPath(project.cwd, workspace.cwd)
    ) {
      throw new AccountControlPlaneError("无权访问该项目", 403);
    }

    this.snapshot.projects = upsertById(
      this.snapshot.projects,
      {
        ...project,
        deletedAt: this.timestamp(),
      },
      (record) => record.projectId,
    );
    await this.enqueuePersist();
    return this.listWorkspaceProjects(input.userId, workspace.workspaceId);
  }

  private async createAuthResult(user: AccountUserRecord): Promise<AccountAuthResult> {
    const workspace = await this.getDefaultWorkspaceForUser(user.userId);
    return {
      user,
      workspace,
      projects: await this.listWorkspaceProjects(user.userId, workspace.workspaceId),
      accessToken: user.accessToken,
    };
  }

  private async requireWorkspaceAccess(input: {
    userId: string;
    workspaceId: string;
    accessToken: string;
  }): Promise<AccountWorkspaceRecord> {
    await this.requireUserAccess(input);

    const workspace = this.snapshot.workspaces.find(
      (record) => record.workspaceId === input.workspaceId && record.deletedAt === null,
    );
    if (!workspace) {
      throw new AccountControlPlaneError("工作区不存在", 404);
    }
    if (workspace.ownerUserId !== input.userId) {
      throw new AccountControlPlaneError("无权访问该工作区", 403);
    }
    return workspace;
  }

  private async ensureDefaultProject(input: {
    userId: string;
    workspace: AccountWorkspaceRecord;
  }): Promise<AccountProjectRecord> {
    const existingProjects = await this.listWorkspaceProjects(
      input.userId,
      input.workspace.workspaceId,
    );
    const existingDefault = existingProjects.find(
      (project) => project.displayName.trim().toLowerCase() === "default",
    );
    if (existingDefault) {
      return existingDefault;
    }

    const timestamp = this.timestamp();
    const project: AccountProjectRecord = {
      projectId: `prj_${randomUUID()}`,
      workspaceId: input.workspace.workspaceId,
      ownerUserId: input.userId,
      displayName: "default",
      cwd: path.join(input.workspace.cwd, "projects", "default"),
      createdAt: timestamp,
      deletedAt: null,
    };
    await mkdir(project.cwd, { recursive: true });

    await this.load();
    this.snapshot.projects = upsertById(
      this.snapshot.projects,
      project,
      (record) => record.projectId,
    );
    await this.enqueuePersist();
    return project;
  }

  private async requireUserAccess(input: {
    userId: string;
    accessToken: string;
  }): Promise<AccountUserRecord> {
    await this.load();
    const user = this.snapshot.users.find(
      (record) => record.userId === input.userId && record.disabledAt === null,
    );
    if (!user) {
      throw new AccountControlPlaneError("用户不存在", 404);
    }
    if (user.accessToken !== input.accessToken) {
      throw new AccountControlPlaneError("登录已失效，请重新登录", 401);
    }
    return user;
  }

  private async refreshAccessToken(user: AccountUserRecord): Promise<AccountUserRecord> {
    await this.load();
    const nextUser = { ...user, accessToken: randomUUID() };
    this.snapshot.users = upsertById(this.snapshot.users, nextUser, (record) => record.userId);
    await this.enqueuePersist();
    return nextUser;
  }

  private async findActiveUserByEmail(email: string): Promise<AccountUserRecord | null> {
    const normalizedEmail = normalizeEmail(email);
    await this.load();
    return (
      this.snapshot.users.find(
        (record) => normalizeEmail(record.email) === normalizedEmail && record.disabledAt === null,
      ) ?? null
    );
  }

  private async getDefaultWorkspaceForUser(userId: string): Promise<AccountWorkspaceRecord> {
    await this.load();
    const workspace = this.snapshot.workspaces.find(
      (record) => record.ownerUserId === userId && record.deletedAt === null,
    );
    if (!workspace) {
      throw new AccountControlPlaneError("工作区不存在", 404);
    }
    return workspace;
  }

  private async listWorkspaceProjects(
    userId: string,
    workspaceId: string,
  ): Promise<AccountProjectRecord[]> {
    await this.load();
    const workspace = this.snapshot.workspaces.find(
      (record) =>
        record.ownerUserId === userId &&
        record.workspaceId === workspaceId &&
        record.deletedAt === null,
    );
    if (!workspace) {
      return [];
    }
    return this.snapshot.projects.filter(
      (record) =>
        record.ownerUserId === userId &&
        record.workspaceId === workspaceId &&
        record.deletedAt === null &&
        isSameOrChildPath(record.cwd, workspace.cwd),
    );
  }

  private async load(): Promise<void> {
    if (this.loaded) {
      return;
    }
    try {
      const raw = await readFile(this.filePath, "utf8");
      this.snapshot = normalizeSnapshot(JSON.parse(raw));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        throw error;
      }
      this.snapshot = { ...EMPTY_SNAPSHOT };
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
    await writeFile(tempPath, JSON.stringify(this.snapshot, null, 2), "utf8");
    await rename(tempPath, this.filePath);
  }

  private async enqueuePersist(): Promise<void> {
    const nextPersist = this.persistQueue.then(() => this.persist());
    this.persistQueue = nextPersist.catch(() => undefined);
    await nextPersist;
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeSnapshot(value: unknown): AccountSnapshot {
  if (!value || typeof value !== "object") {
    return { ...EMPTY_SNAPSHOT };
  }
  const record = value as Partial<AccountSnapshot>;
  return {
    users: Array.isArray(record.users)
      ? record.users.map((user) => {
          const userRecord = user as Partial<AccountUserRecord>;
          return {
            ...userRecord,
            accessToken:
              typeof userRecord.accessToken === "string" ? userRecord.accessToken : randomUUID(),
          } as AccountUserRecord;
        })
      : [],
    workspaces: Array.isArray(record.workspaces) ? record.workspaces : [],
    projects: Array.isArray(record.projects) ? record.projects : [],
  };
}

function slugifyProjectName(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
  return slug || "project";
}

function isSameOrChildPath(candidatePath: string, parentPath: string): boolean {
  return (
    candidatePath === parentPath ||
    candidatePath.startsWith(`${parentPath}/`) ||
    candidatePath.startsWith(`${parentPath}\\`)
  );
}

function upsertById<TRecord>(
  records: TRecord[],
  record: TRecord,
  getId: (record: TRecord) => string,
): TRecord[] {
  const recordId = getId(record);
  return [...records.filter((existing) => getId(existing) !== recordId), record];
}
