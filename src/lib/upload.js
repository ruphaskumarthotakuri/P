import { supabase } from './supabase'

export async function compressImage(file, maxDimension = 1600) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return file
  if (typeof createImageBitmap !== 'function') return file
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.82))
    if (!blob || (blob.size >= file.size && scale === 1)) return file
    const extension = blob.type === 'image/webp' ? '.webp' : '.png'
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + extension, { type: blob.type })
  } finally { bitmap.close() }
}

export async function uploadImage(path, file, onProgress) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Sign in again before uploading.')
  const baseUrl = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('POST', `${baseUrl}/storage/v1/object/photo/${path.split('/').map(encodeURIComponent).join('/')}`)
    request.timeout = 120000
    request.setRequestHeader('Authorization', `Bearer ${session.access_token}`)
    request.setRequestHeader('apikey', key)
    request.setRequestHeader('Content-Type', file.type)
    request.setRequestHeader('x-upsert', 'true')
    request.upload.onprogress = event => {
      if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100))
    }
    request.onerror = () => reject(new Error('Upload interrupted. Retry using the selected photo.'))
    request.ontimeout = () => reject(new Error('Upload timed out. Retry using the selected photo.'))
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) return resolve()
      let message = 'Upload failed. Please retry.'
      try { message = JSON.parse(request.responseText).message || message } catch { /* Keep a readable fallback. */ }
      reject(new Error(message))
    }
    request.send(file)
  })
}
