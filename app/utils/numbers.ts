const KHMER_DIGITS = '០១២៣៤៥៦៧៨៩'

/** A whole number in the language's digits (Khmer digits in Khmer), without separators. */
export function localNumber(value: number, locale: string): string {
  const text = String(Math.trunc(value))
  return locale === 'km' ? text.replace(/\d/g, digit => KHMER_DIGITS[Number(digit)]!) : text
}

/** Any text with its digits in the language's digits, e.g. a level label "3-7". */
export function localDigits(text: string, locale: string): string {
  return locale === 'km' ? text.replace(/\d/g, digit => KHMER_DIGITS[Number(digit)]!) : text
}
