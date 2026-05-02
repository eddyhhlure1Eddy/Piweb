export interface FormatterInfo {
    name: string;
    extensions: string[];
    command: (filePath: string) => string[] | false;
}
export declare function formatFile(filePath: string): Promise<boolean>;
