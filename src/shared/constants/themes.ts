import type { AccentName, ThemeName } from '../types/workspace'

export interface ThemePalette {
  name: string
  isDark: boolean
  bg: string
  surface: string
  surfaceElevated: string
  header: string
  border: string
  text: string
  muted: string
  sel: string
  hover: string
  err: string
  errBg: string
  warn: string
  ok: string
  info: string
}

export const THEMES: Record<ThemeName, ThemePalette> = {
  dark: {
    name: 'Dark Studio',
    isDark: true,
    bg: '#0E1117',
    surface: '#161B22',
    surfaceElevated: '#1C222B',
    header: '#12161E',
    border: '#272E3A',
    text: '#E6EDF3',
    muted: '#8B949E',
    sel: '#1F2A3A',
    hover: '#1D2430',
    err: '#F87171',
    errBg: 'rgba(248, 113, 113, 0.12)',
    warn: '#FBBF24',
    ok: '#34D399',
    info: '#60A5FA'
  },
  light: {
    name: 'Light Crisp',
    isDark: false,
    bg: '#F7F8FA',
    surface: '#FFFFFF',
    surfaceElevated: '#F1F3F6',
    header: '#FFFFFF',
    border: '#E2E6ED',
    text: '#111827',
    muted: '#6B7280',
    sel: '#EEF2FF',
    hover: '#F3F4F6',
    err: '#DC2626',
    errBg: 'rgba(220, 38, 38, 0.08)',
    warn: '#D97706',
    ok: '#059669',
    info: '#2563EB'
  },
  modern: {
    name: 'Modern Slate',
    isDark: false,
    bg: '#F3F6FB',
    surface: '#FFFFFF',
    surfaceElevated: '#EBF0F7',
    header: '#F9FBFF',
    border: '#DCE3EE',
    text: '#0F172A',
    muted: '#64748B',
    sel: '#E0E7FF',
    hover: '#EFF4FB',
    err: '#E11D48',
    errBg: 'rgba(225, 29, 72, 0.08)',
    warn: '#D97706',
    ok: '#10B981',
    info: '#0284C7'
  },
  atelier: {
    name: 'Atelier Warm',
    isDark: false,
    bg: '#F7F4EE',
    surface: '#FCFBF8',
    surfaceElevated: '#EFE9DD',
    header: '#F2EDE2',
    border: '#DFD6C5',
    text: '#23201B',
    muted: '#736B5E',
    sel: '#EAE1CF',
    hover: '#F0EAD9',
    err: '#B91C1C',
    errBg: 'rgba(185, 28, 28, 0.08)',
    warn: '#B45309',
    ok: '#15803D',
    info: '#1D4ED8'
  },
  aurora: {
    name: 'Aurora Deep',
    isDark: true,
    bg: '#08131A',
    surface: '#0E1D26',
    surfaceElevated: '#132834',
    header: '#0B1821',
    border: '#1D3746',
    text: '#E2F3F5',
    muted: '#7FA5B8',
    sel: '#153445',
    hover: '#122B3A',
    err: '#FB7185',
    errBg: 'rgba(251, 113, 133, 0.12)',
    warn: '#FBBF24',
    ok: '#2DD4BF',
    info: '#38BDF8'
  }
}

export const ACCENTS: Record<AccentName, { name: string; color: string; hover: string; soft: string }> = {
  indigo: { name: 'Indigo', color: '#6366F1', hover: '#4F46E5', soft: 'rgba(99, 102, 241, 0.16)' },
  ocean: { name: 'Ocean', color: '#0EA5E9', hover: '#0284C7', soft: 'rgba(14, 165, 233, 0.16)' },
  teal: { name: 'Teal', color: '#14B8A6', hover: '#0D9488', soft: 'rgba(20, 184, 166, 0.16)' },
  violet: { name: 'Violet', color: '#8B5CF6', hover: '#7C3AED', soft: 'rgba(139, 92, 246, 0.16)' },
  graphite: { name: 'Graphite', color: '#64748B', hover: '#475569', soft: 'rgba(100, 116, 139, 0.2)' }
}
