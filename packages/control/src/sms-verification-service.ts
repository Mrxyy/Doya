import { randomInt } from "node:crypto";

const DEFAULT_SMS_URL = "http://mxthk.weiwebs.cn/msg/HttpVarSM";
const CODE_TTL_MS = 5 * 60 * 1000;
const RESEND_INTERVAL_MS = 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 5;
const LOGIN_CODE_SMS_CONTENT_PREFIX = "【本地宝】您的验证码是：";
const LOGIN_CODE_SMS_CONTENT_SUFFIX = "，感谢您的使用，请不要向他人分享验证码。";

export interface SmsVerificationConfig {
  provider: "mxt";
  url: string;
  account: string;
  password: string;
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

interface MxtSmsResponse {
  result?: number | string;
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
      throw new SmsVerificationError("请输入正确的手机号");
    }

    const config = this.requireConfig();
    const now = this.now();
    const previousSend = this.sendLog.get(phone);
    if (previousSend && now - previousSend.sentAt < RESEND_INTERVAL_MS) {
      throw new SmsVerificationError("验证码发送太频繁，请稍后再试", 429);
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await sendSmsCode({
      config,
      phone,
      code,
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
      throw new SmsVerificationError("请输入正确的手机号和验证码");
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
  const account = env.DOYA_SMS_ACCOUNT?.trim();
  const password = env.DOYA_SMS_PASSWORD?.trim();
  if (!account || !password) {
    return null;
  }
  return {
    provider: "mxt",
    url: env.DOYA_SMS_URL?.trim() || DEFAULT_SMS_URL,
    account,
    password,
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

async function sendSmsCode(input: {
  config: SmsVerificationConfig;
  phone: string;
  code: string;
}): Promise<void> {
  const body = createSmsRequestBody(input);
  const response = await fetch(input.config.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  let payload: MxtSmsResponse;
  try {
    payload = (await response.json()) as MxtSmsResponse;
  } catch {
    throw new SmsVerificationError("短信服务返回异常", 502);
  }

  if (!response.ok || String(payload.result) !== "0") {
    throw new SmsVerificationError(payload.msg || "短信验证码发送失败", 502);
  }
}

function createSmsRequestBody(input: {
  config: SmsVerificationConfig;
  phone: string;
  code: string;
}): URLSearchParams {
  return new URLSearchParams({
    account: input.config.account,
    pswd: input.config.password,
    msg: `${LOGIN_CODE_SMS_CONTENT_PREFIX}{$var}${LOGIN_CODE_SMS_CONTENT_SUFFIX}`,
    params: `${input.phone},${input.code}`,
    needstatus: "true",
    resptype: "json",
  });
}
