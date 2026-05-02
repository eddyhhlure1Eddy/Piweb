import { type Diagnostic } from "./client.js";
import * as LSPDiagnostic from "./diagnostic.js";
export { LSPDiagnostic };
export declare function init(workdir: string, enabledServers?: string[]): Promise<void>;
export declare function shutdown(): Promise<void>;
export declare function touchFile(filePath: string, waitForDiagnostics: boolean, workdir: string): Promise<void>;
export declare function getDiagnostics(workdir: string): Promise<Record<string, Diagnostic[]>>;
export declare function getDiagnosticsSync(workdir: string): Record<string, Diagnostic[]>;
export declare function hasClients(file: string, workdir: string): Promise<boolean>;
export declare function getStatus(): {
    id: string;
    name: string;
    root: string;
    status: string;
}[];
export type { Diagnostic };
