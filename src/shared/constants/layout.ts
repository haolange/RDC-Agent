export const LEFT_SIDEBAR_DEFAULT_WIDTH = 256;
export const LEFT_SIDEBAR_MIN_WIDTH = 220;
export const LEFT_SIDEBAR_MAX_WIDTH = 420;
export const LEFT_SIDEBAR_COLLAPSED_WIDTH = 0;

export const RIGHT_PANEL_DEFAULT_WIDTH = 312;
export const RIGHT_PANEL_MIN_WIDTH = 280;
export const RIGHT_PANEL_MAX_WIDTH = 520;
export const RIGHT_PANEL_COLLAPSED_WIDTH = 0;

/** The rail remains docked through compact desktop widths; the drawer is for genuinely narrow workspaces. */
export const RIGHT_RAIL_DRAWER_BREAKPOINT = 920;

export const APP_MIN_MAIN_WIDTH = 480;
export const APP_RESIZE_HANDLE_WIDTH = 8;

/** Composer-authoritative app floor when sidebars are collapsed or hidden. */
export const APP_MIN_WINDOW_WIDTH = APP_MIN_MAIN_WIDTH;

/** Minimum width when both sidebars remain expanded at their layout mins. */
export const APP_FULL_CHROME_MIN_WIDTH =
  APP_MIN_MAIN_WIDTH
  + LEFT_SIDEBAR_MIN_WIDTH
  + RIGHT_PANEL_MIN_WIDTH
  + APP_RESIZE_HANDLE_WIDTH * 2;

/** Single product max for page-shell / Local / composer / transcript outer rail. */
export const WORKBENCH_CHAT_RAIL_MAX_WIDTH = 'min(990px, 77%)';

export const TERMINAL_DEFAULT_HEIGHT = 328;
export const TERMINAL_MIN_HEIGHT = 180;
export const TERMINAL_MAX_HEIGHT = 720;
