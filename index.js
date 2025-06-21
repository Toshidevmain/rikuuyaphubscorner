const express  = require('express')
const mongoose = require('mongoose')
const multer   = require('multer')
const { GridFSBucket } = require('mongodb')
const { Types } = mongoose
const { Readable } = require('stream')
const path = require('path')

const MONGO = 'mongodb+srv://toshidev0:zcode22107@dbtxt.3dxoaud.mongodb.net/pyhost?retryWrites=true&w=majority'
const PORT  = 8080
const ADMIN = 'oten'

mongoose.connect(MONGO)
const conn = mongoose.connection
let bucket
conn.once('open', () => bucket = new GridFSBucket(conn.db, { bucketName: 'videos' }))

const upload = multer({ storage: multer.memoryStorage() })
const app = express()
app.use(express.static('public'))

app.get('/api/stream/:id', async (req, res) => {
  const id = new Types.ObjectId(req.params.id)
  const f  = await bucket.find({ _id: id }).toArray()
  if (!f[0]) return res.sendStatus(404)

  const len  = f[0].length
  const type = f[0].contentType || 'video/mp4'
  const rng  = req.headers.range

  if (!rng) {
    res.set({ 'Content-Type': type, 'Content-Length': len })
    return bucket.openDownloadStream(id).pipe(res)
  }

  const [a, b] = rng.replace(/bytes=/, '').split('-')
  const start  = parseInt(a, 10)
  const end    = b ? parseInt(b, 10) : len - 1
  res.status(206).set({
    'Content-Type'  : type,
    'Accept-Ranges' : 'bytes',
    'Content-Range' : `bytes ${start}-${end}/${len}`,
    'Content-Length': end - start + 1
  })
  bucket.openDownloadStream(id, { start, end: end + 1 }).pipe(res)
})

app.get('/api/download/:id', async (req, res) => {
  const id = new Types.ObjectId(req.params.id)
  const f  = await bucket.find({ _id: id }).toArray()
  if (!f[0]) return res.sendStatus(404)
  res.set({
    'Content-Type'       : f[0].contentType || 'video/mp4',
    'Content-Disposition': `attachment; filename="${f[0].metadata.original}"`
  })
  bucket.openDownloadStream(id).pipe(res)
})

app.delete('/api/video/:id', async (req, res) => {
  try {
    await bucket.delete(new Types.ObjectId(req.params.id))
    res.json({ ok: true })
  } catch { res.status(500).json({ ok: false }) }
})

app.get('/api/videos', async (_, res) => {
  const files = await bucket.find().sort({ uploadDate: -1 }).toArray()
  const map   = {}
  files.forEach(f => {
    const title = f.metadata.title || f.metadata.original
    const m     = f.metadata.original.match(/_(\d{3,4}p)\./i)
    const q     = m ? m[1] : 'original'
    if (!map[title]) map[title] = []
    map[title].push({ id: f._id.toString(), quality: q })
  })
  const out = Object.entries(map).map(([t, v]) => {
    v.sort((a, b) => {
      const z = x => x.quality === 'original' ? 0 : parseInt(x.quality)
      return z(b) - z(a)
    })
    return { title: t, variants: v }
  })
  res.json(out)
})

app.post('/api/upload', upload.single('video'), (req, res) => {
  if (!req.file) return res.redirect(`/admin/${ADMIN}`)
  const { buffer, originalname, mimetype } = req.file
  const title = req.body.title || originalname
  const up = bucket.openUploadStream(
    Date.now() + path.extname(originalname),
    { contentType: mimetype || 'video/mp4', metadata: { original: originalname, title } }
  )
  Readable.from(buffer).pipe(up).on('finish', () => res.redirect(`/admin/${ADMIN}`))
})

app.get(`/admin/${ADMIN}`, (req, res) =>
  res.sendFile(path.join(__dirname, 'admin', 'admin.html'))
)

app.listen(PORT)
