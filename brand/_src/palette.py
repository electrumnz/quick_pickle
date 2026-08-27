def _lin(c):
    c = c/255.0
    return c/12.92 if c <= 0.04045 else ((c+0.055)/1.055)**2.4

def lum(hexstr):
    h = hexstr.lstrip('#')
    r, g, b = (int(h[i:i+2], 16) for i in (0, 2, 4))
    return 0.2126*_lin(r) + 0.7152*_lin(g) + 0.0722*_lin(b)

def ratio(a, b):
    la, lb = lum(a), lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)

LIGHT = {
    "ink":     ("#0F1511", "Ink",      "Primary type, rules, the mark"),
    "pepper":  ("#4E554A", "Pepper",   "Secondary type, captions, metadata"),
    "dill":    ("#18402F", "Dill",     "Second surface, footers, ingredient panels"),
    "brine":   ("#C8D93B", "Brine",    "The signature. Fields, highlights, the cap"),
    "vinegar": ("#E4E8BE", "Vinegar",  "Quiet tint blocks, table stripes"),
    "bone":    ("#F2EFE3", "Bone",     "Page ground"),
    "paper":   ("#FBFAF4", "Paper",    "Raised surfaces, cards, inputs"),
    "rind":    ("#D6D2C0", "Rind",     "Hairlines, dividers, borders"),
    "chilli":  ("#A83521", "Chilli",   "Errors, sold-out, allergen notices"),
}

DARK = {
    "night":   ("#0A0F0C", "Night",    "Page ground"),
    "cellar":  ("#131A15", "Cellar",   "Raised surfaces, cards"),
    "shelf":   ("#1E2A21", "Shelf",    "Hairlines, dividers, inset wells"),
    "salt":    ("#EAE8DB", "Salt",     "Primary type"),
    "ash":     ("#9BA694", "Ash",      "Secondary type, captions, metadata"),
    "brine":   ("#BDD03A", "Brine 600","The signature, held back one step for dark ground"),
    "moss":    ("#6FA07C", "Moss",     "Second accent, links, live status"),
    "ember":   ("#E08163", "Ember",    "Errors, sold-out"),
}

# Pairs the brand sanctions. (fg, bg, role, size-class)
PAIRS_LIGHT = [
    ("ink","bone","Body text on the page ground","body"),
    ("ink","paper","Body text on a card","body"),
    ("ink","brine","Type on a Brine field","body"),
    ("ink","vinegar","Type on a Vinegar tint","body"),
    ("pepper","bone","Captions and metadata","body"),
    ("pepper","paper","Captions on a card","body"),
    ("chilli","bone","Error and sold-out copy","body"),
    ("chilli","paper","Error copy on a card","body"),
    ("bone","ink","Reversed type on Ink","body"),
    ("bone","dill","Reversed type on Dill","body"),
    ("brine","ink","Brine type on Ink — display only","large"),
    ("brine","dill","Brine type on Dill — display only","large"),
]
PAIRS_DARK = [
    ("salt","night","Body text on the page ground","body"),
    ("salt","cellar","Body text on a card","body"),
    ("salt","shelf","Type in an inset well","body"),
    ("ash","night","Captions and metadata","body"),
    ("ash","cellar","Captions on a card","body"),
    ("brine","night","Accent type and links","body"),
    ("brine","cellar","Accent type on a card","body"),
    ("moss","night","Second accent, live status","body"),
    ("ember","night","Error and sold-out copy","body"),
    ("ember","cellar","Error copy on a card","body"),
    ("night","brine","Ink-side type on a Brine field","body"),
]

def table(pairs, tokens):
    rows = []
    for fg, bg, role, cls in pairs:
        r = ratio(tokens[fg][0], tokens[bg][0])
        need = 4.5 if cls == "body" else 3.0
        rows.append((fg, bg, tokens[fg][0], tokens[bg][0], r, need, r >= need, role, cls))
    return rows

if __name__ == "__main__":
    for label, pairs, tok in (("LIGHT", PAIRS_LIGHT, LIGHT), ("DARK", PAIRS_DARK, DARK)):
        print("\n== %s ==" % label)
        for fg, bg, fh, bh, r, need, ok, role, cls in table(pairs, tok):
            print("  %-8s on %-8s %s/%s  %5.2f:1  need %.1f  %s   %s"
                  % (fg, bg, fh, bh, r, need, "PASS" if ok else "**FAIL**", role))
