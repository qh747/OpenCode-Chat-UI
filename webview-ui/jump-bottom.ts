/**
 * 「回到底部」胶囊的判定：视口是否在底部,以及向下滚轮累计到两格当量
 * （鼠标一格 wheel 事件约 120,触摸板按实际滚动量）就提示。向上滚清零
 * 累计,已显示的胶囊保持显示直到点击或到底。纯函数,便于脱离 DOM 测试。
 */

/** 「接近底部」的阈值（px），与 transcript 钉底判定共用一个语义。 */
export const BOTTOM_THRESHOLD = 40;

/** 向下滚轮累计到这个量（约两格）就显示胶囊。 */
export const JUMP_WHEEL_DELTA = 240;

export function isAtBottom(input: {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}): boolean {
  return input.scrollHeight - input.scrollTop - input.clientHeight < BOTTOM_THRESHOLD;
}

export interface JumpWheelDecision {
  /** 当前累计的向下滚动量。 */
  delta: number;
  /** 胶囊当前是否显示。 */
  show: boolean;
}

/**
 * 每次滚轮事件推进一次判定：已在底部不计数且直接隐没（重现需要重新滚
 * 满两格）；向上滚清零累计；向下滚累加,满两格当量显示。
 */
export function updateJumpWheel(
  current: JumpWheelDecision,
  deltaY: number,
  atBottom: boolean,
): JumpWheelDecision {
  if (atBottom) {
    return { delta: 0, show: false };
  }
  if (deltaY < 0) {
    return { delta: 0, show: current.show };
  }
  const delta = current.delta + deltaY;
  return { delta, show: current.show || delta >= JUMP_WHEEL_DELTA };
}
