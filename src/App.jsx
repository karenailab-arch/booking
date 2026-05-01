import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabaseClient'
import './App.css'

const THERAPISTS = ['王老師', '陳老師', '林老師']
const TIME_SLOTS = [
  '09:00',
  '10:00',
  '11:00',
  '13:00',
  '14:00',
  '15:00',
  '16:00',
  '19:00',
  '20:00',
]

const INITIAL_FORM = {
  customer_name: '',
  customer_phone: '',
  symptom: '',
  duration: '',
  therapist_name: THERAPISTS[0],
  appointment_date: '',
  appointment_time: TIME_SLOTS[0],
  note: '',
}

function hasRecoveryTokenInHash() {
  const hash = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash
  const params = new URLSearchParams(hash)
  return params.get('type') === 'recovery'
}

function App() {
  const [isRecoveryFlow, setIsRecoveryFlow] = useState(() => hasRecoveryTokenInHash())
  const [mode, setMode] = useState(() => (hasRecoveryTokenInHash() ? 'admin' : 'booking'))
  const [form, setForm] = useState(INITIAL_FORM)
  const [loginForm, setLoginForm] = useState({ email: '', password: '' })
  const [resetPassword, setResetPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [loggingIn, setLoggingIn] = useState(false)
  const [bookings, setBookings] = useState([])
  const [auditLogs, setAuditLogs] = useState([])
  const [loading, setLoading] = useState(false)
  const [logsLoading, setLogsLoading] = useState(false)
  const [message, setMessage] = useState(() =>
    hasRecoveryTokenInHash() ? '請輸入新密碼完成重設。' : '',
  )
  const [session, setSession] = useState(null)

  const statusText = useMemo(
    () => ({
      pending: '待確認',
      confirmed: '已確認',
      cancelled: '已取消',
      completed: '已完成',
    }),
    [],
  )

  useEffect(() => {
    async function loadSession() {
      const { data } = await supabase.auth.getSession()
      setSession(data.session ?? null)
    }

    loadSession()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
    })

    return () => subscription.unsubscribe()
  }, [])

  async function fetchBookings() {
    setLoading(true)
    const { data, error } = await supabase
      .from('appointments')
      .select('*')
      .order('appointment_date', { ascending: true })
      .order('appointment_time', { ascending: true })

    if (error) {
      setMessage(`讀取失敗：${error.message}`)
    } else {
      setBookings(data ?? [])
    }
    setLoading(false)
  }

  async function fetchAuditLogs() {
    setLogsLoading(true)
    const { data, error } = await supabase
      .from('appointment_audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) {
      setMessage(`讀取操作紀錄失敗：${error.message}`)
    } else {
      setAuditLogs(data ?? [])
    }
    setLogsLoading(false)
  }

  function openAdminPanel() {
    setMode('admin')
    if (session) {
      fetchBookings()
      fetchAuditLogs()
    }
  }

  function updateField(event) {
    const { name, value } = event.target
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  async function submitBooking(event) {
    event.preventDefault()
    setSubmitting(true)
    setMessage('')

    const payload = {
      customer_name: form.customer_name.trim(),
      customer_phone: form.customer_phone.trim(),
      symptom: form.symptom.trim(),
      duration: form.duration.trim(),
      therapist_name: form.therapist_name,
      appointment_date: form.appointment_date,
      appointment_time: form.appointment_time,
      note: form.note.trim(),
      status: 'pending',
    }

    const { error } = await supabase.from('appointments').insert(payload)
    setSubmitting(false)

    if (error) {
      if (error.code === '23505') {
        setMessage('此時段已被預約，請改選其他時間。')
      } else {
        setMessage(`送出失敗：${error.message}`)
      }
      return
    }

    setForm(INITIAL_FORM)
    setMessage('預約成功！我們會盡快與您確認時段。')
  }

  async function updateStatus(id, status) {
    const { error } = await supabase
      .from('appointments')
      .update({ status })
      .eq('id', id)

    if (error) {
      setMessage(`更新狀態失敗：${error.message}`)
      return
    }
    fetchBookings()
  }

  async function removeBooking(id) {
    const okay = window.confirm('確定要刪除此預約？')
    if (!okay) return

    const { error } = await supabase.from('appointments').delete().eq('id', id)
    if (error) {
      setMessage(`刪除失敗：${error.message}`)
      return
    }
    fetchBookings()
  }

  async function signInAdmin(event) {
    event.preventDefault()
    setLoggingIn(true)
    setMessage('')

    const { error } = await supabase.auth.signInWithPassword({
      email: loginForm.email.trim(),
      password: loginForm.password,
    })

    setLoggingIn(false)
    if (error) {
      setMessage(`登入失敗：${error.message}`)
      return
    }
    fetchBookings()
    fetchAuditLogs()
    setMessage('管理員登入成功。')
  }

  async function signOutAdmin() {
    const { error } = await supabase.auth.signOut()
    if (error) {
      setMessage(`登出失敗：${error.message}`)
      return
    }
    setBookings([])
    setAuditLogs([])
    setMessage('已登出管理後台。')
  }

  async function sendResetPasswordEmail() {
    if (!loginForm.email.trim()) {
      setMessage('請先輸入管理員 Email。')
      return
    }

    const { error } = await supabase.auth.resetPasswordForEmail(
      loginForm.email.trim(),
      { redirectTo: window.location.origin },
    )

    if (error) {
      setMessage(`寄送重設信失敗：${error.message}`)
      return
    }
    setMessage('已寄出重設密碼信，請到信箱點擊連結。')
  }

  async function submitNewPassword(event) {
    event.preventDefault()
    if (resetPassword.length < 8) {
      setMessage('新密碼至少 8 碼。')
      return
    }

    const { error } = await supabase.auth.updateUser({ password: resetPassword })
    if (error) {
      setMessage(`重設密碼失敗：${error.message}`)
      return
    }

    setResetPassword('')
    setIsRecoveryFlow(false)
    setMessage('密碼已更新，請用新密碼登入。')
  }

  return (
    <div className="page">
      <header className="topbar">
        <div>
          <h1>結構調理預約系統</h1>
          <p>線上預約、後台管理、免費資料庫</p>
        </div>
        <nav className="switcher">
          <button
            type="button"
            className={mode === 'booking' ? 'active' : ''}
            onClick={() => setMode('booking')}
          >
            預約頁面
          </button>
          <button
            type="button"
            className={mode === 'admin' ? 'active' : ''}
            onClick={openAdminPanel}
          >
            管理後台
          </button>
        </nav>
      </header>

      {message && <p className="message">{message}</p>}

      {mode === 'booking' ? (
        <main className="panel">
          <h2>預約時段</h2>
          <form onSubmit={submitBooking} className="grid-form">
            <label>
              姓名
              <input
                name="customer_name"
                value={form.customer_name}
                onChange={updateField}
                required
              />
            </label>
            <label>
              電話
              <input
                name="customer_phone"
                value={form.customer_phone}
                onChange={updateField}
                placeholder="09xxxxxxxx"
                required
              />
            </label>
            <label>
              症狀
              <input
                name="symptom"
                value={form.symptom}
                onChange={updateField}
                placeholder="例如：肩頸痠痛、腰緊繃"
                required
              />
            </label>
            <label>
              持續時間
              <input
                name="duration"
                value={form.duration}
                onChange={updateField}
                placeholder="例如：2 週、3 個月"
                required
              />
            </label>
            <label>
              調理師
              <select
                name="therapist_name"
                value={form.therapist_name}
                onChange={updateField}
              >
                {THERAPISTS.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              預約日期
              <input
                type="date"
                name="appointment_date"
                value={form.appointment_date}
                onChange={updateField}
                required
              />
            </label>
            <label>
              預約時間
              <select
                name="appointment_time"
                value={form.appointment_time}
                onChange={updateField}
              >
                {TIME_SLOTS.map((time) => (
                  <option key={time} value={time}>
                    {time}
                  </option>
                ))}
              </select>
            </label>
            <label className="full">
              備註
              <textarea name="note" value={form.note} onChange={updateField} rows={4} />
            </label>
            <button type="submit" className="primary full" disabled={submitting}>
              {submitting ? '送出中...' : '送出預約'}
            </button>
          </form>
        </main>
      ) : (
        <main className="panel">
          {!session ? (
            <>
              {isRecoveryFlow ? (
                <>
                  <h2>重設管理員密碼</h2>
                  <form onSubmit={submitNewPassword} className="login-form">
                    <label>
                      新密碼（至少 8 碼）
                      <input
                        type="password"
                        value={resetPassword}
                        onChange={(event) => setResetPassword(event.target.value)}
                        required
                      />
                    </label>
                    <button type="submit" className="primary">
                      更新密碼
                    </button>
                  </form>
                </>
              ) : (
                <>
                  <h2>管理員登入</h2>
                  <p className="hint">僅授權管理員可存取後台預約資料。</p>
                  <form onSubmit={signInAdmin} className="login-form">
                    <label>
                      帳號 Email
                      <input
                        type="email"
                        value={loginForm.email}
                        onChange={(event) =>
                          setLoginForm((prev) => ({ ...prev, email: event.target.value }))
                        }
                        required
                      />
                    </label>
                    <label>
                      密碼
                      <input
                        type="password"
                        value={loginForm.password}
                        onChange={(event) =>
                          setLoginForm((prev) => ({ ...prev, password: event.target.value }))
                        }
                        required
                      />
                    </label>
                    <div className="actions">
                      <button type="submit" className="primary" disabled={loggingIn}>
                        {loggingIn ? '登入中...' : '登入後台'}
                      </button>
                      <button type="button" onClick={sendResetPasswordEmail}>
                        忘記密碼
                      </button>
                    </div>
                  </form>
                </>
              )}
            </>
          ) : (
            <>
              <div className="admin-head">
                <h2>預約管理</h2>
                <div className="actions">
                  <button type="button" onClick={fetchBookings}>
                    重新整理
                  </button>
                  <button type="button" onClick={signOutAdmin}>
                    登出
                  </button>
                </div>
              </div>
              {loading ? (
                <p>讀取中...</p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>日期</th>
                        <th>時間</th>
                        <th>客戶</th>
                        <th>電話</th>
                        <th>症狀</th>
                        <th>持續時間</th>
                        <th>調理師</th>
                        <th>狀態</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bookings.map((item) => (
                        <tr key={item.id}>
                          <td>{item.appointment_date}</td>
                          <td>{item.appointment_time}</td>
                          <td>{item.customer_name}</td>
                          <td>{item.customer_phone}</td>
                          <td>{item.symptom || '-'}</td>
                          <td>{item.duration || '-'}</td>
                          <td>{item.therapist_name}</td>
                          <td>{statusText[item.status] ?? item.status}</td>
                          <td className="actions">
                            <button type="button" onClick={() => updateStatus(item.id, 'confirmed')}>
                              確認
                            </button>
                            <button type="button" onClick={() => updateStatus(item.id, 'completed')}>
                              完成
                            </button>
                            <button type="button" onClick={() => updateStatus(item.id, 'cancelled')}>
                              取消
                            </button>
                            <button
                              type="button"
                              className="danger"
                              onClick={() => removeBooking(item.id)}
                            >
                              刪除
                            </button>
                          </td>
                        </tr>
                      ))}
                      {bookings.length === 0 && (
                        <tr>
                          <td colSpan={9}>目前沒有預約資料</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
              <section className="logs">
                <div className="admin-head">
                  <h3>後台操作紀錄</h3>
                  <button type="button" onClick={fetchAuditLogs}>
                    重新整理紀錄
                  </button>
                </div>
                {logsLoading ? (
                  <p>讀取紀錄中...</p>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>時間</th>
                          <th>動作</th>
                          <th>預約 ID</th>
                          <th>操作者</th>
                        </tr>
                      </thead>
                      <tbody>
                        {auditLogs.map((log) => (
                          <tr key={log.id}>
                            <td>{new Date(log.created_at).toLocaleString()}</td>
                            <td>{log.action}</td>
                            <td>{log.appointment_id}</td>
                            <td>{log.actor_user_id}</td>
                          </tr>
                        ))}
                        {auditLogs.length === 0 && (
                          <tr>
                            <td colSpan={4}>目前沒有操作紀錄</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}
        </main>
      )}
    </div>
  )
}

export default App
