import { useState } from 'react'
import { t } from '../i18n'

const VIDEO_ID = 'mwSJtvYDoeA'

// Lite embed: a thumbnail until tapped, then the privacy-enhanced player —
// the landing stays fast and no YouTube scripts load before consent-by-click.
export function DemoVideo() {
  const [playing, setPlaying] = useState(false)

  return (
    <section className="demo-video" aria-label={t('Watch the demo')}>
      <h2>{t('Watch the demo')}</h2>
      {playing ? (
        <div className="demo-video__frame">
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${VIDEO_ID}?autoplay=1`}
            title={t('Watch the demo')}
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        </div>
      ) : (
        <button className="demo-video__poster" onClick={() => setPlaying(true)}
          aria-label={t('Watch the demo')}>
          <img src={`https://i.ytimg.com/vi/${VIDEO_ID}/hqdefault.jpg`} alt="" loading="lazy" />
          <span className="demo-video__play" aria-hidden>▶</span>
        </button>
      )}
    </section>
  )
}
