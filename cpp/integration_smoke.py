"""Exercise the real native collector and a disposable loopback MQTT broker."""
import json
import math
import os
import shlex
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request


def free_port():
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


def main():
    executable = str(Path(sys.argv[1]).resolve())
    with tempfile.TemporaryDirectory(prefix="stormdesk-smoke-") as root:
        directory = Path(root)
        port, broker_port = free_port(), free_port()
        config = {"settings": {"stationSource": "ecowitt", "stationId": "collector", "stationName": "Test station", "units": "metric", "ingestKey": "test-key"}}
        mqtt = shutil.which("mosquitto") and shutil.which("mosquitto_sub")
        if mqtt:
            config["settings"]["mqttUrl"] = f"mqtt://127.0.0.1:{broker_port}"
        (directory / "config.json").write_text(json.dumps(config))
        broker = process = None
        base = f"http://127.0.0.1:{port}"
        environment = os.environ.copy()
        browser = []
        opened = directory / "opened-url"
        if sys.platform.startswith("linux"):
            opener = directory / "xdg-open"
            opener.write_text("#!/bin/sh\nprintf '%s' \"$1\" > " + shlex.quote(str(opened)) + "\n")
            opener.chmod(0o755)
            environment["PATH"] = str(directory) + os.pathsep + environment["PATH"]
            browser = ["--browser"]

        def get(path):
            with urllib.request.urlopen(base + path, timeout=5) as response:
                return response.read()

        def start():
            nonlocal process
            process = subprocess.Popen([executable, "--headless", "--no-udp", "--bind", "127.0.0.1", "--port", str(port), "--data-dir", str(directory)] + browser, env=environment, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            for _ in range(100):
                if process.poll() is not None:
                    raise AssertionError("Native collector exited during startup")
                try:
                    get("/api/v1")
                    return
                except (urllib.error.URLError, ConnectionError):
                    time.sleep(.05)
            raise AssertionError("Native collector did not start")

        def subscribe(topic):
            result = subprocess.run(["mosquitto_sub", "-h", "127.0.0.1", "-p", str(broker_port), "-t", topic, "-C", "1", "-W", "15"], capture_output=True, timeout=18, check=True)
            return result.stdout.decode().strip()

        try:
            if mqtt:
                broker_config = directory / "mosquitto.conf"
                broker_config.write_text(f"listener {broker_port} 127.0.0.1\nallow_anonymous true\npersistence false\n")
                broker = subprocess.Popen(["mosquitto", "-c", str(broker_config)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                time.sleep(.2)
            start()
            if browser:
                for _ in range(30):
                    if opened.exists(): break
                    time.sleep(.05)
                assert opened.read_text() == base
            assert get("/ingest/test-key?tempf=68&humidity=50&dailyrainin=1") == b"success"
            state = json.loads(get("/api/v1"))
            assert state["api"] == 1 and state["units"] == "si"
            assert state["current"]["temp"] == 20
            assert state["current"]["rain"] == 0
            assert b"test-key" not in get("/config-public")
            assert len(json.loads(get("/history/tuples?hours=1"))["obs"]) == 1
            if mqtt:
                assert float(subscribe("stormdesk/collector/temp")) == 20
                discovery = json.loads(subscribe("homeassistant/sensor/wd_collector_temp/config"))
                assert discovery["unit_of_measurement"] == "°C"
                assert discovery["state_topic"] == "stormdesk/collector/temp"
            process.terminate()
            process.wait(timeout=5)
            time.sleep(1.05)
            start()
            assert get("/ingest/test-key?tempf=69&humidity=50&dailyrainin=1.1") == b"success"
            assert math.isclose(json.loads(get("/api/v1"))["current"]["rain"], 2.54)
            assert len(json.loads(get("/history/tuples?hours=1"))["obs"]) == 2
            print("PASS: native collector, SI API, restart counters" + (", MQTT state and discovery" if mqtt else " (MQTT skipped: tools unavailable)"))
        finally:
            for child in (process, broker):
                if child and child.poll() is None:
                    child.terminate()
                    try:
                        child.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        child.kill()
                        child.wait()


if __name__ == "__main__":
    main()
