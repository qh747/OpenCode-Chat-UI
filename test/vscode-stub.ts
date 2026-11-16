// 极简 vscode 模块替身：仅供测试构建（esbuild alias）为 src/git.ts 提供运行时 API 面。
// 类型检查仍使用真实的 @types/vscode，alias 只在 esbuild --tests 打包时生效。

/** 与 vscode.Disposable 行为一致的最小实现。 */
export class Disposable {
  constructor(private readonly call: () => void) {}
  dispose(): void {
    this.call();
  }
}

/** 与 vscode.EventEmitter 行为一致的最小实现。 */
export class EventEmitter<T> {
  private listeners: Array<(value: T) => void> = [];

  readonly event = (listener: (value: T) => void): Disposable => {
    this.listeners.push(listener);
    return new Disposable(() => {
      this.listeners = this.listeners.filter((item) => item !== listener);
    });
  };

  fire(value: T): void {
    for (const listener of [...this.listeners]) {
      listener(value);
    }
  }

  dispose(): void {
    this.listeners = [];
  }
}

/**
 * 测试通过全局槽 `__vscodeGitExtensionForTest` 注入假的 vscode.git 扩展导出；
 * 未注入时等价于"git 扩展不可用"。
 */
export const extensions = {
  getExtension<T>(_id: string): T | undefined {
    const slots = globalThis as Record<string, unknown>;
    return (slots.__vscodeGitExtensionForTest as T | undefined) ?? undefined;
  },
};

/** 占位：git.ts 运行时未使用 workspace 下的 API。 */
export const workspace = { name: "stub" };
