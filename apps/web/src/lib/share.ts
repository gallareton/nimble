import { copyText } from './copy'
import { APP_URL } from './host'
import { t } from '../i18n'

/**
 * One way to hand someone the app: the native share sheet where it exists,
 * the clipboard otherwise. Pay uses it to pull in the other person; Settings
 * uses it to recommend NIMble. Cancelling the sheet is not a failure — it
 * never falls through to a copy the user didn't ask for.
 */
export async function shareApp(): Promise<'shared' | 'copied' | 'failed'> {
  const text = t('Pay or get paid with a 6-digit code in Nimiq Pay.')
  if (navigator.share) {
    await navigator.share({ title: 'NIMble', text, url: APP_URL }).catch(() => {})
    return 'shared'
  }
  return (await copyText(`${text} ${APP_URL}`)) ? 'copied' : 'failed'
}
