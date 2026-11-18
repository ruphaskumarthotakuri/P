import path from 'node:path'
import fs from 'node:fs/promises'
import makeWASocket, { DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys'
import qrcode from 'qrcode-terminal'
import QRCode from 'qrcode'

const authDirectory = path.resolve(process.env.WHATSAPP_AUTH_DIR || '.whatsapp-auth')
let socket = null
let pendingQr = null
let pendingQrCodeDataUrl = null
let connecting = false
let reconnectTimer = null

export function normalizeWhatsAppNumber(value) {
  if (value == null || value === '') throw new Error('INVALID_PHONE')
  if (typeof value !== 'string' || !/^[+\d\s().-]+$/.test(value)) throw new Error('INVALID_PHONE')
  let digits = value.replace(/[\s().-]/g, '')
  if (/^[6-9]\d{9}$/.test(digits)) digits = `+91${digits}`
  else if (/^91[6-9]\d{9}$/.test(digits)) digits = `+${digits}`
  if (!/^\+91[6-9]\d{9}$/.test(digits)) throw new Error('INVALID_PHONE')
  return digits
}

function connected() {
  return Boolean(socket?.user?.id)
}

function senderIdentity() {
  const raw = String(socket?.user?.id || '').split('@')[0].split(':')[0]
  try { return normalizeWhatsAppNumber(raw) } catch { return null }
}

export function whatsappStatus() {
  const expected = process.env.WHATSAPP_SENDER_NUMBER ? normalizeWhatsAppNumber(process.env.WHATSAPP_SENDER_NUMBER) : null
  const actual = senderIdentity()
  return { connected: connected(), expectedNumber: expected, actualNumber: actual, authorized: Boolean(expected && actual === expected) }
}

export async function whatsappAdminStatus() {
  const status = whatsappStatus()
  if (status.connected || !pendingQr) return { ...status, qrCode: null }
  if (!pendingQrCodeDataUrl) pendingQrCodeDataUrl = await QRCode.toDataURL(pendingQr, { width: 260, margin: 1 })
  return { ...status, qrCode: pendingQrCodeDataUrl }
}

function scheduleReconnect(delay = 5000) {
  if (reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect().catch(error => console.error('WhatsApp reconnect failed:', error.message))
  }, delay)
}

export async function sendWhatsAppText(number, text) {
  if (!connected()) throw new Error('WHATSAPP_DISCONNECTED')
  const identity = whatsappStatus()
  if (!identity.expectedNumber) throw new Error('WHATSAPP_SENDER_NUMBER_REQUIRED')
  if (!identity.authorized) throw new Error('WHATSAPP_ACCOUNT_NOT_READY')
  const normalized = normalizeWhatsAppNumber(number)
  const matches = await socket.onWhatsApp(normalized.slice(1))
  if (!matches?.some(account => account.exists)) throw new Error('NOT_ON_WHATSAPP')
  const sent = await socket.sendMessage(`${normalized.slice(1)}@s.whatsapp.net`, { text })
  if (!sent?.key?.id) throw new Error('AMBIGUOUS_SEND')
  return { messageId: sent.key.id }
}

async function connect() {
  if (connecting || connected()) return
  connecting = true
  try {
    const { state, saveCreds } = await useMultiFileAuthState(authDirectory)
    const nextSocket = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      browser: ['Northstar', 'Chrome', '1.0.0'],
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 25000,
      markOnlineOnConnect: false,
    })
    socket = nextSocket
    nextSocket.ev.on('creds.update', saveCreds)
    nextSocket.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        pendingQr = qr
        pendingQrCodeDataUrl = null
        console.log('Scan this WhatsApp QR from WhatsApp → Linked devices:')
        qrcode.generate(qr, { small: true })
      }
      if (connection === 'open') { pendingQr = null; pendingQrCodeDataUrl = null; console.log('WhatsApp sender connected.') }
      if (connection === 'close') {
        socket = null
        pendingQr = null
        pendingQrCodeDataUrl = null
        const statusCode = lastDisconnect?.error?.output?.statusCode
        if (statusCode === DisconnectReason.loggedOut) {
          console.error('WhatsApp session logged out. Preparing a fresh link QR.')
          fs.rm(authDirectory, { recursive: true, force: true }).then(() => scheduleReconnect(3000))
            .catch(error => console.error('Could not reset the logged-out WhatsApp session:', error.message))
          return
        }
        scheduleReconnect()
      }
    })
  } finally {
    connecting = false
  }
}

export function startWhatsApp() {
  connect().catch(error => console.error('WhatsApp startup failed:', error.message))
}
