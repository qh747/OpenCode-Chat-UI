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

// --- 极简内存文件系统：revertFile 单测使用 -------------------------------

/** 键为绝对路径（fsPath）的内存文件内容。 */
export const memoryFiles = new Map<string, string>();

/** 记录进回收站的 delete 目标路径。 */
export const trashedPaths: string[] = [];

/** 记录 createDirectory 的目录路径。 */
export const createdDirectories: string[] = [];

/** 每个测试自行清空内存文件系统与记录。 */
export function resetFs(): void {
  memoryFiles.clear();
  trashedPaths.length = 0;
  createdDirectories.length = 0;
}

/** 与 vscode.workspace.fs 行为一致的最小实现（内存版）。 */
export const fs = {
  /** 文件在内存文件系统里即存在；否则与真实实现一致地抛错（ENOENT）。 */
  async stat(uri: { fsPath: string }): Promise<{ type: number }> {
    if (!memoryFiles.has(uri.fsPath)) {
      throw new Error(`ENOENT: ${uri.fsPath}`);
    }
    return { type: 0 };
  },
  async readFile(uri: { fsPath: string }): Promise<Buffer> {
    const content = memoryFiles.get(uri.fsPath);
    if (content === undefined) {
      throw new Error(`ENOENT: ${uri.fsPath}`);
    }
    return Buffer.from(content, "utf8");
  },
  async writeFile(uri: { fsPath: string }, content: Buffer): Promise<void> {
    memoryFiles.set(uri.fsPath, content.toString("utf8"));
  },
  async delete(uri: { fsPath: string }): Promise<void> {
    trashedPaths.push(uri.fsPath);
    memoryFiles.delete(uri.fsPath);
  },
  async createDirectory(uri: { fsPath: string }): Promise<void> {
    createdDirectories.push(uri.fsPath);
  },
};

/** git.ts/revertFile/sendNow 运行时用到的 workspace API 面。 */
export const workspace = {
  name: "stub",
  workspaceFolders: undefined,
  fs,
  /** 与 vscode.workspace.getConfiguration 行为一致：总是回给调用方的回退值。 */
  getConfiguration(_section: string) {
    return {
      get(_key: string, fallback?: unknown) {
        return fallback;
      },
    };
  },
};

/** 与 vscode.Uri.file / joinPath 行为一致的最小实现（仅 fsPath/path 字段）。 */
export const Uri = {
  file(path: string): { fsPath: string; path: string } {
    return { fsPath: path, path };
  },
  joinPath(base: { path: string }, ...segments: string[]): { fsPath: string; path: string } {
    const joined = [base.path.replace(/\/$/, ""), ...segments].join("/");
    return { fsPath: joined, path: joined };
  },
};

/** 与 vscode.env 行为一致的最小实现。 */
export const env = { language: "en" };

/** 与 vscode.window 行为一致的最小实现（只覆盖测试用到的 API）。 */
export const window = {
  createOutputChannel(_name: string) {
    return {
      appendLine(_line: string): void {},
      show(_preserveFocus?: boolean): void {},
      dispose(): void {},
    };
  },
};

/** 一次被记录下来的 executeCommand 调用，供断言使用。 */
export interface RecordedCommandCall {
  command: string;
  args: unknown[];
}

const registeredCommands = new Map<string, (...args: unknown[]) => unknown>();

/** 测试可读取的 executeCommand 调用记录。 */
export const executedCommands: RecordedCommandCall[] = [];

/** 每个测试自行清空命令注册表和调用记录。 */
export function resetCommands(): void {
  registeredCommands.clear();
  executedCommands.length = 0;
}

/** 与 vscode.commands 行为一致的最小实现：注册、执行、记录原生设置页调用。 */
export const commands = {
  registerCommand(id: string, callback: (...args: unknown[]) => unknown): Disposable {
    registeredCommands.set(id, callback);
    return new Disposable(() => {
      if (registeredCommands.get(id) === callback) {
        registeredCommands.delete(id);
      }
    });
  },
  async executeCommand(command: string, ...args: unknown[]): Promise<unknown> {
    if (command === "workbench.action.openSettings") {
      executedCommands.push({ command, args });
      return undefined;
    }
    return registeredCommands.get(command)?.(...args);
  },
};
