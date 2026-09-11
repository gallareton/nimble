import { t } from '../i18n'

export type Unit = 'USD' | 'NIM'

/** The one USD/NIM switch (Q5). Charge and Remote bill used to carry two
 *  different-looking controls for the same decision — a segmented control on
 *  one screen, a pair of chips on the other — so an auditor read them as two
 *  unrelated settings. One component, one look: the active side is a blue
 *  fill with white text, the higher-contrast of the two originals. */
export function UnitSwitch(props: { unit: Unit; onChange: (u: Unit) => void; label?: string }) {
  const { unit, onChange } = props
  return (
    <div className="seg" role="group" aria-label={props.label ?? t('Pricing unit')}>
      <button type="button" aria-pressed={unit === 'USD'} onClick={() => onChange('USD')}>{t('USD')}</button>
      <button type="button" aria-pressed={unit === 'NIM'} onClick={() => onChange('NIM')}>{t('NIM')}</button>
    </div>
  )
}
