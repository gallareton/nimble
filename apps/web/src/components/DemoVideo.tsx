import { useEffect, useState } from 'react'
import { t } from '../i18n'

type Clip = { id: string; title: string; vertical?: boolean }

const CLIPS: Clip[] = [
  { id: 'hJ2gzRGlG_U', title: 'How it works', vertical: true },
  { id: 'mwSJtvYDoeA', title: 'Watch the demo' },
]

// Posters only until tapped (no YouTube scripts on load), then the clip
// opens as a lightbox filling the screen — an inline frame is too small to
// watch a phone recording in.
export function DemoVideo() {
  const [open, setOpen] = useState<Clip | null>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null) }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open])

  return (
    <section className="demo-video" aria-label={t('Watch the demo')}>
      <div className="demo-video__grid">
        {CLIPS.map(clip => (
          <figure className="demo-video__item" key={clip.id}>
            <figcaption className="demo-video__caption">{t(clip.title)}</figcaption>
            <button
              className={`demo-video__poster${clip.vertical ? ' demo-video__poster--vertical' : ''}`}
              onClick={() => setOpen(clip)}
              aria-label={t(clip.title)}
            >
              <img src={`https://i.ytimg.com/vi/${clip.id}/hqdefault.jpg`} alt="" loading="lazy" />
              <span className="demo-video__play" aria-hidden>▶</span>
            </button>
          </figure>
        ))}
      </div>

      {open && (
        <div className="lightbox" role="dialog" aria-modal="true" aria-label={t(open.title)}
          onClick={() => setOpen(null)}>
          <button className="lightbox__close" onClick={() => setOpen(null)}
            aria-label={t('Close')} autoFocus>×</button>
          <div className={`lightbox__frame${open.vertical ? ' lightbox__frame--vertical' : ''}`}
            onClick={e => e.stopPropagation()}>
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${open.id}?autoplay=1&playsinline=1`}
              title={t(open.title)}
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
            />
          </div>
        </div>
      )}
    </section>
  )
}
