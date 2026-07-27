import {
  APP_MIN_MAIN_WIDTH,
  APP_RESIZE_HANDLE_WIDTH,
  LEFT_SIDEBAR_COLLAPSED_WIDTH,
  LEFT_SIDEBAR_MIN_WIDTH,
  RIGHT_PANEL_COLLAPSED_WIDTH,
  RIGHT_PANEL_MIN_WIDTH,
  WORKBENCH_CHAT_RAIL_MAX_WIDTH,
} from '@shared/constants/layout';

export { WORKBENCH_CHAT_RAIL_MAX_WIDTH };

type SidebarState = {
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  minMainWidth: number;
};

type SidebarWidths = {
  left: number;
  right: number;
};

const reduceOverflow = (
  desired: number,
  minimum: number,
  overflow: number,
): { width: number; remainingOverflow: number } => {
  const reducible = Math.max(0, desired - minimum);
  const reduction = Math.min(reducible, overflow);
  return {
    width: desired - reduction,
    remainingOverflow: overflow - reduction,
  };
};

export const getResponsiveMinMainWidth = (_containerWidth: number): number => APP_MIN_MAIN_WIDTH;

const getResizeHandleAllowance = (
  leftCollapsed: boolean,
  rightCollapsed: boolean,
  rightVisible: boolean,
): number => (
  (leftCollapsed ? 0 : APP_RESIZE_HANDLE_WIDTH)
  + (!rightVisible || rightCollapsed ? 0 : APP_RESIZE_HANDLE_WIDTH)
);

const canFitLayout = (
  containerWidth: number,
  leftWidth: number,
  rightWidth: number,
  leftCollapsed: boolean,
  rightCollapsed: boolean,
  minMainWidth: number,
  rightVisible: boolean,
): boolean => {
  const desiredLeft = leftCollapsed ? LEFT_SIDEBAR_COLLAPSED_WIDTH : leftWidth;
  const desiredRight = !rightVisible ? 0 : (rightCollapsed ? RIGHT_PANEL_COLLAPSED_WIDTH : rightWidth);
  const availableSidebarSpace = Math.max(
    0,
    containerWidth - minMainWidth - getResizeHandleAllowance(leftCollapsed, rightCollapsed, rightVisible),
  );
  return desiredLeft + desiredRight <= availableSidebarSpace;
};

export const resolveResponsiveSidebarState = (
  containerWidth: number,
  leftWidth: number,
  rightWidth: number,
  leftCollapsed: boolean,
  rightCollapsed: boolean,
  rightVisible: boolean,
): SidebarState => {
  if (containerWidth <= 0) {
    return {
      leftCollapsed,
      rightCollapsed,
      minMainWidth: APP_MIN_MAIN_WIDTH,
    };
  }

  const minMainWidth = getResponsiveMinMainWidth(containerWidth);
  let nextLeftCollapsed = leftCollapsed;
  let nextRightCollapsed = rightVisible ? rightCollapsed : true;

  if (!canFitLayout(containerWidth, leftWidth, rightWidth, nextLeftCollapsed, nextRightCollapsed, minMainWidth, rightVisible)) {
    nextRightCollapsed = true;
  }

  if (!canFitLayout(containerWidth, leftWidth, rightWidth, nextLeftCollapsed, nextRightCollapsed, minMainWidth, rightVisible)) {
    nextLeftCollapsed = true;
  }

  return {
    leftCollapsed: nextLeftCollapsed,
    rightCollapsed: nextRightCollapsed,
    minMainWidth,
  };
};

export const resolveSidebarWidths = (
  containerWidth: number,
  leftWidth: number,
  rightWidth: number,
  leftCollapsed: boolean,
  rightCollapsed: boolean,
  minMainWidth: number,
  rightVisible: boolean,
): SidebarWidths => {
  if (containerWidth <= 0) {
    return {
      left: leftCollapsed ? LEFT_SIDEBAR_COLLAPSED_WIDTH : leftWidth,
      right: !rightVisible ? 0 : (rightCollapsed ? RIGHT_PANEL_COLLAPSED_WIDTH : rightWidth),
    };
  }

  const desiredLeft = leftCollapsed ? LEFT_SIDEBAR_COLLAPSED_WIDTH : leftWidth;
  const desiredRight = !rightVisible ? 0 : (rightCollapsed ? RIGHT_PANEL_COLLAPSED_WIDTH : rightWidth);
  const minLeft = leftCollapsed ? LEFT_SIDEBAR_COLLAPSED_WIDTH : LEFT_SIDEBAR_MIN_WIDTH;
  const minRight = !rightVisible ? 0 : (rightCollapsed ? RIGHT_PANEL_COLLAPSED_WIDTH : RIGHT_PANEL_MIN_WIDTH);
  const availableSidebarSpace = Math.max(
    0,
    containerWidth - minMainWidth - getResizeHandleAllowance(leftCollapsed, rightCollapsed, rightVisible),
  );
  const desiredTotal = desiredLeft + desiredRight;

  if (desiredTotal <= availableSidebarSpace) {
    return { left: desiredLeft, right: desiredRight };
  }

  let overflow = desiredTotal - availableSidebarSpace;
  const leftPass = reduceOverflow(desiredLeft, minLeft, overflow);
  overflow = leftPass.remainingOverflow;
  const rightPass = reduceOverflow(desiredRight, minRight, overflow);
  overflow = rightPass.remainingOverflow;

  if (overflow > 0) {
    const secondLeftPass = reduceOverflow(leftPass.width, minLeft, overflow);
    overflow = secondLeftPass.remainingOverflow;
    const secondRightPass = reduceOverflow(rightPass.width, minRight, overflow);
    return {
      left: Math.round(secondLeftPass.width),
      right: Math.round(secondRightPass.width),
    };
  }

  return {
    left: Math.round(leftPass.width),
    right: Math.round(rightPass.width),
  };
};
