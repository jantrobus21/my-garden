export const colors = {
  surface: "#F9FAF7",
  onSurface: "#1A211C",
  surfaceSecondary: "#FFFFFF",
  onSurfaceSecondary: "#3A453C",
  surfaceTertiary: "#EAEFE8",
  onSurfaceTertiary: "#29322A",
  surfaceInverse: "#232A25",
  onSurfaceInverse: "#F0F4EE",
  brand: "#3C6E4A",
  brandPrimary: "#3C6E4A",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#D3E3D7",
  onBrandSecondary: "#1E3D27",
  brandTertiary: "#E5EDE8",
  onBrandTertiary: "#2A5235",
  success: "#367548",
  onSuccess: "#FFFFFF",
  warning: "#C27A30",
  onWarning: "#FFFFFF",
  error: "#B84A4A",
  onError: "#FFFFFF",
  info: "#4A6E78",
  onInfo: "#FFFFFF",
  border: "#E1E8E2",
  borderStrong: "#B9C7BC",
  divider: "#E6EDE8",
  scrim: "rgba(35, 42, 37, 0.6)",
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
};

export const radius = {
  sm: 6,
  md: 12,
  lg: 20,
  pill: 999,
};

export const typeScale = {
  sm: 12,
  base: 14,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
};

export const statusMeta: Record<string, { label: string; bg: string; fg: string }> = {
  healthy: { label: "Healthy", bg: "#D3E3D7", fg: "#1E3D27" },
  thirsty: { label: "Thirsty", bg: "#F4D9B8", fg: "#7A4A12" },
  needs_fertilizer: { label: "Feed Me", bg: "#E5DDB6", fg: "#5A5018" },
  issue: { label: "Issue", bg: "#F3CECE", fg: "#7A1F1F" },
};
