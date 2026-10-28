import { useApi } from '../api/useApi'
import { api } from '../api/client'
import { Modal, Loading, ErrBox, Pill, fmtDate, fmtDateTime } from './ui'

const STATUS_PILL = { sent: ['Sent', 'p-info'], bounced: ['Bounced', 'p-bad'], scheduled: ['Scheduled', 'p-mute'], skipped: ['Skipped', 'p-mute'], send_failed: ['Failed', 'p-bad'] }

export default function EvidenceModal({ customerId, customerName, onClose }) {
  const { data, error, loading } = useApi(() => api.get(`/customers/${customerId}/blacklist-evidence`), [customerId])

  return (
    <Modal title={`Why — ${customerName}`} onClose={onClose} wide footer={
      <button className="btn" onClick={onClose} type="button">Close</button>
    }>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrBox message={error} />
      ) : (
        <>
          {data.event ? (
            <div className="card" style={{ margin: '0 0 12px' }}>
              <div className="row">
                <Pill text={'Blacklist ' + data.event.cat} cls={data.current_cat === data.event.cat ? 'p-bad' : 'p-mute'} />
                <span className="spacer" />
                <span className="hint">{data.event.status === 'approved' ? 'Approved' : data.event.status === 'pending' ? 'Pending' : data.event.status === 'rejected' ? 'Rejected' : 'Withdrawn'}{data.event.auto_raised ? ' · auto-raised' : ' · staff-raised'}</span>
              </div>
              <p style={{ margin: '8px 0 2px' }}><b>Rule:</b> {data.event.rule}</p>
              <p style={{ margin: '2px 0' }}><b>Action:</b> {data.event.action}</p>
              <p style={{ margin: '2px 0' }}><b>Evidence:</b> {data.event.reason}</p>
              {data.event.approvals.length ? (
                <p style={{ margin: '8px 0 0' }}>
                  {data.event.approvals.map((a) => (
                    <Pill key={a.approver_id} text={(a.decision ? 'Approved' : 'Rejected') + (a.note ? `: ${a.note}` : '')} cls={a.decision ? 'p-ok' : 'p-bad'} />
                  ))}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="hint">No blacklist suggestion has ever been raised for this company.</p>
          )}

          {data.mail_trail.length ? (
            <>
              <h3 style={{ margin: '12px 0 6px' }}>The follow-up thread this was raised from</h3>
              {data.mail_trail.map((t) => (
                <div key={t.visit_contact_id} className="card" style={{ margin: '0 0 10px' }}>
                  <p className="hint" style={{ margin: '0 0 6px' }}>Visit on {fmtDate(t.visit_date)}</p>
                  <table>
                    <tr><th>Mail</th><th>Status</th><th>Sent</th><th>Replied</th></tr>
                    {t.mails.map((m) => {
                      const [label, cls] = STATUS_PILL[m.status] || [m.status, 'p-mute']
                      return (
                        <tr key={m.mail_number}>
                          <td>Mail {m.mail_number}</td>
                          <td><Pill text={label} cls={cls} /></td>
                          <td>{m.sent_at ? fmtDate(m.sent_at) : '—'}</td>
                          <td>{m.replied ? `Yes — ${fmtDate(m.replied_at)}` : 'No'}</td>
                        </tr>
                      )
                    })}
                  </table>
                </div>
              ))}
            </>
          ) : null}

          {data.exceptions.length ? (
            <>
              <h3 style={{ margin: '12px 0 6px' }}>Exception requests</h3>
              <table>
                <tr><th>Status</th><th>Reason</th><th>Valid till</th></tr>
                {data.exceptions.map((e) => (
                  <tr key={e.id}>
                    <td><Pill text={e.status} cls={e.status === 'approved' ? 'p-ok' : e.status === 'pending' ? 'p-warn' : 'p-bad'} /></td>
                    <td>{e.reason}</td>
                    <td>{e.valid_till ? fmtDate(e.valid_till) : '—'}</td>
                  </tr>
                ))}
              </table>
            </>
          ) : null}

          {data.history.length ? (
            <>
              <h3 style={{ margin: '12px 0 6px' }}>History</h3>
              <table>
                <tr><th>When</th><th>What</th></tr>
                {data.history.map((h, i) => (
                  <tr key={i}>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(h.created_at)}</td>
                    <td>{h.action}{h.detail?.reason ? ` — ${h.detail.reason}` : ''}</td>
                  </tr>
                ))}
              </table>
            </>
          ) : null}
        </>
      )}
    </Modal>
  )
}
