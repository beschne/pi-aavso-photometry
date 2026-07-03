#!/usr/bin/env python3
"""
tools/fetch-vsp.py

Download an AAVSO VSP comparison-star table and finder chart for a variable
star and save them as:

  <outdir>/<chartID>.csv   — comparison stars in the format the script expects
  <outdir>/<chartID>.png   — finder chart image

The chart ID printed and embedded in the filenames is the same value that
goes in the AAVSO CHART report field.

Usage:
  python3 tools/fetch-vsp.py [options]

Options:
  --star     NAME    Variable star name (default: T CrB)
  --fov      ARCMIN  Field of view in arcminutes (default: 450 = 7.5°)
  --maglimit MAG     Faint magnitude limit (default: 14.5)
  --outdir   DIR     Output directory (default: charts)

No external dependencies — stdlib only (Python 3.6+).
"""

import argparse
import csv
import html as html_mod
import math
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

PHOTOMETRY_URL = "https://apps.aavso.org/vsp/photometry/"
CHART_PNG_URL  = "https://apps.aavso.org/vsp/chart/{chart_id}.png"
USER_AGENT     = "fetch-vsp/1.0 (github.com/BeSchne/pi-aavso-photometry)"


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=90) as resp:
        return resp.read()


def parse_mag_error(text):
    """'9.809 (0.023)4' -> (9.809, 0.023).  Returns (None, None) if blank."""
    m = re.match(r"\s*([-\d.]+)\s*\(([\d.]+)\)", text)
    if not m:
        return None, None
    return float(m.group(1)), float(m.group(2))


def parse_coord(text):
    """'15:58:28.42 [239.857 deg]' -> '15:58:28.42'.  Drops leading + for positive values."""
    m = re.match(r"\s*([+\-]?\d+:\d+:\d+\.?\d*)", text)
    if not m:
        return text.strip()
    return m.group(1).lstrip("+")


def strip_tags(s):
    return re.sub(r"<[^>]+>", "", s)


def parse_photometry_html(html):
    """
    Parse the VSP photometry table HTML page.

    Returns:
        chart_id (str)  — e.g. 'X42615CFD'
        stars (list)    — one dict per star with keys:
                          auid, ra, dec, label,
                          mag_v, err_v, mag_bv, err_bv, comments
    """
    # Chart ID
    m = re.search(r"Report this sequence as\s*<strong>(\S+?)</strong>", html)
    if not m:
        sys.exit(
            "ERROR: chart ID not found in VSP response.\n"
            "Check the star name and that the URL is reachable."
        )
    chart_id = m.group(1).rstrip(".")

    # Data table — first <table class='table'>
    table_m = re.search(
        r"<table[^>]*class=['\"]table['\"][^>]*>(.*?)</table>", html, re.DOTALL
    )
    if not table_m:
        sys.exit("ERROR: data table not found in VSP response.")

    stars = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", table_m.group(1), re.DOTALL):
        tds = re.findall(r"<td[^>]*>(.*?)</td>", tr, re.DOTALL)
        if len(tds) < 6:
            continue
        cells = [html_mod.unescape(strip_tags(td)).strip() for td in tds]

        auid, ra_raw, dec_raw, label = cells[0], cells[1], cells[2], cells[3]
        mag_v,  err_v  = parse_mag_error(cells[4])
        mag_bv, err_bv = parse_mag_error(cells[5])
        comments = cells[6] if len(cells) > 6 else ""

        if mag_v is None:
            continue

        stars.append(dict(
            auid=auid,
            ra=parse_coord(ra_raw),
            dec=parse_coord(dec_raw),
            label=label,
            mag_v=mag_v,   err_v=err_v,
            mag_bv=mag_bv, err_bv=err_bv,
            comments=comments,
        ))

    return chart_id, stars


def write_csv(path, stars):
    """
    Write one row per star per band.
    V comes directly from the table; B is derived as V + (B-V).
    """
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["AUID", "RA", "Dec", "Label", "Band", "Mag", "Error", "Comments"])
        for s in stars:
            w.writerow([s["auid"], s["ra"], s["dec"], s["label"],
                        "V", s["mag_v"], s["err_v"], s["comments"]])
            if s["mag_bv"] is not None:
                mag_b = round(s["mag_v"] + s["mag_bv"], 4)
                err_b = (round(math.sqrt(s["err_v"] ** 2 + s["err_bv"] ** 2), 4)
                         if s["err_bv"] is not None else s["err_v"])
                w.writerow([s["auid"], s["ra"], s["dec"], s["label"],
                            "B", mag_b, err_b, s["comments"]])


def main():
    ap = argparse.ArgumentParser(
        description="Fetch AAVSO VSP comparison-star CSV and chart PNG",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    ap.add_argument("--star",     default="T CrB", help="Variable star name")
    ap.add_argument("--fov",      type=float, default=450,
                    help="Field of view in arcminutes (450 = 7.5 deg)")
    ap.add_argument("--maglimit", type=float, default=14.5,
                    help="Faint magnitude limit")
    ap.add_argument("--outdir",   default="charts",
                    help="Output directory")
    args = ap.parse_args()

    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)

    # Photometry table
    params   = urllib.parse.urlencode({"star": args.star, "fov": args.fov, "maglimit": args.maglimit})
    phot_url = f"{PHOTOMETRY_URL}?{params}"
    print(f"Fetching: {phot_url}")
    raw  = fetch(phot_url)
    html = raw.decode("utf-8", errors="replace")

    chart_id, stars = parse_photometry_html(html)
    print(f"Chart ID : {chart_id}")
    print(f"Stars    : {len(stars)}")

    csv_path = outdir / f"{chart_id}.csv"
    write_csv(csv_path, stars)
    print(f"CSV      : {csv_path}")

    # Chart PNG
    png_url  = CHART_PNG_URL.format(chart_id=chart_id)
    png_path = outdir / f"{chart_id}.png"
    print(f"Fetching: {png_url}")
    png_data = fetch(png_url)
    if png_data[:4] != b"\x89PNG":
        print("WARNING: response is not a PNG — chart image not saved", file=sys.stderr)
    else:
        png_path.write_bytes(png_data)
        print(f"PNG      : {png_path}  ({len(png_data):,} bytes)")


if __name__ == "__main__":
    main()
