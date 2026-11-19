import { useEffect, useRef, useState } from 'react'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import AdminPage from './pages/AdminPage.jsx'
import AdminLoginPage from './pages/AdminLoginPage.jsx'
import AuthPage from './pages/AuthPage.jsx'
import MemberPage from './pages/MemberPage.jsx'
import { PageSkeleton } from './components/Skeletons.jsx'
import AppErrorBoundary from './components/AppErrorBoundary.jsx'

const FEED_PAGE_SIZE = 10
const COMMENT_PAGE_SIZE = 2
const POST_FIELDS = 'id, user_id, image_path, caption, location, latitude, longitude, created_at'

function isProfileComplete(profile) {
  const requiredValues = [profile.phone, profile.education, profile.description, profile.location, profile.church_name]
  const latitude = Number(profile.latitude)
  const longitude = Number(profile.longitude)
  const hasCoordinates = profile.latitude !== '' && profile.latitude != null
    && profile.longitude !== '' && profile.longitude != null
    && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
    && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180
  return requiredValues.every(value => String(value || '').trim())
    && Boolean(profile.avatar_path || profile.avatar_url)
    && hasCoordinates
}

function validateProfileFields(profile, avatarFile) {
  const value = (field, max) => String(field || '').trim().length > 0 && String(field || '').trim().length <= max
  if (!value(profile.education, 120) || String(profile.education || '').trim().length < 2) return 'Education must be between 2 and 120 characters.'
  if (!value(profile.description, 2000)) return 'Description is required and must be 2,000 characters or less.'
  if (!value(profile.location, 200) || String(profile.location || '').trim().length < 2) return 'Enter a valid location.'
  if (!value(profile.church_name, 120) || String(profile.church_name || '').trim().length < 2) return 'Church or organization must be between 2 and 120 characters.'
  if (String(profile.church_location || '').trim().length > 200) return 'Church location must be 200 characters or less.'
  const latitude = Number(profile.latitude)
  const longitude = Number(profile.longitude)
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return 'Detect a valid location before saving.'
  for (const [label, url] of [['Instagram', profile.instagram_url], ['Facebook', profile.facebook_url], ['YouTube', profile.youtube_url]]) {
    if (!String(url || '').trim()) continue
    try {
      const parsed = new URL(url)
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error()
    } catch { return `${label} link must be a valid http or https URL.` }
  }
  if (avatarFile && (!avatarFile.type.startsWith('image/') || avatarFile.size > 8 * 1024 * 1024)) return 'Profile photo must be an image no larger than 8 MB.'
  return ''
}

function toPublicProfile(userId, profile) {
  return {
    user_id: userId,
    full_name: profile.full_name || '',
    education: profile.education || '',
    description: profile.description || '',
    location: profile.location || '',
    latitude: profile.latitude === '' || profile.latitude == null ? null : Number(profile.latitude),
    longitude: profile.longitude === '' || profile.longitude == null ? null : Number(profile.longitude),
    church_name: profile.church_name || '',
    church_location: profile.church_location || '',
    instagram_url: profile.instagram_url || '',
    facebook_url: profile.facebook_url || '',
    youtube_url: profile.youtube_url || '',
    avatar_path: profile.avatar_path || '',
    updated_at: new Date().toISOString(),
  }
}

async function addSignedPhotoUrls(client, posts, profiles = []) {
  const paths = [...new Set([
    ...posts.map(post => post.image_path),
    ...profiles.map(profile => profile.avatar_path).filter(Boolean),
  ])]
  const { data, error } = paths.length
    ? await client.storage.from('photo').createSignedUrls(paths, 3600)
    : { data: [], error: null }
  if (error) throw error
  // Resolve by returned path instead of array position. Storage can return
  // per-file errors, which otherwise shift the signed URL onto the wrong post.
  const urls = new Map((data || []).map(item => [item.path, item.signedUrl || '']))
  const signedProfiles = profiles.map(profile => ({ ...profile, avatar_url: urls.get(profile.avatar_path) || '' }))
  const profilesById = new Map(signedProfiles.map(profile => [profile.user_id, profile]))
  return {
    profiles: signedProfiles,
    posts: posts.map(post => ({ ...post, image_url: urls.get(post.image_path) || '', author: profilesById.get(post.user_id) || null })),
  }
}

async function memberApi(path, options = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Your session has expired. Sign in again.')
  const response = await fetch(path, {
    cache: 'no-store',
    ...options,
    headers: { Authorization: `Bearer ${session.access_token}`, ...(options.headers || {}) },
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error || 'The request could not be completed.')
  return result
}

export default function App() {
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [signupPhone, setSignupPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const [user, setUser] = useState(null)
  const [checkingSession, setCheckingSession] = useState(isSupabaseConfigured)
  const [profile, setProfile] = useState({ full_name: '', phone: '', education: '', description: '', location: '', latitude: '', longitude: '', church_name: '', church_location: '', instagram_url: '', facebook_url: '', youtube_url: '', avatar_path: '', avatar_url: '' })
  const [avatarFile, setAvatarFile] = useState(null)
  const [avatarPreview, setAvatarPreview] = useState('')
  const [profileBusy, setProfileBusy] = useState(false)
  const [locationBusy, setLocationBusy] = useState(false)
  const [profileNotice, setProfileNotice] = useState(null)
  const [profileTab, setProfileTab] = useState('feed')
  const [posts, setPosts] = useState([])
  const [postsBusy, setPostsBusy] = useState(false)
  const [postsLoadError, setPostsLoadError] = useState('')
  const [feedPosts, setFeedPosts] = useState([])
  const [feedBusy, setFeedBusy] = useState(false)
  const [feedError, setFeedError] = useState('')
  const [feedRefresh, setFeedRefresh] = useState(0)
  const [feedHasMore, setFeedHasMore] = useState(false)
  const [feedMoreBusy, setFeedMoreBusy] = useState(false)
  const [feedFollowingIds, setFeedFollowingIds] = useState([])
  const [feedDiscoveryIds, setFeedDiscoveryIds] = useState([])
  const [followBusyIds, setFollowBusyIds] = useState([])
  const [loadingCommentPost, setLoadingCommentPost] = useState('')
  const [busyLikePosts, setBusyLikePosts] = useState([])
  const [commentDrafts, setCommentDrafts] = useState({})
  const [busyCommentPost, setBusyCommentPost] = useState('')
  const [viewedProfile, setViewedProfile] = useState(null)
  const [viewedProfilePosts, setViewedProfilePosts] = useState([])
  const [viewedFollowStats, setViewedFollowStats] = useState(null)
  const [profileFollowStats, setProfileFollowStats] = useState(null)
  const [followListState, setFollowListState] = useState(null)
  const [notifications, setNotifications] = useState([])
  const [notificationsBusy, setNotificationsBusy] = useState(false)
  const [notificationsError, setNotificationsError] = useState('')
  const followListRequestRef = useRef(0)
  const [viewedProfileBusy, setViewedProfileBusy] = useState(false)
  const [viewedProfileError, setViewedProfileError] = useState('')
  const [postFile, setPostFile] = useState(null)
  const [postPreview, setPostPreview] = useState('')
  const [postCaption, setPostCaption] = useState('')
  const [postLocation, setPostLocation] = useState(null)
  const [postLocationBusy, setPostLocationBusy] = useState(false)
  const [postBusy, setPostBusy] = useState(false)
  const [composerOpen, setComposerOpen] = useState(false)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const [adminView, setAdminView] = useState(false)
  const [adminAuthenticated, setAdminAuthenticated] = useState(false)
  const [adminEmail, setAdminEmail] = useState('admin')
  const [adminPassword, setAdminPassword] = useState('')
  const [adminBusy, setAdminBusy] = useState(false)
  const [adminNotice, setAdminNotice] = useState(null)
  const [adminUsers, setAdminUsers] = useState([])
  const [usersBusy, setUsersBusy] = useState(false)
  const [verificationBusy, setVerificationBusy] = useState('')
  const [deletingUser, setDeletingUser] = useState('')
  const [userSearch, setUserSearch] = useState('')
  const [selectedMemberIds, setSelectedMemberIds] = useState([])
  const [messageTarget, setMessageTarget] = useState(null)
  const [adminMessage, setAdminMessage] = useState('')
  const [adminMessageBusy, setAdminMessageBusy] = useState(false)
  const [adminMessageNotice, setAdminMessageNotice] = useState(null)
  const [whatsappAdminStatus, setWhatsappAdminStatus] = useState(null)
  const [whatsappStatusError, setWhatsappStatusError] = useState('')
  const [whatsappUnlinkBusy, setWhatsappUnlinkBusy] = useState(false)
  const [bulkMessageResults, setBulkMessageResults] = useState([])
  const isSignup = mode === 'signup'
  const profileComplete = isProfileComplete(profile)
  const filteredAdminUsers = adminUsers.filter(user => [user.name, user.email, user.phone, user.education, user.location, user.church_name, user.church_location]
    .some(value => String(value || '').toLowerCase().includes(userSearch.toLowerCase())))
  const verifiedUsers = adminUsers.filter(member => member.verified)
  const selectedVerifiedUsers = verifiedUsers.filter(member => selectedMemberIds.includes(member.id))
  const socialLinks = [
    { label: 'Instagram', url: profile.instagram_url },
    { label: 'Facebook', url: profile.facebook_url },
    { label: 'YouTube', url: profile.youtube_url },
  ].filter(({ url }) => typeof url === 'string' && /^https?:\/\/[^\s]+$/i.test(url.trim()))
  const viewedSocialLinks = [
    { label: 'Instagram', url: viewedProfile?.instagram_url },
    { label: 'Facebook', url: viewedProfile?.facebook_url },
    { label: 'YouTube', url: viewedProfile?.youtube_url },
  ].filter(({ url }) => typeof url === 'string' && /^https?:\/\/[^\s]+$/i.test(url.trim()))
  const whatsappDisplayTitle = whatsappStatusError ? 'WhatsApp status unavailable'
    : whatsappAdminStatus?.serverless ? 'WhatsApp needs a persistent backend'
    : whatsappAdminStatus?.authorized ? 'WhatsApp linked'
      : whatsappAdminStatus?.connected ? (whatsappAdminStatus.expectedNumber ? 'WhatsApp account mismatch' : 'Set the sender number')
        : 'Link WhatsApp'
  const whatsappDisplayMessage = whatsappStatusError || (whatsappAdminStatus?.serverless
    ? 'Vercel serverless cannot keep the WhatsApp connection running. To unlink an existing device, remove Northstar in WhatsApp → Linked devices.'
    : whatsappAdminStatus?.bulkProgress
    ? `Sending ${whatsappAdminStatus.bulkProgress.processed + 1} of ${whatsappAdminStatus.bulkProgress.total} to members. Sent ${whatsappAdminStatus.bulkProgress.sent} so far.`
    : whatsappAdminStatus?.authorized
      ? `Connected as ${whatsappAdminStatus.actualNumber}.`
      : whatsappAdminStatus?.connected
        ? (whatsappAdminStatus.expectedNumber ? `Linked account ${whatsappAdminStatus.actualNumber || ''} does not match ${whatsappAdminStatus.expectedNumber}.` : 'Set WHATSAPP_SENDER_NUMBER in .env to the linked account number.')
        : 'Scan this QR code from WhatsApp → Linked devices to connect this app.')

  useEffect(() => {
    if (!profileNotice) return
    const timeout = window.setTimeout(() => setProfileNotice(null), 3500)
    return () => window.clearTimeout(timeout)
  }, [profileNotice])

  useEffect(() => {
    if (!supabase) return
    let active = true
    async function verifySession(session) {
      if (!session?.access_token) {
        if (active) { setUser(null); setCheckingSession(false) }
        return
      }
      try {
        const response = await fetch('/api/me', { cache: 'no-store', headers: { Authorization: `Bearer ${session.access_token}` } })
        const result = await response.json()
        if (!response.ok) throw new Error(result.error)
        if (active) setUser(result.user)
      } catch {
        if (active) setUser(null)
      } finally {
        if (active) setCheckingSession(false)
      }
    }
    supabase.auth.getSession().then(({ data }) => verifySession(data.session))
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => verifySession(session))
    return () => { active = false; listener.subscription.unsubscribe() }
  }, [])

  useEffect(() => {
    let active = true
    fetch('/api/admin/session', { cache: 'no-store' }).then(response => response.json()).then(result => {
      if (active && result.authenticated) setAdminAuthenticated(true)
    }).catch(() => {})
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!adminAuthenticated) return
    let active = true
    setUsersBusy(true)
    fetch('/api/admin/users').then(async response => {
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not load users.')
      if (active) setAdminUsers(result.users || [])
    }).catch(error => {
      if (active) setAdminNotice({ kind: 'error', text: error.message })
    }).finally(() => active && setUsersBusy(false))
    return () => { active = false }
  }, [adminAuthenticated])

  useEffect(() => {
    if (!adminAuthenticated) { setWhatsappAdminStatus(null); return }
    let active = true
    const refreshStatus = async () => {
      try {
        const response = await fetch('/api/admin/whatsapp/status')
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || 'Could not read WhatsApp status.')
        if (active) { setWhatsappAdminStatus(result); setWhatsappStatusError('') }
      } catch (error) {
        if (active) { setWhatsappAdminStatus(null); setWhatsappStatusError(error.message) }
      }
    }
    refreshStatus()
    const interval = window.setInterval(refreshStatus, 2500)
    return () => { active = false; window.clearInterval(interval) }
  }, [adminAuthenticated])

  useEffect(() => {
    if (!user) return
    const metadata = user.user_metadata || {}
    setProfile({
      full_name: metadata.full_name || '',
      phone: metadata.phone || '',
      education: metadata.education || '',
      description: metadata.description || '',
      location: metadata.location || '',
      latitude: metadata.latitude ?? '',
      longitude: metadata.longitude ?? '',
      church_name: metadata.church_name || '',
      church_location: metadata.church_location || '',
      instagram_url: metadata.instagram_url || '',
      facebook_url: metadata.facebook_url || '',
      youtube_url: metadata.youtube_url || '',
      avatar_path: metadata.avatar_path || '',
      avatar_url: metadata.avatar_url || '',
    })
  }, [user])

  useEffect(() => {
    if (!user?.id) return
    setProfileTab(isProfileComplete(user.user_metadata || {}) ? 'feed' : 'settings')
  }, [user?.id])

  useEffect(() => {
    if (!postFile) { setPostPreview(''); return }
    const url = URL.createObjectURL(postFile)
    setPostPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [postFile])

  useEffect(() => {
    if (!user || !supabase) { setPosts([]); return }
    let active = true
    setPostsBusy(true)
    setPostsLoadError('')
    supabase.from('posts').select('id, image_path, caption, location, latitude, longitude, created_at')
      .eq('user_id', user.id).order('created_at', { ascending: false })
      .then(async ({ data, error }) => {
        if (error) throw error
        const rows = data || []
        const { data: signed } = rows.length
          ? await supabase.storage.from('photo').createSignedUrls(rows.map(post => post.image_path), 3600)
          : { data: [] }
        const urls = new Map((signed || []).map(item => [item.path, item.signedUrl || '']))
        if (active) setPosts(rows.map(post => ({ ...post, image_url: urls.get(post.image_path) })))
      })
      .catch(error => { if (active) setPostsLoadError(error.message.includes("Could not find the table 'public.posts'") ? 'Photo posts are not set up yet. Run supabase/posts-schema.sql in your Supabase SQL Editor.' : `Could not load posts: ${error.message}`) })
      .finally(() => { if (active) setPostsBusy(false) })
    return () => { active = false }
  }, [user?.id])

  useEffect(() => {
    if (!user || !supabase || !isProfileComplete(user.user_metadata || {})) return
    let active = true
    supabase.from('profiles').upsert(toPublicProfile(user.id, user.user_metadata), { onConflict: 'user_id' })
      .then(({ error }) => {
        if (active && error) setFeedError(`Could not sync your public profile. Run supabase/posts-schema.sql in Supabase SQL Editor. (${error.message})`)
      })
      .catch(error => { if (active) setFeedError(`Could not sync your public profile. (${error.message})`) })
    return () => { active = false }
  }, [user?.id])

  async function fetchFeedPage(offset, ordering = { followedIds: feedFollowingIds, discoveryIds: feedDiscoveryIds }) {
    const followedIds = (ordering.followedIds || []).filter(id => id !== user.id).slice(0, 500)
    const discoveryIds = (ordering.discoveryIds || []).filter(id => id !== user.id && !followedIds.includes(id)).slice(0, 150)
    const followingQuery = followedIds.length
      ? supabase.from('posts').select(POST_FIELDS, { count: 'exact' }).in('user_id', followedIds).order('created_at', { ascending: false }).range(offset, offset + FEED_PAGE_SIZE - 1)
      : Promise.resolve({ data: [], count: 0, error: null })
    const { data: followedRows, count: followedCount, error: followedError } = await followingQuery
    if (followedError) throw followedError
    const followedPosts = followedRows || []
    const slotsLeft = FEED_PAGE_SIZE - followedPosts.length
    const discoveryOffset = Math.max(0, offset - (followedCount || 0))
    const discoveryQuery = slotsLeft > 0 && discoveryIds.length
      ? supabase.from('posts').select(POST_FIELDS).in('user_id', discoveryIds).order('created_at', { ascending: false }).range(discoveryOffset, discoveryOffset + slotsLeft - 1)
      : Promise.resolve({ data: [], error: null })
    const { data: discoveryRows, error: discoveryError } = await discoveryQuery
    if (discoveryError) throw discoveryError
    const discoveryPosts = discoveryRows || []
    const postsPage = [...followedPosts, ...discoveryPosts]
    const ids = [...new Set(postsPage.map(post => post.user_id))]
    const postIds = postsPage.map(post => post.id)
    const [profilesResult, likesResult] = await Promise.all([
      ids.length
        ? supabase.from('profiles').select('user_id, full_name, education, description, location, latitude, longitude, church_name, church_location, instagram_url, facebook_url, youtube_url, avatar_path').in('user_id', ids)
        : Promise.resolve({ data: [], error: null }),
      postIds.length ? supabase.from('post_likes').select('post_id, user_id').in('post_id', postIds) : Promise.resolve({ data: [], error: null }),
    ])
    if (profilesResult.error) throw profilesResult.error
    if (likesResult.error) throw likesResult.error
    const [result, verifiedUsers] = await Promise.all([
      addSignedPhotoUrls(supabase, postsPage, profilesResult.data || []),
      fetchVerifiedUsers(ids),
    ])
    const likeRows = likesResult.data || []
    return {
      posts: result.posts.map(post => ({
        ...post,
        author: post.author ? { ...post.author, is_verified: Boolean(verifiedUsers[post.user_id]) } : null,
        like_count: (likeRows || []).filter(like => like.post_id === post.id).length,
        liked_by_me: (likeRows || []).some(like => like.post_id === post.id && like.user_id === user.id),
        comments: [],
        comments_total: null,
        comments_loaded: false,
      })),
      hasMore: postsPage.length === FEED_PAGE_SIZE,
    }
  }

  useEffect(() => {
    if (profileTab !== 'feed' || !user || !supabase) return
    let active = true
    setFeedBusy(true)
    setFeedHasMore(false)
    setFeedPosts([])
    setFeedError('')
    memberApi('/api/feed/ordering')
      .then(ordering => {
        if (!active) return null
        setFeedFollowingIds(ordering.followedIds || [])
        setFeedDiscoveryIds(ordering.discoveryIds || [])
        return fetchFeedPage(0, ordering)
      })
      .then(result => {
        if (active && result) { setFeedPosts(result.posts); setFeedHasMore(result.hasMore) }
      })
      .catch(error => { if (active) setFeedError(`Could not load the feed. ${error.message.includes('follows') ? 'Run supabase/follows-schema.sql in Supabase SQL Editor.' : 'Check your posts schema and server environment.'} (${error.message})`) })
      .finally(() => { if (active) setFeedBusy(false) })
    return () => { active = false }
  }, [profileTab, user?.id, feedRefresh])

  useEffect(() => {
    if (profileTab !== 'profile' || !user || !supabase) return
    let active = true
    memberApi(`/api/follows/${user.id}`)
      .then(stats => { if (active) setProfileFollowStats({ ...stats, userId: user.id }) })
      .catch(() => { if (active) setProfileFollowStats({ followers: 0, following: 0, userId: user.id }) })
    return () => { active = false }
  }, [profileTab, user?.id, feedRefresh])

  useEffect(() => {
    if (!user || !supabase) return
    let active = true
    const loadNotifications = async () => {
      setNotificationsBusy(true)
      setNotificationsError('')
      try {
        const { data, error } = await supabase.from('notifications')
          .select('id, actor_id, kind, post_id, created_at, read_at')
          .eq('recipient_id', user.id).order('created_at', { ascending: false }).limit(50)
        if (error) throw error
        const rows = data || []
        const actorIds = [...new Set(rows.map(item => item.actor_id).filter(Boolean))]
        const { data: actors, error: actorError } = actorIds.length
          ? await supabase.from('profiles').select('user_id, full_name, avatar_path').in('user_id', actorIds)
          : { data: [], error: null }
        if (actorError) throw actorError
        const { profiles } = await addSignedPhotoUrls(supabase, [], actors || [])
        const actorById = new Map(profiles.map(item => [item.user_id, item]))
        if (active) setNotifications(rows.map(item => ({ ...item, actor: actorById.get(item.actor_id) || null })))
      } catch (error) {
        if (active) setNotificationsError(error.message.includes('notifications') ? 'Run supabase/notifications-schema.sql in Supabase SQL Editor to enable notifications.' : error.message)
      } finally {
        if (active) setNotificationsBusy(false)
      }
    }
    loadNotifications()
    const channel = supabase.channel(`member-notifications-${user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${user.id}` }, loadNotifications)
      .subscribe()
    return () => { active = false; supabase.removeChannel(channel) }
  }, [user?.id])

  async function openNotification(item) {
    if (!item.read_at) {
      const readAt = new Date().toISOString()
      const { error } = await supabase.from('notifications').update({ read_at: readAt }).eq('id', item.id).eq('recipient_id', user.id)
      if (!error) setNotifications(current => current.map(notification => notification.id === item.id ? { ...notification, read_at: readAt } : notification))
    }
    if (item.actor_id && item.kind !== 'new_member') await openMemberProfile(item.actor_id)
    else if (item.actor_id) await openMemberProfile(item.actor_id)
  }

  async function loadMoreFeedPosts() {
    if (!supabase || !user || feedMoreBusy || !feedHasMore) return
    setFeedMoreBusy(true)
    try {
      const { posts: page, hasMore } = await fetchFeedPage(feedPosts.length)
      setFeedPosts(current => [...current, ...page])
      setFeedHasMore(hasMore)
    } catch (error) {
      setFeedError(`Could not load more posts. (${error.message})`)
    } finally {
      setFeedMoreBusy(false)
    }
  }

  async function toggleMemberFollow(memberId, isFollowingOverride) {
    if (!memberId || memberId === user?.id || followBusyIds.includes(memberId)) return
    setFollowBusyIds(current => [...current, memberId])
    const currentlyFollowing = typeof isFollowingOverride === 'boolean'
      ? isFollowingOverride
      : viewedFollowStats?.userId === memberId ? viewedFollowStats.isFollowing : feedFollowingIds.includes(memberId)
    try {
      await memberApi(`/api/follows/${memberId}`, { method: currentlyFollowing ? 'DELETE' : 'PUT' })
      setFeedFollowingIds(current => currentlyFollowing ? current.filter(id => id !== memberId) : [...current, memberId])
      setViewedFollowStats(current => current?.userId === memberId ? { ...current, isFollowing: !currentlyFollowing, followers: Math.max(0, (current.followers || 0) + (currentlyFollowing ? -1 : 1)) } : current)
      setProfileFollowStats(current => current ? { ...current, following: Math.max(0, (current.following || 0) + (currentlyFollowing ? -1 : 1)) } : current)
      setFollowListState(current => current ? { ...current, items: current.items.map(item => item.user_id === memberId ? { ...item, isFollowing: !currentlyFollowing } : item) } : current)
      setFeedRefresh(value => value + 1)
    } catch (error) {
      setProfileNotice({ kind: 'error', text: `Could not update follow. ${error.message}` })
    } finally {
      setFollowBusyIds(current => current.filter(id => id !== memberId))
    }
  }

  async function openFollowList(profileId, listType) {
    const requestId = ++followListRequestRef.current
    const title = listType === 'followers' ? 'Followers' : 'Following'
    setFollowListState({ profileId, listType, title, items: [], busy: true, error: '' })
    try {
      const result = await memberApi(`/api/follows/${profileId}?list=${listType}`)
      const ids = result.userIds || []
      const { data, error } = ids.length
        ? await supabase.from('profiles').select('user_id, full_name, location, avatar_path').in('user_id', ids)
        : { data: [], error: null }
      if (error) throw error
      const { profiles } = await addSignedPhotoUrls(supabase, [], data || [])
      const byId = new Map(profiles.map(item => [item.user_id, item]))
      const items = ids.map(id => ({ ...byId.get(id), user_id: id, isFollowing: (result.viewerFollowingIds || []).includes(id) }))
      if (requestId === followListRequestRef.current) setFollowListState({ profileId, listType, title, items, busy: false, error: '' })
    } catch (error) {
      if (requestId === followListRequestRef.current) setFollowListState({ profileId, listType, title, items: [], busy: false, error: error.message || 'Could not load this list.' })
    }
  }

  function closeFollowList() {
    followListRequestRef.current += 1
    setFollowListState(null)
  }

  async function loadPostComments(post, loadAll = false) {
    if (!supabase || loadingCommentPost === post.id) return
    const offset = post.comments_loaded ? post.comments.length : 0
    const batchSize = loadAll ? Math.max(0, (post.comments_total || 0) - offset) : COMMENT_PAGE_SIZE
    setLoadingCommentPost(post.id)
    try {
      const { data, count, error } = await supabase.from('post_comments')
        .select('id, post_id, user_id, content, created_at', { count: 'exact' })
        .eq('post_id', post.id)
        .order('created_at', { ascending: false })
        .range(offset, offset + batchSize - 1)
      if (error) throw error
      const commentUserIds = [...new Set((data || []).map(comment => comment.user_id))]
      const { data: commentProfiles, error: profilesError } = commentUserIds.length
        ? await supabase.from('profiles').select('user_id, full_name').in('user_id', commentUserIds)
        : { data: [], error: null }
      if (profilesError) throw profilesError
      const namesByUser = new Map((commentProfiles || []).map(item => [item.user_id, item.full_name]))
      const comments = (data || []).map(comment => ({ ...comment, author_name: namesByUser.get(comment.user_id) || 'Member' }))
      setFeedPosts(current => current.map(item => item.id === post.id ? {
        ...item,
        comments: offset ? [...item.comments, ...comments] : comments,
        comments_total: count ?? comments.length,
        comments_loaded: true,
      } : item))
    } catch (error) {
      setProfileNotice({ kind: 'error', text: `Could not load comments. (${error.message})` })
    } finally {
      setLoadingCommentPost('')
    }
  }

  useEffect(() => {
    if (avatarFile) {
      const previewUrl = URL.createObjectURL(avatarFile)
      setAvatarPreview(previewUrl)
      return () => URL.revokeObjectURL(previewUrl)
    }
    if (!profile.avatar_path || !supabase) {
      setAvatarPreview(profile.avatar_url || '')
      return
    }
    let active = true
    supabase.storage.from('photo').createSignedUrl(profile.avatar_path, 3600).then(({ data, error }) => {
      if (!active) return
      if (error || !data?.signedUrl) {
        setAvatarPreview(profile.avatar_url || '')
        if (error) setProfileNotice({ kind: 'error', text: `Could not load profile photo: ${error.message}` })
        return
      }
      setAvatarPreview(`${data.signedUrl}${data.signedUrl.includes('?') ? '&' : '?'}v=${Date.now()}`)
    }).catch(error => {
      if (active) {
        setAvatarPreview(profile.avatar_url || '')
        setProfileNotice({ kind: 'error', text: `Could not load profile photo: ${error.message}` })
      }
    })
    return () => { active = false }
  }, [avatarFile, profile.avatar_path, profile.avatar_url])

  async function openMemberProfile(userId) {
    setViewedProfileBusy(true)
    setViewedProfileError('')
    setViewedProfile(null)
    setViewedProfilePosts([])
    try {
      const [{ data: profileRow, error: profileError }, { data: postRows, error: postsError }, followStats] = await Promise.all([
        supabase.from('profiles').select('user_id, full_name, education, description, location, latitude, longitude, church_name, church_location, instagram_url, facebook_url, youtube_url, avatar_path').eq('user_id', userId).single(),
        supabase.from('posts').select('id, user_id, image_path, caption, location, latitude, longitude, created_at').eq('user_id', userId).order('created_at', { ascending: false }),
        memberApi(`/api/follows/${userId}`),
      ])
      if (profileError) throw profileError
      if (postsError) throw postsError
      const result = await addSignedPhotoUrls(supabase, postRows || [], [profileRow])
      const verifiedUsers = await fetchVerifiedUsers([userId])
      setViewedProfile({ ...result.profiles[0], is_verified: Boolean(verifiedUsers[userId]) })
      setViewedProfilePosts(result.posts)
      setViewedFollowStats({ ...followStats, userId })
      setProfileTab('member-profile')
    } catch (error) {
      setViewedProfileError(`Could not open this profile. Run supabase/posts-schema.sql in Supabase SQL Editor. (${error.message})`)
    } finally {
      setViewedProfileBusy(false)
    }
  }

  async function fetchVerifiedUsers(userIds) {
    if (!supabase || !userIds.length) return {}
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) return {}
    const response = await fetch('/api/profiles/verification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ user_ids: userIds }),
    })
    if (!response.ok) return {}
    const result = await response.json()
    return result.verifiedUsers || {}
  }

  async function togglePostLike(post) {
    if (!supabase || !user || busyLikePosts.includes(post.id)) return
    setBusyLikePosts(current => [...current, post.id])
    try {
      if (post.liked_by_me) {
        const { error } = await supabase.from('post_likes').delete().eq('post_id', post.id).eq('user_id', user.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('post_likes').insert({ post_id: post.id, user_id: user.id })
        if (error) throw error
      }
      setFeedPosts(current => current.map(item => item.id === post.id ? {
        ...item,
        liked_by_me: !post.liked_by_me,
        like_count: Math.max(0, item.like_count + (post.liked_by_me ? -1 : 1)),
      } : item))
    } catch (error) {
      setProfileNotice({ kind: 'error', text: `Could not update like. Run the updated supabase/posts-schema.sql. (${error.message})` })
    } finally {
      setBusyLikePosts(current => current.filter(id => id !== post.id))
    }
  }

  async function submitPostComment(event, post) {
    event.preventDefault()
    const content = (commentDrafts[post.id] || '').trim()
    if (!content || !supabase || !user || busyCommentPost) return
    setBusyCommentPost(post.id)
    try {
      const { data, error } = await supabase.from('post_comments').insert({ post_id: post.id, user_id: user.id, content }).select('id, post_id, user_id, content, created_at').single()
      if (error) throw error
      const comment = { ...data, author_name: profile.full_name || user.user_metadata?.full_name || 'You' }
      setFeedPosts(current => current.map(item => item.id === post.id ? {
        ...item,
        comments: item.comments_loaded ? [comment, ...item.comments] : item.comments,
        comments_total: item.comments_total == null ? null : item.comments_total + 1,
      } : item))
      setCommentDrafts(current => ({ ...current, [post.id]: '' }))
    } catch (error) {
      setProfileNotice({ kind: 'error', text: `Could not add comment. Run the updated supabase/posts-schema.sql. (${error.message})` })
    } finally {
      setBusyCommentPost('')
    }
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setNotice(null)
    if (isSignup && (name.trim().length < 2 || name.trim().length > 120 || /[\u0000-\u001f<>]/.test(name))) {
      setNotice({ kind: 'error', text: 'Enter a valid name between 2 and 120 characters.' })
      return
    }
    if (email.trim().length > 254 || !/^\S+@\S+\.\S+$/.test(email.trim())) {
      setNotice({ kind: 'error', text: 'Enter a valid email address.' })
      return
    }
    if (isSignup && (password.length < 8 || password.length > 128)) {
      setNotice({ kind: 'error', text: 'Password must be 8 to 128 characters.' })
      return
    }
    if (isSignup) {
      const phoneDigits = signupPhone.replace(/[\s().-]/g, '').replace(/^\+/, '')
      const validPhone = /^(?:91)?[6-9]\d{9}$/.test(phoneDigits)
      if (!validPhone) {
        setNotice({ kind: 'error', text: 'Enter a valid Indian mobile number.' })
        return
      }
    }
    if (!isSupabaseConfigured) {
      setNotice({ kind: 'error', text: 'Supabase is not configured. Check the local .env file.' })
      return
    }
    setBusy(true)
    try {
      if (isSignup) {
        const response = await fetch('/api/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email.trim(), password, full_name: name.trim(), phone: signupPhone.trim() }),
        })
        const created = await response.json()
        if (!response.ok) throw new Error(created.error || 'Could not create the account.')
      }
      const result = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (result.error) throw result.error
      if (result.data.user) {
        setProfileTab('profile')
        setUser({ id: result.data.user.id, email: result.data.user.email, user_metadata: result.data.user.user_metadata })
        setNotice({ kind: 'success', text: isSignup ? 'Account created.' : 'Signed in.' })
      }
    } catch (error) {
      setNotice({ kind: 'error', text: error.message || 'Something went wrong. Please try again.' })
    } finally {
      setBusy(false)
    }
  }

  async function sendPasswordReset() {
    setNotice(null)
    if (!email || !supabase) {
      setNotice({ kind: 'error', text: 'Enter your email address first.' })
      return
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email)
    setNotice(error
      ? { kind: 'error', text: error.message }
      : { kind: 'success', text: 'Password reset instructions have been sent.' })
  }

  async function saveProfile(event) {
    event.preventDefault()
    setProfileNotice(null)
    if (!supabase || !user) return
    const missingFields = []
    if (!avatarFile && !profile.avatar_path && !profile.avatar_url) missingFields.push('profile picture')
    if (!String(profile.phone || '').trim()) missingFields.push('phone number')
    if (!String(profile.education || '').trim()) missingFields.push('education')
    if (!String(profile.description || '').trim()) missingFields.push('description')
    if (!String(profile.location || '').trim() || profile.latitude === '' || profile.latitude == null || profile.longitude === '' || profile.longitude == null) missingFields.push('detected location')
    if (!String(profile.church_name || '').trim()) missingFields.push('church or organization')
    if (missingFields.length) {
      setProfileNotice({ kind: 'error', text: `Complete these fields before continuing: ${missingFields.join(', ')}.` })
      return
    }
    const validationError = validateProfileFields(profile, avatarFile)
    if (validationError) {
      setProfileNotice({ kind: 'error', text: validationError })
      return
    }
    setProfileBusy(true)
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      if (!sessionData.session?.access_token) throw new Error('Your session has expired. Sign in again.')
      const phoneResponse = await fetch('/api/profile/validate', {
        method: 'POST',
        headers: { Authorization: `Bearer ${sessionData.session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: profile.phone, education: profile.education, description: profile.description,
          location: profile.location, latitude: profile.latitude, longitude: profile.longitude,
          church_name: profile.church_name, church_location: profile.church_location,
          instagram_url: profile.instagram_url, facebook_url: profile.facebook_url, youtube_url: profile.youtube_url }),
      })
      const phoneValidation = await phoneResponse.json()
      if (!phoneResponse.ok) throw new Error(phoneValidation.error || 'Could not validate this phone number.')
      let avatarPath = profile.avatar_path
      if (avatarFile) {
        const extension = avatarFile.name.split('.').pop()?.toLowerCase() || 'jpg'
        const filePath = `${user.id}/profile.${extension}`
        const { error: uploadError } = await supabase.storage.from('photo').upload(filePath, avatarFile, {
          upsert: true,
          contentType: avatarFile.type || 'image/jpeg',
        })
        if (uploadError) throw uploadError
        avatarPath = filePath
      }

      const metadata = { ...profile, phone: phoneValidation.phone, avatar_path: avatarPath }
      const { data, error } = await supabase.auth.updateUser({ data: metadata })
      if (error) throw error
      const { error: publicProfileError } = await supabase.from('profiles').upsert(toPublicProfile(user.id, metadata), { onConflict: 'user_id' })
      if (publicProfileError) throw new Error(`Profile details saved, but public profile sync failed. Run supabase/posts-schema.sql in Supabase SQL Editor. (${publicProfileError.message})`)
      await memberApi('/api/feed/cache/invalidate', { method: 'POST' }).catch(() => {})
      if (data.user) setUser({ ...user, user_metadata: data.user.user_metadata })
      setProfile(metadata)
      setAvatarFile(null)
      if (avatarPath) {
        const { data: signedPhoto } = await supabase.storage.from('photo').createSignedUrl(avatarPath, 3600)
        if (signedPhoto?.signedUrl) setAvatarPreview(`${signedPhoto.signedUrl}${signedPhoto.signedUrl.includes('?') ? '&' : '?'}v=${Date.now()}`)
      }
      setProfileTab('profile')
      setProfileNotice({ kind: 'success', text: 'Profile saved.' })
    } catch (error) {
      setProfileNotice({ kind: 'error', text: error.message || 'Could not save your profile.' })
    } finally {
      setProfileBusy(false)
    }
  }

  async function openProfileSettings() {
    setProfileTab('settings')
    if (!supabase || !user) return
    const { data, error } = await supabase.auth.getUser()
    if (error) {
      setProfileNotice({ kind: 'error', text: `Could not refresh your saved profile: ${error.message}` })
      return
    }
    if (data.user?.id === user.id) {
      setUser(current => current ? { ...current, user_metadata: data.user.user_metadata } : current)
    }
  }

  async function detectLocation() {
    setProfileNotice(null)
    if (!window.isSecureContext) {
      setProfileNotice({ kind: 'error', text: 'Browser location requires HTTPS. Open this app on localhost or use an HTTPS address.' })
      return
    }
    if (!navigator.geolocation) {
      setProfileNotice({ kind: 'error', text: 'Location detection is not available in this browser.' })
      return
    }
    setLocationBusy(true)
    try {
      const coords = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(
        position => resolve(position.coords),
        error => reject(new Error(error.code === 1 ? 'Allow location access in your browser to detect your location.' : 'Could not detect your location. Check your device location settings and try again.')),
        { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 },
      ))
      const latitude = Number(coords.latitude.toFixed(6))
      const longitude = Number(coords.longitude.toFixed(6))
      let location = `${latitude}, ${longitude}`
      try {
        const response = await fetch(`https://photon.komoot.io/reverse?lat=${latitude}&lon=${longitude}&lang=en`)
        if (response.ok) {
          const result = await response.json()
          const place = result.features?.[0]?.properties || {}
          const locality = place.city || place.town || place.village || place.locality || place.county
          location = [locality, place.state, place.country].filter(Boolean).join(', ') || location
        }
      } catch {
        // Keep the coordinates when the place-name lookup is unavailable.
      }
      setProfile(current => ({ ...current, location, latitude, longitude }))
      setProfileNotice({ kind: 'success', text: 'Location detected. Save profile to store it.' })
    } catch (error) {
      setProfileNotice({ kind: 'error', text: error.message || 'Could not detect your location.' })
    } finally {
      setLocationBusy(false)
    }
  }

  async function detectPostLocation() {
    setProfileNotice(null)
    if (!window.isSecureContext) {
      setProfileNotice({ kind: 'error', text: 'Photo location requires HTTPS. Open this app on localhost or use an HTTPS address.' })
      return
    }
    if (!navigator.geolocation) {
      setProfileNotice({ kind: 'error', text: 'Location detection is not available in this browser.' })
      return
    }
    setPostLocationBusy(true)
    try {
      const coords = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(
        position => resolve(position.coords),
        error => reject(new Error(error.code === 1 ? 'Allow location access to tag this photo.' : 'Could not detect your location. Try again.')),
        { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 },
      ))
      const latitude = Number(coords.latitude.toFixed(6))
      const longitude = Number(coords.longitude.toFixed(6))
      let location = `${latitude}, ${longitude}`
      try {
        const response = await fetch(`https://photon.komoot.io/reverse?lat=${latitude}&lon=${longitude}&lang=en`)
        if (response.ok) {
          const place = (await response.json()).features?.[0]?.properties || {}
          location = [place.city || place.town || place.village || place.locality || place.county, place.state, place.country].filter(Boolean).join(', ') || location
        }
      } catch { /* Coordinates still provide the required location tag. */ }
      setPostLocation({ location, latitude, longitude })
      setProfileNotice({ kind: 'success', text: `Photo location added: ${location}` })
    } catch (error) {
      setPostLocation(null)
      setProfileNotice({ kind: 'error', text: error.message || 'Could not detect your location.' })
    } finally {
      setPostLocationBusy(false)
    }
  }

  async function publishPost(event) {
    event.preventDefault()
    if (!supabase || !user) return
    if (!postFile) {
      setProfileNotice({ kind: 'error', text: 'Choose or capture a photo first.' })
      return
    }
    if (postLocation?.latitude == null || postLocation?.longitude == null || !postLocation?.location) {
      setProfileNotice({ kind: 'error', text: 'Detect your location before uploading a photo.' })
      return
    }
    if (!postFile.type.startsWith('image/')) {
      setProfileNotice({ kind: 'error', text: 'Choose an image file.' })
      return
    }
    setPostBusy(true)
    setProfileNotice(null)
    const extension = postFile.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
    const imagePath = `${user.id}/posts/${crypto.randomUUID()}.${extension}`
    try {
      const { error: uploadError } = await supabase.storage.from('photo').upload(imagePath, postFile, { contentType: postFile.type })
      if (uploadError) throw uploadError
      const { data, error } = await supabase.from('posts').insert({
        user_id: user.id,
        image_path: imagePath,
        caption: postCaption.trim(),
        location: postLocation.location,
        latitude: postLocation.latitude,
        longitude: postLocation.longitude,
      }).select('id, image_path, caption, location, latitude, longitude, created_at').single()
      if (error) {
        await supabase.storage.from('photo').remove([imagePath]).catch(() => {})
        throw error
      }
      const { data: signed } = await supabase.storage.from('photo').createSignedUrl(imagePath, 3600)
      setPosts(current => [{ ...data, image_url: signed?.signedUrl || postPreview }, ...current])
      setPostFile(null)
      setPostCaption('')
      setPostLocation(null)
      setComposerOpen(false)
      setFeedRefresh(value => value + 1)
      setProfileNotice({ kind: 'success', text: 'Photo posted to your profile.' })
    } catch (error) {
      setProfileNotice({ kind: 'error', text: error.message || 'Could not upload this photo.' })
    } finally {
      setPostBusy(false)
    }
  }

  async function handleAdminLogin(event) {
    event.preventDefault()
    setAdminBusy(true)
    setAdminNotice(null)
    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: adminEmail, password: adminPassword }),
      })
      let result
      try {
        result = await response.json()
      } catch {
        throw new Error('The admin API returned a web page instead of JSON. Start the backend on port 3002 and open this app at http://localhost:3001.')
      }
      if (!response.ok) throw new Error(result.error || 'Admin sign in failed.')
      setAdminAuthenticated(true)
      setAdminView(true)
      setAdminPassword('')
    } catch (error) {
      setAdminNotice({ kind: 'error', text: error.message })
    } finally {
      setAdminBusy(false)
    }
  }

  async function handleAdminLogout() {
    await fetch('/api/admin/logout', { method: 'POST' }).catch(() => {})
    setAdminAuthenticated(false)
    setAdminUsers([])
    setAdminView(false)
  }

  async function exportUsers() {
    setAdminNotice(null)
    try {
      const response = await fetch('/api/admin/users/export')
      if (!response.ok) {
        const result = await response.json()
        throw new Error(result.error || 'Could not export users.')
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'northstar-users.xlsx'
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      setAdminNotice({ kind: 'error', text: error.message })
    }
  }

  async function unlinkWhatsApp() {
    setWhatsappUnlinkBusy(true)
    try {
      const response = await fetch('/api/admin/whatsapp/unlink', { method: 'POST' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not unlink WhatsApp.')
      setWhatsappAdminStatus(result)
      setWhatsappStatusError('')
    } catch (error) {
      setWhatsappStatusError(error.message)
    } finally {
      setWhatsappUnlinkBusy(false)
    }
  }

  async function setVerified(userId, verified) {
    setVerificationBusy(userId)
    setAdminNotice(null)
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/verification`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ verified }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not update verification.')
      setAdminUsers(users => users.map(user => user.id === userId ? { ...user, verified: result.verified } : user))
      if (!result.verified) setSelectedMemberIds(ids => ids.filter(id => id !== userId))
    } catch (error) {
      setAdminNotice({ kind: 'error', text: error.message })
    } finally {
      setVerificationBusy('')
    }
  }

  async function sendWhatsAppMessage(event) {
    event.preventDefault()
    if (!messageTarget || !adminMessage.trim()) return
    if (messageTarget.bulk && !messageTarget.userIds?.length) {
      setAdminMessageNotice({ kind: 'error', text: 'Select at least one verified member first.' })
      return
    }
    setAdminMessageBusy(true)
    setAdminMessageNotice(null)
    setBulkMessageResults([])
    try {
      const endpoint = messageTarget.bulk ? '/api/admin/users/message-selected' : `/api/admin/users/${encodeURIComponent(messageTarget.id)}/message`
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: adminMessage.trim(), ...(messageTarget.bulk ? { userIds: messageTarget.userIds } : {}) }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not send WhatsApp message.')
      if (messageTarget.bulk) setBulkMessageResults((result.results || []).filter(item => item.status !== 'sent'))
      setAdminMessageNotice({ kind: 'success', text: messageTarget.bulk
        ? `Bulk send finished: ${result.sent} sent, ${result.failed} failed, ${result.skipped} skipped out of ${result.total} members${result.stoppedReason ? `. Stopped: ${result.stoppedReason}` : ''}.`
        : `Message sent to ${messageTarget.name || messageTarget.phone}.` })
      setAdminMessage('')
      setMessageTarget(null)
    } catch (error) {
      setAdminMessageNotice({ kind: 'error', text: error.message })
    } finally {
      setAdminMessageBusy(false)
    }
  }

  async function deleteUserAccount(user) {
    const label = user.email || user.name || user.id
    if (!window.confirm(`Permanently delete ${label}'s account, profile, posts, and photos?`)) return
    setDeletingUser(user.id)
    setAdminNotice(null)
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}`, { method: 'DELETE' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not delete this account.')
      setAdminUsers(users => users.filter(item => item.id !== user.id))
      setSelectedMemberIds(ids => ids.filter(id => id !== user.id))
      setAdminNotice({ kind: 'success', text: `Deleted ${label}'s account and profile data.` })
    } catch (error) {
      setAdminNotice({ kind: 'error', text: error.message })
    } finally {
      setDeletingUser('')
    }
  }

  const pageProps = {
    mode, isSignup, setMode, email, setEmail, password, setPassword, name, setName, signupPhone, setSignupPhone,
    busy, notice, setNotice, handleSubmit, sendPasswordReset, isSupabaseConfigured, setAdminView, adminView,
    adminEmail, setAdminEmail, adminPassword, setAdminPassword, adminBusy, adminNotice, setAdminNotice, handleAdminLogin,
    handleAdminLogout, adminAuthenticated, adminUsers, usersBusy, verificationBusy, deletingUser, userSearch, setUserSearch,
    filteredAdminUsers, exportUsers, setVerified, deleteUserAccount, messageTarget, setMessageTarget, adminMessage,
    selectedMemberIds, setSelectedMemberIds, selectedVerifiedUsers, verifiedUsers,
    setAdminMessage, adminMessageBusy, adminMessageNotice, setAdminMessageNotice, sendWhatsAppMessage,
    whatsappAdminStatus, whatsappStatusError, whatsappDisplayTitle, whatsappDisplayMessage, whatsappUnlinkBusy, unlinkWhatsApp, bulkMessageResults, setBulkMessageResults,
    profileNotice, user, profileComplete, profileTab, setProfileTab, openProfileSettings, accountMenuOpen,
    setAccountMenuOpen, profile, avatarPreview, setAvatarPreview, saveProfile, avatarFile, setAvatarFile,
    profileBusy, locationBusy, detectLocation, setProfile, feedError, feedBusy, feedPosts, feedHasMore, feedMoreBusy, loadMoreFeedPosts, feedFollowingIds, followBusyIds, toggleMemberFollow, openMemberProfile,
    notifications, notificationsBusy, notificationsError, openNotification,
    busyLikePosts, togglePostLike, busyCommentPost, commentDrafts, setCommentDrafts, submitPostComment, loadingCommentPost, loadPostComments, loadAllPostComments: post => loadPostComments(post, true),
    viewedProfileBusy, viewedProfileError, viewedProfile, viewedSocialLinks, viewedProfilePosts, viewedFollowStats, profileFollowStats, followListState, openFollowList, closeFollowList, socialLinks,
    posts, composerOpen, setComposerOpen, setProfileNotice, publishPost, postFile, postPreview, setPostFile,
    setPostLocation, postCaption, setPostCaption, postLocationBusy, postLocation, detectPostLocation, postBusy,
    postsLoadError, postsBusy, supabase, setUser,
  }
  
  if (checkingSession) return <PageSkeleton />
  if (adminAuthenticated) return <AdminPage app={pageProps} />
  if (adminView) return <AdminLoginPage app={pageProps} />
  if (user) return <AppErrorBoundary><MemberPage app={pageProps} /></AppErrorBoundary>
  return <AuthPage app={pageProps} />
}
