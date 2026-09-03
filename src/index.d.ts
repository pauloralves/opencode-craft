import type { Plugin } from "@opencode-ai/plugin";

export declare function syncLedger(targetDir?: string, options?: { verbose?: boolean; pythonScript?: string }): Promise<boolean>;
export declare const CraftPlugin: Plugin;
export default CraftPlugin;
