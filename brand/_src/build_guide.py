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
