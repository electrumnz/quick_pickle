import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from letterforms import *
from letterforms import _f, _pt

OUT = "/home/user/pickled_jews/brand/assets"
INK   = "#0F1511"
BONE  = "#F2EFE3"
BRINE = "#C8D93B"

HEAD = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="%s" width="%s" height="%s" role="img" aria-label="%s">'

# ---------------------------------------------------------------- 1. wordmark
def wordmark(path, fill=INK, bg=None, name="wordmark"):
    total, frag = render("HALF SOUR")
    pad = 8
    vb_w = total + pad*2
    vb_h = CAP + OS*2 + pad*2
    s  = HEAD % ("0 0 %s %s" % (_f(vb_w), _f(vb_h)), _f(vb_w), _f(vb_h), "HALF SOUR")
    s += '<title>HALF SOUR wordmark</title>'
    if bg: s += '<rect width="%s" height="%s" fill="%s"/>' % (_f(vb_w), _f(vb_h), bg)
    s += '<g transform="translate(%s %s)" fill="%s">%s</g>' % (_f(pad), _f(pad+OS), fill, frag)
    s += '</svg>'
    open(path, "w").write(s)
    return vb_w, vb_h

# ---------------------------------------------------------------- 2. the mark
def mark(path, fill=INK, bg=None, ring_only=False):
    """'The Half' — the O of the wordmark redrawn on a square em."""
    S_ = 120.0; c = S_/2.0
    ro = 54.0; r = ro - STEM/2.0; ri = ro - STEM
    d_ring = band(c, c, r, STEM, 0, 360)
    parts = [band(c, c, r, STEM, 0, 180), band(c, c, r, STEM, 180, 360)]
    body = "".join('<path d="%s"/>' % p for p in parts)
    if not ring_only:
        gap = 3.5
        rr = ri - gap
        half  = "M%s %s " % (_f(c), _f(c-rr))
        half += arc_cmds(c, c, rr, -90, -270) + " Z"
        body += '<path d="%s"/>' % half
    s  = HEAD % ("0 0 120 120", "120", "120", "HALF SOUR mark")
    s += '<title>HALF SOUR — the Half</title>'
    if bg: s += '<rect width="120" height="120" fill="%s"/>' % bg
    s += '<g fill="%s">%s</g></svg>' % (fill, body)
    open(path, "w").write(s)

def mark_favicon(path):
    """16px-safe cut: heavier ring, larger fill, no hairline (it would vanish)."""
    S_ = 32.0; c = 16.0
    ro = 15.0; stem = 5.6; r = ro - stem/2.0; ri = ro - stem
    parts = [band(c, c, r, stem, 0, 180), band(c, c, r, stem, 180, 360)]
    rr = ri - 1.1
    half  = "M%s %s " % (_f(c), _f(c-rr)) + arc_cmds(c, c, rr, -90, -270) + " Z"
    body = "".join('<path d="%s"/>' % p for p in parts) + '<path d="%s"/>' % half
    s  = HEAD % ("0 0 32 32", "32", "32", "HALF SOUR")
    s += '<rect width="32" height="32" fill="%s"/>' % BRINE
    s += '<g fill="%s">%s</g></svg>' % (INK, body)
    open(path, "w").write(s)

# ---------------------------------------------------------------- 3. lockups
def lockup_stacked(path):
    total, frag = render("HALF SOUR")
    S_ = 120.0; c = S_/2.0; ro = 54.0; r = ro - STEM/2.0; ri = ro - STEM
    mparts = [band(c, c, r, STEM, 0, 180), band(c, c, r, STEM, 180, 360)]
    rr = ri - 3.5
    mparts.append("M%s %s " % (_f(c), _f(c-rr)) + arc_cmds(c, c, rr, -90, -270) + " Z")
    mbody = "".join('<path d="%s"/>' % p for p in mparts)

    pad = 40.0
    wm_scale = 1.0
    W = max(total, 120.0) + pad*2
    mark_x = (W - 120.0)/2.0
    wm_x   = (W - total)/2.0
    y_mark = pad
    y_wm   = y_mark + 120.0 + 44.0
    y_rule = y_wm + CAP + 34.0
    H = y_rule + 30.0 + pad

    s  = HEAD % ("0 0 %s %s" % (_f(W), _f(H)), _f(W), _f(H), "HALF SOUR")
    s += '<title>HALF SOUR — stacked lockup</title>'
    s += '<g fill="%s">' % INK
    s += '<g transform="translate(%s %s)">%s</g>' % (_f(mark_x), _f(y_mark), mbody)
    s += '<g transform="translate(%s %s)">%s</g>' % (_f(wm_x), _f(y_wm), frag)
    s += '</g>'
    s += '<rect x="%s" y="%s" width="%s" height="2" fill="%s"/>' % (_f(wm_x), _f(y_rule), _f(total), INK)
    s += ('<text x="%s" y="%s" font-family="ui-monospace,SFMono-Regular,Menlo,monospace" '
          'font-size="15" letter-spacing="5.2" fill="%s" text-anchor="middle">PICKLE BRINE</text>'
          % (_f(W/2.0), _f(y_rule+26), INK))
    s += '</svg>'
    open(path, "w").write(s)

def lockup_horizontal(path):
    total, frag = render("HALF SOUR")
    S_ = 120.0; c = S_/2.0; ro = 54.0; r = ro - STEM/2.0; ri = ro - STEM
    mparts = [band(c, c, r, STEM, 0, 180), band(c, c, r, STEM, 180, 360)]
    rr = ri - 3.5
    mparts.append("M%s %s " % (_f(c), _f(c-rr)) + arc_cmds(c, c, rr, -90, -270) + " Z")
    mbody = "".join('<path d="%s"/>' % p for p in mparts)

    pad  = 26.0
    gapx = 40.0
    ms   = 1.06                       # mark set marginally taller than the caps
    mh   = 120.0*ms
    W = pad + mh + gapx + total + pad
    H = pad + max(mh, CAP) + pad
    y_mark = (H - mh)/2.0
    y_wm   = (H - CAP)/2.0

    s  = HEAD % ("0 0 %s %s" % (_f(W), _f(H)), _f(W), _f(H), "HALF SOUR")
    s += '<title>HALF SOUR — horizontal lockup</title>'
    s += '<g fill="%s">' % INK
    s += '<g transform="translate(%s %s) scale(%s)">%s</g>' % (_f(pad), _f(y_mark), _f(ms), mbody)
    s += '<g transform="translate(%s %s)">%s</g>' % (_f(pad+mh+gapx), _f(y_wm), frag)
    s += '</g></svg>'
    open(path, "w").write(s)

if __name__ == "__main__":
    w, h = wordmark(OUT + "/wordmark.svg")
    wordmark(OUT + "/wordmark-reversed.svg", fill=BONE, bg=INK)
    mark(OUT + "/mark.svg")
    mark(OUT + "/mark-reversed.svg", fill=BONE, bg=INK)
    mark_favicon(OUT + "/favicon.svg")
    lockup_stacked(OUT + "/lockup-stacked.svg")
    lockup_horizontal(OUT + "/lockup-horizontal.svg")
    print("wordmark viewBox", _f(w), _f(h))
    for f in sorted(os.listdir(OUT)):
        print(" ", f, os.path.getsize(os.path.join(OUT, f)))
