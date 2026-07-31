import { useState } from 'react'
import { t } from '../i18n'

// Lite embeds: a thumbnail until tapped, then the privacy-enhanced player —
// the landing stays fast and no YouTube scripts load before consent-by-click.
function LiteVideo({ id, title, vertical = false }:
  { id: string; title: string; vertical?: boolean }) {
  const [playing, setPlaying] = useState(false)
  const cls = vertical ? 'demo-video__media demo-video__media--vertical' : 'demo-video__media'

  return (
    <figure className="demo-video__item">
      <figcaption className="demo-video__caption">{title}</figcaption>
      {playing ? (
        <div className={cls}>
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1`}
            title={title}
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        </div>
      ) : (
        <button className={`demo-video__poster ${cls}`} onClick={() => setPlaying(true)}
          aria-label={title}>
          <img src={`https://i.ytimg.com/vi/${id}/hqdefault.jpg`} alt="" loading="lazy" />
          <span className="demo-video__play" aria-hidden>▶</span>
        </button>
      )}
    </figure>
  )
}

export function DemoVideo() {
  return (
    <section className="demo-video" aria-label={t('Watch the demo')}>
      <div className="demo-video__grid">
        <LiteVideo id="hJ2gzRGlG_U" title={t('How it works')} vertical />
        <LiteVideo id="mwSJtvYDoeA" title={t('Watch the demo')} />
      </div>
    </section>
  )
}
