import asyncio
import random
import sqlite3
from contextlib import asynccontextmanager, closing
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock

from fastapi import FastAPI, WebSocket, WebSocketDisconnect

THRESHOLDS = {
    "cpu": (85, "High CPU usage"),
    "memory": (90, "High memory usage"),
    "temperature": (80, "High temperature"),
    "network": (90, "High network usage"),
}
DB_PATH = Path(__file__).with_name("pulse.db")
incident_lock = Lock()
abnormal_metrics = set()


@asynccontextmanager
async def lifespan(app: FastAPI):
    with closing(sqlite3.connect(DB_PATH)) as connection, connection:
        connection.execute("""
            CREATE TABLE IF NOT EXISTS incidents (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                metric TEXT NOT NULL,
                value REAL NOT NULL,
                message TEXT NOT NULL
            )
        """)
    abnormal_metrics.clear()
    yield


app = FastAPI(lifespan=lifespan)


def save_incidents(metrics):
    # Share transition state across HTTP and WebSocket samples in this process.
    with incident_lock:
        current = {metric for metric, (threshold, _) in THRESHOLDS.items()
                   if metrics[metric] > threshold}
        timestamp = datetime.now(timezone.utc).isoformat()
        rows = [(timestamp, metric, metrics[metric], message)
                for metric, (_, message) in THRESHOLDS.items()
                if metric in current and metric not in abnormal_metrics]
        if rows:
            with closing(sqlite3.connect(DB_PATH)) as connection, connection:
                connection.executemany(
                    "INSERT INTO incidents (timestamp, metric, value, message) VALUES (?, ?, ?, ?)",
                    rows,
                )
        # Update only after a successful commit so failed writes can be retried.
        abnormal_metrics.clear()
        abnormal_metrics.update(current)


@app.get("/health")
def health():
    return {"status": "ok"}


def generate_telemetry():
    metrics = {
        "cpu": round(random.uniform(5, 80), 2),  # Percent
        "memory": round(random.uniform(20, 85), 2),  # Percent
        "temperature": round(random.uniform(35, 75), 2),  # Celsius
        "network": round(random.uniform(0, 85), 2),  # Mbps
    }
    # Roughly one in five samples includes a spike in one metric.
    if random.random() < 0.2:
        metric = random.choice(list(THRESHOLDS))
        threshold, _ = THRESHOLDS[metric]
        maximum = 95 if metric == "temperature" else 100
        metrics[metric] = round(random.uniform(threshold + 1, maximum), 2)

    alerts = [message for metric, (threshold, message) in THRESHOLDS.items()
              if metrics[metric] > threshold]
    save_incidents(metrics)
    return {**metrics, "anomaly": bool(alerts), "alerts": alerts}


@app.get("/telemetry")
def telemetry():
    return generate_telemetry()


@app.get("/incidents")
def incidents():
    with closing(sqlite3.connect(DB_PATH)) as connection:
        connection.row_factory = sqlite3.Row
        rows = connection.execute(
            "SELECT id, timestamp, metric, value, message FROM incidents ORDER BY id DESC LIMIT 20"
        ).fetchall()
    return [dict(row) for row in rows]


@app.websocket("/ws/telemetry")
async def telemetry_websocket(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            await websocket.send_json(generate_telemetry())
            await asyncio.sleep(1)
    except WebSocketDisconnect:
        pass
