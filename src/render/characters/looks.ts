/**
 * Character appearances: the data the character builder works from. Colours are sRGB hex.
 * New cast members are made by writing a Look; see showcase.html to preview them.
 */
export type Personality = 'lively' | 'busy' | 'calm';

export interface Look {
  skin: string;
  hair: string;
  hairStyle: 'short' | 'bun' | 'long';
  eyes: string;
  /** Shirt / main garment. */
  top: string;
  /** Vest, apron or robe trim. */
  accent: string;
  /** Belt, sash and small trims. */
  trim: string;
  legs: string;
  boots: string;
  cape?: string;
  robe?: boolean;
  hat?: string;
  /** Torso width multiplier. */
  build?: number;
  /** Gentler eyes for older characters. */
  calm?: boolean;
  /** Leather belt colour (default a warm brown). */
  belt?: string;
  /** Leather cuffs at the wrists (default: the belt colour). */
  cuffs?: string;
  /** An apron in this colour. */
  apron?: string;
  /** Open vest over the shirt (default on, unless a robe). */
  vest?: boolean;
  /** How they stand around: bouncy, fidgety or still. */
  personality?: Personality;
  /** Body construction: 'classic' (assembled parts) or 'sculpted' (one smooth form, fitted clothes). */
  shape?: 'classic' | 'sculpted';
  /** How the face is drawn. */
  faceStyle?: 'anime' | 'storybook' | 'soft' | 'natural';
}

export const LOOKS: Record<string, Look> = {
  player: {
    skin: '#ffdcc6',
    hair: '#7a3f2c',
    hairStyle: 'short',
    eyes: '#2f86a8',
    top: '#efe4cf',
    accent: '#2f8f93',
    trim: '#e2b45a',
    legs: '#5d4436',
    boots: '#4a3024',
    cape: '#d04c42',
    personality: 'lively',
  },
  merchant: {
    skin: '#eab792',
    hair: '#33243a',
    hairStyle: 'bun',
    eyes: '#7a4a2a',
    top: '#f0a84e',
    accent: '#5f9a4e',
    trim: '#c9543e',
    legs: '#5a4636',
    boots: '#3e2a20',
    build: 1.15,
    apron: '#6a9a52',
    vest: false,
    belt: '#7a4a2e',
    personality: 'busy',
  },
  keeper: {
    skin: '#ffe4d2',
    hair: '#eef1f7',
    hairStyle: 'long',
    eyes: '#5a6fc0',
    top: '#3f5ea8',
    accent: '#2f4380',
    trim: '#e8bb5e',
    legs: '#2f3f72',
    boots: '#2a2230',
    robe: true,
    hat: '#2f4380',
    calm: true,
    personality: 'calm',
  },
};

/** A varied villager look from a seed (hair, skin, clothes, build). */
export function villagerLook(seed: number): Look {
  let s = seed >>> 0;
  const r = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const styles: Look['hairStyle'][] = ['short', 'bun', 'long'];
  return {
    skin: pick(['#ffdcc6', '#f2c4a2', '#e2a97f', '#c98e64', '#a46b45', '#7d4e32']),
    hair: pick(['#2e2230', '#5a3424', '#7a3f2c', '#c9853e', '#e8c26a', '#4a2a4a', '#1f2a3a', '#9a9aa8']),
    hairStyle: pick(styles),
    eyes: pick(['#2f6f8f', '#5a3a24', '#3f7a48', '#6a4a9a', '#8a5a2a']),
    top: pick(['#e9a046', '#d9604c', '#5f9a4e', '#3f7aa8', '#c9a0d8', '#f2e2b8', '#8a5a9a', '#e07a8a']),
    accent: pick(['#5f9a4e', '#2f8f93', '#a8603e', '#3f5ea8', '#e8bb5e', '#8a3c44']),
    trim: pick(['#e2b45a', '#c9543e', '#f3d488', '#6a8a4a']),
    legs: pick(['#5a4636', '#3f3a52', '#6a5a3e', '#4a3a30']),
    boots: pick(['#3e2a20', '#4a3024', '#2a2230']),
    build: 0.95 + r() * 0.2,
    calm: r() < 0.3,
    vest: r() < 0.6,
    apron: r() < 0.25 ? pick(['#f2e8d0', '#c9b48a', '#8aa86a']) : undefined,
    belt: pick(['#6b4630', '#4a3226', '#8a5a36']),
    personality: pick(['lively', 'busy', 'calm'] as Personality[]),
  };
}
