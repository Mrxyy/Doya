import { randomInt } from "node:crypto";

const DEFAULT_DOTSMS_TEMPLATE_URL = "https://api.dotsms.cn/sms/template";
const CODE_TTL_MS = 5 * 60 * 1000;
const RESEND_INTERVAL_MS = 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 5;

export interface SmsVerificationConfig {
  provider: "dotsms";
  url: string;
  apiKey: string;
  secret: string;
  signId: string;
  templateId: string;
}

interface SmsCodeRecord {
  phone: string;
  code: string;
  expiresAt: number;
  attempts: number;
}

interface SendLogRecord {
  sentAt: number;
}

interface DotSmsResponse {
  code?: number | string;
  msg?: string;
}

export class SmsVerificationError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

export class SmsVerificationService {
  private readonly codes = new Map<string, SmsCodeRecord>();
  private readonly sendLog = new Map<string, SendLogRecord>();
  private readonly now: () => number;

  constructor(
    private readonly config: SmsVerificationConfig | null,
    options?: { now?: () => number },
  ) {
    this.now = options?.now ?? Date.now;
  }

  async sendLoginCode(input: { phone: string }): Promise<void> {
    const phone = normalizePhone(input.phone);
    if (!phone) {
      throw new SmsVerificationError("手机号不能为空");
    }

    const config = this.requireConfig();
    const now = this.now();
    const previousSend = this.sendLog.get(phone);
    if (previousSend && now - previousSend.sentAt < RESEND_INTERVAL_MS) {
      throw new SmsVerificationError("验证码发送太频繁，请稍后再试", 429);
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await sendDotSmsTemplate({
      config,
      phone,
      content: code,
    });

    this.codes.set(phone, {
      phone,
      code,
      expiresAt: now + CODE_TTL_MS,
      attempts: 0,
    });
    this.sendLog.set(phone, { sentAt: now });
  }

  verify(input: { phone: string; code: string }): string {
    const phone = normalizePhone(input.phone);
    const code = input.code.trim();
    if (!phone || !code) {
      throw new SmsVerificationError("手机号和验证码不能为空");
    }

    const record = this.codes.get(phone);
    if (!record || record.expiresAt < this.now()) {
      this.codes.delete(phone);
      throw new SmsVerificationError("验证码已过期，请重新获取", 401);
    }

    if (record.attempts >= MAX_VERIFY_ATTEMPTS) {
      this.codes.delete(phone);
      throw new SmsVerificationError("验证码错误次数过多，请重新获取", 401);
    }

    if (record.code !== code) {
      record.attempts += 1;
      throw new SmsVerificationError("验证码不正确", 401);
    }

    this.codes.delete(phone);
    return phone;
  }

  private requireConfig(): SmsVerificationConfig {
    if (!this.config) {
      throw new SmsVerificationError("短信服务未配置", 503);
    }
    return this.config;
  }
}

export function resolveSmsVerificationConfig(env: NodeJS.ProcessEnv): SmsVerificationConfig | null {
  const apiKey = env.PASEO_DOTSMS_APIKEY?.trim();
  const secret = env.PASEO_DOTSMS_SECRET?.trim();
  const signId = env.PASEO_DOTSMS_SIGN_ID?.trim();
  const templateId = env.PASEO_DOTSMS_TEMPLATE_ID?.trim();
  if (!apiKey || !secret || !signId || !templateId) {
    return null;
  }
  return {
    provider: "dotsms",
    url: env.PASEO_DOTSMS_URL?.trim() || DEFAULT_DOTSMS_TEMPLATE_URL,
    apiKey,
    secret,
    signId,
    templateId,
  };
}

export function normalizePhone(phone: string): string {
  const compact = phone.trim().replace(/[\s-]/g, "");
  if (/^1\d{10}$/.test(compact)) {
    return compact;
  }
  if (/^\+86(1\d{10})$/.test(compact)) {
    return compact.slice(3);
  }
  return "";
}

async function sendDotSmsTemplate(input: {
  config: SmsVerificationConfig;
  phone: string;
  content: string;
}): Promise<void> {
  const response = await fetch(input.config.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      apikey: input.config.apiKey,
      secret: input.config.secret,
      mobile: input.phone,
      sign_id: input.config.signId,
      template_id: input.config.templateId,
      content: input.content,
    }),
  });

  let payload: DotSmsResponse;
  try {
    payload = (await response.json()) as DotSmsResponse;
  } catch {
    throw new SmsVerificationError("短信服务返回异常", 502);
  }

  if (!response.ok || String(payload.code) !== "0") {
    throw new SmsVerificationError(payload.msg || "短信验证码发送失败", 502);
  }
}
