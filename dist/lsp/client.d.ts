import { createMessageConnection } from "vscode-jsonrpc/node.js";
import type { Diagnostic as VSCodeDiagnostic } from "vscode-languageserver-types";
type Diagnostic = VSCodeDiagnostic;
interface LSPServerHandle {
    process: import("child_process").ChildProcess;
    initialization?: Record<string, unknown>;
}
type DiagnosticsCallback = (path: string, serverID: string) => void;
export interface LSPClientInfo {
    root: string;
    serverID: string;
    connection: ReturnType<typeof createMessageConnection>;
    diagnostics: Map<string, Diagnostic[]>;
    notify: {
        open(request: {
            path: string;
        }): Promise<void>;
    };
    waitForDiagnostics(request: {
        path: string;
    }): Promise<void>;
    shutdown(): Promise<void>;
}
export declare function createLSPClient(input: {
    serverID: string;
    server: LSPServerHandle;
    root: string;
    directory: string;
    onDiagnostics?: DiagnosticsCallback;
}): Promise<LSPClientInfo>;
export type { Diagnostic, LSPServerHandle };
