/**
 * What a reader can and cannot see in a piece of text.
 *
 * Some characters take up no room and do not show: a zero-width space, a
 * soft hyphen, a mark that says which way the writing runs, the selector
 * that picks an emoji's colour, the "tag" letters. They arrive in text
 * pasted from somewhere else, and they can be put inside a word on purpose
 * so that it reads the same to a person and differently to a rule.
 *
 * So anything that reads text the way a person would (the copy rules), or
 * counts how much room it takes (the band across the top), takes them out
 * first. This file imports nothing.
 */

/**
 * Every character Unicode says is ignorable by default, and every format
 * control. Used with `replace`, never with `test`: it is a global pattern.
 */
const INVISIBLE = /[\p{Default_Ignorable_Code_Point}\p{Cf}]/gu;

/**
 * The same, but for the two an emoji is held together by: the joiner in a
 * family or a flag, and the selector that makes a heart red. Taking those
 * out of text that is kept would change how it looks.
 */
const STRAY = /(?![‍️])[\p{Default_Ignorable_Code_Point}\p{Cf}]/gu;

/** The text with everything that cannot be seen taken out. */
export function withoutInvisible(text: string): string {
  return text.replace(INVISIBLE, "");
}

/**
 * The text with what cannot be seen taken out, but for what holds an emoji
 * together. For words that are going to be kept and shown.
 */
export function withoutStray(text: string): string {
  return text.replace(STRAY, "");
}

/** How many letters a reader sees: one for each character that shows. */
export function visibleLength(text: string): number {
  return [...withoutInvisible(text)].length;
}
