// jsdom 全局环境，必须先于 react-dom 的 import 执行（ESM import 按声明顺序
// 初始化，react-dom 在模块初始化时探测 TextEvent / documentMode 来选择事件
// 路径，补丁晚了它就退化到 IE 的 attachEvent 兼容路径并崩溃）。
import { JSDOM } from "jsdom";

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
const globalAny = globalThis as Record<string, unknown>;
globalAny.window = dom.window;
globalAny.document = dom.window.document;
Object.defineProperty(globalAny, "navigator", {
  value: dom.window.navigator,
  writable: true,
  configurable: true,
});
globalAny.HTMLElement = dom.window.HTMLElement;
globalAny.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
globalAny.HTMLInputElement = dom.window.HTMLInputElement;
globalAny.Event = dom.window.Event;
globalAny.KeyboardEvent = dom.window.KeyboardEvent;
globalAny.MouseEvent = dom.window.MouseEvent;
// React 的 input 事件现代化路径要求 window.TextEvent 存在，jsdom 没有；
// 缺了它会退化到 IE 的 attachEvent 兼容路径并崩溃。
dom.window.TextEvent = dom.window.Event as unknown as typeof TextEvent;
globalAny.TextEvent = dom.window.TextEvent;
// React 18 的 act() 需要显式声明测试环境。
globalAny.IS_REACT_ACT_ENVIRONMENT = true;

export { dom };
