import { type ChildProcess } from "child_process";
export interface ServerHandle {
    process: ChildProcess & {
        stdout: NodeJS.ReadableStream;
        stdin: NodeJS.WritableStream;
        stderr: NodeJS.ReadableStream;
    };
    initialization?: Record<string, unknown>;
}
export interface ServerInfo {
    id: string;
    extensions: string[];
    root: (file: string, workdir: string) => Promise<string | undefined>;
    spawn(root: string, workdir: string): Promise<ServerHandle | undefined>;
}
export declare const Typescript: ServerInfo;
export declare const Deno: ServerInfo;
export declare const Pyright: ServerInfo;
export declare const Gopls: ServerInfo;
export declare const RustAnalyzer: ServerInfo;
export declare const Clangd: ServerInfo;
export declare const Biome: ServerInfo;
export declare const RubyLSP: ServerInfo;
export declare const Zls: ServerInfo;
export declare const SourceKit: ServerInfo;
export declare const Dart: ServerInfo;
export declare const BashLS: ServerInfo;
export declare const YamlLS: ServerInfo;
export declare const LuaLS: ServerInfo;
export declare const PHPIntelephense: ServerInfo;
export declare const Svelte: ServerInfo;
export declare const Vue: ServerInfo;
export declare const Ocaml: ServerInfo;
export declare const ElixirLS: ServerInfo;
export declare const Prisma: ServerInfo;
export declare const TerraformLS: ServerInfo;
export declare const CSharp: ServerInfo;
export declare const FSharp: ServerInfo;
export declare const KotlinLS: ServerInfo;
export declare const JDTLS: ServerInfo;
export declare const TexLab: ServerInfo;
export declare const Gleam: ServerInfo;
export declare const DockerfileLS: ServerInfo;
export declare const NixLS: ServerInfo;
export declare const TypstLS: ServerInfo;
export declare const ClojureLS: ServerInfo;
export declare const HaskellLS: ServerInfo;
export declare const JuliaLS: ServerInfo;
export declare const CSSLS: ServerInfo;
export declare const HTMLLS: ServerInfo;
export declare const JSONLS: ServerInfo;
export declare const MarkdownLS: ServerInfo;
export declare const ALL_SERVERS: ServerInfo[];
