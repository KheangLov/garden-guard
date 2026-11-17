/**
 * The story: Dara and his grandmother (Yay) defend their garden, then the village, from Gearax and
 * its Bolt-Bots, across the six worlds. A scene plays before each world's first level (intro) and
 * after its boss (outro). The words are in i18n/locales/*.json under `story.<world>.<intro|outro>`,
 * one line per speaker below, in order.
 */
import type { WorldId } from './levels'
import type { SpriteName } from './sprites'

export type Speaker = 'dara' | 'yay' | 'mealea' | 'gearax'

export const SPEAKER_SPRITE: Record<Speaker, SpriteName> = {
  dara: 'dara',
  yay: 'yay',
  mealea: 'mealea',
  gearax: 'boss',
}

export const STORY: Record<WorldId, { intro: Speaker[], outro: Speaker[] }> = {
  backyard: { intro: ['dara', 'yay', 'dara', 'yay', 'yay'], outro: ['gearax', 'dara', 'gearax', 'yay'] },
  moonlit: { intro: ['dara', 'yay', 'dara', 'yay'], outro: ['gearax', 'dara'] },
  terraces: { intro: ['mealea', 'dara', 'mealea', 'yay'], outro: ['mealea', 'gearax', 'yay'] },
  temple: { intro: ['yay', 'dara', 'mealea'], outro: ['dara', 'gearax', 'yay'] },
  river: { intro: ['mealea', 'dara', 'yay'], outro: ['gearax', 'dara'] },
  factory: { intro: ['yay', 'mealea', 'dara'], outro: ['gearax', 'yay', 'gearax', 'dara', 'yay'] },
}
