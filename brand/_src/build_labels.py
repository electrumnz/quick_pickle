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
    """A 500ml flint bottle carrying the label."""
    bx0, bx1 = 44.0, 316.0
    body_top, body_bot = 268.0, 872.0
    nx0, nx1 = 146.0, 214.0
    neck_top = 86.0
    shape = ("M%s %s L%s %s "
             "C%s %s %s %s %s %s "
             "L%s %s Q%s %s %s %s L%s %s Q%s %s %s %s L%s %s "
             "C%s %s %s %s %s %s Z") % (
        nx0, neck_top, nx0, 176,
        nx0, 214, bx0, 214, bx0, body_top,
        bx0, body_bot-14, bx0, body_bot, bx0+14, body_bot,
        bx1-14, body_bot, bx1, body_bot, bx1, body_bot-14,
        bx1, body_top,
        bx1, 214, nx1, 214, nx1, 176,
        )
    shape = shape.replace("L%s %s C" % (nx1, 176), "L%s %s C" % (nx1, 176))
    cid = "clip-%s" % s["no"]
    o = ['<defs><clipPath id="%s"><path d="%s"/></clipPath>'
         '<linearGradient id="gl-%s" x1="0" y1="0" x2="1" y2="0">'
         '<stop offset="0" stop-color="#FFFFFF" stop-opacity=".55"/>'
         '<stop offset=".18" stop-color="#FFFFFF" stop-opacity="0"/>'
         '<stop offset=".78" stop-color="#FFFFFF" stop-opacity="0"/>'
         '<stop offset="1" stop-color="#000000" stop-opacity=".14"/></linearGradient></defs>'
         % (cid, shape, s["no"])]
    # glass + brine
    o.append('<path d="%s" fill="#DBE0AE"/>' % shape)
    o.append('<g clip-path="url(#%s)"><rect x="0" y="0" width="%s" height="150" fill="#EDEFD8"/></g>' % (cid, BW))
    o.append('<path d="%s" fill="url(#gl-%s)"/>' % (shape, s["no"]))
    o.append('<path d="%s" fill="none" stroke="%s" stroke-width="1.6" stroke-opacity=".5"/>' % (shape, PEPPER))
    # closure
    o.append('<rect x="%s" y="%s" width="%s" height="60" rx="3" fill="%s"/>'
             % (_f(nx0-8), 30, _f(nx1-nx0+16), s["band"] if s["band"] != BONE else INK))
    o.append('<rect x="%s" y="%s" width="%s" height="10" fill="%s" fill-opacity=".2"/>'
             % (_f(nx0-8), 80, _f(nx1-nx0+16), INK))
    # label
    lw, lh = bx1-bx0-24.0, 470.0
    lx, ly = bx0+12.0, 350.0
    o.append('<g transform="translate(%s %s) scale(%s)">%s</g>'
             % (_f(lx), _f(ly), _f(lw/LW), "".join(label_body(s, LW, LW*lh/lw))))
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
