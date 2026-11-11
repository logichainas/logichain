# Build scripts (not served on the website)
After changing `macgregor-dashboard.html` or the demo dashboards, run from the repo root:

    python3 scripts/build_kunde.py .   # kunde-dashboard.html from macgregor-dashboard.html
    python3 scripts/build_en.py .      # macgregor-dashboard-en.html + kunde-dashboard-en.html

`build_en.py` translates with the line pairs of logichain-dashboard-demo(.html/-en.html) plus `en_phrases.py`.
