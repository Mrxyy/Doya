import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import { ZodError, type ZodType } from "zod";
import type { DaemonNodeRecord } from "../domain.js";
import {
  createGatewayOrder,
  getPaymentGatewayConfig,
  verifyPaymentNotify,
  type PaymentNotifyPayload,
} from "../payment-gateway.js";
import {
  BillingPreflightError,
  NotFoundError,
  NodeSchedulingUnavailableError,
  PricingUnavailableError,
  ReferralConflictError,
  StorageQuotaExceededError,
  UsageBillingConflictError,
  type AdminSessionCleanupTarget,
  type ControlStore,
} from "../store.js";
import {
  adminAdjustmentBodySchema,
  adminBillingQuerySchema,
  allocateSessionWorkDirBodySchema,
  appendMessageBodySchema,
  bindReferralBodySchema,
  billingPreflightBodySchema,
  cleanupDaemonSessionsBodySchema,
  createArtifactBodySchema,
  createFileSnapshotBodySchema,
  createPaymentOrderBodySchema,
  createRuntimeAllocationBodySchema,
  daemonConfigPatchBodySchema,
  createSessionBodySchema,
  loginBodySchema,
  registerBodySchema,
  registerNodeBodySchema,
  recordUsageTurnBodySchema,
  runtimeSyncArtifactBodySchema,
  runtimeSyncEventBodySchema,
  selectRuntimeNodeBodySchema,
  updateBillingSettingsBodySchema,
  updateBillingPlanDefinitionBodySchema,
  updateBillingPlanBodySchema,
  upsertModelPricingBodySchema,
  upsertAgentBindingBodySchema,
  upsertUserDaemonWorkspaceBodySchema,
  updateDaemonNodeBodySchema,
  updateReferralBodySchema,
  updateSessionBodySchema,
  updateStorageQuotaBodySchema,
} from "./schemas.js";

interface AuthContext {
  userId: string;
  accessToken: string;
}

type AuthenticatedRequest = Request & { auth?: AuthContext };

export function createControlApp(store: ControlStore): express.Express {
  const app = express();
  app.use(applyCorsHeaders);
  app.options("*", (_req, res) => {
    res.status(204).end();
  });
  app.use(express.json({ limit: "30mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.post(
    "/api/account/register",
    asyncHandler(async (req, res) => {
      const body = parseBody(registerBodySchema, req.body);
      res.status(201).json(await store.registerOrLogin(body));
    }),
  );

  app.post(
    "/api/account/login",
    asyncHandler(async (req, res) => {
      const body = parseBody(loginBodySchema, req.body);
      res.json(await store.login(body));
    }),
  );

  app.get(
    "/api/account/session",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      const auth = requireRequestAuth(req);
      const user = await store.getUserByToken(auth);
      res.json({ user, accessToken: auth.accessToken });
    }),
  );

  app.get(
    "/api/billing/summary",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      res.json(await store.getBillingSummary({ userId: requireUserId(req) }));
    }),
  );

  app.get(
    "/api/billing/pricing",
    requireAuth(store),
    asyncHandler(async (_req, res) => {
      const pricing = (await store.listModelPricing()).filter((entry) => entry.enabled);
      res.json({ pricing });
    }),
  );

  app.post(
    "/api/billing/payments",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      const config = await getPaymentGatewayConfig();
      if (!config) {
        res.status(503).json({
          error:
            "Payment gateway is not configured. Add $DOYA_CONTROL_HOME/payment.json or set DOYA_PAYMENT_MERCHANT_ID, DOYA_PAYMENT_MERCHANT_KEY, and DOYA_PAYMENT_PUBLIC_BASE_URL.",
        });
        return;
      }
      const body = parseBody(createPaymentOrderBodySchema, req.body);
      const order = await store.createPaymentOrder({
        userId: requireUserId(req),
        planId: body.planId,
        billingPeriod: body.billingPeriod,
        providerType: body.providerType,
      });
      const gatewayOrder = await createGatewayOrder(config, {
        type: body.providerType,
        outTradeNo: order.outTradeNo,
        name: `Doya Pro ${body.billingPeriod}`,
        money: order.amountCny.toFixed(2),
        clientIp: getClientIp(req),
        device: "jump",
        param: order.id,
      });
      const updatedOrder = await store.updatePaymentOrderGatewayResult({
        orderId: order.id,
        providerTradeNo: gatewayOrder.tradeNo,
        paymentUrl: gatewayOrder.payurl,
        qrcode: gatewayOrder.qrcode,
        urlscheme: gatewayOrder.urlscheme,
        rawGatewayResponse: gatewayOrder.raw,
      });
      res.status(201).json({ order: updatedOrder });
    }),
  );

  app.get(
    "/api/billing/payments/notify",
    asyncHandler(async (req, res) => {
      const config = await getPaymentGatewayConfig();
      if (!config) {
        res.status(503).send("payment gateway not configured");
        return;
      }
      const payload = toPaymentNotifyPayload(req.query);
      if (!verifyPaymentNotify(config, payload)) {
        res.status(400).send("invalid sign");
        return;
      }
      if (payload.trade_status !== "TRADE_SUCCESS") {
        res.status(200).send("success");
        return;
      }
      await store.confirmPaidPaymentOrder({
        outTradeNo: payload.out_trade_no,
        providerTradeNo: payload.trade_no,
        providerType: payload.type,
        amountCny: Number(payload.money),
        rawNotifyPayload: payload,
      });
      res.status(200).send("success");
    }),
  );

  app.post(
    "/api/billing/preflight",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      const body = parseBody(billingPreflightBodySchema, req.body);
      res.json(await store.preflightBilling({ userId: requireUserId(req), ...body }));
    }),
  );

  app.post(
    "/api/billing/referrals/bind",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      const body = parseBody(bindReferralBodySchema, req.body);
      res.status(201).json({
        referral: await store.bindReferralCode({
          inviteeUserId: requireUserId(req),
          code: body.code,
          sourceFingerprint: buildReferralSourceFingerprint(req, body.clientId),
        }),
      });
    }),
  );

  app.post(
    "/api/billing/usage-turns",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      const body = parseBody(recordUsageTurnBodySchema, req.body);
      res.status(201).json(
        await store.recordUsageTurn({
          userId: requireUserId(req),
          sessionId: body.sessionId,
          runtimeId: body.runtimeId,
          nodeId: body.nodeId,
          agentId: body.agentId,
          providerId: body.providerId,
          modelId: body.modelId,
          turnId: body.turnId,
          requestId: body.requestId,
          requestFingerprint: body.requestFingerprint,
          tokens: body.tokens,
        }),
      );
    }),
  );

  app.get(
    "/api/sessions",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
      res.json({ sessions: await store.listSessions({ userId: requireUserId(req), limit }) });
    }),
  );

  app.post(
    "/api/sessions",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      const body = parseBody(createSessionBodySchema, req.body);
      const session = await store.createSession({
        userId: requireUserId(req),
        title: body.title,
        workingContext: body.workingContext,
      });
      res.status(201).json({ session });
    }),
  );

  app.get(
    "/api/sessions/:sessionId",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      res.json({
        session: await store.getSession({
          sessionId: req.params.sessionId,
          userId: requireUserId(req),
        }),
      });
    }),
  );

  app.patch(
    "/api/sessions/:sessionId",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      const body = parseBody(updateSessionBodySchema, req.body);
      res.json({
        session: await store.updateSession({
          sessionId: req.params.sessionId,
          userId: requireUserId(req),
          title: body.title,
          status: body.status,
        }),
      });
    }),
  );

  app.delete(
    "/api/sessions/:sessionId",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      await store.deleteSession({ sessionId: req.params.sessionId, userId: requireUserId(req) });
      res.status(204).end();
    }),
  );

  app.get(
    "/api/sessions/:sessionId/messages",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      res.json({
        messages: await store.listMessages({
          sessionId: req.params.sessionId,
          userId: requireUserId(req),
        }),
      });
    }),
  );

  app.post(
    "/api/sessions/:sessionId/messages",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      const body = parseBody(appendMessageBodySchema, req.body);
      const message = await store.appendMessage({
        sessionId: req.params.sessionId,
        userId: requireUserId(req),
        role: body.role,
        externalId: body.externalId,
        content: body.content,
      });
      res.status(201).json({ message });
    }),
  );

  app.get(
    "/api/sessions/:sessionId/artifacts",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      res.json({
        artifacts: await store.listArtifacts({
          sessionId: req.params.sessionId,
          userId: requireUserId(req),
        }),
      });
    }),
  );

  app.post(
    "/api/sessions/:sessionId/artifacts",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      const body = parseBody(createArtifactBodySchema, req.body);
      const artifact = await store.createArtifact({
        sessionId: req.params.sessionId,
        userId: requireUserId(req),
        type: body.type,
        name: body.name,
        uri: body.uri,
        externalId: body.externalId,
        metadata: body.metadata,
      });
      res.status(201).json({ artifact });
    }),
  );

  app.post(
    "/api/file-snapshots",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      const body = parseBody(createFileSnapshotBodySchema, req.body);
      const snapshot = await store.createFileSnapshot({
        userId: requireUserId(req),
        files: body.files.map((file) => ({
          path: file.path,
          contentBase64: file.contentBase64,
          mode: file.mode ?? null,
        })),
      });
      res.status(201).json({ snapshot });
    }),
  );

  app.get(
    "/api/file-snapshots/:snapshotId",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      res.json({
        snapshot: await store.getFileSnapshot({
          snapshotId: req.params.snapshotId,
          userId: requireUserId(req),
        }),
      });
    }),
  );

  app.post(
    "/api/nodes/register",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      const body = parseBody(registerNodeBodySchema, req.body);
      res.status(201).json({ node: toPublicDaemonNode(await store.registerNode(body)) });
    }),
  );

  app.post(
    "/api/runtime-sync/events",
    asyncHandler(async (req, res) => {
      const body = parseBody(runtimeSyncEventBodySchema, req.body);
      const allocation = await store.getRuntimeAllocationByRuntimeId({
        sessionId: body.sessionId,
        runtimeId: body.runtimeId,
        nodeId: body.nodeId,
      });
      await store.touchRuntimeAllocation({ allocationId: allocation.id });
      const session = await store.getSession({ sessionId: body.sessionId });
      const synced = await appendRuntimeSyncEvent({
        store,
        userId: session.userId,
        sessionId: session.id,
        runtimeId: body.runtimeId,
        nodeId: body.nodeId,
        agentId: body.agentId,
        providerId: allocation.providerId,
        modelId: allocation.modelId,
        event: body.event,
      });
      res.status(201).json({ synced });
    }),
  );

  app.post(
    "/api/runtime-sync/artifacts",
    asyncHandler(async (req, res) => {
      const body = parseBody(runtimeSyncArtifactBodySchema, req.body);
      const allocation = await store.getRuntimeAllocationByRuntimeId({
        sessionId: body.sessionId,
        runtimeId: body.runtimeId,
        nodeId: body.nodeId,
      });
      await store.touchRuntimeAllocation({ allocationId: allocation.id });
      const session = await store.getSession({ sessionId: body.sessionId });
      const artifact = await store.createArtifact({
        sessionId: session.id,
        userId: session.userId,
        type: body.artifact.type,
        name: body.artifact.name,
        uri: body.artifact.uri,
        externalId:
          body.artifact.externalId ??
          buildRuntimeArtifactExternalId({
            runtimeId: body.runtimeId,
            agentId: body.agentId,
            uri: body.artifact.uri,
          }),
        metadata: body.artifact.metadata ?? null,
      });
      res.status(201).json({ artifact });
    }),
  );

  app.get(
    "/api/nodes",
    requireAuth(store),
    asyncHandler(async (_req, res) => {
      res.json({ nodes: (await store.listNodes()).map(toPublicDaemonNode) });
    }),
  );

  app.post(
    "/api/scheduler/runtime-node",
    asyncHandler(async (req, res) => {
      const body = parseBody(selectRuntimeNodeBodySchema, req.body);
      const selection = await store.selectRuntimeNode({
        providerId: body.providerId,
        modelId: body.modelId,
      });
      res.json({
        node: toSchedulerDaemonNode(selection.node),
        selectionReason: selection.selectionReason,
      });
    }),
  );

  app.get(
    "/api/admin/daemon-overview",
    requireAuth(store),
    asyncHandler(async (_req, res) => {
      const overview = await store.getAdminOverview();
      res.json({
        ...overview,
        daemonNodes: await Promise.all(
          overview.daemonNodes.map(async (summary) => {
            const node = await store.getNode(summary.node.id);
            return Object.assign({}, summary, {
              load: await getDaemonLoad(node).catch((error) => ({
                status: "unavailable" as const,
                error: error instanceof Error ? error.message : "Unable to read daemon load",
              })),
            });
          }),
        ),
      });
    }),
  );

  app.get(
    "/api/admin/billing/overview",
    requireAuth(store),
    asyncHandler(async (_req, res) => {
      res.json(await store.getAdminBillingOverview());
    }),
  );

  app.get(
    "/api/admin/billing",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      const query = parseBody(adminBillingQuerySchema, req.query);
      res.json(await store.getAdminBillingState(normalizeUsageFilters(query)));
    }),
  );

  app.patch(
    "/api/admin/billing/settings",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      const body = parseBody(updateBillingSettingsBodySchema, req.body);
      res.json({ settings: await store.updateBillingSettings(body) });
    }),
  );

  app.patch(
    "/api/admin/billing/plans",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      const body = parseBody(updateBillingPlanDefinitionBodySchema, req.body);
      res.json({ plan: await store.updateBillingPlanDefinition(body) });
    }),
  );

  app.get(
    "/api/admin/billing/pricing",
    requireAuth(store),
    asyncHandler(async (_req, res) => {
      res.json({ pricing: await store.listModelPricing() });
    }),
  );

  app.post(
    "/api/admin/billing/pricing",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      const body = parseBody(upsertModelPricingBodySchema, req.body);
      res.status(201).json({ pricing: await store.upsertModelPricing(body) });
    }),
  );

  app.post(
    "/api/admin/billing/adjustments",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      const body = parseBody(adminAdjustmentBodySchema, req.body);
      res.status(201).json(await store.createAdminAdjustment(body));
    }),
  );

  app.post(
    "/api/admin/billing/top-ups",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      const body = parseBody(adminAdjustmentBodySchema, req.body);
      res.status(201).json(await store.createAdminTopUp(body));
    }),
  );

  app.patch(
    "/api/admin/billing/users/plan",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      const body = parseBody(updateBillingPlanBodySchema, req.body);
      res.json(await store.updateBillingAccountPlan(body));
    }),
  );

  app.patch(
    "/api/admin/billing/storage",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      const body = parseBody(updateStorageQuotaBodySchema, req.body);
      res.json({ storageQuota: await store.updateStorageQuota(body) });
    }),
  );

  app.post(
    "/api/admin/billing/storage/rescan",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      const body = parseBody(updateStorageQuotaBodySchema.pick({ userId: true }), req.body);
      res.json({ storageQuota: await rescanUserStorage({ store, userId: body.userId }) });
    }),
  );

  app.post(
    "/api/billing/storage/rescan",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      res.json({ storageQuota: await rescanUserStorage({ store, userId: requireUserId(req) }) });
    }),
  );

  app.patch(
    "/api/admin/billing/referrals/:referralId",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      const body = parseBody(updateReferralBodySchema, req.body);
      res.json({
        referral: await store.updateReferral({
          referralId: req.params.referralId,
          status: body.status,
          rejectReason: body.rejectReason,
        }),
      });
    }),
  );

  app.patch(
    "/api/admin/nodes/:nodeId",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      const body = parseBody(updateDaemonNodeBodySchema, req.body);
      res.json({
        node: toPublicDaemonNode(
          await store.updateNode({
            nodeId: req.params.nodeId,
            status: body.status,
          }),
        ),
      });
    }),
  );

  app.delete(
    "/api/admin/nodes/:nodeId",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      await store.removeNode(req.params.nodeId);
      res.status(204).end();
    }),
  );

  app.post(
    "/api/admin/nodes/:nodeId/restart",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      const node = await store.getNode(req.params.nodeId);
      res.status(202).json({
        restart: await restartDaemonNode(node),
      });
    }),
  );

  app.get(
    "/api/admin/nodes/:nodeId/config",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      const node = await store.getNode(req.params.nodeId);
      res.json({ config: await getDaemonConfig(node) });
    }),
  );

  app.patch(
    "/api/admin/nodes/:nodeId/config",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      const body = parseBody(daemonConfigPatchBodySchema, req.body);
      const node = await store.getNode(req.params.nodeId);
      res.json({ config: await patchDaemonConfig(node, body) });
    }),
  );

  app.post(
    "/api/admin/nodes/:nodeId/cleanup-sessions",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      const body = parseBody(cleanupDaemonSessionsBodySchema, req.body);
      const targets = await store.getAdminSessionCleanupTargets({
        nodeId: req.params.nodeId,
        sessionIds: body.sessionIds,
      });
      const node = await store.getNode(req.params.nodeId);
      const workDirCleanup = body.deleteWorkDirs
        ? await deleteDaemonSessionWorkDirs({ node, targets })
        : { deleted: [], failed: [] };
      const controlCleanup = await store.cleanupAdminSessions({
        nodeId: req.params.nodeId,
        sessionIds: targets.map((target) => target.session.id),
        deleteSessions: body.deleteSessions ?? true,
        workDirDeletedSessionIds: workDirCleanup.deleted.map((entry) => entry.sessionId),
      });
      res.json({
        cleanup: {
          requestedSessionCount: body.sessionIds.length,
          matchedSessionCount: targets.length,
          ...controlCleanup,
          workDirCleanup,
        },
      });
    }),
  );

  app.get(
    "/api/nodes/:nodeId/user-workspace",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      res.json({
        workspace: await store.getUserDaemonWorkspace({
          userId: requireUserId(req),
          nodeId: req.params.nodeId,
        }),
      });
    }),
  );

  app.post(
    "/api/nodes/:nodeId/user-workspace",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      const body = parseBody(upsertUserDaemonWorkspaceBodySchema, req.body);
      res.status(201).json({
        workspace: await store.upsertUserDaemonWorkspace({
          userId: requireUserId(req),
          nodeId: req.params.nodeId,
          workspaceDir: body.workspaceDir,
          status: body.status,
        }),
      });
    }),
  );

  app.get(
    "/api/sessions/:sessionId/agent-binding",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      const userId = requireUserId(req);
      const binding = await store.getActiveAgentBinding({
        sessionId: req.params.sessionId,
        userId,
      });
      if (!binding) {
        res.json({ binding: null, node: null });
        return;
      }
      const node = await store.getNode(binding.nodeId).catch(() => null);
      res.json({ binding, node: node ? toPublicDaemonNode(node) : null });
    }),
  );

  app.post(
    "/api/nodes/:nodeId/user-workspace/ensure",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      const userId = requireUserId(req);
      const existing = await store.getUserDaemonWorkspace({
        userId,
        nodeId: req.params.nodeId,
      });
      if (existing) {
        res.json({ workspace: existing });
        return;
      }
      const node = await store.getNode(req.params.nodeId);
      const daemonWorkspace = await ensureDaemonUserWorkspace({ node, userId });
      res.status(201).json({
        workspace: await store.upsertUserDaemonWorkspace({
          userId,
          nodeId: req.params.nodeId,
          workspaceDir: daemonWorkspace.workspace.workspaceDir,
          status: "active",
        }),
      });
    }),
  );

  app.post(
    "/api/sessions/:sessionId/agent-binding",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      const body = parseBody(upsertAgentBindingBodySchema, req.body);
      const userId = requireUserId(req);
      await store.preflightBilling({ userId });
      const binding = await store.upsertAgentBinding({
        sessionId: req.params.sessionId,
        userId,
        nodeId: body.nodeId,
        agentId: body.agentId,
        userWorkspaceId: body.userWorkspaceId,
        workspaceId: body.workspaceId,
        cwd: body.cwd,
        status: body.status,
      });
      const node = await store.getNode(binding.nodeId).catch(() => null);
      res.status(201).json({ binding, node: node ? toPublicDaemonNode(node) : null });
    }),
  );

  app.post(
    "/api/sessions/:sessionId/workdir",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      const userId = requireUserId(req);
      const body = parseBody(allocateSessionWorkDirBodySchema, req.body);
      const userWorkspace = await store.getUserDaemonWorkspace({
        userId,
        nodeId: body.nodeId,
      });
      if (!userWorkspace) {
        throw new NotFoundError("User daemon workspace not found");
      }
      await preflightRuntimeBilling({
        store,
        userId,
        providerId: body.providerId,
        modelId: body.modelId,
      });
      const node = await store.getSchedulableNode(body.nodeId);
      const allocation = await allocateDaemonSessionWorkDir({
        node,
        userId,
        sessionId: req.params.sessionId,
      });
      const runtime = await store.createRuntimeAllocation({
        sessionId: req.params.sessionId,
        userId,
        nodeId: body.nodeId,
        runtimeId: body.runtimeId ?? `rt_${req.params.sessionId}`,
        providerId: body.providerId,
        modelId: body.modelId,
        selectionReason: body.selectionReason,
        userWorkspaceId: userWorkspace.id,
        workspaceDir: allocation.workDir,
        status: "running",
      });
      res.status(201).json({ runtime, userWorkspace });
    }),
  );

  app.post(
    "/api/sessions/:sessionId/runtimes",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      const body = parseBody(createRuntimeAllocationBodySchema, req.body);
      const userId = requireUserId(req);
      await preflightRuntimeBilling({
        store,
        userId,
        providerId: body.providerId,
        modelId: body.modelId,
      });
      await store.getSchedulableNode(body.nodeId);
      const runtime = await store.createRuntimeAllocation({
        sessionId: req.params.sessionId,
        userId,
        nodeId: body.nodeId,
        runtimeId: body.runtimeId,
        providerId: body.providerId,
        modelId: body.modelId,
        selectionReason: body.selectionReason,
        userWorkspaceId: body.userWorkspaceId,
        workspaceDir: body.workspaceDir,
        status: body.status,
      });
      res.status(201).json({ runtime });
    }),
  );

  app.get(
    "/api/sessions/:sessionId/runtimes/active",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      res.json({
        runtime: await store.getActiveRuntime({
          sessionId: req.params.sessionId,
          userId: requireUserId(req),
        }),
      });
    }),
  );

  app.use(errorHandler);
  return app;
}

function requireAuth(store: ControlStore) {
  return asyncHandler(async (req: AuthenticatedRequest, res, next) => {
    const userId = readHeader(req, "x-doya-user-id");
    const accessToken = readAuthorizationBearer(req) ?? readHeader(req, "x-doya-access-token");
    if (!userId || !accessToken) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    await store.getUserByToken({ userId, accessToken });
    req.auth = { userId, accessToken };
    next();
  });
}

function requireUserId(req: Request): string {
  return requireRequestAuth(req).userId;
}

function getClientIp(req: Request): string {
  const forwardedFor = req.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string") {
    return forwardedFor.split(",")[0]?.trim() || req.ip || "127.0.0.1";
  }
  return req.ip || req.socket.remoteAddress || "127.0.0.1";
}

function toPaymentNotifyPayload(query: Request["query"]): PaymentNotifyPayload {
  const payload: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === "string") {
      payload[key] = value;
    }
  }
  return payload as unknown as PaymentNotifyPayload;
}

function normalizeUsageFilters(input: {
  userId?: string;
  sessionId?: string;
  providerId?: string;
  modelId?: string;
  planId?: string;
  startAt?: string;
  endAt?: string;
}) {
  return {
    userId: normalizeQueryString(input.userId),
    sessionId: normalizeQueryString(input.sessionId),
    providerId: normalizeQueryString(input.providerId),
    modelId: normalizeQueryString(input.modelId),
    planId: normalizeQueryString(input.planId),
    startAt: normalizeQueryString(input.startAt),
    endAt: normalizeQueryString(input.endAt),
  };
}

function normalizeQueryString(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function buildReferralSourceFingerprint(req: Request, clientId: string | null | undefined): string {
  const clientPart = clientId?.trim() || readHeader(req, "x-doya-client-id") || "client:unknown";
  const ipPart = req.ip || req.socket.remoteAddress || "ip:unknown";
  return `${clientPart}:${ipPart}`;
}

async function preflightRuntimeBilling(input: {
  store: ControlStore;
  userId: string;
  providerId?: string | null;
  modelId?: string | null;
}): Promise<void> {
  if (!input.providerId || !input.modelId) {
    return;
  }
  await input.store.preflightBilling({
    userId: input.userId,
    providerId: input.providerId,
    modelId: input.modelId,
  });
}

function requireRequestAuth(req: Request): AuthContext {
  const auth = (req as AuthenticatedRequest).auth;
  if (!auth) {
    throw new Error("Missing auth context");
  }
  return auth;
}

function readHeader(req: Request, name: string): string | null {
  const value = req.header(name);
  return value && value.trim().length > 0 ? value.trim() : null;
}

function readAuthorizationBearer(req: Request): string | null {
  const header = req.header("authorization");
  if (!header) {
    return null;
  }
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() || null;
}

function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  return schema.parse(body);
}

function applyCorsHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Doya-User-Id, X-Doya-Access-Token",
  );
  res.header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  next();
}

function asyncHandler(handler: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      next(error);
    }
  };
}

function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (error instanceof ZodError) {
    res.status(400).json({ error: error.issues[0]?.message ?? "Invalid request" });
    return;
  }
  if (error instanceof NotFoundError) {
    res.status(404).json({ error: error.message });
    return;
  }
  if (
    error instanceof BillingPreflightError ||
    error instanceof PricingUnavailableError ||
    error instanceof StorageQuotaExceededError
  ) {
    res.status(402).json({ error: error.message });
    return;
  }
  if (
    error instanceof UsageBillingConflictError ||
    error instanceof ReferralConflictError ||
    error instanceof NodeSchedulingUnavailableError
  ) {
    res.status(409).json({ error: error.message });
    return;
  }
  const message = error instanceof Error ? error.message : "Request failed";
  res.status(400).json({ error: message });
}

function toPublicDaemonNode(node: DaemonNodeRecord): Omit<DaemonNodeRecord, "runtimeAuthToken"> {
  const { runtimeAuthToken: _runtimeAuthToken, ...publicNode } = node;
  return publicNode;
}

function toSchedulerDaemonNode(node: DaemonNodeRecord): {
  id: string;
  endpoint: string;
  status: DaemonNodeRecord["status"];
  lastHeartbeatAt: string;
} {
  return {
    id: node.id,
    endpoint: node.endpoint,
    status: node.status,
    lastHeartbeatAt: node.lastHeartbeatAt,
  };
}

async function ensureDaemonUserWorkspace(input: {
  node: DaemonNodeRecord;
  userId: string;
}): Promise<{ workspace: { workspaceDir: string } }> {
  try {
    return await postDaemonJson<{ workspace: { workspaceDir: string } }>(
      input.node,
      "/api/user-workspaces/ensure",
      { userId: input.userId },
    );
  } catch (error) {
    if (!isDaemonRouteMissingError(error)) {
      throw error;
    }
    return {
      workspace: {
        workspaceDir: path.join(resolveDaemonHome(input.node), "user-workspaces", input.userId),
      },
    };
  }
}

async function allocateDaemonSessionWorkDir(input: {
  node: DaemonNodeRecord;
  userId: string;
  sessionId: string;
}): Promise<{ workDir: string }> {
  try {
    return await postDaemonJson<{ workDir: string }>(
      input.node,
      "/api/user-workspaces/session-workdirs",
      {
        userId: input.userId,
        sessionId: input.sessionId,
      },
    );
  } catch (error) {
    if (!isDaemonRouteMissingError(error)) {
      throw error;
    }
    return {
      workDir: path.join(
        resolveDaemonHome(input.node),
        "user-workspaces",
        input.userId,
        "sessions",
        input.sessionId,
      ),
    };
  }
}

async function getDaemonLoad(node: DaemonNodeRecord): Promise<DaemonLoadResult> {
  return await requestDaemonJson<DaemonLoadResult>(node, {
    method: "GET",
    endpointPath: "/api/admin/daemon/load",
  });
}

async function restartDaemonNode(node: DaemonNodeRecord): Promise<DaemonRestartResult> {
  return await requestDaemonJson<DaemonRestartResult>(node, {
    method: "POST",
    endpointPath: "/api/admin/daemon/restart",
    body: {
      requestId: `control_admin_restart_${node.id}_${Date.now()}`,
      reason: "control_admin_restart",
    },
  });
}

async function getDaemonConfig(node: DaemonNodeRecord): Promise<DaemonMutableConfig> {
  const payload = await requestDaemonJson<{ config: DaemonMutableConfig }>(node, {
    method: "GET",
    endpointPath: "/api/admin/daemon/config",
  });
  return payload.config;
}

async function patchDaemonConfig(
  node: DaemonNodeRecord,
  patch: DaemonMutableConfigPatch,
): Promise<DaemonMutableConfig> {
  const payload = await requestDaemonJson<{ config: DaemonMutableConfig }>(node, {
    method: "PATCH",
    endpointPath: "/api/admin/daemon/config",
    body: patch,
  });
  return payload.config;
}

async function deleteDaemonSessionWorkDirs(input: {
  node: DaemonNodeRecord;
  targets: AdminSessionCleanupTarget[];
}): Promise<DaemonSessionWorkDirCleanupResult> {
  const deleted: DaemonDeletedSessionWorkDir[] = [];
  const failed: DaemonFailedSessionWorkDir[] = [];
  const targetsByUserId = new Map<string, string[]>();
  for (const target of input.targets) {
    const current = targetsByUserId.get(target.session.userId) ?? [];
    current.push(target.session.id);
    targetsByUserId.set(target.session.userId, current);
  }
  for (const [userId, sessionIds] of targetsByUserId) {
    try {
      const result = await requestDaemonJson<DaemonSessionWorkDirCleanupResult>(input.node, {
        method: "DELETE",
        endpointPath: "/api/user-workspaces/session-workdirs",
        body: { userId, sessionIds },
      });
      deleted.push(...result.deleted);
      failed.push(...result.failed);
    } catch (error) {
      for (const sessionId of sessionIds) {
        failed.push({
          sessionId,
          error: error instanceof Error ? error.message : "Unable to delete session workdir",
        });
      }
    }
  }
  return { deleted, failed };
}

async function rescanUserStorage(input: { store: ControlStore; userId: string }) {
  const workspaces = await input.store.listUserDaemonWorkspaces({ userId: input.userId });
  if (workspaces.length === 0) {
    return await input.store.updateStorageQuota({
      userId: input.userId,
      generatedBytesUsed: 0,
      lastScannedAt: new Date().toISOString(),
    });
  }
  let totalBytes = 0;
  let scannedAt: string | null = null;
  for (const workspace of workspaces) {
    const node = await input.store.getNode(workspace.nodeId);
    const scan = await scanDaemonUserWorkspace({ node, userId: input.userId });
    totalBytes += scan.totalBytes;
    scannedAt = scan.scannedAt;
  }
  const current = await input.store.getBillingSummary({ userId: input.userId });
  return await input.store.updateStorageQuota({
    userId: input.userId,
    generatedBytesUsed: Math.max(0, totalBytes - current.storageQuota.uploadedBytesUsed),
    lastScannedAt: scannedAt,
  });
}

async function scanDaemonUserWorkspace(input: {
  node: DaemonNodeRecord;
  userId: string;
}): Promise<DaemonUserWorkspaceScanResult> {
  return await postDaemonJson<DaemonUserWorkspaceScanResult>(
    input.node,
    "/api/user-workspaces/scan",
    { userId: input.userId },
  );
}

async function postDaemonJson<TResponse extends object>(
  node: DaemonNodeRecord,
  endpointPath: string,
  body: unknown,
): Promise<TResponse> {
  return await requestDaemonJson<TResponse>(node, { method: "POST", endpointPath, body });
}

async function requestDaemonJson<TResponse extends object>(
  node: DaemonNodeRecord,
  input: {
    method: "DELETE" | "GET" | "PATCH" | "POST";
    endpointPath: string;
    body?: unknown;
  },
): Promise<TResponse> {
  const response = await fetch(
    `${normalizeDaemonHttpBaseUrl(node.endpoint)}${input.endpointPath}`,
    {
      method: input.method,
      headers: {
        "Content-Type": "application/json",
        ...(node.runtimeAuthToken ? { Authorization: `Bearer ${node.runtimeAuthToken}` } : {}),
      },
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
    },
  );
  let payload: TResponse | { error?: string };
  try {
    payload = (await response.json()) as TResponse | { error?: string };
  } catch {
    throw new DaemonApiResponseError(
      `Daemon API returned non-JSON response (${response.status})`,
      response.status,
    );
  }
  if (!response.ok) {
    throw new DaemonApiResponseError(
      "error" in payload && payload.error ? payload.error : "Daemon API request failed",
      response.status,
    );
  }
  return payload as TResponse;
}

interface DaemonLoadResult {
  status: "ok";
  nodeId: string;
  sampledAt: string;
  cpu: {
    loadAverage: number[];
  };
  memory: {
    totalBytes: number;
    freeBytes: number;
    usedBytes: number;
    usedRatio: number;
  };
  disk: {
    totalBytes: number;
    freeBytes: number;
    usedBytes: number;
    usedRatio: number;
  } | null;
  uptimeSeconds: number;
}

interface DaemonRestartResult {
  status: "restart_requested";
  nodeId: string;
  requestId: string;
  reason: string;
}

interface DaemonMutableConfig {
  mcp: {
    injectIntoAgents: boolean;
  };
  appendSystemPrompt: string;
}

interface DaemonMutableConfigPatch {
  mcp?: {
    injectIntoAgents?: boolean;
  };
  appendSystemPrompt?: string;
}

interface DaemonDeletedSessionWorkDir {
  sessionId: string;
  workDir: string;
  deleted: boolean;
}

interface DaemonFailedSessionWorkDir {
  sessionId: string;
  error: string;
}

interface DaemonSessionWorkDirCleanupResult {
  deleted: DaemonDeletedSessionWorkDir[];
  failed: DaemonFailedSessionWorkDir[];
}

interface DaemonUserWorkspaceScanResult {
  workspace: {
    workspaceDir: string;
  };
  totalBytes: number;
  fileCount: number;
  scannedAt: string;
}

class DaemonApiResponseError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function isDaemonRouteMissingError(error: unknown): boolean {
  return error instanceof DaemonApiResponseError && error.status === 404;
}

function resolveDaemonHome(node: DaemonNodeRecord): string {
  if (node.doyaHome) {
    return node.doyaHome;
  }
  return process.env.DOYA_HOME ?? path.join(process.env.HOME ?? ".", ".doya");
}

function normalizeDaemonHttpBaseUrl(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/$/, "");
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  if (trimmed.startsWith("ws://")) {
    return `http://${trimmed.slice("ws://".length)}`;
  }
  if (trimmed.startsWith("wss://")) {
    return `https://${trimmed.slice("wss://".length)}`;
  }
  return `http://${trimmed}`;
}

async function appendRuntimeSyncEvent(input: {
  store: ControlStore;
  userId: string;
  sessionId: string;
  runtimeId: string;
  nodeId: string;
  agentId: string;
  providerId: string | null;
  modelId: string | null;
  event: unknown;
}): Promise<boolean> {
  const status = readRuntimeSessionStatus(input.event);
  if (status) {
    const usage = readRuntimeBillingUsage(input.event);
    if (usage) {
      if (input.providerId && input.modelId) {
        await input.store.recordUsageTurn({
          userId: input.userId,
          sessionId: input.sessionId,
          runtimeId: input.runtimeId,
          nodeId: input.nodeId,
          agentId: input.agentId,
          providerId: input.providerId,
          modelId: input.modelId,
          turnId: usage.turnId,
          requestId: `${input.runtimeId}:${input.agentId}:${usage.turnId}`,
          tokens: usage.tokens,
        });
      }
    }
    await input.store.updateSession({
      sessionId: input.sessionId,
      userId: input.userId,
      status,
    });
    scheduleStorageRescanAfterTurn({ store: input.store, userId: input.userId });
    return true;
  }

  const artifact = readRuntimeTimelineArtifact(input.event);
  if (artifact) {
    await input.store.createArtifact({
      sessionId: input.sessionId,
      userId: input.userId,
      type: artifact.type,
      name: artifact.name,
      uri: artifact.uri,
      externalId: buildRuntimeTimelineArtifactExternalId({
        runtimeId: input.runtimeId,
        agentId: input.agentId,
        artifactId: artifact.artifactId,
      }),
      metadata: artifact.metadata,
    });
    return true;
  }

  const timeline = readRuntimeTimelineItem(input.event);
  if (!timeline) {
    return false;
  }
  const externalId = buildRuntimeTimelineExternalId({
    runtimeId: input.runtimeId,
    agentId: input.agentId,
    item: timeline.item,
  });
  await input.store.appendMessage({
    sessionId: input.sessionId,
    userId: input.userId,
    role: timeline.role,
    externalId,
    content: timeline.content,
  });
  return true;
}

function scheduleStorageRescanAfterTurn(input: { store: ControlStore; userId: string }): void {
  void rescanUserStorage(input).catch(() => undefined);
}

function readRuntimeBillingUsage(event: unknown): {
  turnId: string;
  tokens: {
    inputTokens?: number;
    outputTokens?: number;
    cacheCreationTokens?: number;
    cacheReadTokens?: number;
    cachedInputTokens?: number;
    reasoningTokens?: number;
    contextWindowUsedTokens?: number | null;
    contextWindowMaxTokens?: number | null;
  };
} | null {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    return null;
  }
  const eventRecord = event as Record<string, unknown>;
  if (
    eventRecord.type !== "turn_completed" &&
    eventRecord.type !== "turn_failed" &&
    eventRecord.type !== "turn_canceled"
  ) {
    return null;
  }
  const usage = eventRecord.usage;
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) {
    return null;
  }
  const turnId =
    typeof eventRecord.turnId === "string" && eventRecord.turnId.trim()
      ? eventRecord.turnId.trim()
      : null;
  if (!turnId) {
    return null;
  }
  const usageRecord = usage as Record<string, unknown>;
  return {
    turnId,
    tokens: {
      inputTokens: readUsageNumber(usageRecord.inputTokens),
      outputTokens: readUsageNumber(usageRecord.outputTokens),
      cacheCreationTokens: readUsageNumber(usageRecord.cacheCreationTokens),
      cacheReadTokens: readUsageNumber(usageRecord.cacheReadTokens),
      cachedInputTokens: readUsageNumber(usageRecord.cachedInputTokens),
      reasoningTokens: readUsageNumber(usageRecord.reasoningTokens),
      contextWindowUsedTokens: readUsageNumber(usageRecord.contextWindowUsedTokens) ?? null,
      contextWindowMaxTokens: readUsageNumber(usageRecord.contextWindowMaxTokens) ?? null,
    },
  };
}

function readUsageNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readRuntimeSessionStatus(event: unknown): "idle" | "running" | "done" | "error" | null {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    return null;
  }
  const eventRecord = event as Record<string, unknown>;
  switch (eventRecord.type) {
    case "turn_started":
      return "running";
    case "turn_completed":
      return "done";
    case "turn_failed":
      return "error";
    case "turn_canceled":
      return "idle";
    default:
      return null;
  }
}

function readRuntimeTimelineArtifact(event: unknown): {
  artifactId: string;
  type: string;
  name: string;
  uri: string;
  metadata: unknown;
} | null {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    return null;
  }
  const eventRecord = event as Record<string, unknown>;
  if (eventRecord.type !== "timeline") {
    return null;
  }
  const item = eventRecord.item;
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return null;
  }
  const itemRecord = item as Record<string, unknown>;
  if (itemRecord.type !== "artifact") {
    return null;
  }
  const payload = itemRecord.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const payloadRecord = payload as Record<string, unknown>;
  const artifactId = typeof payloadRecord.id === "string" ? payloadRecord.id.trim() : "";
  const type = typeof payloadRecord.type === "string" ? payloadRecord.type.trim() : "";
  const name = typeof payloadRecord.title === "string" ? payloadRecord.title.trim() : "";
  if (!artifactId || !type || !name) {
    return null;
  }
  return {
    artifactId,
    type,
    name,
    uri: `runtime-artifact://${encodeURIComponent(artifactId)}`,
    metadata: {
      source: "runtime_timeline",
      item: itemRecord,
      content: typeof payloadRecord.content === "string" ? payloadRecord.content : "",
      isBase64: payloadRecord.isBase64 === true,
    },
  };
}

function readRuntimeTimelineItem(event: unknown): {
  role: "user" | "assistant" | "system" | "tool";
  item: Record<string, unknown>;
  content: unknown;
} | null {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    return null;
  }
  const eventRecord = event as Record<string, unknown>;
  if (eventRecord.type !== "timeline") {
    return null;
  }
  const item = eventRecord.item;
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return null;
  }
  const itemRecord = item as Record<string, unknown>;
  switch (itemRecord.type) {
    case "user_message":
      return {
        role: "user",
        item: itemRecord,
        content: {
          text: typeof itemRecord.text === "string" ? itemRecord.text : "",
          source: "runtime_timeline",
          item: itemRecord,
        },
      };
    case "assistant_message":
      return {
        role: "assistant",
        item: itemRecord,
        content: {
          text: typeof itemRecord.text === "string" ? itemRecord.text : "",
          source: "runtime_timeline",
          item: itemRecord,
        },
      };
    case "reasoning":
    case "todo":
    case "compaction":
    case "error":
      return {
        role: "system",
        item: itemRecord,
        content: {
          source: "runtime_timeline",
          item: itemRecord,
        },
      };
    case "tool_call":
      return {
        role: "tool",
        item: itemRecord,
        content: {
          source: "runtime_timeline",
          item: itemRecord,
        },
      };
    default:
      return null;
  }
}

function buildRuntimeTimelineExternalId(input: {
  runtimeId: string;
  agentId: string;
  item: Record<string, unknown>;
}): string {
  const messageId = typeof input.item.messageId === "string" ? input.item.messageId : null;
  const callId =
    readNestedString(input.item, ["detail", "callId"]) ??
    readNestedString(input.item, ["detail", "id"]);
  const stableId = messageId ?? callId ?? hashStableJson(input.item);
  return `runtime:${input.runtimeId}:agent:${input.agentId}:timeline:${input.item.type}:${stableId}`;
}

function readNestedString(value: unknown, pathSegments: string[]): string | null {
  let cursor = value;
  for (const key of pathSegments) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) {
      return null;
    }
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return typeof cursor === "string" ? cursor : null;
}

function hashStableJson(value: unknown): string {
  const text = JSON.stringify(value) ?? "";
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function buildRuntimeArtifactExternalId(input: {
  runtimeId: string;
  agentId: string;
  uri: string;
}): string {
  return `runtime:${input.runtimeId}:agent:${input.agentId}:artifact:${hashStableJson(input.uri)}`;
}

function buildRuntimeTimelineArtifactExternalId(input: {
  runtimeId: string;
  agentId: string;
  artifactId: string;
}): string {
  return `runtime:${input.runtimeId}:agent:${input.agentId}:timeline:artifact:${input.artifactId}`;
}
