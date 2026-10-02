import { useEffect, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import './App.css'

type Telemetry = {
  cpu: number
  memory: number
  temperature: number
  network: number
  anomaly: boolean
  alerts: string[]
}

type Incident = { id: number; message: string; timestamp: string }
type TelemetrySample = Telemetry & { timestamp: number }

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString()
}

const metrics = [
  { key: 'cpu', label: 'CPU', unit: '%', description: 'Processor utilization', threshold: 85 },
  { key: 'memory', label: 'Memory', unit: '%', description: 'Memory utilization', threshold: 90 },
  { key: 'temperature', label: 'Temperature', unit: '°C', description: 'System temperature', threshold: 80 },
  { key: 'network', label: 'Network', unit: 'Mbps', description: 'Network throughput', threshold: 90 },
] as const

function isTelemetry(value: unknown): value is Telemetry {
  if (typeof value !== 'object' || value === null) return false
  const data = value as Record<string, unknown>
  return metrics.every(
    ({ key }) => typeof data[key] === 'number' && Number.isFinite(data[key]),
  ) && typeof data.anomaly === 'boolean' && Array.isArray(data.alerts)
    && data.alerts.every((alert: unknown) => typeof alert === 'string')
}

function App() {
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null)
  const [connected, setConnected] = useState(false)
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [history, setHistory] = useState<TelemetrySample[]>([])

  useEffect(() => {
    let socket: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined
    let disposed = false
    let nextIncidentId = 0

    function connect() {
      if (disposed || (socket && socket.readyState !== WebSocket.CLOSED)) return
      const connection = new WebSocket('ws://127.0.0.1:8000/ws/telemetry')
      socket = connection

      connection.onopen = () => {
        if (!disposed) setConnected(true)
      }
      connection.onclose = () => {
        if (disposed || socket !== connection) return
        setConnected(false)
        if (reconnectTimer === undefined) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = undefined
            connect()
          }, 2000)
        }
      }
      connection.onerror = () => {
        if (!disposed) setConnected(false)
        // The close event schedules the retry, avoiding a second timer here.
        connection.close()
      }
      connection.onmessage = (event) => {
        if (disposed) return
        try {
          const data: unknown = JSON.parse(event.data)
          if (isTelemetry(data)) {
            setTelemetry(data)
            const sample = { ...data, timestamp: Date.now() }
            setHistory((previous) => [...previous, sample].slice(-60))
            if (data.anomaly) {
              const incident = {
                id: nextIncidentId++,
                message: data.alerts.join('; '),
                timestamp: new Date().toISOString(),
              }
              setIncidents((previous) => [incident, ...previous].slice(0, 10))
            }
          }
        } catch {
          // Keep the latest valid values if a malformed message arrives.
        }
      }
    }

    connect()

    return () => {
      disposed = true
      clearTimeout(reconnectTimer)
      if (socket) {
        socket.onopen = null
        socket.onclose = null
        socket.onerror = null
        socket.onmessage = null
        socket.close()
      }
    }
  }, [])

  return (
    <main className="dashboard">
      <header className="dashboard-header">
        <div className="brand"><span className="brand-mark" aria-hidden="true">ϟ</span>Pulse</div>
        <span className={`connection ${connected ? 'live' : ''}`} role="status">
          <span className="status-dot" aria-hidden="true" />
          {connected ? 'Live' : 'Disconnected'}
        </span>
      </header>

      <section aria-labelledby="overview-title">
        <div className="overview-heading">
          <p className="eyebrow">SYSTEM MONITOR</p>
          <h1 id="overview-title">System overview</h1>
          <p className="subtitle">Your system at a glance. Simulated metrics, updated every second.</p>
        </div>
        <div className="metric-grid">
          {metrics.map(({ key, label, unit, description, threshold }) => {
            const abnormal = telemetry !== null && telemetry[key] > threshold
            return (
              <article className={`metric-card metric-${key}${abnormal ? ' abnormal' : ''}`} key={key} aria-labelledby={`${key}-label`}>
                <h2 id={`${key}-label`}>{label}</h2>
                <p className="metric-value">
                  {telemetry ? telemetry[key].toFixed(2) : '—'}
                  <span className="metric-unit">{unit}</span>
                </p>
                <p className="metric-description">{description}</p>
                {abnormal && <p className="metric-warning">Above {threshold}{unit}</p>}
              </article>
            )
          })}
        </div>
        <p className="stream-note">
          {connected
            ? telemetry ? 'Receiving simulated telemetry.' : 'Connected. Waiting for telemetry…'
            : telemetry ? 'Connection closed. Showing last received values.' : 'Waiting for a connection to the telemetry stream.'}
        </p>
      </section>
      <section className="history-section" aria-labelledby="history-title">
        <h2 id="history-title">Live history</h2>
        <p className="stream-note">Latest {history.length} of 60 samples · local time</p>
        <div className="chart-grid">
          {metrics.map(({ key, label, unit }) => (
            <article className={`chart-card metric-${key}`} key={key} aria-labelledby={`${key}-chart-title`}>
              <h3 id={`${key}-chart-title`}>{label} <span>({unit})</span></h3>
              {history.length === 0 ? (
                <p className="chart-empty">Waiting for telemetry…</p>
              ) : (
                <div className="chart-container">
                  <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                    <LineChart data={history} margin={{ top: 12, right: 16, bottom: 4, left: 0 }} accessibilityLayer>
                      <CartesianGrid stroke="#263245" strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="timestamp" tickFormatter={formatTime} minTickGap={40} tick={{ fill: '#96a3b5', fontSize: 11 }} tickLine={false} axisLine={false} />
                      <YAxis domain={[0, 100]} width={36} tick={{ fill: '#96a3b5', fontSize: 11 }} tickLine={false} axisLine={false} />
                      <Tooltip labelFormatter={(value) => formatTime(Number(value))} contentStyle={{ background: '#121b27', border: '1px solid #354052', borderRadius: 8, color: '#e8edf5' }} />
                      <Line type="linear" dataKey={key} name={label} unit={` ${unit}`} stroke="var(--metric-color)" strokeWidth={2} dot={history.length === 1} activeDot={{ r: 4 }} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </article>
          ))}
        </div>
      </section>
      <section className="incident-feed" aria-labelledby="incident-title">
        <h2 id="incident-title">Incident Feed</h2>
        <p className="stream-note">10 most recent incidents · newest first</p>
        {incidents.length === 0 ? (
          <p className="incident-empty">No incidents recorded yet.</p>
        ) : (
          <ol className="incident-list">
            {incidents.map((incident) => (
              <li key={incident.id}>
                <span>{incident.message}</span>
                <time dateTime={incident.timestamp}>{new Date(incident.timestamp).toLocaleString()}</time>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  )
}

export default App
