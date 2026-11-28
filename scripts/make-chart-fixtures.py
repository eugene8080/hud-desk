"""Synthetic charts with fictional data for the AI Labels view (bridge/chart-labels.mjs).

Each chart is drawn with PIL, so the exact box of every text element is known. The script writes,
per chart, into the output folder:
  <name>.png         the chart (the input the vision model reads during evaluation)
  <name>.pgm.gz      the same pixels as 8-bit grey PGM, gzipped (what the unit tests decode;
                     the bridge's own parsePgm reads it, so tests need no PNG decoder or ffmpeg)
  <name>.truth.json  every text element: text, role and its box [x0, y0, x1, y1] in source pixels

All data, names and sources are invented. Nothing here comes from a real chart.

Usage:  python scripts/make-chart-fixtures.py <output folder> [--no-png]
        (--no-png for tests/fixtures/charts: the tests read only the .pgm.gz and .truth.json files)
"""
from __future__ import annotations

import gzip
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

FONTS = Path(r"C:\Windows\Fonts")


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    # Arial ships with Windows; the generator is a developer tool for this PC, not a runtime path.
    path = FONTS / name
    if not path.exists():
        raise SystemExit(f"Font not found: {path}")
    return ImageFont.truetype(str(path), size)


@dataclass
class Chart:
    name: str
    width: int
    height: int
    background: int
    ink: int
    image: Image.Image = field(init=False)
    draw: ImageDraw.ImageDraw = field(init=False)
    elements: list[dict] = field(default_factory=list)

    def __post_init__(self) -> None:
        self.image = Image.new("L", (self.width, self.height), self.background)
        self.draw = ImageDraw.Draw(self.image)

    def text(self, xy: tuple[float, float], text: str, role: str, face: ImageFont.FreeTypeFont,
             anchor: str = "la", fill: int | None = None) -> None:
        # anchor: PIL text anchors ('la' = left/ascender, 'ma' = middle, 'ra' = right).
        self.draw.text(xy, text, font=face, fill=self.ink if fill is None else fill, anchor=anchor)
        box = self.draw.textbbox(xy, text, font=face, anchor=anchor)
        self.elements.append({"text": text, "role": role, "box": [int(v) for v in box]})

    def vertical_text(self, centre: tuple[int, int], text: str, role: str, face: ImageFont.FreeTypeFont) -> None:
        # Rotated 90 degrees (a y-axis title read bottom to top).
        probe = ImageDraw.Draw(Image.new("L", (1, 1)))
        left, top, right, bottom = probe.textbbox((0, 0), text, font=face)
        tile = Image.new("L", (right - left + 4, bottom - top + 4), 0)
        ImageDraw.Draw(tile).text((2 - left, 2 - top), text, font=face, fill=255)
        tile = tile.rotate(90, expand=True)
        x0, y0 = centre[0] - tile.width // 2, centre[1] - tile.height // 2
        self.image.paste(Image.new("L", tile.size, self.ink), (x0, y0), tile)
        bbox = tile.getbbox() or (0, 0, tile.width, tile.height)
        self.elements.append({"text": text, "role": role, "vertical": True,
                              "box": [x0 + bbox[0], y0 + bbox[1], x0 + bbox[2], y0 + bbox[3]]})

    def dashed(self, start: tuple[float, float], end: tuple[float, float], fill: int, width: int, dash: int = 14, gap: int = 10) -> None:
        (x0, y0), (x1, y1) = start, end
        length = max(abs(x1 - x0), abs(y1 - y0))
        steps = int(length // (dash + gap)) + 1
        for i in range(steps):
            a = i * (dash + gap) / length
            b = min(1.0, (i * (dash + gap) + dash) / length)
            self.draw.line([(x0 + (x1 - x0) * a, y0 + (y1 - y0) * a), (x0 + (x1 - x0) * b, y0 + (y1 - y0) * b)], fill=fill, width=width)

    def save(self, folder: Path, png: bool = True) -> None:
        if png:
            self.image.save(folder / f"{self.name}.png", optimize=True)
        raw = f"P5\n{self.width} {self.height}\n255\n".encode("ascii") + self.image.tobytes()
        (folder / f"{self.name}.pgm.gz").write_bytes(gzip.compress(raw, compresslevel=9, mtime=0))
        truth = {"name": self.name, "width": self.width, "height": self.height, "elements": self.elements}
        (folder / f"{self.name}.truth.json").write_text(json.dumps(truth, indent=1) + "\n", encoding="utf-8")


def line_chart() -> Chart:
    """A line chart with a dashed reference line, a two-line annotation and a left axis."""
    c = Chart("line-reference", 1200, 720, background=255, ink=20)
    title, body, small = font("arialbd.ttf", 40), font("arial.ttf", 26), font("arial.ttf", 22)
    c.text((24, 18), "Monthly Widget Orders, 2031", "title", title)
    c.draw.line([(26, 100), (60, 100)], fill=20, width=5)
    c.text((72, 86), "Orders (thousands)", "legend", body)
    left, right, top, bottom = 110, 1160, 160, 600
    for i, value in enumerate(range(0, 100, 20)):
        y = bottom - (bottom - top) * value / 80
        if value > 80:
            break
        c.draw.line([(left, y), (right, y)], fill=200, width=2)
        c.text((left - 14, y), str(value), "y-tick", small, anchor="rm")
    months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    values = [32, 38, 45, 52, 61, 74, 69, 58, 55, 49, 44, 41]
    step = (right - left - 40) / (len(months) - 1)
    points = []
    for i, (month, value) in enumerate(zip(months, values)):
        x = left + 20 + i * step
        c.draw.line([(x, bottom), (x, bottom + 10)], fill=120, width=2)
        c.text((x, bottom + 16), month, "x-tick", small, anchor="ma")
        points.append((x, bottom - (bottom - top) * value / 80))
    target = bottom - (bottom - top) * 50 / 80
    c.dashed((left, target), (right, target), fill=60, width=3)
    c.text((left + 8, target - 34), "Target 50", "annotation", small)
    c.draw.line(points, fill=20, width=6, joint="curve")
    peak = points[5]
    c.draw.ellipse([peak[0] - 8, peak[1] - 8, peak[0] + 8, peak[1] + 8], fill=20)
    c.draw.line([(peak[0] + 10, peak[1]), (peak[0] + 70, peak[1] - 10)], fill=20, width=2)
    c.text((peak[0] + 76, peak[1] - 40), "Highest month", "annotation", small)
    c.text((peak[0] + 76, peak[1] - 12), "on record", "annotation", small)
    c.text((24, 680), "Source: Fictional Data Office", "source", small)
    return c


def bar_chart() -> Chart:
    """Grouped bars with data labels, a two-entry legend and a vertical y-axis title."""
    c = Chart("bar-groups", 1000, 800, background=255, ink=25)
    title, body, small, tiny = font("arialbd.ttf", 38), font("arial.ttf", 26), font("arial.ttf", 22), font("arial.ttf", 19)
    c.text((30, 20), "Fictional Fruit Harvest by Region", "title", title)
    c.text((30, 72), "Tonnes, 2030 vs 2031", "subtitle", body)
    c.draw.rectangle([30, 122, 52, 144], fill=40)
    c.text((60, 120), "2030", "legend", small)
    c.draw.rectangle([150, 122, 172, 144], fill=150)
    c.text((180, 120), "2031", "legend", small)
    left, right, top, bottom = 140, 970, 190, 700
    for value in range(0, 500, 100):
        y = bottom - (bottom - top) * value / 400
        c.draw.line([(left, y), (right, y)], fill=215, width=2)
        c.text((left - 12, y), str(value), "y-tick", small, anchor="rm")
    c.vertical_text((48, (top + bottom) // 2), "Tonnes", "axis-title", body)
    regions = ["North", "South", "East", "West", "Central"]
    data = [(180, 220), (310, 290), (95, 140), (250, 335), (160, 175)]
    slot = (right - left) / len(regions)
    for i, (region, (a, b)) in enumerate(zip(regions, data)):
        centre = left + slot * (i + 0.5)
        for j, (value, shade) in enumerate(((a, 40), (b, 150))):
            x0 = centre - 62 + j * 64
            y = bottom - (bottom - top) * value / 400
            c.draw.rectangle([x0, y, x0 + 58, bottom], fill=shade)
            c.text((x0 + 29, y - 8), str(value), "data-label", tiny, anchor="md")
        c.text((centre, bottom + 14), region, "x-tick", small, anchor="ma")
    c.draw.line([(left, bottom), (right, bottom)], fill=25, width=3)
    c.text((30, 760), "Source: Example Growers Guild", "source", small)
    return c


def right_axis_chart() -> Chart:
    """Dark background, a right-side dollar axis, date ticks, a reference line and an annotation."""
    c = Chart("right-axis-dark", 1600, 900, background=8, ink=235)
    title, body, small = font("arialbd.ttf", 46), font("arial.ttf", 30), font("arial.ttf", 28)
    c.text((20, 16), "Example Index Since Launch", "title", title)
    c.draw.line([(22, 112), (50, 92)], fill=235, width=6)
    c.text((64, 84), "Example Index", "legend", body)
    left, right, top, bottom = 30, 1480, 170, 760
    labels = {120: "$120", 110: "110", 100: "100", 90: "90", 80: "80"}
    for value, label in labels.items():
        y = bottom - (bottom - top) * (value - 80) / 40
        c.draw.line([(left, y), (right, y)], fill=70, width=2)
        c.text((1585, y - 8), label, "y-tick", small, anchor="rs")
    days = ["Mar. 3", "4", "5", "6", "7", "10", "11", "12", "13", "Mar. 14"]
    values = [100, 108, 115, 111, 104, 96, 88, 91, 99, 106]
    step = (right - left - 60) / (len(days) - 1)
    points = []
    for i, (day, value) in enumerate(zip(days, values)):
        x = left + 30 + i * step
        c.draw.line([(x, bottom), (x, bottom + 12)], fill=150, width=2)
        c.text((x, bottom + 22), day, "x-tick", small, anchor="ma")
        points.append((x, bottom - (bottom - top) * (value - 80) / 40))
    launch = bottom - (bottom - top) * 20 / 40
    c.dashed((left, launch), (right, launch), fill=200, width=4)
    c.text((left + 10, launch - 40), "Launch price", "annotation", small)
    c.draw.line(points, fill=235, width=7, joint="curve")
    low = points[6]
    c.draw.ellipse([low[0] - 9, low[1] - 9, low[0] + 9, low[1] + 9], fill=235)
    c.draw.line([(low[0], low[1] + 12), (low[0], low[1] + 70), (low[0] - 40, low[1] + 70)], fill=235, width=2)
    c.text((low[0] - 50, low[1] + 54), "Lowest close", "annotation", small, anchor="ra")
    c.text((20, 850), "Source: Sample Exchange", "source", small, fill=180)
    return c


def main() -> None:
    args = [a for a in sys.argv[1:] if a != "--no-png"]
    if len(args) != 1:
        raise SystemExit(__doc__)
    folder = Path(args[0])
    folder.mkdir(parents=True, exist_ok=True)
    for chart in (line_chart(), bar_chart(), right_axis_chart()):
        chart.save(folder, png="--no-png" not in sys.argv)
        print(f"{chart.name}: {chart.width}x{chart.height}, {len(chart.elements)} text elements")


if __name__ == "__main__":
    main()
