"""
HALF SOUR — letterform construction.
Every contour here is authored: a monolinear editorial grotesque, cap height 120,
stem 19, flat radial terminals, low crossbars. No font is traced.
"""
import math

CAP   = 120.0     # cap height
STEM  = 21.0      # stem weight
BAR   = 19.0      # horizontal bar weight (optically lighter than the stem)
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
    top = band(cx, c1y, R, STEM, -52, -270)    # terminal at 2 o'clock, over the top, down the left
    bot = band(cx, c2y, R, STEM, -90, 128)     # tangent join, round the bottom, out to 8 o'clock
    return w_, [top, bot]

def _O_geom():
    w  = 84.0
    ro = w/2.0                                  # outer radius of the caps
    r  = ro - STEM/2.0                          # centreline radius
    top_c = -OS + ro
    bot_c = CAP + OS - ro
    return w, ro, r, top_c, bot_c

def g_O(half=False):
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


def g_P():
    w  = 79.0
    bc = (48.0, 31.0)
    ro = 31.0
    r  = ro - STEM/2.0
    return w, [
        rect(0, 0, STEM, CAP),
        rect(STEM, 0, bc[0]-STEM, STEM),
        rect(STEM, 2*bc[1]-STEM, bc[0]-STEM, STEM),
        band(bc[0], bc[1], r, STEM, -90, 90),
    ]

def g_I():
    return STEM, [rect(0, 0, STEM, CAP)]

def g_C():
    w, ro, r, top_c, bot_c = _O_geom()
    cx = w/2.0
    return w, [
        rect(0, top_c, STEM, bot_c-top_c),
        band(cx, top_c, r, STEM, 180, 333),
        band(cx, bot_c, r, STEM, 27, 180),
    ]

def g_K():
    w = 92.0
    return w, [
        rect(0, 0, STEM, CAP),
        poly([(68,0), (w,0), (STEM,72), (STEM,44)]),
        poly([(STEM,65), (STEM,93), (w,CAP), (68,CAP)]),
    ]

def g_E():
    w = 74.0
    return w, [
        rect(0, 0, STEM, CAP),
        rect(0, 0, w, BAR),
        rect(0, 50.5, 58, BAR-2),
        rect(0, CAP-BAR, w, BAR),
    ]

def g_B():
    w = 74.0
    r1 = 29.0 - STEM/2.0
    r2 = 30.0 - STEM/2.0
    return w, [
        rect(0, 0, STEM, CAP),
        rect(STEM, 0, 44.0-STEM, STEM),
        band(44.0, 29.0, r1, STEM, -90, 90),
        rect(STEM, 49.5, 44.0-STEM, STEM),
        band(44.0, 90.0, r2, STEM, -90, 90),
        rect(STEM, CAP-STEM, 44.0-STEM, STEM),
    ]

def g_N():
    w = 100.0
    return w, [
        rect(0, 0, STEM, CAP),
        rect(w-STEM, 0, STEM, CAP),
        poly([(0,0), (STEM,0), (w,CAP), (w-STEM,CAP)]),
    ]

def g_dot():
    """Interpunct used between descriptor phrases."""
    return 21.0, [band(10.5, 60.0, 5.25, 10.5, 0, 180), band(10.5, 60.0, 5.25, 10.5, 180, 360)]

GLYPHS = {'H':g_H, 'A':g_A, 'L':g_L, 'F':g_F, 'S':g_S, 'O':g_O, 'U':g_U, 'R':g_R,
          'P':g_P, 'I':g_I, 'C':g_C, 'K':g_K, 'E':g_E, 'B':g_B, 'N':g_N, '.':g_dot}

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


def set_paths_tracked(text, track):
    """Layout with an explicit tracking value (used for the outlined descriptor)."""
    out, x, prev = [], 0.0, None
    for ch in text:
        if ch == ' ':
            x += track + SPACE*0.9; prev = None; continue
        if prev is not None:
            x += track
        w, ps = GLYPHS[ch]()
        out.append((ch, x, ps))
        x += w
        prev = ch
    return x, out

def render_tracked(text, track):
    total, items = set_paths_tracked(text, track)
    frags = []
    for ch, x, ps in items:
        inner = "".join('<path d="%s"/>' % p for p in ps)
        frags.append('<g transform="translate(%s 0)" data-g="%s">%s</g>' % (_f(x), ch, inner))
    return total, "".join(frags)

# ---------------------------------------------------------------- the rest of the alphabet
def g_D():
    w  = 88.0; R = 40.0; r = R - STEM/2.0
    tc, bc = R, CAP - R
    return w, [
        rect(0, 0, STEM, CAP),
        rect(STEM, 0, w-R-STEM, STEM),
        rect(STEM, CAP-STEM, w-R-STEM, STEM),
        rect(w-STEM, tc, STEM, bc-tc),
        band(w-R, tc, r, STEM, 270, 360),
        band(w-R, bc, r, STEM, 0, 90),
    ]

def g_G():
    w, ro, r, tc, bc = _O_geom()
    cx = w/2.0
    return w, [
        rect(0, tc, STEM, bc-tc),
        band(cx, tc, r, STEM, 180, 333),
        band(cx, bc, r, STEM, 27, 180),
        rect(46, 58, w-46, STEM),
        rect(w-STEM, 58, STEM, 42),
    ]

def g_J():
    w = 62.0; R = 31.0; r = R - STEM/2.0
    bc = CAP + OS - R
    return w, [rect(w-STEM, 0, STEM, bc), band(w-R, bc, r, STEM, 0, 180)]

def g_M():
    w = 118.0; v = w/2.0
    return w, [
        rect(0, 0, STEM, CAP),
        rect(w-STEM, 0, STEM, CAP),
        poly([(0,0), (STEM,0), (v+STEM/2,CAP), (v-STEM/2,CAP)]),
        poly([(w-STEM,0), (w,0), (v+STEM/2,CAP), (v-STEM/2,CAP)]),
    ]

def g_Q():
    w, ps = g_O()
    return w, ps + [poly([(44,84), (60,73), (94,121), (78,132)])]

def g_T():
    w = 86.0
    return w, [rect(0, 0, w, STEM), rect((w-STEM)/2.0, 0, STEM, CAP)]

def g_V():
    w = 100.0; v = w/2.0
    return w, [
        poly([(0,0), (STEM,0), (v+STEM/2,CAP), (v-STEM/2,CAP)]),
        poly([(w-STEM,0), (w,0), (v+STEM/2,CAP), (v-STEM/2,CAP)]),
    ]

def g_W():
    w = 154.0; v1, pk, v2 = 40.0, w/2.0, w-40.0
    return w, [
        poly([(0,0), (STEM,0), (v1+STEM/2,CAP), (v1-STEM/2,CAP)]),
        poly([(pk-STEM/2,0), (pk+STEM/2,0), (v1+STEM/2,CAP), (v1-STEM/2,CAP)]),
        poly([(pk-STEM/2,0), (pk+STEM/2,0), (v2+STEM/2,CAP), (v2-STEM/2,CAP)]),
        poly([(w-STEM,0), (w,0), (v2+STEM/2,CAP), (v2-STEM/2,CAP)]),
    ]

def g_X():
    w = 100.0
    return w, [
        poly([(0,0), (STEM,0), (w,CAP), (w-STEM,CAP)]),
        poly([(w-STEM,0), (w,0), (STEM,CAP), (0,CAP)]),
    ]

def g_Y():
    w = 100.0; v = w/2.0; jy = 64.0
    return w, [
        poly([(0,0), (STEM,0), (v+STEM/2,jy), (v-STEM/2,jy)]),
        poly([(w-STEM,0), (w,0), (v+STEM/2,jy), (v-STEM/2,jy)]),
        rect(v-STEM/2, jy-STEM, STEM, CAP-jy+STEM),
    ]

def g_Z():
    w = 92.0
    return w, [
        rect(0, 0, w, STEM),
        rect(0, CAP-STEM, w, STEM),
        poly([(w-STEM-8,STEM), (w,STEM), (STEM+8,CAP-STEM), (0,CAP-STEM)]),
    ]

# ---------------------------------------------------------------- figures
NW  = 76.0                                    # tabular figure width
NR  = 38.0                                    # outer radius of a figure bowl
NCR = NR - STEM/2.0
NTC = -OS + NR
NBC = CAP + OS - NR

def g_0():
    return NW, [
        band(NW/2, NTC, NCR, STEM, 180, 360),
        band(NW/2, NBC, NCR, STEM, 0, 180),
        rect(0, NTC, STEM, NBC-NTC),
        rect(NW-STEM, NTC, STEM, NBC-NTC),
    ]

def g_1():
    return NW, [rect(34, 0, STEM, CAP), poly([(6,28), (34,4), (34,28), (20,40)])]

def g_2():
    return NW, [
        band(NW/2, NTC, NCR, STEM, 188, 384),
        poly([(50,44), (71,53), (26,CAP-STEM), (0,CAP-STEM)]),
        rect(0, CAP-STEM, NW, STEM),
    ]

def g_3():
    return NW, [
        band(NW/2, NTC, NCR, STEM, 196, 450),
        band(NW/2, NBC, NCR, STEM, -90, 164),
    ]

def g_4():
    return NW, [
        poly([(44,0), (65,0), (27,74), (6,74)]),
        rect(0, 74, NW, STEM),
        rect(44, 0, STEM, CAP),
    ]

def g_5():
    return NW, [
        rect(0, 0, NW-4, STEM),
        rect(0, 0, STEM, 58),
        rect(0, 48, 28, STEM),
        band(NW/2, NBC, NCR, STEM, -135, 166),
    ]

def g_6():
    return NW, [
        rect(0, NTC+8, STEM, NBC-NTC-8),
        band(NW/2, NTC+8, NCR, STEM, 180, 330),
        band(NW/2, NBC, NCR, STEM, 0, 180),
        band(NW/2, NBC, NCR, STEM, 180, 360),
    ]

def g_7():
    return NW, [rect(0, 0, NW, STEM), poly([(NW-STEM-10,STEM), (NW,STEM), (36,CAP), (15,CAP)])]

def g_8():
    r1 = 31.0 - STEM/2.0
    r2 = 36.0 - STEM/2.0
    return NW, [
        band(NW/2, 31.0, r1, STEM, 0, 180), band(NW/2, 31.0, r1, STEM, 180, 360),
        band(NW/2, CAP-36.0, r2, STEM, 0, 180), band(NW/2, CAP-36.0, r2, STEM, 180, 360),
    ]

def g_9():
    return NW, [
        rect(NW-STEM, NTC, STEM, NBC-NTC-8),
        band(NW/2, NBC-8, NCR, STEM, 0, 150),
        band(NW/2, NTC, NCR, STEM, 0, 180),
        band(NW/2, NTC, NCR, STEM, 180, 360),
    ]

def g_slash():
    return 56.0, [poly([(35,-2), (56,-2), (21,CAP+2), (0,CAP+2)])]

def g_dash():
    return 60.0, [rect(0, 55, 60, STEM)]

GLYPHS.update({
    'D':g_D, 'G':g_G, 'J':g_J, 'M':g_M, 'Q':g_Q, 'T':g_T, 'V':g_V, 'W':g_W,
    'X':g_X, 'Y':g_Y, 'Z':g_Z,
    '0':g_0, '1':g_1, '2':g_2, '3':g_3, '4':g_4,
    '5':g_5, '6':g_6, '7':g_7, '8':g_8, '9':g_9,
    '/':g_slash, '-':g_dash,
})
