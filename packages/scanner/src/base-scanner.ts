import type { ScanResult, ScanTargetConfig } from "./types.js";

export abstract class BaseScanner {
  abstract scan(config: ScanTargetConfig): Promise<ScanResult>;
}
