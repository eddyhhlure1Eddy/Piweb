import type { Diagnostic } from "./client.js";
export declare function pretty(diagnostic: Diagnostic): string;
export declare function report(file: string, issues: Diagnostic[]): string;
export declare function reportCrossFile(filePath: string, allDiagnostics: Record<string, Diagnostic[]>, maxFiles?: number): string;
