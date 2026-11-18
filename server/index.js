import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { Redis } from '@upstash/redis'
import ExcelJS from 'exceljs'
import { normalizeWhatsAppNumber, sendWhatsAppText, startWhatsApp, unlinkWhatsApp, whatsappAdminStatus, whatsappStatus } from './whatsapp.js'

const app = express()
const port = process.env.PORT || 3002
const runningOnVercel = Boolean(process.env.VERCEL || process.env.VERCEL_ENV || process.env.AWS_LAMBDA_FUNCTION_NAME)
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
// Admin credentials and Supabase secret keys stay on the server.
const adminEmail = process.env.ADMIN_EMAIL || ''
const adminPassword = process.env.ADMIN_PASSWORD || ''
const adminSessionSecret = process.env.ADMIN_SESSION_SECRET || ''
const serviceRoleKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const adminSupabase = supabaseUrl && serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null
const redis = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  ? new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN })
  : null
const adminCookieName = 'northstar_admin'
const adminSessionDuration = 12 * 60 * 60 * 1000
const adminLoginFailures = new Map()
const adminLoginWindow = 15 * 60 * 1000
const adminLoginLimit = 8
const signupAttempts = new Map()
const signupWindow = 15 * 60 * 1000
const signupLimit = 10
const whatsappDailyLimit = 100
let whatsappSendCount = 0
let whatsappSendDay = ''
let whatsappSendBusy = false
let whatsappBulkProgress = null

app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }))
app.use(express.json())

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', supabaseConfigured: Boolean(supabaseUrl && supabaseKey) })
})

async function getMemberForRequest(req) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '')
  if (!token || !supabaseUrl || !supabaseKey) return null
  const client = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await client.auth.getUser(token)
  return error ? null : data.user || null
}

app.get('/api/feed/ordering', async (req, res) => {
  if (!adminSupabase) return res.status(503).json({ error: 'Supabase server access is not configured.' })
  try {
    const user = await getMemberForRequest(req)
    if (!user) return res.status(401).json({ error: 'Sign in to load your member feed.' })

    const followsKey = `northstar:follows:${user.id}`
    const discoveryKey = 'northstar:feed:member-order:v1'
    let followedIds = null
    let orderedMemberIds = null
    let hadCachedFollows = false
    let hadCachedMembers = false
    if (redis) {
      const [cachedFollows, cachedMembers] = await Promise.all([
        redis.get(followsKey).catch(() => null),
        redis.get(discoveryKey).catch(() => null),
      ])
      hadCachedFollows = Array.isArray(cachedFollows)
      hadCachedMembers = Array.isArray(cachedMembers)
      followedIds = hadCachedFollows ? cachedFollows : null
      orderedMemberIds = hadCachedMembers ? cachedMembers : null
    }
    const [followRows, memberRows] = await Promise.all([
      followedIds ? Promise.resolve(null) : adminSupabase.from('follows').select('following_id').eq('follower_id', user.id),
      orderedMemberIds ? Promise.resolve(null) : adminSupabase.from('profiles').select('user_id').limit(5000),
    ])
    if (followRows?.error) throw followRows.error
    if (memberRows?.error) throw memberRows.error
    if (!followedIds) followedIds = (followRows?.data || []).map(row => row.following_id)
    if (!orderedMemberIds) {
      orderedMemberIds = (memberRows?.data || []).map(row => row.user_id)
      for (let index = orderedMemberIds.length - 1; index > 0; index -= 1) {
        const randomIndex = Math.floor(Math.random() * (index + 1))
        ;[orderedMemberIds[index], orderedMemberIds[randomIndex]] = [orderedMemberIds[randomIndex], orderedMemberIds[index]]
      }
    }
    if (redis) await Promise.all([
      ...(!hadCachedFollows ? [redis.set(followsKey, followedIds, { ex: 300 }).catch(() => null)] : []),
      ...(!hadCachedMembers ? [redis.set(discoveryKey, orderedMemberIds, { ex: 300 }).catch(() => null)] : []),
    ])

    const followedSet = new Set(followedIds)
    return res.json({
      followedIds,
      discoveryIds: orderedMemberIds.filter(id => id !== user.id && !followedSet.has(id)).slice(0, 150),
      cache: redis ? 'upstash' : 'disabled',
    })
  } catch (error) {
    return res.status(503).json({ error: error.message || 'Could not prepare the member feed.' })
  }
})

app.put('/api/follows/:userId', async (req, res) => {
  if (!adminSupabase) return res.status(503).json({ error: 'Supabase server access is not configured.' })
  try {
    const user = await getMemberForRequest(req)
    if (!user) return res.status(401).json({ error: 'Sign in to follow members.' })
    const followingId = String(req.params.userId || '')
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    if (!uuidPattern.test(followingId) || followingId === user.id) return res.status(400).json({ error: 'Choose a valid member to follow.' })
    const { data: target, error: targetError } = await adminSupabase.from('profiles').select('user_id').eq('user_id', followingId).maybeSingle()
    if (targetError) throw targetError
    if (!target) return res.status(404).json({ error: 'That member profile no longer exists.' })
    const { error } = await adminSupabase.from('follows').upsert({ follower_id: user.id, following_id: followingId }, { onConflict: 'follower_id,following_id', ignoreDuplicates: true })
    if (error) throw error
    if (redis) { try { await redis.del(`northstar:follows:${user.id}`) } catch { /* Follow writes have already succeeded in Supabase. */ } }
    return res.json({ following: true })
  } catch (error) {
    return res.status(503).json({ error: error.message || 'Could not follow this member.' })
  }
})

app.delete('/api/follows/:userId', async (req, res) => {
  if (!adminSupabase) return res.status(503).json({ error: 'Supabase server access is not configured.' })
  try {
    const user = await getMemberForRequest(req)
    if (!user) return res.status(401).json({ error: 'Sign in to manage follows.' })
    const followingId = String(req.params.userId || '')
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    if (!uuidPattern.test(followingId) || followingId === user.id) return res.status(400).json({ error: 'Choose a valid member.' })
    const { error } = await adminSupabase.from('follows').delete().eq('follower_id', user.id).eq('following_id', followingId)
    if (error) throw error
    if (redis) { try { await redis.del(`northstar:follows:${user.id}`) } catch { /* Follow writes have already succeeded in Supabase. */ } }
    return res.json({ following: false })
  } catch (error) {
    return res.status(503).json({ error: error.message || 'Could not update this follow.' })
  }
})

app.get('/api/me', async (req, res) => {
  if (!supabaseUrl || !supabaseKey) {
    return res.status(503).json({ error: 'Supabase is not configured. Add the project URL and anon key to .env.' })
  }

  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '')
  if (!token) return res.status(401).json({ error: 'A bearer token is required.' })

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return res.status(401).json({ error: 'Your session is invalid or expired.' })

  return res.json({ user: { id: data.user.id, email: data.user.email, user_metadata: data.user.user_metadata, app_metadata: data.user.app_metadata } })
})

app.post('/api/profiles/verification', async (req, res) => {
  if (!supabaseUrl || !supabaseKey || !adminSupabase) return res.status(503).json({ error: 'Supabase server access is not configured.' })
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '')
  if (!token) return res.status(401).json({ error: 'Sign in to view member verification.' })
  const client = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: sessionData, error: sessionError } = await client.auth.getUser(token)
  if (sessionError || !sessionData.user) return res.status(401).json({ error: 'Your session is invalid or expired.' })
  const ids = req.body?.user_ids
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  if (!Array.isArray(ids) || ids.length > 100 || ids.some(id => typeof id !== 'string' || !uuidPattern.test(id))) {
    return res.status(400).json({ error: 'Provide up to 100 valid member IDs.' })
  }
  try {
    const verifiedUsers = {}
    await Promise.all([...new Set(ids)].map(async id => {
      const { data, error } = await adminSupabase.auth.admin.getUserById(id)
      if (error) throw error
      verifiedUsers[id] = Boolean(data.user?.app_metadata?.is_verified)
    }))
    return res.json({ verifiedUsers })
  } catch (error) {
    return res.status(503).json({ error: error.message || 'Could not load member verification.' })
  }
})

app.post('/api/auth/signup', async (req, res) => {
  if (!adminSupabase) return res.status(503).json({ error: 'Server-side Supabase admin access is not configured.' })
  const email = String(req.body?.email || '').trim().toLowerCase()
  const password = String(req.body?.password || '')
  const fullName = String(req.body?.full_name || '').trim()
  let phone
  try { phone = normalizeWhatsAppNumber(String(req.body?.phone || '').trim()) } catch {
    return res.status(400).json({ error: 'Enter a valid Indian mobile number.' })
  }
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) return res.status(400).json({ error: 'Enter a valid email address.' })
  if (password.length < 8 || password.length > 128) return res.status(400).json({ error: 'Password must be 8 to 128 characters.' })
  if (fullName.length < 2 || fullName.length > 120 || /[\u0000-\u001f<>]/.test(fullName)) return res.status(400).json({ error: 'Enter a valid name between 2 and 120 characters.' })

  const attemptKey = req.ip || req.socket.remoteAddress || 'unknown'
  const attempt = signupAttempts.get(attemptKey)
  if (attempt && attempt.resetAt > Date.now() && attempt.count >= signupLimit) {
    return res.status(429).json({ error: 'Too many sign-up attempts. Try again in 15 minutes.' })
  }
  const nextAttempt = !attempt || attempt.resetAt <= Date.now()
    ? { count: 1, resetAt: Date.now() + signupWindow }
    : { ...attempt, count: attempt.count + 1 }
  signupAttempts.set(attemptKey, nextAttempt)

  const existingUsers = []
  for (let page = 1; ; page += 1) {
    const { data, error } = await adminSupabase.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) return res.status(503).json({ error: 'Could not validate account details. Try again.' })
    existingUsers.push(...(data.users || []))
    if ((data.users || []).length < 1000) break
  }
  if (existingUsers.some(existing => existing.email?.toLowerCase() === email)) {
    return res.status(409).json({ error: 'An account with this email already exists.' })
  }
  if (existingUsers.some(existing => {
    try { return normalizeWhatsAppNumber(String(existing.user_metadata?.phone || '')) === phone } catch { return false }
  })) return res.status(409).json({ error: 'An account with this phone number already exists.' })

  const { data, error } = await adminSupabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, phone },
  })
  if (error) {
    const duplicate = /already (registered|exists)|already been registered/i.test(error.message || '')
    return res.status(duplicate ? 409 : 400).json({ error: duplicate ? 'An account with this email already exists.' : error.message || 'Could not create the account.' })
  }
  return res.status(201).json({ user: { id: data.user.id, email: data.user.email } })
})

app.post('/api/profile/validate', async (req, res) => {
  if (!supabaseUrl || !supabaseKey || !adminSupabase) return res.status(503).json({ error: 'Supabase server access is not configured.' })
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '')
  if (!token) return res.status(401).json({ error: 'Sign in before updating your phone number.' })
  const client = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: sessionData, error: sessionError } = await client.auth.getUser(token)
  if (sessionError || !sessionData.user) return res.status(401).json({ error: 'Your session is invalid or expired.' })
  const body = req.body || {}
  const textField = (key, label, min, max, required = true) => {
    const value = String(body[key] || '').trim()
    if ((required && value.length < min) || value.length > max) throw new Error(`${label} must be ${required ? `between ${min} and ` : 'no more than '}${max} characters.`)
    return value
  }
  let phone
  try { phone = normalizeWhatsAppNumber(String(req.body?.phone || '').trim()) } catch {
    return res.status(400).json({ error: 'Enter a valid Indian mobile number.' })
  }
  try {
    textField('education', 'Education', 2, 120)
    textField('description', 'Description', 2, 2000)
    textField('location', 'Location', 2, 200)
    textField('church_name', 'Church or organization', 2, 120)
    textField('church_location', 'Church location', 0, 200, false)
    for (const key of ['latitude', 'longitude']) {
      if (body[key] == null || String(body[key]).trim() === '') throw new Error('Detect a valid location before saving.')
      const coordinate = Number(body[key])
      const limit = key === 'latitude' ? 90 : 180
      if (!Number.isFinite(coordinate) || Math.abs(coordinate) > limit) throw new Error('Detect a valid location before saving.')
    }
    for (const key of ['instagram_url', 'facebook_url', 'youtube_url']) {
      const value = String(body[key] || '').trim()
      if (!value) continue
      if (value.length > 500) throw new Error('Social links must be 500 characters or less.')
      let parsed
      try { parsed = new URL(value) } catch { throw new Error('Enter valid social links.') }
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Social links must start with http or https.')
    }
  } catch (error) {
    return res.status(400).json({ error: error.message })
  }
  for (let page = 1; ; page += 1) {
    const { data, error } = await adminSupabase.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) return res.status(503).json({ error: 'Could not validate this phone number. Try again.' })
    const duplicate = (data.users || []).some(existing => {
      if (existing.id === sessionData.user.id) return false
      try { return normalizeWhatsAppNumber(String(existing.user_metadata?.phone || '')) === phone } catch { return false }
    })
    if (duplicate) return res.status(409).json({ error: 'This phone number is already linked to another account.' })
    if ((data.users || []).length < 1000) break
  }
  return res.json({ phone })
})

function makeAdminToken(email) {
  const payload = Buffer.from(JSON.stringify({ email, role: 'admin', exp: Date.now() + adminSessionDuration })).toString('base64url')
  const signature = createHmac('sha256', adminSessionSecret).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

function getAdminSession(req) {
  if (!adminSessionSecret) return null
  const cookie = req.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(`${adminCookieName}=`))
  if (!cookie) return null
  const token = cookie.slice(adminCookieName.length + 1)
  const [payload, signature] = token.split('.')
  if (!payload || !signature) return null
  const expected = createHmac('sha256', adminSessionSecret).update(payload).digest('base64url')
  const signatureBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expected)
  if (signatureBuffer.length !== expectedBuffer.length || !timingSafeEqual(signatureBuffer, expectedBuffer)) return null
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString())
    return session.role === 'admin' && session.exp > Date.now() ? session : null
  } catch {
    return null
  }
}

function requireAdmin(req, res, next) {
  const session = getAdminSession(req)
  if (!session) return res.status(401).json({ error: 'Admin sign in is required.' })
  req.admin = session
  next()
}

app.post('/api/admin/login', (req, res) => {
  if (!adminEmail || !adminPassword || !adminSessionSecret) {
    return res.status(503).json({ error: 'Admin credentials are not configured on the server.' })
  }
  const email = String(req.body?.email || '').trim()
  const password = String(req.body?.password || '')
  const attemptKey = req.ip || req.socket.remoteAddress || 'unknown'
  const attempt = adminLoginFailures.get(attemptKey)
  if (attempt?.lockedUntil > Date.now()) {
    return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' })
  }
  const storedPassword = Buffer.from(adminPassword)
  const submittedPassword = Buffer.from(password)
  const passwordMatches = storedPassword.length === submittedPassword.length && timingSafeEqual(storedPassword, submittedPassword)
  if (email.toLowerCase() !== adminEmail.toLowerCase() || !passwordMatches) {
    const failures = (attempt?.failures || 0) + 1
    adminLoginFailures.set(attemptKey, failures >= adminLoginLimit
      ? { failures, lockedUntil: Date.now() + adminLoginWindow }
      : { failures, lockedUntil: 0 })
    return res.status(401).json({ error: 'Incorrect admin email or password.' })
  }
  adminLoginFailures.delete(attemptKey)
  res.cookie(adminCookieName, makeAdminToken(adminEmail), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: adminSessionDuration,
  })
  return res.json({ authenticated: true, email: adminEmail })
})

app.get('/api/admin/session', (req, res) => {
  const session = getAdminSession(req)
  return res.json({ authenticated: Boolean(session), email: session?.email || null })
})

app.post('/api/admin/logout', requireAdmin, (_req, res) => {
  res.clearCookie(adminCookieName, { httpOnly: true, sameSite: 'strict', path: '/' })
  return res.json({ authenticated: false })
})

async function listAdminUsers(photoExpiry = 3600) {
  if (!adminSupabase) throw new Error('Add SUPABASE_SECRET_KEY (sb_secret_...) to the server .env to list users. The publishable key cannot access the admin user list.')
  const users = []
  for (let page = 1; ; page += 1) {
    const { data, error } = await adminSupabase.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw error
    users.push(...data.users)
    if (data.users.length < 1000) break
  }

  const imageUsers = users.filter(user => user.user_metadata?.avatar_path)
  let photoLinks = []
  if (imageUsers.length) {
    const { data, error } = await adminSupabase.storage.from('photo').createSignedUrls(
      imageUsers.map(user => user.user_metadata.avatar_path), photoExpiry,
    )
    if (!error) photoLinks = data || []
  }
  const photoByPath = new Map(imageUsers.map((user, index) => [user.user_metadata.avatar_path, photoLinks[index]?.signedUrl || '']))

  return users.map(user => {
    const metadata = user.user_metadata || {}
    return {
      id: user.id,
      email: user.email || '',
      name: metadata.full_name || '',
      phone: metadata.phone || '',
      education: metadata.education || '',
      description: metadata.description || '',
      location: metadata.location || '',
      latitude: metadata.latitude ?? '',
      longitude: metadata.longitude ?? '',
      church_name: metadata.church_name || '',
      church_location: metadata.church_location || '',
      verified: Boolean(user.app_metadata?.is_verified),
      photo_path: metadata.avatar_path || '',
      photo_link: metadata.avatar_path ? (photoByPath.get(metadata.avatar_path) || '') : '',
      created_at: user.created_at || '',
      email_confirmed_at: user.email_confirmed_at || '',
      last_sign_in_at: user.last_sign_in_at || '',
      user_metadata_json: JSON.stringify(metadata),
    }
  })
}

app.get('/api/admin/users', requireAdmin, async (_req, res) => {
  try {
    return res.json({ users: await listAdminUsers() })
  } catch (error) {
    return res.status(503).json({ error: error.message || 'Could not load users.' })
  }
})

app.get('/api/admin/whatsapp/status', requireAdmin, async (_req, res) => {
  try {
    return res.json({ ...await whatsappAdminStatus(), bulkProgress: whatsappBulkProgress, serverless: runningOnVercel })
  } catch (error) {
    return res.status(503).json({ error: error.message || 'Could not read WhatsApp connection status.' })
  }
})

app.post('/api/admin/whatsapp/unlink', requireAdmin, async (_req, res) => {
  if (runningOnVercel) {
    return res.status(503).json({ error: 'WhatsApp cannot be unlinked from this Vercel serverless deployment. Remove Northstar from WhatsApp → Linked devices.' })
  }
  try {
    return res.json({ unlinked: true, ...await unlinkWhatsApp() })
  } catch (error) {
    return res.status(503).json({ error: error.message || 'Could not unlink WhatsApp.' })
  }
})

app.patch('/api/admin/users/:id/verification', requireAdmin, async (req, res) => {
  const verified = req.body?.verified
  if (typeof verified !== 'boolean') return res.status(400).json({ error: 'verified must be true or false.' })
  if (!adminSupabase) return res.status(503).json({ error: 'Supabase admin access is not configured.' })
  try {
    const { data: existing, error: lookupError } = await adminSupabase.auth.admin.getUserById(req.params.id)
    if (lookupError) throw lookupError
    const { data, error } = await adminSupabase.auth.admin.updateUserById(req.params.id, {
      app_metadata: { ...existing.user.app_metadata, is_verified: verified },
    })
    if (error) throw error
    return res.json({ id: data.user.id, verified: Boolean(data.user.app_metadata?.is_verified) })
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Could not update verification.' })
  }
})

app.post('/api/admin/users/:id/message', requireAdmin, async (req, res) => {
  const userId = req.params.id
  const message = String(req.body?.message || '').trim()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
    return res.status(400).json({ error: 'Invalid user ID.' })
  }
  if (!message || message.length > 1500) return res.status(400).json({ error: 'Enter a message up to 1,500 characters.' })
  if (!adminSupabase) return res.status(503).json({ error: 'Supabase admin access is not configured.' })
  if (whatsappSendBusy) return res.status(409).json({ error: 'A WhatsApp message is already being sent. Try again shortly.' })
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  if (whatsappSendDay !== today) { whatsappSendDay = today; whatsappSendCount = 0 }
  if (whatsappSendCount >= whatsappDailyLimit) return res.status(429).json({ error: 'The app has reached its 100-message daily sending limit.' })
  whatsappSendBusy = true
  try {
    const { data, error } = await adminSupabase.auth.admin.getUserById(userId)
    if (error) throw error
    if (!data.user?.app_metadata?.is_verified) return res.status(403).json({ error: 'Only verified members can receive admin messages.' })
    const phone = String(data.user?.user_metadata?.phone || '').trim()
    if (!phone) return res.status(400).json({ error: 'This member has no phone number in their profile.' })
    whatsappSendCount += 1
    try {
      const result = await sendWhatsAppText(phone, message)
      return res.json({ sent: true, messageId: result.messageId })
    } catch (error) {
      const errors = {
        WHATSAPP_DISCONNECTED: 'The app’s WhatsApp session is disconnected.',
        WHATSAPP_ACCOUNT_NOT_READY: 'The linked WhatsApp account is not ready to send.',
        NOT_ON_WHATSAPP: 'This phone number is not registered on WhatsApp.',
        WHATSAPP_SENDER_NUMBER_REQUIRED: 'Set WHATSAPP_SENDER_NUMBER in the server environment.',
        INVALID_PHONE: 'This member’s phone number must be a valid Indian mobile number.',
        AMBIGUOUS_SEND: 'WhatsApp did not confirm the send. Check the conversation before retrying.',
      }
      const status = error.message === 'AMBIGUOUS_SEND' ? 502 : ['WHATSAPP_DISCONNECTED', 'WHATSAPP_ACCOUNT_NOT_READY', 'WHATSAPP_SENDER_NUMBER_REQUIRED'].includes(error.message) ? 503 : 400
      return res.status(status).json({ error: errors[error.message] || 'Could not send WhatsApp message.' })
    } finally {
      whatsappSendBusy = false
    }
  } catch (error) {
    return res.status(503).json({ error: error.message || 'Could not send WhatsApp message.' })
  } finally {
    whatsappSendBusy = false
  }
})

app.post('/api/admin/users/message-selected', requireAdmin, async (req, res) => {
  const message = String(req.body?.message || '').trim()
  if (!message || message.length > 1500) return res.status(400).json({ error: 'Enter a message up to 1,500 characters.' })
  const requestedIds = Array.isArray(req.body?.userIds) ? [...new Set(req.body.userIds)] : []
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  if (!requestedIds.length || requestedIds.length > 1000 || requestedIds.some(id => typeof id !== 'string' || !uuidPattern.test(id))) {
    return res.status(400).json({ error: 'Select one or more valid member accounts.' })
  }
  if (whatsappSendBusy) return res.status(409).json({ error: 'A WhatsApp message is already being sent. Try again shortly.' })
  whatsappSendBusy = true
  try {
    const identity = whatsappStatus()
    if (!identity.connected) return res.status(503).json({ error: 'WhatsApp is not linked. Scan the QR code shown in the admin page first.' })
    if (!identity.authorized) return res.status(503).json({ error: 'The linked WhatsApp account does not match WHATSAPP_SENDER_NUMBER.' })
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
    if (whatsappSendDay !== today) { whatsappSendDay = today; whatsappSendCount = 0 }
    const allMembers = await listAdminUsers()
    const requestedSet = new Set(requestedIds)
    const members = allMembers.filter(member => requestedSet.has(member.id) && member.verified)
    const eligibleIds = new Set(members.map(member => member.id))
    const excludedResults = requestedIds.filter(id => !eligibleIds.has(id)).map(id => ({
      userId: id,
      name: allMembers.find(member => member.id === id)?.name || 'Member',
      status: 'skipped',
      reason: allMembers.some(member => member.id === id) ? 'Member is not verified' : 'Member account not found',
    }))
    if (!members.length) return res.status(400).json({ error: 'None of the selected members are currently verified.' })
    const results = []
    const seenNumbers = new Set()
    let sent = 0
    let busyError = ''
    try {
      for (let memberIndex = 0; memberIndex < members.length; memberIndex += 1) {
        const member = members[memberIndex]
        whatsappBulkProgress = { total: members.length, processed: memberIndex, sent, currentName: member.name || 'Member' }
        if (!member.phone) {
          results.push({ userId: member.id, name: member.name, status: 'skipped', reason: 'No phone number' })
          continue
        }
        let number
        try { number = normalizeWhatsAppNumber(member.phone) } catch {
          results.push({ userId: member.id, name: member.name, status: 'skipped', reason: 'Invalid phone number' })
          continue
        }
        if (seenNumbers.has(number)) {
          results.push({ userId: member.id, name: member.name, status: 'skipped', reason: 'Duplicate phone number' })
          continue
        }
        seenNumbers.add(number)
        if (whatsappSendCount >= whatsappDailyLimit) {
          results.push({ userId: member.id, name: member.name, status: 'skipped', reason: 'Daily sending limit reached' })
          continue
        }
        whatsappSendCount += 1
        try {
          const result = await sendWhatsAppText(number, message)
          sent += 1
          results.push({ userId: member.id, name: member.name, status: 'sent', messageId: result.messageId })
        } catch (error) {
          const reason = error.message === 'NOT_ON_WHATSAPP' ? 'Not registered on WhatsApp'
            : error.message === 'INVALID_PHONE' ? 'Invalid phone number'
              : error.message === 'WHATSAPP_DISCONNECTED' ? 'WhatsApp disconnected during sending'
                : error.message === 'AMBIGUOUS_SEND' ? 'Send status unknown; check before retrying'
                  : 'Send failed'
          results.push({ userId: member.id, name: member.name, status: error.message === 'AMBIGUOUS_SEND' ? 'unknown' : 'failed', reason })
          if (error.message === 'WHATSAPP_DISCONNECTED' || error.message === 'WHATSAPP_ACCOUNT_NOT_READY') {
            busyError = reason
            break
          }
        }
        if (memberIndex < members.length - 1) await new Promise(resolve => setTimeout(resolve, 1200))
      }
      if (busyError && results.length < members.length) {
        for (const member of members.slice(results.length)) {
          results.push({ userId: member.id, name: member.name, status: 'skipped', reason: busyError })
        }
      }
    } finally {
      whatsappSendBusy = false
      whatsappBulkProgress = null
    }
    const allResults = [...excludedResults, ...results]
    return res.json({ total: requestedIds.length, sent, skipped: allResults.filter(item => item.status === 'skipped').length,
      failed: results.filter(item => item.status === 'failed' || item.status === 'unknown').length,
      stoppedReason: busyError, dailyRemaining: Math.max(0, whatsappDailyLimit - whatsappSendCount), results: allResults })
  } catch (error) {
    return res.status(503).json({ error: error.message || 'Could not send messages to members.' })
  } finally {
    whatsappSendBusy = false
    whatsappBulkProgress = null
  }
})

async function listUserPhotoPaths(folder, depth = 0) {
  if (depth > 8) throw new Error('Photo folder nesting is unexpectedly deep.')
  const paths = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await adminSupabase.storage.from('photo').list(folder, { limit: 1000, offset })
    if (error) throw error
    const entries = data || []
    for (const entry of entries) {
      const path = `${folder}/${entry.name}`
      if (entry.id) paths.push(path)
      else paths.push(...await listUserPhotoPaths(path, depth + 1))
    }
    if (entries.length < 1000) break
  }
  return paths
}

app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
  if (!adminSupabase) return res.status(503).json({ error: 'Supabase admin access is not configured.' })
  const userId = req.params.id
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
    return res.status(400).json({ error: 'Invalid user ID.' })
  }
  try {
    const photoPaths = await listUserPhotoPaths(userId)
    for (let index = 0; index < photoPaths.length; index += 1000) {
      const { error } = await adminSupabase.storage.from('photo').remove(photoPaths.slice(index, index + 1000))
      if (error) throw new Error(`Could not remove all user photos: ${error.message}`)
    }
    const { error } = await adminSupabase.auth.admin.deleteUser(userId)
    if (error) throw error
    return res.json({ deleted: true, removedPhotos: photoPaths.length })
  } catch (error) {
    return res.status(503).json({ error: error.message || 'Could not delete this user and their data.' })
  }
})

app.get('/api/admin/users/export', requireAdmin, async (_req, res) => {
  try {
    const users = await listAdminUsers(7 * 24 * 60 * 60)
    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'Northstar Admin'
    const sheet = workbook.addWorksheet('Users')
    const columns = [
      ['id', 'User ID'], ['email', 'Email'], ['name', 'Name'], ['phone', 'Phone'],
      ['education', 'Education'], ['description', 'Description'], ['location', 'Location'],
      ['latitude', 'Latitude'], ['longitude', 'Longitude'], ['church_name', 'Church or organization'],
      ['church_location', 'Church / organization location'],
      ['verified', 'Verified'],
      ['photo_path', 'Photo path'], ['photo_link', 'Photo link (7-day signed URL)'],
      ['created_at', 'Created at'], ['email_confirmed_at', 'Email confirmed at'],
      ['last_sign_in_at', 'Last sign in at'], ['user_metadata_json', 'All user metadata (JSON)'],
    ]
    sheet.columns = columns.map(([key, header]) => ({ header, key, width: Math.min(Math.max(header.length + 3, 18), 48) }))
    sheet.addRows(users)
    sheet.getRow(1).font = { bold: true }
    sheet.views = [{ state: 'frozen', ySplit: 1 }]
    const file = Buffer.from(await workbook.xlsx.writeBuffer())
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', 'attachment; filename="northstar-users.xlsx"')
    return res.send(file)
  } catch (error) {
    return res.status(503).json({ error: error.message || 'Could not export users.' })
  }
})

app.use('/api', (req, res) => {
  res.status(404).json({ error: `API route not found: ${req.method} ${req.originalUrl}` })
})

const rootDir = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.resolve(rootDir, '../dist')
app.use(express.static(distDir))
app.get(/.*/, (_req, res, next) => {
  res.sendFile(path.join(distDir, 'index.html'), error => error && next())
})

if (!runningOnVercel) {
  app.listen(port, () => {
    console.log(`Northstar API listening on http://localhost:${port}`)
    startWhatsApp()
  })
}

export default app
