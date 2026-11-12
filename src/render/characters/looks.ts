/** Character appearances. Colours are sRGB hex. */
export interface Look {
  skin: string;
  hair: string;
  hairStyle: 'short' | 'bun' | 'long';
  eyes: string;
  top: string;
  accent: string;
  legs: string;
  boots: string;
  /** Optional cape colour. */
  cape?: string;
  /** A long robe instead of a short tunic hem. */
  robe?: boolean;
  /** Optional wide-brimmed hat colour. */
  hat?: string;
  /** Torso width multiplier. */
  build?: number;
}

export const LOOKS: Record<string, Look> = {
  player: {
    skin: '#ffd9c2',
    hair: '#6b3a2a',
    hairStyle: 'short',
    eyes: '#2f6f8f',
    top: '#e4d3b2',
    accent: '#2f8f93',
    legs: '#6a4a3a',
    boots: '#4a3024',
    cape: '#d04c42',
  },
  merchant: {
    skin: '#e8b48f',
    hair: '#2e2230',
    hairStyle: 'bun',
    eyes: '#5a3a24',
    top: '#e9a046',
    accent: '#5f9a4e',
    legs: '#5a4636',
    boots: '#3e2a20',
    build: 1.18,
  },
  keeper: {
    skin: '#ffe2cf',
    hair: '#e9edf4',
    hairStyle: 'long',
    eyes: '#4a5fa8',
    top: '#3f5ea8',
    accent: '#e8bb5e',
    legs: '#2f3f72',
    boots: '#2a2230',
    robe: true,
    hat: '#2f4380',
  },
};
