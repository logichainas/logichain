"""Build the English portal pages from the Norwegian ones.
Lines identical to a line in logichain-dashboard-demo.html are swapped for the matching line in
logichain-dashboard-demo-en.html (the two demos are line-aligned); the rest is translated with PHRASES.
Usage: python3 scripts/build_en.py <repo>   → macgregor-dashboard-en.html, kunde-dashboard-en.html"""
import sys, re, os
repo = sys.argv[1] if len(sys.argv) > 1 else "."
no = open(f"{repo}/logichain-dashboard-demo.html").read().split("\n")
en = open(f"{repo}/logichain-dashboard-demo-en.html").read().split("\n")
import difflib
LINE = {}
# align the two demos on their identical lines; translated blocks of equal length are paired line by line
for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, no, en, autojunk=False).get_opcodes():
    if tag != "replace": continue
    A, B = no[i1:i2], en[j1:j2]
    if len(A) != len(B):  # e.g. a blank line added on one side: pair the non-blank lines
        A, B = [x for x in A if x.strip()], [x for x in B if x.strip()]
    if len(A) == len(B):
        for a, b in zip(A, B):
            if a.strip(): LINE.setdefault(a, b)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from en_phrases import PHRASES
def translate(src):
    out = []
    for l in src.split("\n"):
        l = LINE.get(l, l)
        for a, b in PHRASES:
            if a in l: l = l.replace(a, b)
        out.append(l)
    return "\n".join(out)
if __name__ == "__main__":
    for name in ["macgregor-dashboard", "kunde-dashboard"]:
        s = translate(open(f"{repo}/{name}.html").read())
        open(f"{repo}/{name}-en.html", "w").write(s)
        print("ok", name)
