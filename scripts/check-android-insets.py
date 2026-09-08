#!/usr/bin/env python3
"""With StormDesk open on an unlocked phone, run: ADB=/path/to/adb python3 scripts/check-android-insets.py."""
import os
import re
import subprocess
import xml.etree.ElementTree as ET


def adb(*args):
    return subprocess.check_output([os.environ.get("ADB", "adb"), *args], text=True)


def rect(value):
    return tuple(map(int, re.findall(r"\d+", value)))


if __name__ == "__main__":
    adb("shell", "uiautomator", "dump", "/sdcard/stormdesk-insets-check.xml")
    root = ET.fromstring(adb("shell", "cat", "/sdcard/stormdesk-insets-check.xml"))
    views = [rect(n.get("bounds")) for n in root.iter("node")
             if n.get("class") == "android.webkit.WebView"
             and n.get("package") == "io.github.davidmay87.stormdesk"]
    assert views, "Open StormDesk before running this check"
    bars = {rect(m) for m in re.findall(
        r"InsetsSource id=\S+ type=(?:statusBars|navigationBars) "
        r"frame=(\[\d+,\d+\]\[\d+,\d+\]) visible=true",
        adb("shell", "dumpsys", "window"))}
    assert bars, "No visible system bars found; run with system bars visible"
    for left, top, right, bottom in views:
        for bl, bt, br, bb in bars:
            assert right <= bl or left >= br or bottom <= bt or top >= bb, (
                f"WebView {(left, top, right, bottom)} overlaps system bar {(bl, bt, br, bb)}")
    print("PASS: StormDesk WebView clears all visible system bars")
