"""Render the Russian country names offline. Requires PyTorch and ffmpeg.

Pass the local Silero v5_cis_base_nostress.pt model as the first argument.
The website uses the finished MP3s and does not need the synthesis model.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
from xml.sax.saxutils import escape

import numpy as np
import torch

ROOT = Path(__file__).resolve().parents[1]
MODEL_SHA256 = "0405777e332906f0644e08a680f7cfdc2137ea864090079c1fdd30a43c1b8761"
RATE = 48000
SPEAKER = "ru_ekaterina"


def spoken_names():
    catalog = {row["code"]: row["name"] for row in
               json.loads((ROOT / "src/countries.json").read_text())}
    catalog["us"] = "Соединённые Штаты Америки"
    rows = (ROOT / "scripts/spoken-names-ru.txt").read_text().splitlines()
    names = dict(row.split(" ", 1) for row in rows)
    if (len(rows) != len(catalog) or
            {code: name.replace("+", "") for code, name in names.items()} != catalog):
        raise ValueError("The pronunciation list must match the country catalog")
    return names


def render(model, text, target):
    ssml = '<speak><prosody rate="slow">' + escape(text) + '.</prosody></speak>'
    samples = model.apply_tts(ssml_text=ssml, speaker=SPEAKER, sample_rate=RATE,
                              put_accent=False, put_yo=False).cpu().numpy()
    if not samples.size or not np.isfinite(samples).all() or np.max(np.abs(samples)) < 0.01:
        raise ValueError(f"Invalid speech for {text}")
    # Preserve the first consonant and leave a short lead-in for sleeping phone speakers.
    subprocess.run(["ffmpeg", "-nostdin", "-y", "-loglevel", "error", "-f", "f32le",
                    "-ar", str(RATE), "-ac", "1", "-i", "pipe:0", "-af",
                    "loudnorm=I=-18:TP=-2:LRA=7,adelay=160,apad=pad_dur=0.10,aresample=48000,asetpts=N/SR/TB",
                    "-ar", str(RATE), "-c:a", "libmp3lame", "-b:a", "96k", str(target)],
                   input=samples.astype("<f4").tobytes(), check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("model", type=Path)
    args = parser.parse_args()
    with args.model.open("rb") as model_file:
        if hashlib.file_digest(model_file, "sha256").hexdigest() != MODEL_SHA256:
            parser.error("Model checksum differs from the verified voice model")
    names = spoken_names()
    torch.manual_seed(42)
    torch.set_num_threads(3)
    model = torch.package.PackageImporter(str(args.model)).load_pickle("tts_models", "model")
    dest = ROOT / "public/voice"
    with tempfile.TemporaryDirectory(dir=ROOT) as work:
        for code, text in names.items():
            render(model, text, Path(work) / f"{code}.mp3")
        for code in names:
            (Path(work) / f"{code}.mp3").replace(dest / f"{code}.mp3")
    print(f"Rendered {len(names)} Russian country names.")


if __name__ == "__main__":
    main()
