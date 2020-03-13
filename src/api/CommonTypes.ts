import { Uri } from "vscode";

export type FixedJob = { id: string; description: string[] };

export type ChangeInfo = {
    chnum: string;
    description: string;
    date: string;
    user: string;
    client: string;
    status?: string;
};

export type ChangeSpec = {
    description?: string;
    files?: ChangeSpecFile[];
    change?: string;
    rawFields: RawField[];
};

export type RawField = {
    name: string;
    value: string[];
};

export type ChangeSpecFile = {
    depotPath: string;
    action: string;
};

export type FstatInfo = {
    depotFile: string;
    [key: string]: string;
};

export type FileSpec =
    | {
          /** The filesystem path - without escaping special characters */
          fsPath: string;
          /** Optional suffix, e.g. 1 (converts to #1), @=2 */
          fragment?: string;
      }
    | Uri;

export type PerforceFile = FileSpec | string;

export function isFileSpec(obj: any): obj is FileSpec {
    return obj && obj.fsPath;
}

export function isUri(obj: any): obj is Uri {
    return obj && obj.fsPath && obj.scheme !== undefined;
}
