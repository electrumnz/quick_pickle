import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from letterforms import *
from letterforms import _f, _pt

OUT   = "/home/user/pickled_jews/brand/assets"
INK   = "#0F1511"
BONE  = "#F2EFE3"
BRINE = "#C8D93B"

def svg(vb_w, vb_h, title, body, bg=None, w=None, h=None):
    s  = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %s %s" width="%s" height="%s" '
          'role="img" aria-label="%s">' % (_f(vb_w), _f(vb_h), _f(w or vb_w), _f(h or vb_h), title))
    s += '<title>%s</title>' % title
    if bg:
        s += '<rect width="%s" height="%s" fill="%s"/>' % (_f(vb_w), _f(vb_h), bg)
    return s + body + '</svg>'

# --------------------------------------------------------------- the mark
def mark_body(size=120.0, ro=54.0, stem=STEM, gap=3.5, half=True):
    c  = size/2.0
    r  = ro - stem/2.0
    ri = ro - stem
    parts = [band(c, c, r, stem, 0, 180), band(c, c, r, stem, 180, 360)]
    if half:
        rr = ri - gap
        parts.append("M%s %s " % (_f(c), _f(c-rr)) + arc_cmds(c, c, rr, -90, -270) + " Z")
    return "".join('<path d="%s"/>' % p for p in parts)

# --------------------------------------------------------------- files
def build():
    files = {}

    # wordmark -------------------------------------------------------
    total, frag = render("HALF SOUR")
    pad = 8.0
    W, H = total + pad*2, CAP + OS*2 + pad*2
    body = '<g transform="translate(%s %s)" fill="%%s">%s</g>' % (_f(pad), _f(pad+OS), frag)
    files["wordmark.svg"]          = svg(W, H, "HALF SOUR", body % INK)
    files["wordmark-reversed.svg"] = svg(W, H, "HALF SOUR", body % BONE, bg=INK)
    files["wordmark-brine.svg"]    = svg(W, H, "HALF SOUR", body % INK, bg=BRINE)

    # the mark -------------------------------------------------------
    files["mark.svg"]          = svg(120, 120, "HALF SOUR mark", '<g fill="%s">%s</g>' % (INK,  mark_body()))
    files["mark-reversed.svg"] = svg(120, 120, "HALF SOUR mark", '<g fill="%s">%s</g>' % (BONE, mark_body()), bg=INK)
    files["mark-brine.svg"]    = svg(120, 120, "HALF SOUR mark", '<g fill="%s">%s</g>' % (INK,  mark_body()), bg=BRINE)

    # favicon: a separate 16px-safe cut — heavier ring, larger fill, no hairline
    fav = '<g fill="%s">%s</g>' % (INK, mark_body(size=32.0, ro=15.0, stem=5.6, gap=1.1))
    files["favicon.svg"] = svg(32, 32, "HALF SOUR", fav, bg=BRINE)

    # social avatar --------------------------------------------------
    av = '<g transform="translate(96 96) scale(3.2)" fill="%s">%s</g>' % (INK, mark_body())
    files["avatar.svg"] = svg(512, 512, "HALF SOUR", av, bg=BRINE)

    # descriptor (outlined — no live text anywhere in the asset set) --
    d_cap, d_track = 24.0, 56.0
    d_total, d_frag = render_tracked("PICKLE BRINE", d_track)
    d_scale = d_cap/CAP
    d_w = d_total*d_scale

    # stacked lockup -------------------------------------------------
    pad = 40.0
    Wl = max(total, 120.0) + pad*2
    y_mark = pad
    y_wm   = y_mark + 120.0 + 46.0
    y_rule = y_wm + CAP + 30.0
    y_desc = y_rule + 30.0
    Hl = y_desc + d_cap + pad
    b  = '<g fill="%s">' % INK
    b += '<g transform="translate(%s %s)">%s</g>' % (_f((Wl-120.0)/2.0), _f(y_mark), mark_body())
    b += '<g transform="translate(%s %s)">%s</g>' % (_f((Wl-total)/2.0), _f(y_wm), frag)
    b += '<path d="%s"/>' % rect((Wl-total)/2.0, y_rule, total, 3)
    b += '<g transform="translate(%s %s) scale(%s)">%s</g>' % (_f((Wl-d_w)/2.0), _f(y_desc), _f(d_scale), d_frag)
    b += '</g>'
    files["lockup-stacked.svg"] = svg(Wl, Hl, "HALF SOUR — Pickle Brine", b)

    # horizontal lockup ----------------------------------------------
    pad, gapx, ms = 26.0, 40.0, 1.06
    mh = 120.0*ms
    Wh = pad + mh + gapx + total + pad
    Hh = pad + max(mh, CAP) + pad
    b  = '<g fill="%s">' % INK
    b += '<g transform="translate(%s %s) scale(%s)">%s</g>' % (_f(pad), _f((Hh-mh)/2.0), _f(ms), mark_body())
    b += '<g transform="translate(%s %s)">%s</g>' % (_f(pad+mh+gapx), _f((Hh-CAP)/2.0), frag)
    b += '</g>'
    files["lockup-horizontal.svg"] = svg(Wh, Hh, "HALF SOUR — Pickle Brine", b)

    # masthead lockup (wordmark + rule + descriptor, no mark) ---------
    pad = 10.0
    y_rule = pad + CAP + 26.0
    y_desc = y_rule + 26.0
    Wm = total + pad*2
    Hm = y_desc + d_cap + pad
    b  = '<g fill="%s">' % INK
    b += '<g transform="translate(%s %s)">%s</g>' % (_f(pad), _f(pad), frag)
    b += '<path d="%s"/>' % rect(pad, y_rule, total, 3)
    b += '<g transform="translate(%s %s) scale(%s)">%s</g>' % (_f(pad), _f(y_desc), _f(d_scale), d_frag)
    b += '</g>'
    files["lockup-masthead.svg"] = svg(Wm, Hm, "HALF SOUR — Pickle Brine", b)

    for name, content in files.items():
        open(os.path.join(OUT, name), "w").write(content)
    return files

if __name__ == "__main__":
    fs = build()
    for n in sorted(fs):
        print("  %-26s %6d bytes" % (n, len(fs[n])))
