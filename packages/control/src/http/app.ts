import path from "node:path";
import { appendFile } from "node:fs/promises";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { Transform } from "node:stream";
import * as zlib from "node:zlib";
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
  resolveSmsVerificationConfig,
  SmsVerificationError,
  SmsVerificationService,
} from "../sms-verification-service.js";
import {
  AuthenticationError,
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
  daemonCommandResultBodySchema,
  daemonConfigPatchBodySchema,
  createSessionBodySchema,
  loginBodySchema,
  pollDaemonCommandsBodySchema,
  smsLoginBodySchema,
  smsSendBodySchema,
  registerBodySchema,
  registerNodeBodySchema,
  recordUsageTurnBodySchema,
  runtimeSyncArtifactBodySchema,
  runtimeSyncEventBodySchema,
  runtimeNodePreferenceBodySchema,
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
import {
  DaemonCommandBroker,
  DaemonCommandFailedError,
  DaemonCommandTimeoutError,
} from "./daemon-command-broker.js";

interface AuthContext {
  userId: string;
  accessToken: string;
}

type AuthenticatedRequest = Request & { auth?: AuthContext };

interface ManagedCodexConfig {
  enabled: boolean;
  baseUrl: string | null;
  apiKey: string | null;
  model: string | null;
}

const MANAGED_CODEX_ENV = {
  baseUrl: "DOYA_CONTROL_MANAGED_CODEX_BASE_URL",
  apiKey: "DOYA_CONTROL_MANAGED_CODEX_API_KEY",
  model: "DOYA_CONTROL_MANAGED_CODEX_MODEL",
} as const;
const AI_GATEWAY_ENV = {
  publicBaseUrl: "DOYA_CONTROL_AI_GATEWAY_PUBLIC_BASE_URL",
  upstreamBaseUrl: "DOYA_CONTROL_AI_GATEWAY_UPSTREAM_BASE_URL",
  upstreamApiKey: "DOYA_CONTROL_AI_GATEWAY_UPSTREAM_API_KEY",
} as const;
const DEFAULT_MANAGED_CODEX_BASE_URL = "https://csdn.cloud";
const DEFAULT_AI_GATEWAY_UPSTREAM_BASE_URL = "https://csdn.cloud";
const DEFAULT_AI_GATEWAY_UPSTREAM_API_KEY =
  "sk-874f7c0d65235c3b3b5a0f1fbb9d39311e1bdf04f08d48ef8d62c46c647216d4";
const AI_GATEWAY_DEBUG_LOG_PATH = "/tmp/doya-ai-gateway.log";

export function createControlApp(store: ControlStore): express.Express {
  const app = express();
  const daemonCommandBroker = new DaemonCommandBroker();
  const smsVerificationService = new SmsVerificationService(
    resolveSmsVerificationConfig(process.env),
  );
  app.use(applyCorsHeaders);
  app.options("*", (_req, res) => {
    res.status(204).end();
  });
  app.use("/api/ai-gateway", express.raw({ type: "*/*", limit: "30mb" }));
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

  app.post(
    "/api/account/sms/send",
    asyncHandler(async (req, res) => {
      const body = parseBody(smsSendBodySchema, req.body);
      await smsVerificationService.sendLoginCode(body);
      res.json({ ok: true });
    }),
  );

  app.post(
    "/api/account/sms/login",
    asyncHandler(async (req, res) => {
      const body = parseBody(smsLoginBodySchema, req.body);
      const phone = smsVerificationService.verify(body);
      res.json(await store.loginOrRegisterByPhone({ phone }));
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

  app.get(
    "/api/providers/managed-codex",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      const auth = requireRequestAuth(req);
      const billingSummary = await store.getBillingSummary({ userId: auth.userId });
      res.json({
        codex: await resolveManagedCodexConfig({
          env: process.env,
          store,
          auth,
          balanceCny: billingSummary.balanceCny,
          requestBaseUrl: getRequestBaseUrl(req),
        }),
      });
    }),
  );

  app.all(
    "/api/ai-gateway/*",
    asyncHandler(async (req, res) => {
      await handleAiGatewayRequest({ store, req, res });
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
    asyncHandler(async (req, res) => {
      const body = parseBody(registerNodeBodySchema, req.body);
      const auth = await readNodeRegistrationAuth(store, req);
      if (!auth) {
        res.status(401).json({ error: "Daemon node registration authentication required" });
        return;
      }
      if (body.ownerUserId) {
        if (auth.kind !== "user") {
          res.status(403).json({ error: "Daemon owner requires user authentication" });
          return;
        }
        if (body.ownerUserId !== auth.userId) {
          res.status(403).json({ error: "Daemon owner does not match authenticated user" });
          return;
        }
      }
      res.status(201).json({
        node: toPublicDaemonNode(
          await store.registerNode({
            ...body,
            ownerUserId: body.ownerUserId ?? null,
          }),
        ),
      });
    }),
  );

  app.post(
    "/api/nodes/:nodeId/commands/poll",
    asyncHandler(async (req, res) => {
      const node = await requireRuntimeNodeRequest(store, req, res);
      if (!node) {
        return;
      }
      const body = parseBody(pollDaemonCommandsBodySchema, req.body);
      res.json({
        commands: daemonCommandBroker.takePending(node.id, body.maxCommands ?? 1),
      });
    }),
  );

  app.post(
    "/api/nodes/:nodeId/commands/:commandId/result",
    asyncHandler(async (req, res) => {
      const node = await requireRuntimeNodeRequest(store, req, res);
      if (!node) {
        return;
      }
      const body = parseBody(daemonCommandResultBodySchema, req.body);
      const accepted = daemonCommandBroker.complete(node.id, req.params.commandId, body);
      res.status(accepted ? 202 : 404).json({ accepted });
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
        daemonCommandBroker,
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
      const auth = await readOptionalAuth(store, req);
      const selection = await store.selectRuntimeNode({
        userId: auth?.userId,
        nodeId: body.nodeId,
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
    "/api/scheduler/runtime-node-preference",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      const preference = await store.getRuntimeNodePreference({ userId: requireUserId(req) });
      res.json({ preference: preference ?? { mode: "cloud", nodeId: null } });
    }),
  );

  app.get(
    "/api/scheduler/runtime-node-options",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      const userId = requireUserId(req);
      const preference = await store.getRuntimeNodePreference({ userId });
      const nodes = await store.listRuntimeNodeOptions({ userId });
      res.json({
        preference: preference ?? { mode: "cloud", nodeId: null },
        nodes: nodes.map(toSchedulerDaemonNode),
      });
    }),
  );

  app.patch(
    "/api/scheduler/runtime-node-preference",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      const body = parseBody(runtimeNodePreferenceBodySchema, req.body);
      const preference = await store.setRuntimeNodePreference({
        userId: requireUserId(req),
        mode: body.mode,
        nodeId: body.mode === "fixed" ? body.nodeId : null,
      });
      res.json({ preference });
    }),
  );

  app.get(
    "/api/admin/daemon-overview",
    asyncHandler(async (_req, res) => {
      const overview = await store.getAdminOverview();
      res.json({
        ...overview,
        daemonNodes: await Promise.all(
          overview.daemonNodes.map(async (summary) => {
            const node = await store.getNode(summary.node.id);
            return Object.assign({}, summary, {
              load: await getDaemonLoad(node, daemonCommandBroker).catch((error) => ({
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
      res.json({
        storageQuota: await rescanUserStorage({
          store,
          userId: body.userId,
          daemonCommandBroker,
        }),
      });
    }),
  );

  app.post(
    "/api/billing/storage/rescan",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      res.json({
        storageQuota: await rescanUserStorage({
          store,
          userId: requireUserId(req),
          daemonCommandBroker,
        }),
      });
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
        restart: await restartDaemonNode(node, daemonCommandBroker),
      });
    }),
  );

  app.get(
    "/api/admin/nodes/:nodeId/config",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      const node = await store.getNode(req.params.nodeId);
      res.json({ config: await getDaemonConfig(node, daemonCommandBroker) });
    }),
  );

  app.patch(
    "/api/admin/nodes/:nodeId/config",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      const body = parseBody(daemonConfigPatchBodySchema, req.body);
      const node = await store.getNode(req.params.nodeId);
      res.json({ config: await patchDaemonConfig(node, body, daemonCommandBroker) });
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
        ? await deleteDaemonSessionWorkDirs({ node, targets, daemonCommandBroker })
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
      const daemonWorkspace = await ensureDaemonUserWorkspace({
        node,
        userId,
        daemonCommandBroker,
      });
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
        daemonCommandBroker,
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

async function resolveManagedCodexConfig(input: {
  env: NodeJS.ProcessEnv;
  store: ControlStore;
  auth: AuthContext;
  balanceCny: number;
  requestBaseUrl: string;
}): Promise<ManagedCodexConfig> {
  const { env } = input;
  const baseUrl = trimEnv(env[MANAGED_CODEX_ENV.baseUrl]) ?? DEFAULT_MANAGED_CODEX_BASE_URL;
  const explicitApiKey = trimEnv(env[MANAGED_CODEX_ENV.apiKey]);
  const model = trimEnv(env[MANAGED_CODEX_ENV.model]);

  if (explicitApiKey) {
    return {
      enabled: Boolean(baseUrl),
      baseUrl,
      apiKey: explicitApiKey,
      model,
    };
  }

  const upstreamApiKey = resolveAiGatewayUpstreamApiKey(env);
  if (upstreamApiKey && input.balanceCny > 0) {
    const runtimeKey = await input.store.issueManagedRuntimeKey({
      userId: input.auth.userId,
      scope: "codex_gateway",
    });
    return {
      enabled: true,
      baseUrl: `${resolveAiGatewayPublicBaseUrl(env, input.requestBaseUrl)}/api/ai-gateway`,
      apiKey: runtimeKey.key,
      model,
    };
  }

  return {
    enabled: false,
    baseUrl: null,
    apiKey: null,
    model,
  };
}

async function handleAiGatewayRequest(input: {
  store: ControlStore;
  req: Request;
  res: Response;
}): Promise<void> {
  const runtimeKey = readAuthorizationBearer(input.req);
  if (!runtimeKey) {
    input.res.status(401).json({ error: "AI Gateway authentication required" });
    return;
  }
  const keyRecord = await input.store.resolveManagedRuntimeKey({
    key: runtimeKey,
    scope: "codex_gateway",
  });
  if (!keyRecord) {
    input.res.status(401).json({ error: "Invalid AI Gateway key" });
    return;
  }
  const billingSummary = await input.store.getBillingSummary({ userId: keyRecord.userId });
  if (billingSummary.balanceCny <= 0) {
    input.res.status(402).json({ error: "Doya AI usage balance is exhausted" });
    return;
  }
  const upstreamApiKey = resolveAiGatewayUpstreamApiKey(process.env);
  if (!upstreamApiKey) {
    input.res.status(503).json({ error: "AI Gateway upstream is not configured" });
    return;
  }

  const upstreamBaseUrl =
    trimEnv(process.env[AI_GATEWAY_ENV.upstreamBaseUrl]) ?? DEFAULT_AI_GATEWAY_UPSTREAM_BASE_URL;
  await proxyAiGatewayRequest({
    store: input.store,
    req: input.req,
    res: input.res,
    userId: keyRecord.userId,
    upstreamBaseUrl,
    upstreamApiKey,
  });
}

function buildAiGatewayUpstreamHeaders(
  req: Request,
  upstreamApiKey: string,
): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(req.headers)) {
    const lowerName = name.toLowerCase();
    if (
      lowerName === "authorization" ||
      lowerName === "accept-encoding" ||
      lowerName === "host" ||
      lowerName === "content-length" ||
      lowerName === "connection" ||
      lowerName === "keep-alive" ||
      lowerName === "proxy-authenticate" ||
      lowerName === "proxy-authorization" ||
      lowerName === "te" ||
      lowerName === "trailer" ||
      lowerName === "transfer-encoding" ||
      lowerName === "upgrade"
    ) {
      continue;
    }
    if (Array.isArray(value)) {
      headers[name] = value.join(", ");
    } else if (typeof value === "string") {
      headers[name] = value;
    }
  }
  headers.Authorization = `Bearer ${upstreamApiKey}`;
  headers["Accept-Encoding"] = "identity";
  return headers;
}

function writeAiGatewayDebugLog(fields: Record<string, unknown>): void {
  void appendFile(
    AI_GATEWAY_DEBUG_LOG_PATH,
    `${JSON.stringify({ time: new Date().toISOString(), ...fields })}\n`,
  ).catch(() => {});
}

function buildAiGatewayUpstreamUrl(req: Request, upstreamBaseUrl: string): URL {
  const gatewayPrefix = "/api/ai-gateway";
  const rawPath = req.originalUrl.startsWith(gatewayPrefix)
    ? req.originalUrl.slice(gatewayPrefix.length)
    : req.url;
  return new URL(rawPath || "/", withTrailingSlash(upstreamBaseUrl));
}

function readGatewayRequestBody(req: Request): Buffer {
  if (Buffer.isBuffer(req.body)) {
    return req.body;
  }
  if (typeof req.body === "string") {
    return Buffer.from(req.body);
  }
  if (req.body === undefined || req.body === null) {
    return Buffer.alloc(0);
  }
  return Buffer.from(JSON.stringify(req.body));
}

function copyRawGatewayResponseHeaders(
  headers: Record<string, number | string | string[] | undefined>,
  res: Response,
  options: { decodedContent: boolean },
): void {
  for (const [name, value] of Object.entries(headers)) {
    const lowerName = name.toLowerCase();
    if (
      value === undefined ||
      (options.decodedContent &&
        (lowerName === "content-encoding" || lowerName === "content-length")) ||
      lowerName === "connection" ||
      lowerName === "keep-alive" ||
      lowerName === "proxy-authenticate" ||
      lowerName === "proxy-authorization" ||
      lowerName === "te" ||
      lowerName === "trailer" ||
      lowerName === "transfer-encoding" ||
      lowerName === "upgrade"
    ) {
      continue;
    }
    res.setHeader(name, value);
  }
}

function createGatewayContentDecoder(contentEncoding: string): Transform | null {
  const encoding = contentEncoding
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .at(-1);
  if (!encoding || encoding === "identity") {
    return null;
  }
  if (encoding === "gzip" || encoding === "x-gzip") {
    return zlib.createGunzip();
  }
  if (encoding === "br") {
    return zlib.createBrotliDecompress();
  }
  if (encoding === "deflate") {
    return zlib.createInflate();
  }
  if (encoding === "zstd") {
    const createZstdDecompress = (zlib as typeof zlib & { createZstdDecompress?: () => Transform })
      .createZstdDecompress;
    return typeof createZstdDecompress === "function" ? createZstdDecompress() : null;
  }
  return null;
}

function createGatewayResponseStream(
  upstreamRes: IncomingMessage,
  contentEncoding: string,
): { stream: NodeJS.ReadableStream; decodedContent: boolean } {
  const decoder = createGatewayContentDecoder(contentEncoding);
  if (!decoder) {
    return { stream: upstreamRes, decodedContent: false };
  }
  upstreamRes.pipe(decoder);
  return { stream: decoder, decodedContent: true };
}

async function proxyAiGatewayRequest(input: {
  store: ControlStore;
  req: Request;
  res: Response;
  userId: string;
  upstreamBaseUrl: string;
  upstreamApiKey: string;
}): Promise<void> {
  const upstreamUrl = buildAiGatewayUpstreamUrl(input.req, input.upstreamBaseUrl);
  const requestBody = readGatewayRequestBody(input.req);
  const requestBodyText = requestBody.toString("utf8");
  const requestFn = upstreamUrl.protocol === "https:" ? httpsRequest : httpRequest;
  const upstreamHeaders: Record<string, string> = {
    ...buildAiGatewayUpstreamHeaders(input.req, input.upstreamApiKey),
    "Content-Length": String(requestBody.length),
  };
  writeAiGatewayDebugLog({
    event: "request",
    method: input.req.method,
    path: input.req.originalUrl,
    upstreamPath: `${upstreamUrl.pathname}${upstreamUrl.search}`,
    inboundAcceptEncoding: input.req.header("accept-encoding") ?? null,
    outboundAcceptEncoding: upstreamHeaders["Accept-Encoding"] ?? null,
    accept: input.req.header("accept") ?? null,
    contentType: input.req.header("content-type") ?? null,
    bodyBytes: requestBody.length,
  });

  await new Promise<void>((resolve, reject) => {
    const upstreamReq = requestFn(
      upstreamUrl,
      {
        method: input.req.method,
        headers: upstreamHeaders,
      },
      (upstreamRes) => {
        input.res.status(upstreamRes.statusCode ?? 502);
        const contentEncoding = String(upstreamRes.headers["content-encoding"] ?? "");
        const { stream: responseStream, decodedContent } = createGatewayResponseStream(
          upstreamRes,
          contentEncoding,
        );
        copyRawGatewayResponseHeaders(upstreamRes.headers, input.res, { decodedContent });
        writeAiGatewayDebugLog({
          event: "response",
          method: input.req.method,
          path: input.req.originalUrl,
          statusCode: upstreamRes.statusCode ?? null,
          upstreamContentEncoding: upstreamRes.headers["content-encoding"] ?? null,
          upstreamContentType: upstreamRes.headers["content-type"] ?? null,
          responseContentEncoding: input.res.getHeader("content-encoding") ?? null,
          decodedContent,
        });

        const responseChunks: Buffer[] = [];
        let responseBytes = 0;
        const contentType = String(upstreamRes.headers["content-type"] ?? "");
        const canInspectUsage =
          (!contentEncoding || decodedContent) &&
          contentType.toLowerCase().includes("application/json");

        responseStream.on("data", (chunk: Buffer) => {
          if (canInspectUsage && responseBytes <= 2 * 1024 * 1024) {
            responseBytes += chunk.length;
            responseChunks.push(chunk);
          }
          input.res.write(chunk);
        });
        responseStream.on("end", () => {
          input.res.end();
          if (canInspectUsage && upstreamRes.statusCode && upstreamRes.statusCode < 400) {
            void recordAiGatewayUsage({
              store: input.store,
              userId: input.userId,
              requestBody: parseJsonObject(requestBodyText),
              responseText: Buffer.concat(responseChunks).toString("utf8"),
            });
          }
          resolve();
        });
        responseStream.on("error", reject);
        upstreamRes.on("error", reject);
      },
    );

    upstreamReq.on("error", reject);
    upstreamReq.end(requestBody);
  });
}

async function recordAiGatewayUsage(input: {
  store: ControlStore;
  userId: string;
  requestBody: unknown;
  responseText: string;
}): Promise<void> {
  const responseBody = parseJsonObject(input.responseText);
  const requestBody = isRecord(input.requestBody) ? input.requestBody : {};
  const usage = parseOpenAiUsage(responseBody);
  if (!usage) {
    return;
  }
  const modelId =
    readString(responseBody?.model) ?? readString(requestBody.model) ?? "gpt-5.4-mini";
  const requestId =
    readString(responseBody?.id) ?? `gateway:${input.userId}:${Date.now()}:${Math.random()}`;
  await input.store.recordGatewayUsageCharge({
    userId: input.userId,
    providerId: "openai",
    modelId,
    requestId,
    tokens: usage,
  });
}

function parseOpenAiUsage(value: Record<string, unknown> | null): {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  reasoningTokens: number;
} | null {
  const usage = isRecord(value?.usage) ? value.usage : null;
  if (!usage) {
    return null;
  }
  const inputTokens = readNumber(usage.input_tokens) ?? readNumber(usage.prompt_tokens) ?? 0;
  const outputTokens = readNumber(usage.output_tokens) ?? readNumber(usage.completion_tokens) ?? 0;
  const inputDetails = isRecord(usage.input_tokens_details)
    ? usage.input_tokens_details
    : isRecord(usage.prompt_tokens_details)
      ? usage.prompt_tokens_details
      : {};
  const outputDetails = isRecord(usage.output_tokens_details)
    ? usage.output_tokens_details
    : isRecord(usage.completion_tokens_details)
      ? usage.completion_tokens_details
      : {};
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens: readNumber(inputDetails.cached_tokens) ?? 0,
    reasoningTokens: readNumber(outputDetails.reasoning_tokens) ?? 0,
  };
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function resolveAiGatewayPublicBaseUrl(env: NodeJS.ProcessEnv, requestBaseUrl: string): string {
  return trimEnv(env[AI_GATEWAY_ENV.publicBaseUrl]) ?? requestBaseUrl;
}

function resolveAiGatewayUpstreamApiKey(env: NodeJS.ProcessEnv): string | null {
  return trimEnv(env[AI_GATEWAY_ENV.upstreamApiKey]) ?? DEFAULT_AI_GATEWAY_UPSTREAM_API_KEY;
}

function withTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function trimEnv(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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

async function readOptionalAuth(store: ControlStore, req: Request): Promise<AuthContext | null> {
  const userId = readHeader(req, "x-doya-user-id");
  const accessToken = readAuthorizationBearer(req) ?? readHeader(req, "x-doya-access-token");
  if (!userId || !accessToken) {
    return null;
  }
  await store.getUserByToken({ userId, accessToken });
  return { userId, accessToken };
}

async function readNodeRegistrationAuth(
  store: ControlStore,
  req: Request,
): Promise<({ kind: "user" } & AuthContext) | { kind: "node" } | null> {
  const userId = readHeader(req, "x-doya-user-id");
  const accessToken = readAuthorizationBearer(req) ?? readHeader(req, "x-doya-access-token");
  if (userId && accessToken) {
    await store.getUserByToken({ userId, accessToken });
    return { kind: "user", userId, accessToken };
  }
  const registrationToken = process.env.DOYA_CONTROL_NODE_REGISTRATION_TOKEN?.trim();
  if (registrationToken && accessToken === registrationToken) {
    return { kind: "node" };
  }
  return null;
}

function requireUserId(req: Request): string {
  return requireRequestAuth(req).userId;
}

async function requireRuntimeNodeRequest(
  store: ControlStore,
  req: Request,
  res: Response,
): Promise<DaemonNodeRecord | null> {
  const node = await store.getNode(req.params.nodeId);
  if (!node.runtimeAuthToken) {
    res.status(401).json({ error: "Daemon node authentication required" });
    return null;
  }
  const bearer = readAuthorizationBearer(req);
  if (bearer !== node.runtimeAuthToken) {
    res.status(401).json({ error: "Daemon node authentication required" });
    return null;
  }
  return node;
}

function getClientIp(req: Request): string {
  const forwardedFor = req.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string") {
    return forwardedFor.split(",")[0]?.trim() || req.ip || "127.0.0.1";
  }
  return req.ip || req.socket.remoteAddress || "127.0.0.1";
}

function getRequestBaseUrl(req: Request): string {
  const forwardedProto = readFirstForwardedHeader(req.headers["x-forwarded-proto"]);
  const forwardedHost = readFirstForwardedHeader(req.headers["x-forwarded-host"]);
  const proto = forwardedProto ?? req.protocol;
  const host = forwardedHost ?? req.get("host");
  return `${proto}://${host}`;
}

function readFirstForwardedHeader(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const first = raw?.split(",")[0]?.trim();
  return first || null;
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
  if (error instanceof AuthenticationError) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  if (error instanceof SmsVerificationError) {
    res.status(error.statusCode).json({ error: error.message });
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
    endpoint: node.publicEndpoint ?? node.endpoint,
    status: node.status,
    lastHeartbeatAt: node.lastHeartbeatAt,
  };
}

function nodeSupportsControlCommandPolling(node: DaemonNodeRecord): boolean {
  const capabilities = node.capabilities;
  if (!capabilities || typeof capabilities !== "object" || Array.isArray(capabilities)) {
    return false;
  }
  const controlCommands = (capabilities as Record<string, unknown>).controlCommands;
  if (!controlCommands || typeof controlCommands !== "object" || Array.isArray(controlCommands)) {
    return false;
  }
  return (controlCommands as Record<string, unknown>).polling === true;
}

async function ensureDaemonUserWorkspace(input: {
  node: DaemonNodeRecord;
  userId: string;
  daemonCommandBroker: DaemonCommandBroker;
}): Promise<{ workspace: { workspaceDir: string } }> {
  try {
    return await postDaemonJson<{ workspace: { workspaceDir: string } }>(
      input.node,
      "/api/user-workspaces/ensure",
      { userId: input.userId },
      input.daemonCommandBroker,
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
  daemonCommandBroker: DaemonCommandBroker;
}): Promise<{ workDir: string }> {
  try {
    return await postDaemonJson<{ workDir: string }>(
      input.node,
      "/api/user-workspaces/session-workdirs",
      {
        userId: input.userId,
        sessionId: input.sessionId,
      },
      input.daemonCommandBroker,
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

async function getDaemonLoad(
  node: DaemonNodeRecord,
  daemonCommandBroker: DaemonCommandBroker,
): Promise<DaemonLoadResult> {
  return await requestDaemonJson<DaemonLoadResult>(
    node,
    {
      method: "GET",
      endpointPath: "/api/admin/daemon/load",
    },
    daemonCommandBroker,
  );
}

async function restartDaemonNode(
  node: DaemonNodeRecord,
  daemonCommandBroker: DaemonCommandBroker,
): Promise<DaemonRestartResult> {
  return await requestDaemonJson<DaemonRestartResult>(
    node,
    {
      method: "POST",
      endpointPath: "/api/admin/daemon/restart",
      body: {
        requestId: `control_admin_restart_${node.id}_${Date.now()}`,
        reason: "control_admin_restart",
      },
    },
    daemonCommandBroker,
  );
}

async function getDaemonConfig(
  node: DaemonNodeRecord,
  daemonCommandBroker: DaemonCommandBroker,
): Promise<DaemonMutableConfig> {
  const payload = await requestDaemonJson<{ config: DaemonMutableConfig }>(
    node,
    {
      method: "GET",
      endpointPath: "/api/admin/daemon/config",
    },
    daemonCommandBroker,
  );
  return payload.config;
}

async function patchDaemonConfig(
  node: DaemonNodeRecord,
  patch: DaemonMutableConfigPatch,
  daemonCommandBroker: DaemonCommandBroker,
): Promise<DaemonMutableConfig> {
  const payload = await requestDaemonJson<{ config: DaemonMutableConfig }>(
    node,
    {
      method: "PATCH",
      endpointPath: "/api/admin/daemon/config",
      body: patch,
    },
    daemonCommandBroker,
  );
  return payload.config;
}

async function deleteDaemonSessionWorkDirs(input: {
  node: DaemonNodeRecord;
  targets: AdminSessionCleanupTarget[];
  daemonCommandBroker: DaemonCommandBroker;
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
      const result = await requestDaemonJson<DaemonSessionWorkDirCleanupResult>(
        input.node,
        {
          method: "DELETE",
          endpointPath: "/api/user-workspaces/session-workdirs",
          body: { userId, sessionIds },
        },
        input.daemonCommandBroker,
      );
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

async function rescanUserStorage(input: {
  store: ControlStore;
  userId: string;
  daemonCommandBroker?: DaemonCommandBroker;
}) {
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
    const scan = await scanDaemonUserWorkspace({
      node,
      userId: input.userId,
      daemonCommandBroker: input.daemonCommandBroker,
    });
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
  daemonCommandBroker?: DaemonCommandBroker;
}): Promise<DaemonUserWorkspaceScanResult> {
  return await postDaemonJson<DaemonUserWorkspaceScanResult>(
    input.node,
    "/api/user-workspaces/scan",
    { userId: input.userId },
    input.daemonCommandBroker,
  );
}

async function postDaemonJson<TResponse extends object>(
  node: DaemonNodeRecord,
  endpointPath: string,
  body: unknown,
  daemonCommandBroker?: DaemonCommandBroker,
): Promise<TResponse> {
  return await requestDaemonJson<TResponse>(
    node,
    { method: "POST", endpointPath, body },
    daemonCommandBroker,
  );
}

async function requestDaemonJson<TResponse extends object>(
  node: DaemonNodeRecord,
  input: {
    method: "DELETE" | "GET" | "PATCH" | "POST";
    endpointPath: string;
    body?: unknown;
  },
  daemonCommandBroker?: DaemonCommandBroker,
): Promise<TResponse> {
  if (daemonCommandBroker && nodeSupportsControlCommandPolling(node)) {
    try {
      return await daemonCommandBroker.request<TResponse>(node.id, input);
    } catch (error) {
      if (error instanceof DaemonCommandFailedError) {
        throw new DaemonApiResponseError(error.message, error.status);
      }
      if (error instanceof DaemonCommandTimeoutError) {
        throw new DaemonApiResponseError(error.message, 504);
      }
      throw error;
    }
  }

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
  daemonCommandBroker: DaemonCommandBroker;
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
    scheduleStorageRescanAfterTurn({
      store: input.store,
      userId: input.userId,
      daemonCommandBroker: input.daemonCommandBroker,
    });
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

function scheduleStorageRescanAfterTurn(input: {
  store: ControlStore;
  userId: string;
  daemonCommandBroker: DaemonCommandBroker;
}): void {
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
