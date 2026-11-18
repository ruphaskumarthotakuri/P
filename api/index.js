import app from '../server/index.js'

/**
 * Vercel rewrites every /api/:path* request to this single function and puts
 * the original route in __api_path. Restore the original Express URL so the
 * existing handlers continue to receive their normal routes and query string.
 */
export default function apiHandler(req, res) {
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  const route = requestUrl.searchParams.get('__api_path')

  if (!route) {
    return res.status(404).json({ error: 'API route not found.' })
  }

  const safeRoute = route.replace(/^\/+/, '')
  if (safeRoute.split('/').some(segment => segment === '.' || segment === '..')) {
    return res.status(400).json({ error: 'Invalid API route.' })
  }

  requestUrl.searchParams.delete('__api_path')
  const query = requestUrl.searchParams.toString()
  req.url = `/api/${safeRoute}${query ? `?${query}` : ''}`

  return app(req, res)
}
