"""Draw the fictional news-style line chart used by the store preview (scripts/store-preview.mjs).

Eugene, 2026-11-27: show a chart rendered on the G2 and its AI Readout in the README and store
screenshots, without republishing a newsletter's copyrighted chart. This chart copies only the
genre (title, legend, right-side price axis, dashed reference line, a callout, source line); the
company, prices and wording are invented.

Output: .local/store-assets/markets-chart.png (gitignored, like the store fractal). The store
preview renders it with the bridge's own picture code and asks the local vision model once for
the AI Readout (cached next to it).

Run: python scripts/make-store-chart.py
"""
from __future__ import annotations

import logging
from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # file output only; no display backend on a headless run
import matplotlib.pyplot as plt  # noqa: E402  (backend must be chosen before pyplot loads)
from matplotlib.lines import Line2D  # noqa: E402

LOG = logging.getLogger("make-store-chart")
ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / ".local" / "store-assets" / "markets-chart.png"

# Fictional closing prices for a fictional listing, first eight trading days (weekend gap after
# day 4, marked by the dashed vertical rule like a real trading calendar).
DAYS = ["Mar. 3", "4", "5", "6", "10", "11", "12", "Mar. 13"]
CLOSES = [41.2, 46.8, 44.1, 42.9, 38.6, 39.3, 42.0, 44.7]
OFFER_PRICE = 40.0
LOW_INDEX = 4  # the close below the offer price that the callout points at


def draw(path: Path) -> None:
    if len(DAYS) != len(CLOSES):
        raise ValueError("DAYS and CLOSES must have the same length")
    plt.rcParams.update({"font.family": "Arial", "font.size": 22})
    # 20 x 17 inches at 100 dpi = 2000 x 1700 px, the size of a typical newsletter chart image.
    fig = plt.figure(figsize=(20, 17), dpi=100, facecolor="white")
    ax = fig.add_axes((0.03, 0.17, 0.89, 0.66))

    x = list(range(len(CLOSES)))
    ax.plot(x, CLOSES, color="black", linewidth=5, solid_joinstyle="miter", zorder=3)
    ax.axhline(OFFER_PRICE, color="black", linewidth=3.5, linestyle=(0, (5, 4)), zorder=2)
    ax.axvline(3.5, color="#bdbdbd", linewidth=2, linestyle=(0, (4, 4)), zorder=1)
    ax.plot([LOW_INDEX], [CLOSES[LOW_INDEX]], "o", color="black", markersize=14, zorder=4)

    # Right-side price axis with light horizontal gridlines only, as news charts draw them.
    ax.set_ylim(36, 49)
    ticks = list(range(36, 50, 2))
    ax.set_yticks(ticks)
    ax.set_yticklabels([f"${t}" if t == ticks[-1] else str(t) for t in ticks], fontsize=36)
    ax.yaxis.tick_right()
    ax.grid(axis="y", color="#c8c8c8", linewidth=2)
    ax.set_xlim(-0.3, len(CLOSES) - 0.7)
    ax.set_xticks(x)
    ax.set_xticklabels(DAYS, fontsize=36)
    ax.tick_params(axis="both", length=12, width=2, colors="black", pad=12)
    ax.tick_params(axis="y", length=0)
    for side in ("top", "left", "right"):
        ax.spines[side].set_visible(False)
    ax.spines["bottom"].set_color("#9e9e9e")
    ax.spines["bottom"].set_linewidth(2)

    ax.text(0.05, OFFER_PRICE + 0.35, "Offer price", fontsize=36, va="bottom")
    ax.annotate("Closes below\noffer price", xy=(LOW_INDEX, CLOSES[LOW_INDEX] - 0.1),
                xytext=(LOW_INDEX - 0.15, CLOSES[LOW_INDEX] - 1.9), fontsize=36, ha="right", va="center",
                arrowprops={"arrowstyle": "-", "color": "black", "linewidth": 2,
                            "connectionstyle": "angle,angleA=0,angleB=90,rad=0"})

    fig.text(0.0, 0.955, "Nimbus Robotics Swings Around Its Offer Price", fontsize=50, fontweight="bold", va="top")
    fig.legend(handles=[Line2D([], [], color="black", linewidth=5)], labels=["Nimbus Robotics share price"],
               loc="upper left", bbox_to_anchor=(0.0, 0.905), frameon=False, fontsize=36, handlelength=1.2)
    fig.text(0.42, 0.105, "Mar. 2027", fontsize=34, color="#5f5f5f")
    fig.text(0.0, 0.05, "Source: sample data (fictional)", fontsize=34)

    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, facecolor="white")
    plt.close(fig)
    LOG.info("wrote %s", path)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    draw(OUTPUT)
