"""
HALF SOUR — letterform construction.
Every contour here is authored: a monolinear editorial grotesque, cap height 120,
stem 19, flat radial terminals, low crossbars. No font is traced.
"""
import math

CAP   = 120.0     # cap height
STEM  = 19.0      # stem weight
BAR   = 17.0      # horizontal bar weight (optically lighter than the stem)
OS    = 1.5       # overshoot on round forms

def _pt(cx, cy, r, deg):
    a = math.radians(deg)
    return (cx + r*math.cos(a), cy + r*math.sin(a))

def _f(v):
    return ("%.3f" % v).rstrip('0').rstrip('.')

def arc_cmds(cx, cy, r, a1, a2):
    """Arc as <=90deg A-segments. Angles in degrees, SVG space (y down, +x = 0deg)."""
    out = []
    n = max(1, int(math.ceil(abs(a2-a1)/90.0)))
    step = (a2-a1)/n
    sweep = 1 if step > 0 else 0
    for i in range(1, n+1):
        x, y = _pt(cx, cy, r, a1 + step*i)
        out.append("A%s %s 0 0 %d %s %s" % (_f(r), _f(r), sweep, _f(x), _f(y)))
    return " ".join(out)

def band(cx, cy, r, w, a1, a2):
    """Closed outline of a circular stroke band: centreline radius r, weight w,
    swept a1->a2, terminals cut radially (flat)."""
    ro, ri = r + w/2.0, r - w/2.0
    x0, y0 = _pt(cx, cy, ro, a1)
    x1, y1 = _pt(cx, cy, ri, a2)
    d  = "M%s %s " % (_f(x0), _f(y0))
    d += arc_cmds(cx, cy, ro, a1, a2) + " "
    d += "L%s %s " % (_f(x1), _f(y1))
    d += arc_cmds(cx, cy, ri, a2, a1) + " Z"
    return d

def rect(x, y, w, h):
    return "M%s %s H%s V%s H%s Z" % (_f(x), _f(y), _f(x+w), _f(y+h), _f(x))

def poly(pts):
    return "M" + " L".join("%s %s" % (_f(a), _f(b)) for a, b in pts) + " Z"

def stadium_half_left(cx, cy_top, cy_bot, r):
    """Left half of a stadium (vertical capsule): flat edge on the vertical axis x=cx."""
    d  = "M%s %s " % (_f(cx), _f(cy_top - r))
    d += arc_cmds(cx, cy_top, r, -90, -180) + " "
    d += "L%s %s " % (_f(cx - r), _f(cy_bot))
    d += arc_cmds(cx, cy_bot, r, 180, 90) + " Z"
    return d

# ---------------------------------------------------------------- glyphs
# Each returns (width, [path strings]).

def g_H():
    w = 100.0
    y = 50.5                              # crossbar sits above optical centre
    return w, [rect(0, 0, STEM, CAP), rect(w-STEM, 0, STEM, CAP), rect(STEM, y, w-2*STEM, BAR)]

def g_A():
    w   = 104.0
    dw  = 21.0                            # diagonals carry extra weight (they read thinner)
    ax0, ax1 = 41.5, 41.5+dw              # flat apex
    left  = poly([(ax0,0), (ax1,0), (STEM+2,CAP), (0,CAP)])
    right = poly([(ax0,0), (ax1,0), (w,CAP), (w-STEM-2,CAP)])
    bar   = rect(24, 78, 56, 16)          # deliberately low crossbar
    return w, [left, right, bar]

def g_L():
    w = 76.0
    return w, [rect(0, 0, STEM, CAP), rect(0, CAP-BAR, w, BAR)]

def g_F():
    w = 74.0
    return w, [rect(0, 0, STEM, CAP), rect(0, 0, w, BAR+1), rect(0, 50.5, 58, BAR-1)]

def g_S():
    R, w_ = 26.0, 71.0
    cx = 35.5
    c1y, c2y = 34.0, 86.0
    top = band(cx, c1y, R, STEM, 25, -270)     # right terminal, over the top, down the left
    bot = band(cx, c2y, R, STEM, -90, -335)    # tangent join, round the bottom, out right
    return w_, [top, bot]

def _O_geom():
    w  = 84.0
    ro = w/2.0                                  # outer radius of the caps
    r  = ro - STEM/2.0                          # centreline radius
    top_c = -OS + ro
    bot_c = CAP + OS - ro
    return w, ro, r, top_c, bot_c

def g_O(half=True):
    """The O. Condensed stadium ring; the counter's left half is filled — the
    'half sour' device. Also the brand mark, redrawn on a square em."""
    w, ro, r, top_c, bot_c = _O_geom()
    cx = w/2.0
    paths = [
        band(cx, top_c, r, STEM, 180, 360),
        band(cx, bot_c, r, STEM, 0, 180),
        rect(0, top_c, STEM, bot_c-top_c),
        rect(w-STEM, top_c, STEM, bot_c-top_c),
    ]
    if half:
        ri = ro - STEM                          # inner radius of the counter
        gap = 3.5
        paths.append(stadium_half_left(cx, top_c, bot_c, ri-gap))
    return w, paths

def g_U():
    w, ro, r, top_c, bot_c = _O_geom()
    cx = w/2.0
    return w, [
        rect(0, 0, STEM, bot_c),
        rect(w-STEM, 0, STEM, bot_c),
        band(cx, bot_c, r, STEM, 0, 180),
    ]

def g_R():
    w  = 79.0
    bc = (48.0, 31.0)                           # bowl centre
    ro = 31.0
    r  = ro - STEM/2.0
    return w, [
        rect(0, 0, STEM, CAP),
        rect(STEM, 0, bc[0]-STEM, STEM),
        rect(STEM, 2*bc[1]-STEM, bc[0]-STEM, STEM),
        band(bc[0], bc[1], r, STEM, -90, 90),
        poly([(33,58), (54,58), (w,CAP), (w-21,CAP)]),
    ]

GLYPHS = {'H':g_H, 'A':g_A, 'L':g_L, 'F':g_F, 'S':g_S, 'O':g_O, 'U':g_U, 'R':g_R}

# Fitted side bearings. Diagonal and round forms are tucked in; flat-to-flat is opened.
KERN = {('H','A'):-7, ('A','L'):-9, ('L','F'):0, ('S','O'):-2, ('O','U'):-2, ('U','R'):-2}
TRACK = 13.0
SPACE = 40.0

def set_paths(text, x0=0.0):
    """Lay out a string; returns (advance_width, [(glyph, x_offset, [paths])])."""
    out, x, prev = [], x0, None
    for ch in text:
        if ch == ' ':
            x += SPACE; prev = None; continue
        if prev is not None:
            x += TRACK + KERN.get((prev, ch), 0)
        w, ps = GLYPHS[ch]()
        out.append((ch, x, ps))
        x += w
        prev = ch
    return x - x0, out

def render(text, x0=0.0):
    total, items = set_paths(text, x0)
    frags = []
    for ch, x, ps in items:
        inner = "".join('<path d="%s"/>' % p for p in ps)
        frags.append('<g transform="translate(%s 0)" data-g="%s">%s</g>' % (_f(x), ch, inner))
    return total, "".join(frags)
