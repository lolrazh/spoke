export const SHADOW_PAD = 60; // px on each side to prevent CSS shadow clipping

export const ISLAND_HIDDEN_Y = -100 - SHADOW_PAD;
export const ISLAND_VISIBLE_Y = 10 - SHADOW_PAD;

// Expanded pill is 600×610 → window must include padding on all sides
export const ISLAND_WIDTH = 600 + SHADOW_PAD * 2; // 720
export const ISLAND_HEIGHT = 610 + SHADOW_PAD * 2; // 730
export const ISLAND_RADIUS = 6;
