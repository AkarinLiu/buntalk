/**
 * Pure config parsing for the SMTP mailer — no network, no transport.
 * The send path is exercised indirectly by the admin route test.
 */
import { describe, expect, test } from 'bun:test'
import { mailConfig } from '../src/server/mailer'

describe('mail config', () => {
  test('unconfigured without a host', () => {
    expect(mailConfig({})).toBeNull()
    expect(mailConfig({ SMTP_PORT: '587' })).toBeNull()
  })

  test('defaults to port 587 + STARTTLS, from falls back to the host', () => {
    expect(mailConfig({ SMTP_HOST: 'smtp.example.com' })).toMatchObject({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      user: '',
      from: 'no-reply@smtp.example.com',
      rejectUnauthorized: true,
    })
  })

  test('port 465 implies implicit TLS; user and SMTP_FROM feed the sender', () => {
    expect(mailConfig({ SMTP_HOST: 'h', SMTP_PORT: '465' })?.secure).toBe(true)
    expect(
      mailConfig({ SMTP_HOST: 'h', SMTP_PORT: '465', SMTP_USER: 'bot@h', SMTP_PASS: 'x' }),
    ).toMatchObject({ secure: true, from: 'bot@h' })
    expect(
      mailConfig({ SMTP_HOST: 'h', SMTP_USER: 'bot@h', SMTP_FROM: 'Forum <f@h>' })?.from,
    ).toBe('Forum <f@h>')
  })

  test('SMTP_SECURE and TLS-verify overrides win', () => {
    expect(mailConfig({ SMTP_HOST: 'h', SMTP_PORT: '465', SMTP_SECURE: 'false' })?.secure).toBe(false)
    expect(mailConfig({ SMTP_HOST: 'h', SMTP_SECURE: 'true' })?.secure).toBe(true)
    expect(
      mailConfig({ SMTP_HOST: 'h', SMTP_TLS_REJECT_UNAUTHORIZED: 'false' })?.rejectUnauthorized,
    ).toBe(false)
  })
})
