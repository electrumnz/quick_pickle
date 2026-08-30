/**
 * Counting, folding and cropping — the arithmetic the preview is only as good as.
 *
 * The cases here are the ones that make a preview flatter. A caption that fits
 * in characters but not in X's weighted units. A fold that lands in the middle
 * of an emoji and turns it into two squares the platform would never show. A
 * square photograph dropped into a 4:5 frame, which is the single most common
 * crop this business will do and the one worth being exactly right about.
 */

import { describe, expect, it } from "vitest";

import {
  captionLength,
  collapse,
  cropPlan,
  fullCaption,
  hashtagsIn,
  mentionsIn,
  ratioWords,
  urlsIn,
  utf8Length,
  weightedLength,
} from "@/lib/social";

describe("X counts its own way", () => {
  it("charges Latin text one apiece", () => {
    expect(weightedLength("Salt, acid, dill, garlic, time.")).toBe(31);
  });

  it("charges a link 23 however long it is", () => {
    const short = weightedLength("See https://a.co");
    const long = weightedLength(
      "See https://halfsour.co.nz/products/no-03-smoke?utm_source=x&utm_medium=social",
    );
    expect(short).toBe(long);
    expect(short).toBe("See ".length + 23);
  });

  it("charges a bare domain, because X links one", () => {
    expect(urlsIn("Order at halfsour.co.nz today")).toEqual(["halfsour.co.nz"]);
    expect(weightedLength("Order at halfsour.co.nz today")).toBe(
      "Order at ".length + 23 + " today".length,
    );
  });

  it("does not charge a full stop with a missing space after it", () => {
    // "Thursday.Chipotle" is a typo, not a link. Charging 23 for it would tell
    // the founder a post is over the limit when it is not, which is the same
    // class of lie as a preview that flatters.
    expect(urlsIn("back on Thursday.Chipotle and manzano")).toEqual([]);
  });

  it("charges an emoji two, and a joined family two rather than fourteen", () => {
    expect(weightedLength("🥒")).toBe(2);
    expect(weightedLength("👩‍👩‍👧‍👦")).toBe(2);
    expect(weightedLength("👍🏽")).toBe(2);
  });

  it("charges CJK two, per the weighted ranges", () => {
    expect(weightedLength("日本")).toBe(4);
  });

  it("is what makes a 280-character caption fail at 280", () => {
    const caption = `${"a".repeat(276)}🥒`;
    expect(caption.length).toBeLessThanOrEqual(280);
    expect(captionLength(caption, "weighted", 23)).toBe(278);
    const withLink = `${"a".repeat(270)} https://halfsour.co.nz`;
    expect(captionLength(withLink, "weighted", 23)).toBe(270 + 1 + 23);
  });
});

describe("YouTube counts bytes", () => {
  it("charges an em dash three and an emoji four", () => {
    expect(utf8Length("—")).toBe(3);
    expect(utf8Length("🥒")).toBe(4);
    expect(captionLength("a—b", "utf8", null)).toBe(5);
    expect(captionLength("a—b", "utf16", null)).toBe(3);
  });
});

describe("hashtags and @ tags", () => {
  it("finds them in the text", () => {
    const text = "No 03 is back #halfsour #smoke with @brassandbitters";
    expect(hashtagsIn(text)).toEqual(["#halfsour", "#smoke"]);
    expect(mentionsIn(text)).toEqual(["@brassandbitters"]);
  });

  it("does not read a URL fragment or an email as a tag", () => {
    expect(hashtagsIn("https://halfsour.co.nz/faq#shipping")).toEqual([]);
    expect(mentionsIn("hello@halfsour.co.nz")).toEqual([]);
  });

  it("appends the hashtags column, because the platform gets one field", () => {
    const joined = fullCaption("No 03 is back.", ["halfsour", "smoke"]);
    expect(joined).toBe("No 03 is back.\n\n#halfsour #smoke");
    expect(hashtagsIn(joined)).toHaveLength(2);
  });

  it("does not repeat a tag already written into the caption", () => {
    expect(fullCaption("Back Thursday #smoke", ["smoke"])).toBe(
      "Back Thursday #smoke",
    );
  });
});

describe("the fold", () => {
  const caption =
    "No 03 SMOKE is back on Thursday. Chipotle and manzano, manuka-smoked salt, the heat arrives about three seconds late. Batch D, bottled Tuesday.";

  it("cuts at Instagram's 125 and keeps the rest to show her", () => {
    const cut = collapse(caption, 125);
    expect(cut.truncated).toBe(true);
    expect(cut.shown).toHaveLength(125);
    expect(cut.shown + cut.hidden).toBe(caption);
    expect(cut.hiddenCount).toBe(caption.length - 125);
    expect(cut.shown.endsWith("Batch D")).toBe(true);
    expect(cut.hidden).toBe(", bottled Tuesday.");
  });

  it("cuts the same caption in three different places on three platforms", () => {
    expect(collapse(caption, 125).hiddenCount).toBe(18);
    expect(collapse(caption, 140).hiddenCount).toBe(3);
    expect(collapse(caption, 210).truncated).toBe(false);
  });

  it("hides nothing when no fold point is recorded", () => {
    const cut = collapse(caption, null);
    expect(cut.truncated).toBe(false);
    expect(cut.shown).toBe(caption);
    expect(cut.hiddenCount).toBe(0);
  });

  it("never splits a surrogate pair", () => {
    // Cutting at 2 UTF-16 units would land inside the cucumber and render two
    // replacement squares — a defect of this preview, not of the platform.
    const cut = collapse("ab🥒cd", 3);
    expect(cut.shown).toBe("ab🥒");
    expect(cut.hidden).toBe("cd");
  });
});

describe("the crop", () => {
  it("takes a fifth off the sides of a square in a 4:5 frame", () => {
    // 4:5 is taller than it is wide, so a square loses its edges, not its top
    // and bottom. Getting this the wrong way round is the mistake the diagram
    // in the preview exists to stop somebody making by eye.
    const plan = cropPlan(3000, 3000, 4 / 5);
    expect(plan?.axis).toBe("width");
    expect(plan?.lost).toBeCloseTo(0.2, 5);
    expect(plan?.lostPixels).toBe(600);
    expect(plan?.fits).toBe(false);
  });

  it("takes the width off a wide photograph in a square frame", () => {
    const plan = cropPlan(4000, 2667, 1);
    expect(plan?.axis).toBe("width");
    expect(plan?.lostPixels).toBe(1333);
  });

  it("cuts almost two thirds off a square in a 9:16 story", () => {
    const plan = cropPlan(1080, 1080, 9 / 16);
    expect(plan?.axis).toBe("width");
    expect(plan?.lost).toBeCloseTo(0.4375, 4);
  });

  it("says nothing is cut when the shapes already agree", () => {
    const plan = cropPlan(1080, 1920, 9 / 16);
    expect(plan?.axis).toBe("none");
    expect(plan?.lost).toBe(0);
    expect(plan?.fits).toBe(true);
  });

  it("returns null rather than guessing when the size is unknown", () => {
    expect(cropPlan(null, 1920, 1)).toBeNull();
    expect(cropPlan(0, 0, 1)).toBeNull();
  });

  it("names the ratios the way a person writes them", () => {
    expect(ratioWords(1)).toBe("1:1");
    expect(ratioWords(0.8)).toBe("4:5");
    expect(ratioWords(9 / 16)).toBe("9:16");
    expect(ratioWords(1.91)).toBe("1.91:1");
    expect(ratioWords(4000 / 2667)).toBe("3:2");
  });
});
