import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveControlStorePath } from "./db/home.js";

export interface PaymentGatewayConfig {
  merchantId: string;
  merchantKey: string;
  baseUrl: string;
  notifyUrl: string;
  returnUrl: string;
}

interface PaymentGatewayFileConfig {
  merchantId?: string;
  merchantKey?: string;
  publicBaseUrl?: string;
  baseUrl?: string;
  notifyUrl?: string;
  returnUrl?: string;
}

export interface CreateGatewayOrderInput {
  type: "alipay" | "wxpay";
  outTradeNo: string;
  name: string;
  money: string;
  clientIp: string;
  device?: string;
  param?: string;
}

export interface CreateGatewayOrderResult {
  tradeNo: string | null;
  payurl: string | null;
  qrcode: string | null;
  urlscheme: string | null;
  money: string | null;
  raw: unknown;
}

export interface PaymentNotifyPayload {
  pid: string;
  trade_no: string;
  out_trade_no: string;
  type: "alipay" | "wxpay";
  name: string;
  money: string;
  trade_status: string;
  param?: string;
  sign: string;
  sign_type?: string;
  [key: string]: string | undefined;
}

export async function getPaymentGatewayConfig(): Promise<PaymentGatewayConfig | null> {
  const fileConfig = await readPaymentGatewayFileConfig();
  const merchantId = readConfigValue(process.env.DOYA_PAYMENT_MERCHANT_ID, fileConfig.merchantId);
  const merchantKey = readConfigValue(process.env.DOYA_PAYMENT_MERCHANT_KEY, fileConfig.merchantKey);
  const publicBaseUrl = readConfigValue(
    process.env.DOYA_PAYMENT_PUBLIC_BASE_URL,
    fileConfig.publicBaseUrl,
  );
  if (!merchantId || !merchantKey || !publicBaseUrl) {
    return null;
  }
  const normalizedPublicBaseUrl = publicBaseUrl.replace(/\/$/, "");
  return {
    merchantId,
    merchantKey,
    baseUrl:
      readConfigValue(process.env.DOYA_PAYMENT_GATEWAY_BASE_URL, fileConfig.baseUrl) ||
      "https://dl.qpzf.cn",
    notifyUrl:
      readConfigValue(process.env.DOYA_PAYMENT_NOTIFY_URL, fileConfig.notifyUrl) ||
      `${normalizedPublicBaseUrl}/api/billing/payments/notify`,
    returnUrl:
      readConfigValue(process.env.DOYA_PAYMENT_RETURN_URL, fileConfig.returnUrl) ||
      `${normalizedPublicBaseUrl}/billing`,
  };
}

export async function createGatewayOrder(
  config: PaymentGatewayConfig,
  input: CreateGatewayOrderInput,
): Promise<CreateGatewayOrderResult> {
  const params: Record<string, string> = {
    pid: config.merchantId,
    type: input.type,
    out_trade_no: input.outTradeNo,
    notify_url: config.notifyUrl,
    return_url: config.returnUrl,
    name: input.name,
    money: input.money,
    clientip: input.clientIp,
    device: input.device ?? "pc",
    param: input.param ?? "",
  };
  params.sign = signPaymentParams(params, config.merchantKey);
  params.sign_type = "MD5";

  const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/mapi.php`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: new URLSearchParams(params).toString(),
  });
  const raw = (await response.json()) as Partial<{
    code: number;
    msg: string;
    trade_no: string;
    payurl: string;
    qrcode: string;
    urlscheme: string;
    money: string;
  }>;
  if (!response.ok || raw.code !== 1) {
    throw new Error(raw.msg || `Payment gateway returned HTTP ${response.status}`);
  }
  return {
    tradeNo: typeof raw.trade_no === "string" ? raw.trade_no : null,
    payurl: typeof raw.payurl === "string" ? raw.payurl : null,
    qrcode: typeof raw.qrcode === "string" ? raw.qrcode : null,
    urlscheme: typeof raw.urlscheme === "string" ? raw.urlscheme : null,
    money: typeof raw.money === "string" ? raw.money : null,
    raw,
  };
}

export function verifyPaymentNotify(
  config: PaymentGatewayConfig,
  payload: PaymentNotifyPayload,
): boolean {
  const signType = payload.sign_type?.toUpperCase() ?? "MD5";
  return (
    payload.pid === config.merchantId &&
    signType === "MD5" &&
    payload.sign === signPaymentParams(payload, config.merchantKey)
  );
}

export function signPaymentParams(params: Record<string, string | undefined>, key: string): string {
  const base = Object.entries(params)
    .filter(([name, value]) => name !== "sign" && name !== "sign_type" && value !== undefined)
    .filter(([, value]) => String(value).length > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}=${value}`)
    .join("&");
  return createHash("md5").update(`${base}${key}`, "utf8").digest("hex").toLowerCase();
}

async function readPaymentGatewayFileConfig(): Promise<PaymentGatewayFileConfig> {
  const filePath =
    process.env.DOYA_PAYMENT_CONFIG_FILE?.trim() ||
    path.join(path.dirname(resolveControlStorePath()), "payment.json");
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const record = parsed as Record<string, unknown>;
    return {
      merchantId: readString(record.merchantId),
      merchantKey: readString(record.merchantKey),
      publicBaseUrl: readString(record.publicBaseUrl),
      baseUrl: readString(record.baseUrl),
      notifyUrl: readString(record.notifyUrl),
      returnUrl: readString(record.returnUrl),
    };
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? (error as { code?: unknown }).code
        : null;
    if (code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

function readConfigValue(primary: string | undefined, fallback: string | undefined): string | null {
  return primary?.trim() || fallback?.trim() || null;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
