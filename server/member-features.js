const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function registerMemberFeatures(app, { database, getMember, requireAdmin, invalidate, deleteAccount, verifyPassword }) {
  async function memberRequest(req, res, action) {
    try {
      if (!database) return res.status(503).json({ error: 'Database access is unavailable.' })
      const user = await getMember(req)
      if (!user) return res.status(401).json({ error: 'Sign in to continue.' })
      return await action(user)
    } catch (error) {
      return res.status(400).json({ error: error.message })
    }
  }

  app.get('/api/members/search', (req, res) => memberRequest(req, res, async user => {
    const query = String(req.query.q || '').trim().slice(0, 100)
    if (query.length < 2) return res.json({ members: [] })
    const { data: blocks, error: blockError } = await database.from('member_blocks').select('blocker_id, blocked_id')
      .or(`blocker_id.eq.${user.id},blocked_id.eq.${user.id}`)
    if (blockError) throw blockError
    const excluded = blocks.map(row => row.blocker_id === user.id ? row.blocked_id : row.blocker_id)
    let search = database.from('profiles').select('user_id, full_name, avatar_path, location')
      .ilike('full_name', `%${query.replace(/[%_\\]/g, '')}%`).order('full_name').limit(30)
    if (excluded.length) search = search.not('user_id', 'in', `(${excluded.join(',')})`)
    const { data, error } = await search
    if (error) throw error
    return res.json({ members: data })
  }))

  app.get('/api/members/blocks', (req, res) => memberRequest(req, res, async user => {
    const { data, error } = await database.from('member_blocks').select('blocked_id').eq('blocker_id', user.id)
    if (error) throw error
    const ids = data.map(row => row.blocked_id)
    const profiles = ids.length ? await database.from('profiles').select('user_id, full_name').in('user_id', ids) : { data: [], error: null }
    if (profiles.error) throw profiles.error
    return res.json({ members: profiles.data })
  }))

  app.put('/api/members/:id/block', (req, res) => memberRequest(req, res, async user => {
    const target = req.params.id
    if (!uuidPattern.test(target) || target === user.id) throw new Error('Choose another member.')
    const { error } = await database.from('member_blocks').upsert({ blocker_id: user.id, blocked_id: target })
    if (error) throw error
    // Retrying this operation also repairs follows if a previous request failed midway.
    const unfollow = await database.from('follows').delete()
      .or(`and(follower_id.eq.${user.id},following_id.eq.${target}),and(follower_id.eq.${target},following_id.eq.${user.id})`)
    await invalidate(user.id, target)
    if (unfollow.error) throw unfollow.error
    return res.json({ blocked: true })
  }))

  app.delete('/api/members/:id/block', (req, res) => memberRequest(req, res, async user => {
    if (!uuidPattern.test(req.params.id)) throw new Error('Invalid member.')
    const { error } = await database.from('member_blocks').delete().eq('blocker_id', user.id).eq('blocked_id', req.params.id)
    if (error) throw error
    await invalidate(user.id, req.params.id)
    return res.json({ blocked: false })
  }))

  app.post('/api/members/:id/report', (req, res) => memberRequest(req, res, async user => {
    const reason = String(req.body?.reason || '').trim()
    if (!uuidPattern.test(req.params.id) || req.params.id === user.id || reason.length < 3 || reason.length > 1000) {
      throw new Error('Choose another member and enter a reason between 3 and 1,000 characters.')
    }
    const { error } = await database.from('member_reports').insert({ reporter_id: user.id, member_id: req.params.id, reason })
    if (error) throw error
    return res.status(201).json({ reported: true })
  }))

  app.get('/api/admin/reports', requireAdmin, async (_req, res) => {
    try {
      if (!database) throw new Error('Database access is unavailable.')
      const { data, error } = await database.from('member_reports').select('*').order('created_at', { ascending: false }).limit(100)
      if (error) throw error
      const ids = [...new Set(data.flatMap(row => [row.member_id, row.reporter_id]).filter(Boolean))]
      const profiles = ids.length ? await database.from('profiles').select('user_id, full_name').in('user_id', ids) : { data: [] }
      if (profiles.error) throw profiles.error
      const names = new Map(profiles.data.map(row => [row.user_id, row.full_name]))
      return res.json({ reports: data.map(row => ({ ...row, member_name: names.get(row.member_id) || 'Deleted member', reporter_name: names.get(row.reporter_id) || 'Deleted member' })) })
    } catch (error) { return res.status(503).json({ error: error.message }) }
  })

  app.patch('/api/admin/reports/:id', requireAdmin, async (req, res) => {
    try {
      if (!uuidPattern.test(req.params.id) || !['resolved', 'dismissed'].includes(req.body?.status)) throw new Error('Invalid report update.')
      const { data, error } = await database.from('member_reports').update({ status: req.body.status }).eq('id', req.params.id).select().single()
      if (error) throw error
      return res.json({ report: data })
    } catch (error) { return res.status(400).json({ error: error.message }) }
  })

  app.delete('/api/account', (req, res) => memberRequest(req, res, async user => {
    // Password reauthentication is required before this destructive operation.
    if (req.body?.confirmation !== 'DELETE') throw new Error('Type DELETE to confirm.')
    if (!await verifyPassword(user.email, String(req.body?.password || ''))) throw new Error('Your password is incorrect.')
    await deleteAccount(user.id)
    return res.json({ deleted: true })
  }))
}
