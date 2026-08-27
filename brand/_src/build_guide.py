# -*- coding: utf-8 -*-
import sys, os, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from letterforms import *
from letterforms import _f
from palette import LIGHT, DARK, PAIRS_LIGHT, PAIRS_DARK, table

ROOT = "/home/user/pickled_jews/brand"
A    = os.path.join(ROOT, "assets")

def asset(name, cls="", cur=False, style=""):
    s = open(os.path.join(A, name)).read()
    s = re.sub(r'\s(width|height)="[^"]*"', '', s, count=2)
    if cur:
        s = s.replace('fill="#0F1511"', 'fill="currentColor"')
    s = s.replace('<svg ', '<svg class="%s" style="%s" ' % (cls, style), 1)
    return s

def alphabet_svg():
    rows = ["ABCDEFGHIJKLM", "NOPQRSTUVWXYZ", "0123456789/-."]
    parts, y, mw = [], 0, 0
    for r in rows:
        t, f = render_tracked(r, 18)
        mw = max(mw, t)
        parts.append('<g transform="translate(0 %d)">%s</g>' % (y, f)); y += 178
    return ('<svg class="alpha" viewBox="-10 -10 %s %s" role="img" aria-label="HALF SOUR Display alphabet">'
            '<title>HALF SOUR Display — 39 drawn characters</title>'
            '<g fill="currentColor">%s</g></svg>' % (_f(mw+20), y+20, "".join(parts)))

def swatch_row(tokens, order):
    out = []
    for k in order:
        hexv, name, use = tokens[k]
        out.append(
            '<div class="sw"><div class="sw-chip" style="background:%s"></div>'
            '<div class="sw-meta"><b>%s</b><code>%s</code><span>%s</span></div></div>'
            % (hexv, name, hexv.upper(), use))
    return "".join(out)

def contrast_rows(pairs, tokens):
    out = []
    for fg, bg, fh, bh, r, need, ok, role, cls in table(pairs, tokens):
        out.append(
            '<tr><td class="cx-demo"><span style="background:%s;color:%s">Aa</span></td>'
            '<td><code>%s</code><em>%s</em></td>'
            '<td><code>%s</code><em>%s</em></td>'
            '<td class="cx-num">%.2f:1</td><td class="cx-need">%.1f</td>'
            '<td><span class="pill %s">%s</span></td><td class="cx-role">%s</td></tr>'
            % (bh, fh, fh.upper(), tokens[fg][1], bh.upper(), tokens[bg][1],
               r, need, "ok" if ok else "bad", "PASS" if ok else "FAIL",
               role + ("" if cls == "body" else " · large text")))
    return "".join(out)

# ---------------------------------------------------------------- content
SECTIONS = [
    ("01", "Clearance"), ("02", "Positioning"), ("03", "Customer"),
    ("04", "Personality"), ("05", "Voice"), ("06", "Landscape"),
    ("07", "Colour"), ("08", "Type"), ("09", "Identity"),
    ("10", "The line"), ("11", "Art direction"), ("12", "Notes"),
]

TM_ROWS = [
    ("half sour", "NZ", "32, 33", "0", "Clear", "ok"),
    ("half sour", "NZ", "all", "2", "Both <em>RH Robert Half Management Resources</em>, cl. 35. Not citable.", "ok"),
    ("halfsour", "NZ", "all", "0", "Clear", "ok"),
    ("half", "NZ", "32, 33", "18", "<em>Half Moon Bay</em> (33), <em>The Better Half</em> (33), <em>Halfpipe</em> (32), <em>Another Half</em> (33). All compounds with a distinct second element.", "ok"),
    ("sour", "NZ", "32, 33", "71", "<b>Watch:</b> <em>SOURZ</em> — cl. 33, Registered, no. 295846, Jim Beam Brands Co. Also <em>Sour Puss</em> (32, Lion NZ), <em>Sour Patch</em> (Mondelez).", "watch"),
    ("brine", "NZ", "32, 33", "0", "No brine marks in the beverage classes at all", "ok"),
    ("half sour", "AU", "all", "2", "Robert Half only. Clear for the Australia step.", "ok"),
    ("half sour", "US", "all", "7", "<em>Half Sour Club</em> (cl. 25) status <b>Ended</b>. No live US block.", "ok"),
    ("brine club", "NZ", "all", "0", "Backup 1 clear", "ok"),
    ("dillinger", "NZ", "all", "1", "<em>Dillinger</em>, cl. 25, <b>Ended</b>, Target Australia. Backup 2 clear.", "ok"),
]

DOMAINS = [
    ("halfsour.co.nz", "Available", "ok"), ("halfsour.nz", "Available", "ok"),
    ("drinkhalfsour.co.nz", "Available", "ok"), ("drinkhalfsour.com", "Available", "ok"),
    ("halfsourbrine.com", "Available", "ok"), ("halfsour.co", "Available", "ok"),
    ("halfsour.com", "Registered — parked", "bad"),
    ("brineclub.com", "Registered", "bad"), ("dillinger.co.nz", "Available", "ok"),
]

TRAITS = [
    ("Exact", "Numbers are real. Batch sizes, cure times, salinity, stock counts. If we print it, it is true.", "Clinical. We are not a lab report."),
    ("Dry", "The humour lives in restraint and timing, never in wordplay. We under-react.", "Jokey. We never do a bit."),
    ("Useful", "Every piece of copy leaves you knowing what to do with the bottle.", "Preachy. We do not lecture people about food."),
    ("Unbothered", "We do not oversell, count down, or manufacture scarcity. If it is gone, it is gone.", "Aloof. We answer emails like a person."),
    ("Appetising", "It has to sound like it tastes good. Salt, dill, snap, cold glass.", "Gushing. No “obsessed”, no “insane”, no exclamation marks."),
]

PRINCIPLES = [
    ("Lead with the instruction", "The most useful sentence goes first. Charm is the second sentence, if there is room."),
    ("Short declaratives", "One idea per sentence. If a sentence needs a comma to survive, cut it in two."),
    ("The joke is a shrug", "Understatement, deadpan, an honest admission. Never a pun, never a wink, never an emoji doing a word’s job."),
    ("Specific beats superlative", "“Three weeks in a 400-litre tank” outperforms “artisan” every time. Numbers are the whole personality."),
    ("Own the unglamorous moment", "Out-of-stock notices, error pages and shipping emails are where most brands drop the voice. It is where ours is loudest."),
]

LINES = [
    ("Product", "No. 01 HOUSE", "Cucumber brine cured with dill, garlic and black peppercorn. Salty, clean, faintly sweet at the finish. Goes into a martini, a marinade, or a glass of something you regret buying."),
    ("Product", "No. 02 DIRTY", "Cut heavier with salt and coriander seed, then filtered clear so it doesn’t cloud a stirred drink. Three parts gin, one part this. No olive."),
    ("Product", "No. 03 SMOKE", "Smoked chilli, bay and garlic. Built for the margarita, the michelada, and everything you were going to put hot sauce on anyway."),
    ("Product", "Variety box", "One of each. Three bottles, one box, no decision required."),
    ("Product", "2L on-premise", "The one for behind the bar. Same brine, less glass, a screw cap you can open with one hand while you’re doing something else."),
    ("Shop", "Low stock", "Nine bottles of No. 02 left. That’s a real number, not a marketing one."),
    ("Shop", "Empty cart", "Nothing in here yet. No. 01 is the one to start with."),
    ("Shop", "Sold out, permanently", "That was a one-batch thing and the batch is gone. It may come back. We’re not going to promise you it will."),
    ("Shop", "Wholesale auto-reply", "Got it. Wholesale goes to a person, not a queue. You’ll hear back inside two working days with pricing, minimums, and a sample if you want one."),
    ("Email", "Order confirmation", "Order 4417 is in. We pick and pack Tuesdays and Thursdays, so a Friday order moves on Tuesday. Nothing has gone wrong in the meantime."),
    ("Email", "Delivery delay", "Your box is sitting in Palmerston North and we don’t know why either. We’re chasing it. If it hasn’t moved by Thursday we’ll send a second one and stop asking questions."),
    ("Email", "Newsletter confirmation", "You’re on. Roughly one email a month: what’s brining, what’s back, and one drink worth making."),
    ("Error", "Form validation", "That postcode doesn’t exist. We checked twice."),
    ("Social", "Recipe post", "Three parts gin. One part No. 02. Stirred, not shaken, because you’re an adult."),
    ("Social", "Stockist", "We’re behind the bar at Bar Magda now. Order the martini. Tell them we sent you and they will not care."),
    ("Social", "Restock", "No. 01 is back. Same batch size, same seven ingredients, same three-week cure. We’re not doing a countdown."),
]

NEVER = [
    ("Anything about the body", "No electrolytes, hydration, cramps, recovery, probiotics, gut health, immunity, “good for you”, “supports”. Not as a claim, not as a joke, not in a customer post we repost. FSANZ / MPI. <b>Zero tolerance, all channels.</b>"),
    ("Puns", "No “Dill With It”. No “Big Dill”. No “Kind of a Big Dill”. Ever."),
    ("Kiwiana", "No jandals, fern, #8 wire, “sweet as”, kiwi bird, tiki. <em>Made in Aotearoa New Zealand</em> appears on the label because it is a fact of manufacture, and nowhere else."),
    ("Retro deli", "No 1950s script, checkerboard, sunburst, “since 19—”, faux-heritage crest, distressed paper. The category has done this to death."),
    ("Manufactured urgency", "No countdown timers. No “only 3 left!!” when there are thirty. No “drops”. Stock numbers are real or absent."),
    ("Superlatives", "No “best”, “world-class”, “award-winning” — until there is an award, and then once, in small type."),
    ("Wellness register", "No “clean”, “pure”, “wholesome”, “mindful”, “ritual”, “nourish”."),
    ("Exclamation marks", "One per year, and it had better be worth it."),
]

COMPETITORS = [
    ("The cultural bar", "Good Girl Snacks", "US",
     "“We make pickles sexy.” Loud, playful, doodled, unmistakably online. Whole Foods placement on effectively no ad spend.",
     "They own <b>fun</b>. They do not own <b>credible ingredient</b>. A bar manager cannot put that bottle on a back bar and be taken seriously. That shelf is empty."),
    ("The incumbent format", "Van Holten’s Pickleback Mixer", "US",
     "The 1L brine bottle, a century of pickle heritage, real distribution.",
     "Zero design equity. It looks like food service because it is food service. It has never been designed for front of house."),
    ("The 2026 wave", "The Pickle House · The Original Pickle Shot · Mission Craft <em>Pickle-Rita</em>", "UK / US",
     "Speed. They reached shelf while the trend was breaking — The Pickle House is now in Waitrose.",
     "They are riding the flavour, not building a house. Mostly shot- and RTD-shaped; they move on when the flavour does."),
    ("The descriptive risk", "Doc Pickle", "US",
     "Sells a product literally named <em>Half Sour Pickle Brine</em>.",
     "Confirms the term is generic in the trade — which is exactly why we file the composite mark and not the words."),
    ("NZ adjacent", "Six Barrel Soda Co.", "Hawke’s Bay",
     "Small-batch syrups and cocktail mixers, started by two people who worked bars and couldn’t buy decent mixers. They already publish a recipe using dill pickle brine.",
     "They are sweet. We are salt. Not a competitor — we belong next to them on the same trolley."),
    ("NZ direct", "None at time of writing", "—",
     "There is no branded New Zealand pickle brine for bars.",
     "That is the entire opportunity, and it closes."),
]

SCALE = [
    ("Display 1", "88 / 0.92", "−0.03em", "HS Display / Instrument Serif", "Hero, one per page", "d1"),
    ("Display 2", "64 / 1.00", "−0.025em", "Instrument Serif", "Section openers", "d2"),
    ("H1", "44 / 1.08", "−0.02em", "Instrument Serif", "Page titles", "h1s"),
    ("H2", "32 / 1.15", "−0.015em", "Instrument Serif", "Section heads", "h2s"),
    ("H3", "24 / 1.25", "−0.01em", "Archivo 600", "Sub-heads, card titles", "h3s"),
    ("Body L", "19 / 1.60", "0", "Archivo 400", "Lead paragraphs", "bl"),
    ("Body", "17 / 1.65", "0", "Archivo 400", "Everything", "bd"),
    ("Small", "15 / 1.55", "0", "Archivo 400", "Captions, secondary", "sm"),
    ("Micro", "13 / 1.45", "+0.06em", "Archivo 500", "Legal, footnotes", "mi"),
    ("Data", "11 / 1.30", "+0.18em caps", "Martian Mono 500", "Labels, nav, prices, lot codes", "da"),
]

SKUS = [
    ("01", "HOUSE", "Dill and Peppercorn Brine",
     "The everyday brine — dill, garlic, black peppercorn, coriander seed. Salty, clean, faintly sweet at the finish.",
     "var(--brine)", "var(--ink)"),
    ("02", "DIRTY", "Martini Brine",
     "Cut heavier with salt and coriander seed, filtered clear so it won’t cloud a stirred drink.",
     "var(--ink)", "var(--brine)"),
    ("03", "SMOKE", "Smoked Chilli Brine",
     "Smoked chilli, bay and garlic, for the margarita, the michelada, and anything that wanted hot sauce.",
     "var(--chilli)", "var(--bone)"),
]

AD_IS = [
    ("Light", "One hard source, high and to one side, 45°–70°. Deep, sharp shadows with a defined edge. Ratio around 8:1. No fill except what the surface gives you."),
    ("Surface", "Honed stone, stainless bench, a wet bar top, zinc. Or a plain sheet of the label stock. Never wood grain, never marble, never linen."),
    ("Palette in frame", "Ink, Bone, Brine, glass, steel, and one green. If a colour is in the shot and not in the palette, it leaves."),
    ("Subject", "The bottle, the pour, the glass, the ingredient. Cucumber in cross-section, dill, whole peppercorns, a garlic clove — placed like tools, not scattered like confetti."),
    ("Liquid", "Always in motion or freshly still. A pour caught mid-stream. Condensation on a coupe. Brine is cloudy and we show that."),
    ("Human", "Hands only, and working ones — a jigger, a bar spoon, a wrist. No faces, no lifestyle, no laughing."),
    ("Crop", "Tight and slightly uncomfortable. Cut the bottle. Let things leave the frame."),
    ("Grain", "A little. Digital-clean reads like stock photography."),
]

AD_NEVER = [
    ("Lifestyle", "No picnic, no group of friends, no beach, no deck, no barbecue."),
    ("Kiwiana", "No ferns, no jandals, no bach, no landscape."),
    ("Retro deli", "No checkerboard, no red-and-white, no butcher paper, no chalkboard, no 1950s counter."),
    ("Wellness", "No gym, no towel, no post-workout anything, no supplement shelf, no white infinity curve, no eucalyptus flat-lay."),
    ("Mascot", "No anthropomorphised anything."),
    ("Splash", "No frozen-splash-with-fruit-suspended-in-it stock cliché."),
    ("Warm and cosy", "No golden hour, no candlelight, no soft focus, no bokeh."),
    ("Over-propped", "If you can count more than five objects in the frame, remove two."),
]

CSS = """
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0}

:root{
  --ink:#0F1511; --pepper:#4E554A; --dill:#18402F; --brine:#C8D93B;
  --vinegar:#E4E8BE; --bone:#F2EFE3; --paper:#FBFAF4; --rind:#D6D2C0; --chilli:#A83521;
  --bg:var(--bone); --surface:var(--paper); --text:var(--ink); --muted:var(--pepper);
  --line:var(--rind); --accent:var(--brine); --accent-ink:var(--ink); --danger:var(--chilli);
  --line-strong:#B9B4A0;
}
[data-theme="dark"]{
  --night:#0A0F0C; --cellar:#131A15; --shelf:#1E2A21; --salt:#EAE8DB; --ash:#9BA694;
  --brine600:#BDD03A; --moss:#6FA07C; --ember:#E08163;
  --bg:var(--night); --surface:var(--cellar); --text:var(--salt); --muted:var(--ash);
  --line:var(--shelf); --accent:var(--brine600); --accent-ink:var(--night); --danger:var(--ember);
  --line-strong:#2C3B30;
}

body{
  background:var(--bg); color:var(--text);
  font-family:"Archivo","Helvetica Neue",Arial,sans-serif;
  font-size:17px; line-height:1.65; font-weight:400;
  -webkit-font-smoothing:antialiased;
  transition:background .35s ease,color .35s ease;
}
h1,h2,h3,h4{margin:0;font-weight:400}
p{margin:0 0 1em}
a{color:inherit}
code{font-family:"Martian Mono",ui-monospace,Menlo,monospace;font-size:.78em;letter-spacing:-.02em}

.wrap{max-width:1240px;margin:0 auto;padding:0 46px}
.data{font-family:"Martian Mono",ui-monospace,Menlo,monospace;font-size:11px;font-weight:500;
  letter-spacing:.18em;text-transform:uppercase;line-height:1.3}
.serif{font-family:"Instrument Serif","Times New Roman",serif;font-weight:400}

/* ---------- rail ---------- */
.rail{position:fixed;left:0;top:0;bottom:0;width:132px;display:none;flex-direction:column;
  justify-content:center;gap:2px;padding:0 0 0 22px;z-index:40;pointer-events:none}
.rail a{pointer-events:auto;display:flex;gap:9px;align-items:baseline;text-decoration:none;
  color:var(--muted);padding:3px 0;opacity:.8;transition:color .2s,opacity .2s}
.rail a:hover{color:var(--text);opacity:1}
.rail a i{font-style:normal;color:var(--accent);width:16px}
@media(min-width:1500px){.rail{display:flex}}

/* ---------- theme toggle ---------- */
.tt{position:fixed;top:22px;right:24px;z-index:50;display:flex;align-items:center;gap:0;
  border:1.5px solid var(--text);background:var(--bg)}
.tt button{appearance:none;border:0;background:transparent;color:var(--text);cursor:pointer;
  font-family:"Martian Mono",ui-monospace,monospace;font-size:10px;font-weight:500;
  letter-spacing:.16em;text-transform:uppercase;padding:8px 13px;line-height:1}
.tt button[aria-pressed="true"]{background:var(--text);color:var(--bg)}

/* ---------- hero ---------- */
.hero{background:var(--ink);color:var(--bone);padding:72px 0 0;position:relative;overflow:hidden}
[data-theme="dark"] .hero{background:#060A07}
.hero .wrap{position:relative;z-index:2}
.hero-top{display:flex;justify-content:space-between;align-items:baseline;
  border-bottom:1.5px solid rgba(242,239,227,.28);padding-bottom:14px;margin-bottom:56px}
.hero-top span{color:var(--brine)}
.hero-mark svg{display:block;width:100%;height:auto;color:var(--bone)}
.hero-desc{display:flex;justify-content:space-between;align-items:baseline;gap:24px;
  border-top:1.5px solid rgba(242,239,227,.28);margin-top:26px;padding-top:14px}
.hero-desc .data{color:var(--brine)}
.hero-lede{font-family:"Instrument Serif",serif;font-size:36px;line-height:1.22;
  letter-spacing:-.015em;max-width:22ch;margin:58px 0 0;color:var(--bone)}
.hero-lede em{font-style:italic;color:var(--brine)}
.hero-chips{display:flex;flex-wrap:wrap;gap:8px;margin:38px 0 0;padding-bottom:66px}
.chip{border:1.4px solid rgba(242,239,227,.34);padding:7px 13px;color:var(--bone)}
.chip.solid{background:var(--brine);border-color:var(--brine);color:var(--ink)}

/* ---------- sections ---------- */
section{padding:86px 0 0}
.sec-head{display:flex;align-items:baseline;gap:20px;border-top:2px solid var(--text);
  padding-top:14px;margin-bottom:38px}
.sec-head .n{color:var(--accent);flex:none}
.sec-head h2{font-family:"Instrument Serif",serif;font-size:44px;line-height:1;letter-spacing:-.02em;flex:none}
.sec-head .k{margin-left:auto;color:var(--muted);text-align:right;max-width:34ch}
.lede{font-size:19px;line-height:1.6;max-width:62ch;color:var(--text)}
.lede.mut{color:var(--muted)}

/* ---------- generic bits ---------- */
.grid{display:grid;gap:18px}
.g2{grid-template-columns:repeat(2,1fr)}
.g3{grid-template-columns:repeat(3,1fr)}
.g4{grid-template-columns:repeat(4,1fr)}
@media(max-width:900px){.g2,.g3,.g4{grid-template-columns:1fr}}
.card{background:var(--surface);border:1.4px solid var(--line);padding:22px 22px 24px}
.card h4{font-size:20px;font-weight:600;letter-spacing:-.01em;margin-bottom:7px}
.card p{font-size:15px;line-height:1.6;color:var(--muted);margin:0}
.card .data{color:var(--accent);margin-bottom:12px}

table{width:100%;border-collapse:collapse;font-size:14px}
th{text-align:left;font-family:"Martian Mono",ui-monospace,monospace;font-size:10px;font-weight:500;
  letter-spacing:.16em;text-transform:uppercase;color:var(--muted);
  padding:0 12px 10px 0;border-bottom:1.5px solid var(--text);white-space:nowrap}
td{padding:12px 12px 12px 0;border-bottom:1px solid var(--line);vertical-align:top;line-height:1.5}
td em{font-style:normal;color:var(--muted)}
tr:last-child td{border-bottom:0}

.pill{display:inline-block;font-family:"Martian Mono",ui-monospace,monospace;font-size:9.5px;
  font-weight:500;letter-spacing:.14em;padding:3px 8px;white-space:nowrap}
.pill.ok{background:var(--accent);color:var(--accent-ink)}
.pill.bad{background:var(--danger);color:var(--bg)}
.pill.watch{background:transparent;border:1.4px solid var(--danger);color:var(--danger)}

.verdict{display:grid;grid-template-columns:auto 1fr;gap:0;border:2px solid var(--text);margin-bottom:34px}
.verdict .v-l{background:var(--accent);color:var(--accent-ink);padding:26px 34px;display:flex;
  flex-direction:column;justify-content:center;min-width:250px}
.verdict .v-l b{font-family:"Instrument Serif",serif;font-size:52px;line-height:.94;font-weight:400;letter-spacing:-.02em}
.verdict .v-r{padding:24px 28px}
.verdict .v-r p{font-size:15.5px;line-height:1.6;color:var(--muted);margin:0}
.verdict .v-r p+p{margin-top:11px}
@media(max-width:900px){.verdict{grid-template-columns:1fr}}

/* ---------- stats ---------- */
.stats{display:grid;grid-template-columns:repeat(4,1fr);border-top:2px solid var(--text);
  border-bottom:2px solid var(--text)}
.stat{padding:22px 20px 24px;border-right:1px solid var(--line)}
.stat:last-child{border-right:0}
.stat b{display:block;font-family:"Instrument Serif",serif;font-size:42px;line-height:1;
  letter-spacing:-.02em;margin-bottom:8px}
.stat span{display:block;font-size:13.5px;line-height:1.45;color:var(--muted)}
@media(max-width:900px){.stats{grid-template-columns:repeat(2,1fr)}}

/* ---------- traits ---------- */
.trait{display:grid;grid-template-columns:200px 1fr 1fr;gap:26px;padding:18px 0;
  border-bottom:1px solid var(--line);align-items:baseline}
.trait:first-of-type{border-top:1.5px solid var(--text)}
.trait h4{font-family:"Instrument Serif",serif;font-size:30px;line-height:1;letter-spacing:-.015em}
.trait p{font-size:15px;line-height:1.55;margin:0}
.trait .no{color:var(--danger)}
.trait .no::before{content:"NOT ";font-family:"Martian Mono",monospace;font-size:9.5px;
  letter-spacing:.14em;vertical-align:1.5px;margin-right:5px}
@media(max-width:900px){.trait{grid-template-columns:1fr;gap:6px}}

/* ---------- voice ---------- */
.prins{display:grid;grid-template-columns:repeat(5,1fr);gap:0;border-top:2px solid var(--text);
  border-bottom:2px solid var(--text);margin-bottom:44px}
.prin{padding:20px 18px 24px;border-right:1px solid var(--line)}
.prin:last-child{border-right:0}
.prin .data{color:var(--accent);margin-bottom:10px}
.prin h4{font-size:17px;font-weight:600;line-height:1.25;letter-spacing:-.01em;margin-bottom:7px}
.prin p{font-size:13.5px;line-height:1.5;color:var(--muted);margin:0}
@media(max-width:1100px){.prins{grid-template-columns:repeat(2,1fr)}
  .prin{border-bottom:1px solid var(--line)}}

.lines{display:grid;grid-template-columns:repeat(2,1fr);gap:0 34px}
.line{display:grid;grid-template-columns:26px 1fr;gap:14px;padding:15px 0;border-bottom:1px solid var(--line)}
.line .num{font-family:"Martian Mono",monospace;font-size:10px;letter-spacing:.06em;
  color:var(--accent);padding-top:4px}
.line .tag{display:block;font-family:"Martian Mono",monospace;font-size:9.5px;letter-spacing:.14em;
  text-transform:uppercase;color:var(--muted);margin-bottom:5px}
.line .tag b{color:var(--text);font-weight:500}
.line q{quotes:"“" "”";font-size:15.5px;line-height:1.55;display:block}
@media(max-width:900px){.lines{grid-template-columns:1fr}}

/* ---------- ui specimens ---------- */
.ui{background:var(--surface);border:1.4px solid var(--line);display:flex;flex-direction:column;overflow:hidden}
.ui-bar{display:flex;align-items:center;gap:7px;padding:9px 13px;border-bottom:1.4px solid var(--line);
  background:var(--bg)}
.ui-bar i{width:8px;height:8px;border-radius:50%;background:var(--line-strong);display:block}
.ui-bar span{margin-left:6px;font-family:"Martian Mono",monospace;font-size:9.5px;letter-spacing:.1em;
  color:var(--muted);text-transform:none}
.ui-body{padding:26px 24px 28px;flex:1}
.ui-404{font-family:"Instrument Serif",serif;font-size:76px;line-height:.9;letter-spacing:-.03em;
  color:var(--accent);margin-bottom:14px}
.ui-body h5{margin:0 0 8px;font-size:19px;font-weight:600;letter-spacing:-.01em}
.ui-body p{font-size:15px;line-height:1.55;color:var(--muted);margin:0 0 14px}
.ui-btn{display:inline-block;background:var(--text);color:var(--bg);padding:10px 18px;
  font-family:"Martian Mono",monospace;font-size:10px;letter-spacing:.16em;text-transform:uppercase}
.ui-soldout{display:flex;align-items:baseline;gap:10px;margin-bottom:14px}
.ui-rule{height:1px;background:var(--line);margin:16px 0}
.ui-kv{display:flex;justify-content:space-between;font-family:"Martian Mono",monospace;
  font-size:10px;letter-spacing:.1em;color:var(--muted);padding:5px 0}
.ui-kv b{color:var(--text);font-weight:500}

/* ---------- never ---------- */
.never-band{background:var(--dill);color:var(--bone);margin-top:70px;padding:64px 0 70px}
[data-theme="dark"] .never-band{background:#0F1A14}
.never-band .sec-head{border-color:var(--bone)}
.never-band .sec-head h2{color:var(--bone)}
.never-band .sec-head .n{color:var(--brine)}
.never-band .sec-head .k{color:rgba(242,239,227,.62)}
.nv{display:grid;grid-template-columns:210px 1fr;gap:24px;padding:15px 0;
  border-bottom:1px solid rgba(242,239,227,.2)}
.nv:first-of-type{border-top:1px solid rgba(242,239,227,.2)}
.nv h4{font-size:17px;font-weight:600;letter-spacing:-.01em}
.nv h4::before{content:"✕";color:var(--brine);margin-right:9px;font-weight:400}
.nv p{margin:0;font-size:14.5px;line-height:1.55;color:rgba(242,239,227,.74)}
.nv p b{color:var(--brine);font-weight:500}
.nv p em{font-style:italic;color:var(--bone)}
@media(max-width:900px){.nv{grid-template-columns:1fr;gap:4px}}

/* ---------- colour ---------- */
.sws{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
@media(max-width:1000px){.sws{grid-template-columns:repeat(2,1fr)}}
.sw{border:1.4px solid var(--line);background:var(--surface)}
.sw-chip{height:78px;border-bottom:1.4px solid var(--line)}
.sw-meta{padding:12px 14px 14px}
.sw-meta b{display:block;font-size:15px;font-weight:600;letter-spacing:-.01em}
.sw-meta code{display:block;font-size:10.5px;letter-spacing:.1em;color:var(--muted);margin:3px 0 6px}
.sw-meta span{display:block;font-size:12.5px;line-height:1.4;color:var(--muted)}

.darkband{background:#0A0F0C;color:#EAE8DB;padding:60px 0 66px;margin:52px 0}
.darkband .sw{border-color:#1E2A21;background:#131A15}
.darkband .sw-chip{border-color:#1E2A21}
.darkband .sw-meta code,.darkband .sw-meta span{color:#9BA694}
.darkband h3{font-family:"Instrument Serif",serif;font-size:34px;letter-spacing:-.02em;margin-bottom:8px}
.darkband .dl{color:#9BA694;font-size:15.5px;line-height:1.6;max-width:64ch;margin-bottom:30px}
.darkband .dl b{color:#BDD03A;font-weight:500}
.darkband .data{color:#BDD03A;margin-bottom:14px}

.cx-demo span{display:inline-flex;align-items:center;justify-content:center;width:46px;height:34px;
  font-family:"Instrument Serif",serif;font-size:19px;border:1px solid var(--line)}
.cx-num{font-family:"Martian Mono",monospace;font-size:12.5px;font-weight:500;white-space:nowrap}
.cx-need{font-family:"Martian Mono",monospace;font-size:11px;color:var(--muted)}
.cx-role{color:var(--muted);font-size:13px}
td code{display:block;font-size:10.5px;letter-spacing:.06em}
td em{display:block;font-size:12px;margin-top:2px}

.rules{display:grid;grid-template-columns:repeat(5,1fr);gap:0;border-top:2px solid var(--text);
  border-bottom:2px solid var(--text);margin-top:40px}
.rule{padding:18px 16px 22px;border-right:1px solid var(--line)}
.rule:last-child{border-right:0}
.rule .data{color:var(--accent);margin-bottom:9px}
.rule p{font-size:13.5px;line-height:1.5;margin:0;color:var(--muted)}
.rule p b{color:var(--text);font-weight:600}
@media(max-width:1100px){.rules{grid-template-columns:repeat(2,1fr)}
  .rule{border-bottom:1px solid var(--line)}}

/* ---------- type ---------- */
.alpha{display:block;width:100%;height:auto;color:var(--text)}
.alphabox{border:1.4px solid var(--line);background:var(--surface);padding:34px 38px 30px;margin-bottom:20px}
.alphabox .data{color:var(--muted);margin-bottom:24px;display:flex;justify-content:space-between}
.alphabox .data b{color:var(--accent);font-weight:500}

.faces{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-bottom:44px}
@media(max-width:1000px){.faces{grid-template-columns:1fr}}
.face{border:1.4px solid var(--line);background:var(--surface);padding:22px 22px 24px}
.face .sample{font-size:52px;line-height:1;letter-spacing:-.02em;margin-bottom:16px;
  padding-bottom:16px;border-bottom:1px solid var(--line)}
.face .data{color:var(--accent);margin-bottom:9px}
.face h4{font-size:18px;font-weight:600;margin-bottom:5px}
.face p{font-size:13.5px;line-height:1.5;color:var(--muted);margin:0}
.face .lic{margin-top:11px;font-family:"Martian Mono",monospace;font-size:9.5px;letter-spacing:.13em;
  color:var(--muted);text-transform:uppercase}

.scale td:last-child{width:44%}
.spec{display:block;color:var(--text);overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.d1{font-family:"Instrument Serif",serif;font-size:56px;line-height:.94;letter-spacing:-.03em}
.d2{font-family:"Instrument Serif",serif;font-size:44px;line-height:1;letter-spacing:-.025em}
.h1s{font-family:"Instrument Serif",serif;font-size:34px;line-height:1.08;letter-spacing:-.02em}
.h2s{font-family:"Instrument Serif",serif;font-size:27px;line-height:1.15;letter-spacing:-.015em}
.h3s{font-size:22px;font-weight:600;letter-spacing:-.01em}
.bl{font-size:19px}.bd{font-size:17px}.sm{font-size:15px}
.mi{font-size:13px;font-weight:500;letter-spacing:.06em}
.da{font-family:"Martian Mono",monospace;font-size:11px;font-weight:500;letter-spacing:.18em;text-transform:uppercase}

/* ---------- identity ---------- */
.lock{border:1.4px solid var(--line);background:var(--surface);padding:40px;display:flex;
  align-items:center;justify-content:center;min-height:210px}
.lock svg{width:100%;height:auto;max-height:170px;color:var(--text)}
.lock.inv{background:var(--ink);border-color:var(--ink)}
.lock.inv svg{color:var(--bone)}
.lock.acc{background:var(--brine);border-color:var(--brine)}
.lock.acc svg{color:var(--ink)}
.capn{font-family:"Martian Mono",monospace;font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;
  color:var(--muted);margin-top:9px;display:block}
.favs{display:flex;align-items:flex-end;gap:26px;padding:26px 30px;border:1.4px solid var(--line);
  background:var(--surface)}
.favs figure{margin:0;text-align:center}
.favs img{display:block;image-rendering:auto;margin:0 auto 8px}
.favs figcaption{font-family:"Martian Mono",monospace;font-size:9px;letter-spacing:.12em;color:var(--muted)}

/* ---------- product ---------- */
.bottleband{background:var(--dill);padding:52px 0 40px;margin:44px 0 40px}
[data-theme="dark"] .bottleband{background:#0F1A14}
.bottleband svg{display:block;width:100%;height:auto}
.labels{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-top:32px}
.labels svg{display:block;width:100%;height:auto;box-shadow:0 2px 0 rgba(15,21,17,.10)}
@media(max-width:900px){.labels{grid-template-columns:1fr}}
.skus{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
@media(max-width:900px){.skus{grid-template-columns:1fr}}
.sku{border:1.4px solid var(--line);background:var(--surface)}
.sku .bar{height:9px}
.sku .in{padding:20px 20px 22px}
.sku .no{font-family:"Martian Mono",monospace;font-size:10px;letter-spacing:.16em;color:var(--muted)}
.sku h4{font-family:"Instrument Serif",serif;font-size:40px;line-height:1;letter-spacing:-.02em;margin:7px 0 4px}
.sku .sub{font-family:"Martian Mono",monospace;font-size:9.5px;letter-spacing:.14em;
  text-transform:uppercase;color:var(--accent);margin-bottom:11px}
.sku p{font-size:14.5px;line-height:1.55;color:var(--muted);margin:0}

/* ---------- art direction ---------- */
.ad{display:grid;grid-template-columns:repeat(2,1fr);gap:0 46px}
@media(max-width:1000px){.ad{grid-template-columns:1fr}}
.adcol h3{font-family:"Instrument Serif",serif;font-size:30px;letter-spacing:-.02em;margin-bottom:4px}
.adcol .data{color:var(--muted);margin-bottom:20px}
.adrow{display:grid;grid-template-columns:120px 1fr;gap:16px;padding:13px 0;border-bottom:1px solid var(--line)}
.adrow:first-of-type{border-top:1.5px solid var(--text)}
.adrow h5{margin:0;font-size:14px;font-weight:600}
.adrow p{margin:0;font-size:13.5px;line-height:1.5;color:var(--muted)}
.adcol.no .adrow h5{color:var(--danger)}
.adcol.no .adrow h5::before{content:"✕ ";font-weight:400}

.plates{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:34px}
@media(max-width:1000px){.plates{grid-template-columns:1fr}}
.plate{border:1.4px solid var(--line);background:var(--surface);padding:0;overflow:hidden}
.plate .top{height:132px;position:relative;overflow:hidden;border-bottom:1.4px solid var(--line)}
.plate .in{padding:16px 18px 20px}
.plate .data{color:var(--accent);margin-bottom:7px}
.plate h5{margin:0 0 6px;font-size:16px;font-weight:600}
.plate p{margin:0;font-size:13.5px;line-height:1.5;color:var(--muted)}
.lightdiag{background:linear-gradient(112deg,#EFEDE0 0%,#EFEDE0 38%,#3A4238 38.5%,#12180F 100%)}
.lightdiag::after{content:"";position:absolute;left:26%;top:14%;width:58px;height:104px;border-radius:6px;
  background:#CBD394;box-shadow:34px 8px 0 -6px rgba(15,21,17,.55)}
.surfdiag{background:#171E18}
.surfdiag::after{content:"";position:absolute;inset:0;
  background:repeating-linear-gradient(90deg,rgba(234,232,219,.07) 0 1px,transparent 1px 9px)}
.cropdiag{background:#EFEDE0;display:flex;align-items:center;justify-content:center}
.cropdiag::after{content:"";width:96px;height:150px;background:#CBD394;border:2px solid #0F1511;
  margin-top:44px}

/* the forbidden plate */
.nevers{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:22px}
@media(max-width:1000px){.nevers{grid-template-columns:1fr}}
.nev{border:2px solid var(--danger);position:relative;overflow:hidden;background:var(--surface)}
.nev .art{height:186px;position:relative;overflow:hidden;display:flex;align-items:center;
  justify-content:center;text-align:center}
.nev .art::after{content:"";position:absolute;inset:-20%;
  background:linear-gradient(to bottom right,transparent 49.3%,var(--danger) 49.3%,var(--danger) 50.7%,transparent 50.7%)}
.nev .in{padding:14px 16px 18px;border-top:2px solid var(--danger)}
.nev .data{color:var(--danger);margin-bottom:6px}
.nev p{margin:0;font-size:13px;line-height:1.5;color:var(--muted)}
.nev-deli{background:#F3E7CE;
  background-image:repeating-conic-gradient(#C6徒 0% 25%,transparent 0% 50%)}
.nev-deli .t{font-family:"Instrument Serif",serif;font-style:italic;font-size:42px;color:#9E2B20;
  text-shadow:2px 2px 0 #E8D6AE;z-index:1;line-height:1}
.nev-kiwi{background:linear-gradient(#8FB8CF,#8FB8CF 52%,#3E6B3A 52%,#2C5230)}
.nev-kiwi .t{font-family:"Archivo",sans-serif;font-weight:700;font-size:30px;color:#FFF;
  letter-spacing:.02em;z-index:1;text-shadow:0 2px 6px rgba(0,0,0,.4)}
.nev-well{background:#FBFBF9}
.nev-well .t{font-family:"Archivo",sans-serif;font-weight:300;font-size:17px;color:#8A9A8E;
  letter-spacing:.34em;text-transform:uppercase;z-index:1}

/* ---------- notes / footer ---------- */
.notes{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
@media(max-width:1000px){.notes{grid-template-columns:1fr}}
.note{border-left:2px solid var(--accent);padding:2px 0 2px 18px}
.note h4{font-size:15px;font-weight:600;margin-bottom:6px}
.note p{font-size:13.5px;line-height:1.55;color:var(--muted);margin:0}
.note code{font-size:10.5px}
footer{margin-top:96px;background:var(--ink);color:var(--bone);padding:44px 0 52px}
[data-theme="dark"] footer{background:#060A07}
footer .f{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;flex-wrap:wrap}
footer .data{color:var(--brine)}
footer svg{width:250px;height:auto;color:var(--bone)}
.spacer{height:66px}
"""
