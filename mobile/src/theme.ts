// Design tokens shared with the web dashboard (dashboard/tailwind.config.js).
export const colors = {
  surface: '#ffffff',
  plane: '#f3f5f8',
  ink: '#111827',
  ink2: '#4b5563',
  muted: '#6b7280',
  border: '#e3e7ed',
  navy: '#0f1c2e',
  navy2: '#18293f',
  navy3: '#243a57',
  primary: '#1d4f91',
  primarySoft: '#e8eff8',
  // Status hues: `*` for marks and fills, `*Ink` for text, `*Soft` for backgrounds.
  good: '#0ca30c',
  goodInk: '#166534',
  goodSoft: '#e7f6e7',
  critical: '#d03b3b',
  criticalInk: '#b42318',
  criticalSoft: '#fbebeb',
  warning: '#fab219',
  warningInk: '#92400e',
  warningSoft: '#fef4d9',
  position: '#2a78d6',
} as const;

export const radius = { sm: 6, md: 10, lg: 14 } as const;

export const headerOptions = {
  headerStyle: { backgroundColor: colors.navy },
  headerTintColor: '#ffffff',
  headerTitleStyle: { fontSize: 16, fontWeight: '600' as const },
  headerShadowVisible: false,
  contentStyle: { backgroundColor: colors.plane },
};
