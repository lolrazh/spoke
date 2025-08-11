export const SHADOW_PAD = 60; // px on each side to prevent CSS shadow clipping

// Keep pill flush to the top edge of the screen when visible
export const ISLAND_HIDDEN_Y = -100 - SHADOW_PAD;
export const ISLAND_VISIBLE_Y = -SHADOW_PAD;

// Base content dimensions for the expanded pill
export const CONTENT_WIDTH = 600;
export const CONTENT_HEIGHT = 700;

// Window envelope includes padding on all sides for shadows
export const ISLAND_WIDTH = CONTENT_WIDTH + SHADOW_PAD * 2; // 720
export const ISLAND_HEIGHT = CONTENT_HEIGHT + SHADOW_PAD * 2; // 760
