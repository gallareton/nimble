import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { lunaToNim, type ChargeRequestPreview } from '@nimble/shared'
import { useAppOptional } from '../AppContext'
import { Landing } from '../components/Landing'
import { Spinner } from '../components/Spinner'
import { t } from '../i18n'
import { describeError } from '../lib/errors'
import { formatUsdValue } from '../lib/fiat'
import { inNimiqPay } from '../lib/host'
import { fetchFromOtherNetwork, networkChoice } from '../lib/network'

// Read-only, browser-only: see fetchFromOtherNetwork's comment.
async function probeOtherNetwork(id: string): Promise<ChargeRequestPreview | null> {
  const res = await fetchFromOtherNetwork(`/v1/charge-requests/${id}`)
  return res ? (await res.json()) as ChargeRequestPreview : null
}
import { uuid } from '../lib/uuid'
import { ApiError, type Api } from '../api/client'

/** The payer's side of a "remote charge" (spec: bill someone who isn't at
 *  the counter). Reached two ways — a direct open of /r/:id, or main.tsx's
 *  location check redirecting here from the home route — so by the time
 *  this component mounts, the router has already settled on this path; it
 *  only has to render the right thing for `id`.
 *
 *  Deliberately thin past acceptance: `accept` hands back the same
 *  { sessionId } the in-person flow produces, and from there it's the
 *  existing Approval screen — no second payment flow to maintain. */
export function RemoteCharge(props: { api?: Api; token?: string | null; login?: () => Promise<unknown> }) {
  const ctx = useAppOptional()
  const api = props.api ?? ctx?.api
  if (!api) throw new Error('RemoteCharge needs api via props or AppProvider')
  const token = props.token !== undefined ? props.token : (ctx?.token ?? null)
  const login = props.login ?? ctx?.login
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()

  const [preview, setPreview] = useState<ChargeRequestPreview | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [networkMismatch, setNetworkMismatch] = useState(false)
  // The link names the stack that raised the bill; networkChoice() is the one
  // the wallet put us on. Never auto-switch on this — a payment must reach the
  // chain the wallet is actually on.
  const asked = new URLSearchParams(window.location.search).get('n')
  const wrongNetwork = (asked === 'main' || asked === 'test') && asked !== networkChoice().net
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    // Fetched in a plain browser too, on purpose. Opening this link outside
    // Nimiq Pay means a landing page, a blue button and then the wallet's own
    // "unknown link" warning — three steps during which the person has no
    // idea what they are about to approve. The preview endpoint is public
    // precisely so we can show them the amount and the vendor first.
    if (!id) return
    setNotFound(false)
    setLoadError(null)
    api.getChargeRequest(id).then(setPreview).catch(e => {
      // A 404 here has two very different causes. The bill may genuinely not
      // exist — or it may live on the other network, because the link says
      // which stack raised it while the wallet decides which one we talk to.
      // Saying "no such bill" to someone holding a real bill is simply wrong,
      // and the fix is theirs to make: switch the wallet's network.
      // In a plain browser there is no wallet to be wrong about, and the
      // network hint may not have survived the share link, so a 404 is not
      // yet an answer: look on the other stack before telling someone their
      // bill does not exist. Never done inside Nimiq Pay — there the wallet's
      // chain decides and probing the other one would only invite paying on
      // a network the wallet is not on.
      if (e instanceof ApiError && e.status === 404 && !inNimiqPay()) {
        void probeOtherNetwork(id).then(found => {
          if (found) setPreview(found)
          else setNotFound(true)
        })
        return
      }
      if (e instanceof ApiError && e.status === 404 && wrongNetwork) setNetworkMismatch(true)
      else if (e instanceof ApiError && e.status === 404) setNotFound(true)
      else setLoadError(t('Could not load this bill. Check your connection and try again.'))
    })
  }, [api, id])

  useEffect(() => { load() }, [load])

  // Opened in a plain browser: send them to the app via a deep link that
  // points at this exact bill, not the generic home screen — see
  // Landing's own comment.
  if (!inNimiqPay()) return <Landing chargeId={id} bill={preview} />

  const accept = async () => {
    if (!id) return
    setActionError(null)
    setBusy(true)
    try {
      if (!token) {
        if (!login) throw new Error(t('Could not load this bill. Check your connection and try again.'))
        await login()
      }
      const res = await api.acceptChargeRequest(id, uuid())
      navigate(`/session/${res.sessionId}`, { replace: true })
    } catch (e) {
      if (e instanceof ApiError && e.code === 'ALREADY_ACCEPTED') {
        setActionError(t('Someone already accepted this bill.'))
        load()
      } else if (e instanceof ApiError && e.code === 'SELF_ACCEPT') {
        setActionError(t('You cannot pay your own bill.'))
      } else {
        setActionError(describeError(e))
      }
    } finally {
      setBusy(false)
    }
  }

  if (networkMismatch) return (
    <main>
      <h1>{t('Remote bill')}</h1>
      <p role="alert">
        {asked === 'test'
          ? t('This bill is on the test network. Switch Nimiq Pay to Testnet to pay it.')
          : t('This bill is on the main network. Switch Nimiq Pay to Mainnet to pay it.')}
      </p>
    </main>
  )
  if (notFound) return <main><h1>{t('Remote bill')}</h1><p role="alert">{t('This link is not valid.')}</p></main>
  if (loadError) return <main><h1>{t('Remote bill')}</h1><p role="alert">{loadError}</p></main>
  if (!preview) return <main><p>{t('Loading…')}</p></main>

  if (preview.state === 'expired')
    return (
      <main>
        <h1>{t('Remote bill')}</h1>
        <p role="alert">{t('This bill has expired. Ask {name} for a new link.').replace('{name}', preview.receiverDisplayName)}</p>
      </main>
    )
  if (preview.state === 'paid')
    return (
      <main>
        <h1>{t('Remote bill')}</h1>
        <p role="alert">{t('This bill has already been paid.')}</p>
      </main>
    )

  const nim = lunaToNim(BigInt(preview.amountLuna))
  const fiat = preview.fiatAmountMinor !== null && preview.fiatCurrency
    ? formatUsdValue(preview.fiatAmountMinor / 100)
    : null

  return (
    <main>
      <h1>{t('Remote bill')}</h1>
      <section aria-label="remote charge" className="sheet">
        <div>
          <p className="quiet"><strong>{preview.receiverDisplayName}</strong> {t('asks for')}</p>
          <p className="amount">{nim} NIM
            <small>{preview.amountLuna} luna</small>
            {fiat && <small>{fiat}</small>}
          </p>
          {preview.reference && <p className="quiet"><span>{preview.reference}</span></p>}
        </div>
        <dl>
          <dt>{t('Recipient wallet')}</dt>
          <dd>…{preview.receiverAddressTail}</dd>
        </dl>
        <p className="quiet">{t('Expires {date}').replace('{date}', new Date(preview.expiresAt).toLocaleString())}</p>
        <div className="actions">
          <button className="primary" onClick={() => void accept()} disabled={busy}>
            {busy ? <Spinner /> : t('Accept & pay')}
          </button>
        </div>
      </section>
      {actionError && <p role="alert">{actionError}</p>}
    </main>
  )
}
