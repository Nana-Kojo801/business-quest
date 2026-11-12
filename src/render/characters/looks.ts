/** Character appearances. Colours are sRGB hex. */
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
  },
};
