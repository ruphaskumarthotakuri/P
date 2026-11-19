import Brand from '../components/Brand.jsx'
import { ArrowLeft, ArrowUpRight, Bell, Camera, Facebook, Heart, Home, Instagram, LogOut, MapPin, MessageCircle, Plus, Send, Settings, UserRound, Youtube } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { AccountSettings, EditActions, MemberSearch, ScrollMore } from '../components/MemberTools.jsx'
import { FeedSkeleton, PostGridSkeleton, ProfileSkeleton } from '../components/Skeletons.jsx'

export default function MemberPage({ app }) {
  const {
    profilePostsMore, viewedPostsMore, profileMoreBusy, loadMoreProfilePosts, loadMoreFollowList, profilePostCount, viewedPostCount,
    memberApi, editContent, deleteContent, blockMember, reportMember, markAllNotificationsRead,
    notificationPost, setNotificationPost, uploadProgress, uploadStage,
    profileNotice, user, profileComplete, profileTab, setProfileTab, openProfileSettings,
    profile, avatarPreview, setAvatarPreview, saveProfile,
    avatarFile, setAvatarFile, profileBusy, setProfile, locationBusy, detectLocation, feedError,
    feedBusy, feedPosts, feedHasMore, feedMoreBusy, loadMoreFeedPosts, feedFollowingIds, followBusyIds, toggleMemberFollow, openMemberProfile, busyLikePosts, togglePostLike, busyCommentPost,
    commentDrafts, setCommentDrafts, submitPostComment, loadingCommentPost, loadPostComments, loadAllPostComments, viewedProfileBusy, viewedProfileError,
    viewedProfile, viewedSocialLinks, viewedProfilePosts, viewedFollowStats, profileFollowStats, followListState, openFollowList, closeFollowList, socialLinks, posts, composerOpen,
    notifications, notificationsBusy, notificationsError, openNotification,
    setComposerOpen, setProfileNotice, publishPost, postFile, postPreview, setPostFile, setPostLocation,
    postCaption, setPostCaption, postLocationBusy, postLocation, detectPostLocation, postBusy,
    postsLoadError, postsBusy, supabase, setUser,
  } = app
  const galleryInputRef = useRef(null)
  const cameraFallbackInputRef = useRef(null)
  const cameraVideoRef = useRef(null)
  const feedScrollSentinelRef = useRef(null)
  const [cameraStream, setCameraStream] = useState(null)
  const unreadCount = notifications.filter(item => !item.read_at).length
  const viewingFeed = profileTab === 'feed' || profileTab === 'member-profile'

  useEffect(() => {
    if (!composerOpen || profileTab !== 'profile') return
    const frame = window.requestAnimationFrame(() => {
      document.getElementById('post-composer')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [composerOpen, profileTab])

  useEffect(() => {
    if (!cameraStream) return
    const video = cameraVideoRef.current
    if (video) {
      video.srcObject = cameraStream
      video.play().catch(() => {})
    }
    return () => cameraStream.getTracks().forEach(track => track.stop())
  }, [cameraStream])

  useEffect(() => {
    if (profileTab !== 'feed' || !feedHasMore || feedMoreBusy || !feedScrollSentinelRef.current) return
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) loadMoreFeedPosts()
    }, { rootMargin: '500px 0px' })
    observer.observe(feedScrollSentinelRef.current)
    return () => observer.disconnect()
  }, [profileTab, feedHasMore, feedMoreBusy, feedPosts.length, loadMoreFeedPosts])

  useEffect(() => {
    if (profileTab !== 'feed' || !feedPosts.length) return
    const observers = []
    document.querySelectorAll('.comment-initial-sentinel[data-post-id], .comment-load-sentinel[data-post-id]').forEach(sentinel => {
      const initialLoad = sentinel.classList.contains('comment-initial-sentinel')
      const observer = new IntersectionObserver(entries => {
        if (!entries.some(entry => entry.isIntersecting)) return
        const post = feedPosts.find(item => item.id === sentinel.dataset.postId)
        if (post && (initialLoad ? !post.comments_loaded : sentinel.parentElement.scrollTop > 0 && post.comments_loaded && post.comments.length < (post.comments_total || 0))) loadPostComments(post)
      }, initialLoad ? { rootMargin: '120px 0px' } : { root: sentinel.parentElement, rootMargin: '0px 0px 40px 0px' })
      observer.observe(sentinel)
      observers.push(observer)
    })
    return () => observers.forEach(observer => observer.disconnect())
  }, [profileTab, feedPosts, loadingCommentPost, loadPostComments])

  function choosePostFile(event) {
    const file = event.currentTarget.files?.[0]
    if (file) {
      setPostFile(file)
      setPostLocation(null)
    }
    event.currentTarget.value = ''
  }

  async function openPostCamera() {
    setProfileNotice(null)
    if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
      cameraFallbackInputRef.current?.click()
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      setCameraStream(stream)
    } catch (error) {
      setProfileNotice({ kind: 'error', text: error.name === 'NotAllowedError' ? 'Allow camera access in your browser, or choose a photo from your gallery/files.' : 'Could not open the camera. Choose a photo from your gallery/files instead.' })
    }
  }

  function capturePostPhoto() {
    const video = cameraVideoRef.current
    if (!video?.videoWidth || !video?.videoHeight) {
      setProfileNotice({ kind: 'error', text: 'The camera is not ready yet. Try again in a moment.' })
      return
    }
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height)
    canvas.toBlob(blob => {
      if (!blob) {
        setProfileNotice({ kind: 'error', text: 'Could not capture the photo. Please try again.' })
        return
      }
      setPostFile(new File([blob], `minstryconnect-post-${Date.now()}.jpg`, { type: 'image/jpeg' }))
      setPostLocation(null)
      setCameraStream(null)
    }, 'image/jpeg', 0.92)
  }

  return (
    <main className="page member-page">
      {profileNotice && <div className={`toast toast-${profileNotice.kind}`} role="status" aria-live="polite">{profileNotice.text}</div>}
      <section className="member-shell">
        <header className="member-topbar">
          <div className="member-topbar-inner">
            <button className="member-brand" type="button" onClick={() => setProfileTab(profileComplete ? 'feed' : 'settings')}>
              <Brand />
            </button>
            <nav className="member-tabs" aria-label="Member navigation">
              {profileComplete && <>
                <button type="button" aria-current={viewingFeed ? 'location' : undefined} onClick={() => setProfileTab('feed')}>Feed</button>
                <button type="button" aria-current={profileTab === 'profile' ? 'page' : undefined} onClick={() => setProfileTab('profile')}>My profile</button>
                <button className="notification-tab" type="button" aria-current={profileTab === 'notifications' ? 'page' : undefined} aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : 'Notifications'} title="Notifications" onClick={() => setProfileTab('notifications')}>
                  <Bell size={19} aria-hidden="true" />
                  {unreadCount > 0 && <span className="notification-count" aria-hidden="true">{unreadCount}</span>}
                </button>
              </>}
              <button type="button" aria-current={!profileComplete || profileTab === 'settings' ? 'page' : undefined} onClick={openProfileSettings}>{profileComplete ? 'Settings' : 'Complete profile'}</button>
            </nav>
            <div className="member-topbar-actions">
              {profileComplete && <button className="header-new-post" type="button" onClick={() => { setProfileTab('profile'); setComposerOpen(true); setProfileNotice(null) }}><Plus size={17} aria-hidden="true" /> New post</button>}
              <button className="member-signout" type="button" onClick={async () => { await supabase.auth.signOut(); setUser(null); setProfileTab('profile') }}><LogOut size={17} aria-hidden="true" /> Sign out</button>
            </div>
          </div>
        </header>

        {!profileComplete || profileTab === 'settings' ? <section className="settings-content">
          <div className="section-heading"><p className="eyebrow">ACCOUNT</p><h1>{profileComplete ? 'Profile settings' : 'Complete your profile'}</h1><p>{profileComplete ? 'Update your details and social links.' : 'Add the required details and profile photo to open your profile.'}</p></div>
          <form className="profile-form settings-form" onSubmit={saveProfile}>
            <div className="avatar-row">
              {avatarPreview ? <img className="avatar-preview" src={avatarPreview} alt="Profile preview" /> : <div className="avatar-placeholder">Photo</div>}
              <label>Profile picture<input type="file" accept="image/*" required={!profile.avatar_path && !profile.avatar_url} onChange={event => setAvatarFile(event.target.files?.[0] || null)} /></label>
            </div>
            <div className="settings-grid">
              <label>Phone number<input type="tel" autoComplete="tel" value={profile.phone} onChange={event => setProfile({ ...profile, phone: event.target.value })} maxLength={20} required /></label>
              <label>Education<input value={profile.education} onChange={event => setProfile({ ...profile, education: event.target.value })} minLength={2} maxLength={120} required /></label>
              <label>Description<textarea rows="3" maxLength={2000} value={profile.description} onChange={event => setProfile({ ...profile, description: event.target.value })} required /></label>
              <div className="location-field"><label htmlFor="profile-location">Location</label><div className="location-input-row"><input id="profile-location" autoComplete="address-level2" value={profile.location} onChange={event => setProfile({ ...profile, location: event.target.value, latitude: '', longitude: '' })} minLength={2} maxLength={200} required /><button className="detect-location-button" type="button" onClick={detectLocation} disabled={locationBusy}>{locationBusy ? 'Detecting…' : 'Detect'}</button></div><span className="location-required-note">Detect your location to save its coordinates.</span></div>
              <label>Church or organization<input value={profile.church_name} onChange={event => setProfile({ ...profile, church_name: event.target.value })} minLength={2} maxLength={120} required /></label>
              <label>Church / organization location<input value={profile.church_location} onChange={event => setProfile({ ...profile, church_location: event.target.value })} maxLength={200} placeholder="City, area, or address" /></label>
            </div>
            <div className="social-settings"><h2>Social links</h2><label>Instagram<input type="url" placeholder="https://instagram.com/username" value={profile.instagram_url} onChange={event => setProfile({ ...profile, instagram_url: event.target.value })} /></label><label>Facebook<input type="url" placeholder="https://facebook.com/your-page" value={profile.facebook_url} onChange={event => setProfile({ ...profile, facebook_url: event.target.value })} /></label><label>YouTube<input type="url" placeholder="https://youtube.com/@channel" value={profile.youtube_url} onChange={event => setProfile({ ...profile, youtube_url: event.target.value })} /></label></div>
            <button className="primary-button save-settings" type="submit" disabled={profileBusy}>{profileBusy ? 'Saving…' : 'Save settings'}</button>
          </form>
          <AccountSettings api={memberApi} supabase={supabase} user={user} notify={setProfileNotice} />
        </section> : profileTab === 'notifications' ? <section className="notifications-content"><header className="feed-heading"><div><p className="eyebrow">ACTIVITY</p><h1>Notifications</h1><button type="button" className="empty-post-button" disabled={!unreadCount} onClick={markAllNotificationsRead}>Mark all read</button><p>New members, followers, likes, and comments.</p></div></header>{notificationsError ? <p className="posts-setup-note" role="status">{notificationsError}</p> : notificationsBusy && !notifications.length ? <div className="network-list-message">Loading notifications…</div> : notifications.length ? <div className="notifications-list">{notifications.map(item => { const activity = item.kind === 'new_member' ? 'joined MinstryConnect' : item.kind === 'follow' ? 'started following you' : item.kind === 'like' ? 'liked your post' : 'commented on your post'; return <button className={`notification-item ${item.read_at ? '' : 'unread'}`} type="button" key={item.id} onClick={() => openNotification(item)}>{item.actor?.avatar_url ? <img src={item.actor.avatar_url} alt="" loading="lazy" /> : <span className="network-avatar-fallback">{(item.actor?.full_name || 'M').slice(0, 1).toUpperCase()}</span>}<span className="notification-copy"><span><strong>{item.actor?.full_name || 'A member'}</strong> {activity}</span><time>{new Date(item.created_at).toLocaleString()}</time></span>{!item.read_at && <span className="notification-unread-dot" aria-label="Unread" />}</button> })}</div> : <div className="posts-empty"><span><Bell size={20} /></span><strong>No notifications yet</strong><p>New member activity will appear here.</p></div>}</section> : profileTab === 'feed' ? <section className="feed-content">
          <aside className="feed-sidebar">
            <button className="feed-own-profile" type="button" onClick={() => setProfileTab('profile')}>
              {avatarPreview ? <img src={avatarPreview} alt="" /> : <span className="feed-own-initial">{(profile.full_name || 'M').slice(0, 1).toUpperCase()}</span>}
              <span><strong>{profile.full_name || 'My profile'}</strong><small>View my profile <ArrowUpRight size={12} aria-hidden="true" /></small></span>
            </button>
            <MemberSearch api={memberApi} openProfile={openMemberProfile} />
          </aside>
          <div className="feed-main">
            <header className="feed-heading"><h1>Member feed</h1><p>From the people in your community.</p></header>
          {feedError ? <p className="posts-setup-note" role="status">{feedError}</p> : feedBusy ? <FeedSkeleton /> : feedPosts.length ? <><div className="feed-list">{feedPosts.map(post => <article className="feed-post" key={post.id}>
            <header className="feed-post-header"><button className="feed-author" type="button" onClick={() => openMemberProfile(post.user_id)}>{post.author?.avatar_url ? <img src={post.author.avatar_url} alt="" loading="lazy" decoding="async" /> : <span className="feed-avatar-fallback">{(post.author?.full_name || 'M').slice(0, 1).toUpperCase()}</span>}<span><strong>{post.author?.full_name || 'Member'}{post.author?.is_verified && <span className="verified-tick" role="img" aria-label="Verified member" title="Verified member">✓</span>}</strong><small>{post.author?.location || 'View member profile'}</small></span></button><div className="feed-post-meta">{user?.id !== post.user_id && <button className={`follow-button ${feedFollowingIds.includes(post.user_id) ? 'following' : ''}`} type="button" onClick={() => toggleMemberFollow(post.user_id)} disabled={followBusyIds.includes(post.user_id)}>{followBusyIds.includes(post.user_id) ? 'Saving…' : feedFollowingIds.includes(post.user_id) ? 'Following' : 'Follow'}</button>}</div></header>
            {post.image_url ? <img className="feed-post-image" src={post.image_url} alt={post.caption || 'Member post'} loading="lazy" decoding="async" /> : <div className="post-image-missing">Photo unavailable</div>}
            <div className="feed-post-content">{post.user_id === user.id && <EditActions item={post} kind="post" onSave={editContent} onDelete={deleteContent} />}{post.caption && <p>{post.caption}</p>}
              <div className="post-actions"><button type="button" className={`post-action ${post.liked_by_me ? 'liked' : ''}`} onClick={() => togglePostLike(post)} disabled={busyLikePosts.includes(post.id)} aria-pressed={post.liked_by_me}><Heart size={17} fill={post.liked_by_me ? 'currentColor' : 'none'} /> <span>{post.like_count} {post.like_count === 1 ? 'Like' : 'Likes'}</span></button><button type="button" className="post-action-count" onClick={() => loadPostComments(post)} disabled={loadingCommentPost === post.id}><MessageCircle size={16} /> {post.comments_loaded ? `${post.comments_total} ${post.comments_total === 1 ? 'Comment' : 'Comments'}` : loadingCommentPost === post.id ? 'Loading comments…' : 'Comments'}</button></div>
              {!post.comments_loaded && <span className="comment-initial-sentinel" data-post-id={post.id} aria-hidden="true" />}
              {post.comments_loaded && post.comments.length < (post.comments_total || 0) && <button className="load-all-comments" type="button" onClick={() => loadAllPostComments(post)} disabled={loadingCommentPost === post.id}>{loadingCommentPost === post.id ? 'Loading comments…' : `View all ${post.comments_total} comments`}</button>}
              {post.comments_loaded && <div className="post-comments">{post.comments.map(comment => <div key={comment.id}><p><strong>{comment.author_name}</strong> {comment.content}</p>{comment.user_id === user.id && <EditActions item={comment} kind="comment" onSave={editContent} onDelete={deleteContent} />}</div>)}{post.comments.length < (post.comments_total || 0) && <span className="comment-load-sentinel" data-post-id={post.id} aria-hidden="true">{loadingCommentPost === post.id ? 'Loading comments…' : ''}</span>}</div>}
              <form className="post-comment-form" onSubmit={event => submitPostComment(event, post)}><input aria-label="Write a comment" maxLength={1000} placeholder="Write a comment…" value={commentDrafts[post.id] || ''} onChange={event => setCommentDrafts(current => ({ ...current, [post.id]: event.target.value }))} /><button type="submit" aria-label="Send comment" disabled={!commentDrafts[post.id]?.trim() || busyCommentPost === post.id}>{busyCommentPost === post.id ? 'Sending…' : <Send size={16} />}</button></form>
            </div>
          </article>)}</div>{feedHasMore && <div ref={feedScrollSentinelRef} className="feed-scroll-sentinel" aria-hidden="true">{feedMoreBusy ? 'Loading posts…' : ''}</div>}</> : <div className="posts-empty feed-empty"><span className="empty-camera"><Camera size={21} /></span><strong>No member posts yet</strong><p>When members share photos, they’ll appear here.</p></div>}
          </div>
        </section> : profileTab === 'member-profile' ? <section className="public-member-content">
          <button className="back-to-feed" onClick={() => setProfileTab('feed')}><ArrowLeft size={15} /> Back to feed</button>
          {viewedProfileBusy ? <ProfileSkeleton /> : viewedProfileError ? <p className="posts-setup-note" role="status">{viewedProfileError}</p> : viewedProfile && <><section className="profile-overview public-profile-overview">{viewedProfile.avatar_url ? <img className="profile-large-avatar" src={viewedProfile.avatar_url} alt="" /> : <div className="profile-large-avatar profile-avatar-empty">{(viewedProfile.full_name || 'M').slice(0, 1).toUpperCase()}</div>}<div className="profile-identity"><div className="profile-name-row"><h1>{viewedProfile.full_name || 'Member'}</h1>{viewedProfile.is_verified && <span className="verified-tick" role="img" aria-label="Verified member" title="Verified member">✓</span>}{viewedProfile.user_id !== user.id && <button className={`profile-follow-button ${viewedFollowStats?.isFollowing ? 'following' : ''}`} type="button" onClick={() => toggleMemberFollow(viewedProfile.user_id)} disabled={followBusyIds.includes(viewedProfile.user_id)}>{followBusyIds.includes(viewedProfile.user_id) ? 'Saving…' : viewedFollowStats?.isFollowing ? 'Following' : 'Follow'}</button>}</div><div className="member-tools">{viewedProfile.user_id !== user.id && <><button type="button" onClick={() => blockMember(viewedProfile.user_id)}>Block member</button><button type="button" onClick={() => reportMember(viewedProfile.user_id)}>Report member</button></>}</div><div className="profile-social-stats"><div><strong>{viewedPostCount}</strong><span>posts</span></div><button type="button" className="profile-stat-button" onClick={() => openFollowList(viewedProfile.user_id, 'followers')}><strong>{viewedFollowStats?.followers ?? 0}</strong><span>followers</span></button><button type="button" className="profile-stat-button" onClick={() => openFollowList(viewedProfile.user_id, 'following')}><strong>{viewedFollowStats?.following ?? 0}</strong><span>following</span></button></div><p>{viewedProfile.description || 'No description added.'}</p><div className="profile-socials">{viewedSocialLinks.map(link => <a key={link.label} href={link.url} target="_blank" rel="noreferrer">{link.label === 'Instagram' ? <Instagram size={14} /> : link.label === 'Facebook' ? <Facebook size={14} /> : <Youtube size={14} />}{link.label}<ArrowUpRight size={12} /></a>)}</div></div></section>
            <section className="profile-details public-profile-details"><div><span>Education</span><strong>{viewedProfile.education || '—'}</strong></div><div><span>Location</span><strong>{viewedProfile.location || '—'}</strong></div><div><span>Church / organization</span><strong>{viewedProfile.church_name || '—'}</strong></div><div><span>Church location</span><strong>{viewedProfile.church_location || '—'}</strong></div></section>
            <section className="posts-section"><header className="posts-heading"><div><p className="eyebrow">PHOTOS</p><h2>{viewedProfile.user_id === user.id ? 'My posts' : 'Posts'} <span>{viewedPostCount}</span></h2></div></header>{viewedProfilePosts.length ? <div className="posts-grid">{viewedProfilePosts.map(post => <article className="post-card" key={post.id}>{post.image_url ? <img src={post.image_url} alt={post.caption || 'Member post'} loading="lazy" decoding="async" /> : <div className="post-image-missing">Photo unavailable</div>}<div className="post-card-info">{(post.user_id === user.id || posts.some(own => own.id === post.id)) && <EditActions item={post} kind="post" onSave={editContent} onDelete={deleteContent} />}{post.caption && <p>{post.caption}</p>}<span><MapPin size={12} /> {post.location}</span><time>{new Date(post.created_at).toLocaleDateString()}</time></div></article>)}</div> : <div className="posts-empty"><strong>No posts yet</strong></div>}<ScrollMore hasMore={viewedPostsMore} busy={profileMoreBusy} loadMore={loadMoreProfilePosts} /></section></>}
        </section> : <>
          <section className="profile-overview" id="profile">
            {avatarPreview ? <img className="profile-large-avatar" src={avatarPreview} alt="Profile" onError={() => { setAvatarPreview(''); setProfileNotice({ kind: 'error', text: 'Profile photo could not load. Please upload it again in Settings.' }) }} /> : <div className="profile-large-avatar profile-avatar-empty">{(profile.full_name || user.email || 'U').slice(0, 1).toUpperCase()}</div>}
            <div className="profile-identity"><div className="profile-name-row"><h1>{profile.full_name || 'Your profile'}</h1>{user.app_metadata?.is_verified && <span className="verified-badge" aria-label="Verified profile">✓ Verified</span>}</div><p>{user.email}</p><div className="profile-social-stats"><div><strong>{profilePostCount}</strong><span>posts</span></div><button type="button" className="profile-stat-button" onClick={() => openFollowList(user.id, 'followers')}><strong>{profileFollowStats?.followers ?? 0}</strong><span>followers</span></button><button type="button" className="profile-stat-button" onClick={() => openFollowList(user.id, 'following')}><strong>{profileFollowStats?.following ?? 0}</strong><span>following</span></button></div><p>{profile.description || 'Add a short description in your settings.'}</p><div className="profile-socials">{socialLinks.map(link => <a key={link.label} href={link.url} target="_blank" rel="noreferrer">{link.label === 'Instagram' ? <Instagram size={14} /> : link.label === 'Facebook' ? <Facebook size={14} /> : <Youtube size={14} />}{link.label}<ArrowUpRight size={12} /></a>)}</div></div>
          </section>
          <section className="profile-details"><div><span>Phone</span><strong>{profile.phone || '—'}</strong></div><div><span>Education</span><strong>{profile.education || '—'}</strong></div><div><span>Location</span><strong>{profile.location || '—'}</strong></div><div><span>Church / organization</span><strong>{profile.church_name || '—'}</strong></div><div><span>Church location</span><strong>{profile.church_location || '—'}</strong></div></section>
          <section className="posts-section"><header className="posts-heading"><div><p className="eyebrow">YOUR PHOTOS</p><h2>My posts <span>{profilePostCount}</span></h2></div><button type="button" className="primary-button new-post-button" onClick={() => { setComposerOpen(open => !open); setProfileNotice(null) }}>{composerOpen ? 'Close' : <><Plus size={15} /> New post</>}</button></header>
            {composerOpen && <form id="post-composer" className="post-composer" onSubmit={publishPost}>
              <fieldset className="composer-fields" disabled={postBusy}>
                <div className="post-photo-picker">
                  <div className="post-photo-preview">
                    {postPreview ? <img src={postPreview} alt="Selected post" /> : <span><b><Camera size={22} /></b>Choose a photo or use your camera</span>}
                  </div>
                  <div className="post-photo-controls">
                    <label className="secondary-button">Gallery / files<input ref={galleryInputRef} type="file" accept="image/*" onChange={choosePostFile} /></label>
                    <button className="secondary-button" type="button" onClick={openPostCamera}><Camera size={14} /> Use camera</button>
                    <input ref={cameraFallbackInputRef} className="sr-only" type="file" accept="image/*" capture="environment" onChange={choosePostFile} aria-label="Take a photo" />
                  </div>
                </div>
                <div className="composer-side">
                  <label>Caption<textarea rows="4" maxLength="2000" value={postCaption} onChange={event => setPostCaption(event.target.value)} placeholder="Write a caption…" /></label>
                  <div className="post-location-row"><button className="detect-location-button" type="button" onClick={detectPostLocation} disabled={postLocationBusy}>{postLocationBusy ? 'Finding location…' : postLocation ? <><MapPin size={13} /> Location added</> : <><MapPin size={13} /> Add photo location</>}</button><span>{postLocation?.location || 'Required before posting'}</span></div>
                  <p className="location-required-note">A location must be attached before the image can be uploaded.</p>
                  <div aria-live="polite">{postBusy && <><p>{uploadStage} {uploadStage === 'Uploading photo…' ? `${uploadProgress}%` : ''}</p><progress max="100" value={uploadProgress} aria-label="Photo upload progress" /></>}</div>
                  <button className="primary-button publish-button" type="submit" disabled={postBusy || !postFile || !postLocation}>{postBusy ? 'Uploading…' : uploadProgress > 0 && postFile ? 'Retry share post' : 'Share post'}</button>
                </div>
              </fieldset>
            </form>}
            {postsLoadError ? <p className="posts-setup-note" role="status">{postsLoadError}</p> : postsBusy ? <PostGridSkeleton count={3} /> : posts.length ? <div className="posts-grid">{posts.map(post => <article className="post-card" key={post.id}>{post.image_url ? <img src={post.image_url} alt={post.caption || 'Profile post'} loading="lazy" decoding="async" /> : <div className="post-image-missing">Photo unavailable</div>}<div className="post-card-info">{(post.user_id === user.id || posts.some(own => own.id === post.id)) && <EditActions item={post} kind="post" onSave={editContent} onDelete={deleteContent} />}{post.caption && <p>{post.caption}</p>}<span><MapPin size={12} /> {post.location}</span><time>{new Date(post.created_at).toLocaleDateString()}</time></div></article>)}</div> : <div className="posts-empty"><span className="empty-camera"><Camera size={21} /></span><strong>No posts yet</strong><p>Share a photo and it will appear here on your profile.</p><button className="empty-post-button" onClick={() => setComposerOpen(true)}>Create your first post</button></div>}
            <ScrollMore hasMore={profilePostsMore} busy={profileMoreBusy} loadMore={loadMoreProfilePosts} />
          </section>
        </>}
        {followListState && <div className="network-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) closeFollowList() }}><section className="network-modal" role="dialog" aria-modal="true" aria-label={followListState.title}><header><h2>{followListState.title}</h2><button type="button" aria-label="Close list" onClick={closeFollowList}>×</button></header>{followListState.busy && !followListState.items.length ? <p className="network-list-message">Loading members…</p> : followListState.error ? <p className="network-list-message network-list-error">{followListState.error}</p> : followListState.items.length ? <div className="network-list">{followListState.items.map(member => <div className="network-member" key={member.user_id}><button className="network-member-open" type="button" onClick={() => { closeFollowList(); openMemberProfile(member.user_id) }}>{member.avatar_url ? <img src={member.avatar_url} alt="" loading="lazy" /> : <span className="network-avatar-fallback">{(member.full_name || 'M').slice(0, 1).toUpperCase()}</span>}<span><strong>{member.full_name || 'Member'}</strong><small>{member.location || 'Member'}</small></span></button>{member.user_id !== user.id && <button type="button" className={`network-follow-button ${member.isFollowing ? 'following' : ''}`} disabled={followBusyIds.includes(member.user_id)} onClick={() => toggleMemberFollow(member.user_id, member.isFollowing)}>{followBusyIds.includes(member.user_id) ? 'Saving…' : member.isFollowing ? 'Following' : 'Follow'}</button>}</div>)}<ScrollMore hasMore={Boolean(followListState.nextCursor)} busy={followListState.busy} loadMore={loadMoreFollowList} /></div> : <p className="network-list-message">No {followListState.listType} yet.</p>}</section></div>}
        {notificationPost && <div className="network-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setNotificationPost(null) }}><section className="network-modal post-detail-modal" role="dialog" aria-modal="true" aria-label="Post"><header><h2>Post</h2><button type="button" aria-label="Close post" onClick={() => setNotificationPost(null)}>×</button></header><div>{notificationPost.image_url && <img src={notificationPost.image_url} alt={notificationPost.caption || 'Post photo'} />}<p>{notificationPost.caption}</p><button className="empty-post-button" type="button" onClick={() => { const id = notificationPost.user_id; setNotificationPost(null); openMemberProfile(id) }}>View profile</button></div></section></div>}
        {cameraStream && <div className="post-camera-backdrop" role="presentation"><section className="post-camera-modal" role="dialog" aria-modal="true" aria-labelledby="post-camera-title"><header><strong id="post-camera-title">Take a photo</strong><button type="button" aria-label="Close camera" onClick={() => setCameraStream(null)}>×</button></header><video ref={cameraVideoRef} autoPlay playsInline muted /><div className="post-camera-actions"><button className="secondary-button" type="button" onClick={() => setCameraStream(null)}>Cancel</button><button className="primary-button" type="button" onClick={capturePostPhoto}>Use photo</button></div></section></div>}
        <nav className="mobile-bottom-bar" aria-label="Member navigation">
          {profileComplete && <>
            <button type="button" className={viewingFeed ? 'selected' : ''} aria-current={viewingFeed ? 'location' : undefined} onClick={() => setProfileTab('feed')}><Home size={19} aria-hidden="true" /><span>Feed</span></button>
            <button type="button" className="mobile-post-action" onClick={() => { setProfileTab('profile'); setComposerOpen(true); setProfileNotice(null) }} aria-label="New post"><Plus size={24} aria-hidden="true" /></button>
            <button type="button" className={profileTab === 'profile' ? 'selected' : ''} aria-current={profileTab === 'profile' ? 'page' : undefined} onClick={() => setProfileTab('profile')} aria-label="My profile"><UserRound size={19} aria-hidden="true" /><span>Profile</span></button>
            <button type="button" className={profileTab === 'notifications' ? 'selected' : ''} aria-current={profileTab === 'notifications' ? 'page' : undefined} onClick={() => setProfileTab('notifications')} aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : 'Notifications'}><Bell size={21} aria-hidden="true" />{unreadCount > 0 && <span className="mobile-notification-dot" aria-hidden="true" />}</button>
          </>}
          <button type="button" className={!profileComplete || profileTab === 'settings' ? 'selected' : ''} aria-current={!profileComplete || profileTab === 'settings' ? 'page' : undefined} onClick={openProfileSettings} aria-label={profileComplete ? 'Settings' : 'Complete profile'}><Settings size={19} aria-hidden="true" /><span>{profileComplete ? 'Settings' : 'Complete'}</span></button>
        </nav>
      </section>
    </main>
  )
}
