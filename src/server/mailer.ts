/**
 * Outbound email over SMTP.
 *
 * Configuration lives entirely in the environment, mirroring `storage.ts`: the
 * transport is only built once `SMTP_HOST` is set, so an install with no mail
 * configured never constructs a client (keeping tests offline too).
 *
 * Nothing is wired into a business flow yet — the only caller is the admin
 * "发送测试邮件" endpoint, which doubles as the way to verify a deployment.
 */
import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'

export interface MailConfig {
  host: string
  port: number
  /** implicit TLS (SMTPS); true for 465 unless SMTP_SECURE overrides */
  secure: boolean
  user: string
  pass: string
  from: string
  /** set SMTP_TLS_REJECT_UNAUTHORIZED=false to accept self-signed certs (dev) */
  rejectUnauthorized: boolean
}

/**
 * Reads SMTP settings from the environment. Returns null when no host is set —
 * that is the switch the rest of the app keys off.
 */
export function mailConfig(env: Record<string, string | undefined> = process.env): MailConfig | null {
  const host = env.SMTP_HOST?.trim()
  if (!host) return null
  const port = Number(env.SMTP_PORT) || 587
  // 465 speaks TLS from the first byte; every other port expects STARTTLS.
  const secure = env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : port === 465
  const user = env.SMTP_USER?.trim() ?? ''
  const pass = env.SMTP_PASS ?? ''
  const from = env.SMTP_FROM?.trim() || user || `no-reply@${host}`
  return {
    host,
    port,
    secure,
    user,
    pass,
    from,
    rejectUnauthorized: env.SMTP_TLS_REJECT_UNAUTHORIZED !== 'false',
  }
}

export const mailConfigured = (): boolean => mailConfig() !== null

/** Cached transporter; the pool is reused across sends. */
let transporter: Transporter | null = null

function getTransporter(cfg: MailConfig): Transporter {
  transporter ??= nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
    tls: { rejectUnauthorized: cfg.rejectUnauthorized },
  })
  return transporter
}

export interface MailInput {
  to: string
  subject: string
  text: string
  html?: string
}

/** Sends one message. Throws when SMTP is unconfigured or the send fails. */
export async function sendMail(input: MailInput): Promise<void> {
  const cfg = mailConfig()
  if (!cfg) throw new Error('SMTP 未配置')
  await getTransporter(cfg).sendMail({ from: cfg.from, ...input })
}
