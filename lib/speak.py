# Speaks many lines in one process: loads the Kokoro voice model once, then writes line<i>.wav for each line in its
# own voice and speed. oldguy narrate runs it for templates with speakers, so a chapter of many short lines does not
# reload the model for every line (about 10 s each, measured in spikes/08-templates).
#
# Usage: python speak.py <model.onnx> <voices.bin> <request.json>
# request.json: {"out_dir": "...", "lines": [{"text": "...", "voice": "am_adam", "speed": 1.1}, ...]}
# Prints one JSON line: {"sample_rate": 24000, "lines": [{"file": "line0.wav", "seconds": 1.234}, ...]}
# On failure prints {"error": "...", "line": <index or null>} and exits 1.
import json
import os
import re
import sys


# The language Kokoro reads a voice in, from the first letter of its id (a: American, b: British, and so on).
LANGS = {"a": "en-us", "b": "en-gb", "e": "es", "f": "fr-fr", "j": "ja", "z": "zh", "h": "hi", "i": "it", "p": "pt-br"}


# Says why the run failed, as JSON on stdout, and stops.
def fail(message, line=None):
    print(json.dumps({"error": message, "line": line}))
    sys.exit(1)


# True when Kokoro refused a text for being too long for one pass.
def too_long(error):
    return bool(re.search(r"index \d+ is out of bounds for axis 0 with size 510", str(error), re.IGNORECASE))


# Splits a text near its middle, on a space when there is one.
def halves(text):
    mid = len(text) // 2
    spaces = [i + 1 for i, c in enumerate(text) if c.isspace() and 0 < i < len(text) - 1]
    at = min(spaces, key=lambda i: abs(i - mid)) if spaces else mid
    return text[:at], text[at:]


# Speaks one text, splitting it in two (and again) when Kokoro says it is too long for one pass.
def synthesize(model, text, kwargs):
    try:
        return model.create(text, **kwargs)
    except IndexError as error:
        if not too_long(error) or len(text) < 2:
            raise
        left, right = halves(text)
        a, rate = synthesize(model, left, kwargs)
        b, _ = synthesize(model, right, kwargs)
        return list(a) + list(b), rate


def main():
    if len(sys.argv) != 4:
        fail("usage: speak.py <model.onnx> <voices.bin> <request.json>")
    model_path, voices_path, request_path = sys.argv[1:4]
    for path in (model_path, voices_path):
        if not os.path.isfile(path):
            fail(f"missing {path}: run oldguy setup and install voice")
    with open(request_path, encoding="utf-8") as f:
        request = json.load(f)
    lines = request.get("lines")
    out_dir = request.get("out_dir")
    if not isinstance(lines, list) or not lines or not isinstance(out_dir, str):
        fail("request needs out_dir and a non-empty lines list")

    import kokoro_onnx
    import soundfile

    model = kokoro_onnx.Kokoro(model_path, voices_path)
    done = []
    rate = None
    for i, line in enumerate(lines):
        try:
            voice = line["voice"]
            kwargs = {"voice": voice, "speed": float(line.get("speed", 1.0)), "lang": LANGS.get(voice[:1], "en-us")}
            samples, rate = synthesize(model, line["text"], kwargs)
            name = f"line{i}.wav"
            # 16-bit PCM, the only wav oldguy's own reader (lib/wav.mts) accepts
            soundfile.write(os.path.join(out_dir, name), samples, rate, subtype="PCM_16")
            done.append({"file": name, "seconds": round(len(samples) / rate, 4)})
        except Exception as error:  # any failure names the line it happened on
            fail(f"{type(error).__name__}: {error}", i)
    print(json.dumps({"sample_rate": rate, "lines": done}))


main()
