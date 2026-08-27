import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from letterforms import *
from letterforms import _f

OUT    = "/home/user/pickled_jews/brand/assets"
INK    = "#0F1511"
BONE   = "#F2EFE3"
PAPER  = "#FBFAF4"
BRINE  = "#C8D93B"
DILL   = "#18402F"
CHILLI = "#A83521"
RIND   = "#D6D2C0"
PEPPER = "#4E554A"

def place(text, x, y, cap, track=0.0, anchor="start", fill=None):
    """Set outlined display type. y is the cap line. track is in em."""
    sc = cap/CAP
    total, frag = render_tracked(text, track*CAP)
    w = total*sc
    if anchor == "middle": x -= w/2.0
    elif anchor == "end":  x -= w
    g = '<g transform="translate(%s %s) scale(%s)"%s>%s</g>' % (
        _f(x), _f(y), _f(sc), (' fill="%s"' % fill) if fill else "", frag)
    return g, w

def rule(x, y, w, h=1.6, fill=INK):
    return '<rect x="%s" y="%s" width="%s" height="%s" fill="%s"/>' % (_f(x), _f(y), _f(w), _f(h), fill)

def half_mark(x, y, size, fill=INK):
    ro, stem, gap = 54.0, 21.0, 3.5
    c = 60.0
    r, ri = ro-stem/2.0, ro-stem
    parts = [band(c, c, r, stem, 0, 180), band(c, c, r, stem, 180, 360),
             "M%s %s " % (_f(c), _f(c-(ri-gap))) + arc_cmds(c, c, ri-gap, -90, -270) + " Z"]
    body = "".join('<path d="%s"/>' % p for p in parts)
    return '<g transform="translate(%s %s) scale(%s)" fill="%s">%s</g>' % (
        _f(x), _f(y), _f(size/120.0), fill, body)

# ------------------------------------------------------------------ label art
LW, LH = 460.0, 700.0        # flat label artwork, 460 x 700

SKUS = [
    dict(no="01", name="HOUSE", sub="DILL AND PEPPERCORN BRINE",
         ing="CUCUMBER BRINE / DILL / GARLIC / BLACK PEPPERCORN / CORIANDER SEED / SEA SALT",
         band=BRINE, bandtype=INK, ground=BONE, ink=INK, accent=BRINE),
    dict(no="02", name="DIRTY", sub="MARTINI BRINE",
         ing="CUCUMBER BRINE / DILL / SEA SALT / CORIANDER SEED / WHITE PEPPERCORN / BAY",
         band=INK, bandtype=BRINE, ground=BONE, ink=INK, accent=INK),
    dict(no="03", name="SMOKE", sub="SMOKED CHILLI BRINE",
         ing="CUCUMBER BRINE / SMOKED CHILLI / DILL / GARLIC / BAY / SEA SALT",
         band=CHILLI, bandtype=BONE, ground=BONE, ink=INK, accent=CHILLI),
]

def label_body(s, w=LW, h=LH):
    ink, ground = s["ink"], s["ground"]
    m  = 34.0
    o  = ['<rect width="%s" height="%s" fill="%s"/>' % (_f(w), _f(h), ground)]
    o.append(rule(m, m, w-2*m, 1.6, ink))

    g, ww = place("HALF SOUR", w/2.0, m+34, 44, 0.0, "middle", ink); o.append(g)
    o.append(rule(m, m+34+44+22, w-2*m, 1.6, ink))
    g, _ = place("PICKLE BRINE", w/2.0, m+34+44+38, 11, 0.44, "middle", ink); o.append(g)

    # the seal
    o.append(half_mark(w/2.0-40, 232, 80, s["accent"] if s["accent"] != BONE else ink))

    # product number, hairline-boxed
    g, nw = place("NO " + s["no"], w/2.0, 360, 13, 0.40, "middle", ink); o.append(g)
    o.append('<rect x="%s" y="%s" width="%s" height="%s" fill="none" stroke="%s" stroke-width="1.4"/>'
             % (_f(w/2.0-nw/2.0-14), _f(360-13), _f(nw+28), _f(13+26), ink))

    # name
    g, _ = place(s["name"], w/2.0, 424, 62, 0.02, "middle", ink); o.append(g)
    g, _ = place(s["sub"], w/2.0, 512, 12, 0.36, "middle", ink); o.append(g)

    # ingredient run, wrapped by hand
    words = s["ing"].split(" / ")
    lines, cur = [], []
    for wd in words:
        cur.append(wd)
        if len(" / ".join(cur)) > 34:
            lines.append(" / ".join(cur)); cur = []
    if cur: lines.append(" / ".join(cur))
    y = 566
    for ln in lines:
        g, _ = place(ln, w/2.0, y, 8.4, 0.22, "middle", PEPPER if ground == BONE else ink)
        o.append(g); y += 17

    # foot band
    bh = 62.0
    o.append('<rect x="0" y="%s" width="%s" height="%s" fill="%s"/>' % (_f(h-bh), _f(w), _f(bh), s["band"]))
    g, _ = place("500 ML", m, h-bh+24, 15, 0.30, "start", s["bandtype"]); o.append(g)
    g, _ = place("MADE IN AOTEAROA NEW ZEALAND", w-m, h-bh+24, 10, 0.30, "end", s["bandtype"]); o.append(g)
    return o

def svg(w, h, title, body, width=None):
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %s %s" width="%s" height="%s" '
            'role="img" aria-label="%s"><title>%s</title>%s</svg>'
            % (_f(w), _f(h), _f(width or w), _f((width or w)*h/w), title, title, "".join(body)))

# ------------------------------------------------------------------ bottle
BW, BH = 360.0, 900.0

def bottle(s, x=0.0):
    """A 500 ml flint bottle carrying the wrap label."""
    nx0, nx1   = 150.0, 210.0
    neck_top   = 96.0
    neck_bot   = 196.0
    bx0, bx1   = 62.0, 298.0
    body_top   = 306.0
    body_bot   = 862.0
    rr         = 16.0
    shape = (
        "M{nx0} {nt} L{nx0} {nb} "
        "C{nx0} {c1} {bx0} {c2} {bx0} {bt} "
        "L{bx0} {bb1} Q{bx0} {bb} {bx0r} {bb} "
        "L{bx1r} {bb} Q{bx1} {bb} {bx1} {bb1} "
        "L{bx1} {bt} "
        "C{bx1} {c2} {nx1} {c1} {nx1} {nb} "
        "L{nx1} {nt} Z"
    ).format(nx0=nx0, nx1=nx1, nt=neck_top, nb=neck_bot,
             c1=neck_bot+52, c2=body_top-58, bx0=bx0, bx1=bx1,
             bt=body_top, bb=body_bot, bb1=body_bot-rr,
             bx0r=bx0+rr, bx1r=bx1-rr)
    uid = s["no"]
    o = ['<defs>'
         '<clipPath id="clip-%s"><path d="%s"/></clipPath>'
         '<linearGradient id="gl-%s" x1="0" y1="0" x2="1" y2="0">'
         '<stop offset="0" stop-color="#0F1511" stop-opacity=".18"/>'
         '<stop offset=".10" stop-color="#FFFFFF" stop-opacity=".42"/>'
         '<stop offset=".30" stop-color="#FFFFFF" stop-opacity="0"/>'
         '<stop offset=".74" stop-color="#FFFFFF" stop-opacity="0"/>'
         '<stop offset=".92" stop-color="#0F1511" stop-opacity=".13"/>'
         '<stop offset="1" stop-color="#0F1511" stop-opacity=".26"/></linearGradient>'
         '<linearGradient id="br-%s" x1="0" y1="0" x2="0" y2="1">'
         '<stop offset="0" stop-color="#E2E7B4"/><stop offset="1" stop-color="#CBD394"/>'
         '</linearGradient></defs>' % (uid, shape, uid, uid)]
    o.append('<ellipse cx="180" cy="874" rx="118" ry="13" fill="#0F1511" fill-opacity=".22"/>')
    o.append('<path d="%s" fill="#EFF1E2"/>' % shape)
    o.append('<g clip-path="url(#clip-%s)">'
             '<rect x="0" y="168" width="%s" height="%s" fill="url(#br-%s)"/>'
             '<rect x="0" y="168" width="%s" height="7" fill="#0F1511" fill-opacity=".10"/>'
             '</g>' % (uid, _f(BW), _f(BH), uid, _f(BW)))
    o.append('<path d="%s" fill="url(#gl-%s)"/>' % (shape, uid))
    o.append('<path d="%s" fill="none" stroke="#4E554A" stroke-width="1.4" stroke-opacity=".45"/>' % shape)
    # closure
    capc = s["band"]
    o.append('<rect x="%s" y="44" width="%s" height="70" rx="3" fill="%s"/>'
             % (_f(nx0-9), _f(nx1-nx0+18), capc))
    o.append('<rect x="%s" y="44" width="6" height="70" fill="#FFFFFF" fill-opacity=".22"/>' % _f(nx0-9))
    o.append('<rect x="%s" y="%s" width="6" height="70" fill="#0F1511" fill-opacity=".18"/>' % (_f(nx1+3), 44))
    o.append('<rect x="%s" y="112" width="%s" height="9" fill="#0F1511" fill-opacity=".16"/>'
             % (_f(nx0-3), _f(nx1-nx0+6)))
    # wrap label, aspect-locked to the flat artwork
    lw = (bx1 - bx0) - 8.0
    lh = lw * LH / LW
    lx, ly = bx0 + 4.0, 396.0
    o.append('<g transform="translate(%s %s) scale(%s)">%s</g>'
             % (_f(lx), _f(ly), _f(lw/LW), "".join(label_body(s, LW, LH))))
    o.append('<g clip-path="url(#clip-%s)"><rect x="%s" y="%s" width="%s" height="%s" '
             'fill="url(#gl-%s)" opacity=".55"/></g>' % (uid, _f(lx), _f(ly), _f(lw), _f(lh), uid))
    return '<g transform="translate(%s 0)">%s</g>' % (_f(x), "".join(o))

if __name__ == "__main__":
    files = {}
    for s in SKUS:
        files["label-%s-%s.svg" % (s["no"], s["name"].lower())] = svg(
            LW, LH, "HALF SOUR No %s %s — label artwork" % (s["no"], s["name"]), label_body(s))
    gap = 20.0
    body = ['<rect width="%s" height="%s" fill="none"/>' % (_f(3*BW+2*gap), _f(BH))]
    for i, s in enumerate(SKUS):
        body.append(bottle(s, i*(BW+gap)))
    files["bottles.svg"] = svg(3*BW+2*gap, BH, "HALF SOUR launch line — three 500ml bottles", body)
    for n, c in files.items():
        open(os.path.join(OUT, n), "w").write(c)
        print("  %-30s %6d" % (n, len(c)))
