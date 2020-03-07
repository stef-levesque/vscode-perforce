import { Event, Uri, workspace } from "vscode";
import { PerforceService } from "./PerforceService";
import { Display } from "./Display";

import * as fs from "fs";

export function mapEvent<I, O>(event: Event<I>, map: (i: I) => O): Event<O> {
    return (listener, thisArgs = null, disposables?) =>
        event(i => listener.call(thisArgs, map(i)), null, disposables);
}

export type UriArguments = {
    [key: string]: string | boolean;
};

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Utils {
    // normalize function for turning windows paths into
    // something comparable before and after processing
    export function normalize(path: string): string {
        path = path.replace(/\\\\/g, "/");
        path = path.replace(/\\/g, "/");
        const matches = /([A-Z]):(.*)/.exec(path);
        if (matches) {
            path = `${matches[1].toLowerCase()}:${matches[2]}`;
        }
        return path;
    }

    // Use ASCII expansion for special characters
    export function expansePath(path: string): string {
        if (workspace.getConfiguration("perforce").get("realpath", false)) {
            if (fs.existsSync(path)) {
                path = fs.realpathSync(path);
            }
        }

        const fixup = path
            .replace(/%/g, "%25")
            .replace(/\*/g, "%2A")
            .replace(/#/g, "%23")
            .replace(/@/g, "%40");
        const relativeToRoot = PerforceService.convertToRel(fixup);
        return relativeToRoot;
    }

    export function getDepotPathFromDepotUri(uri: Uri): string {
        return "//" + uri.authority + uri.path;
    }

    function encodeParam(param: string, value?: any) {
        if (value !== undefined && typeof value === "string") {
            return encodeURIComponent(param) + "=" + encodeURIComponent(value);
        } else if (value === undefined || value) {
            return encodeURIComponent(param);
        }
    }

    export function makePerforceDocUri(
        uri: Uri,
        command: string,
        p4Args?: string,
        otherArgs?: { [key: string]: string | boolean }
    ) {
        return uri.with({
            scheme: "perforce",
            query: makePerforceUriQuery(command, p4Args ?? "", otherArgs)
        });
    }

    export function makePerforceUriQuery(
        command: string,
        p4Args: string,
        otherArgs?: { [key: string]: string | boolean }
    ) {
        const allArgs = [encodeParam("p4args", p4Args), encodeParam("command", command)];
        if (otherArgs) {
            allArgs.push(
                ...Object.keys(otherArgs)
                    .filter(key => otherArgs[key] !== false)
                    .map(key => encodeParam(key, otherArgs[key]))
            );
        }
        return allArgs.join("&");
    }

    export function decodeUriQuery(query: string) {
        const argArr = query?.split("&") ?? [];
        const allArgs: UriArguments = {};
        argArr.forEach(arg => {
            const parts = arg.split("=");
            const name = decodeURIComponent(parts[0]);
            const value = parts[1] ? decodeURIComponent(parts[1]) : true;
            allArgs[name] = value;
        });

        return allArgs;
    }

    export interface CommandParams {
        file?: Uri | string;
        revision?: string;
        prefixArgs?: string[];
        gOpts?: string;
        input?: string;
        /**
         * hides std-err from the status bar (not from the log output)
         */
        hideStdErr?: boolean;
        /**
         * When set to true, will not reject if stderr is present
         */
        stdErrIsOk?: boolean;
    }

    // Get a string containing the output of the command
    export function runCommand(
        resource: Uri,
        command: string,
        params: CommandParams
    ): Promise<string> {
        return new Promise((resolve, reject) => {
            const {
                file,
                revision,
                prefixArgs,
                gOpts,
                input,
                hideStdErr,
                stdErrIsOk
            } = params;
            const args = prefixArgs ?? [];

            if (gOpts !== undefined) {
                command = gOpts + " " + command;
            }

            const revisionString = revision ?? "";

            if (file) {
                let path = typeof file === "string" ? file : file.fsPath;
                path = expansePath(path);

                args.push(path + revisionString);
            }

            PerforceService.execute(
                resource,
                command,
                (err, stdout, stderr) => {
                    err && Display.showError(err.toString());
                    if (stderr) {
                        hideStdErr
                            ? Display.channel.appendLine(stderr.toString())
                            : Display.showError(stderr.toString());
                    }
                    if (err) {
                        reject(err);
                    } else if (stderr && !stdErrIsOk) {
                        reject(stderr);
                    } else {
                        resolve(stdout);
                    }
                },
                args,
                input
            );
        });
    }

    // Get a string containing the output of the command specific to a file
    export function runCommandForFile(
        command: string,
        file: Uri,
        revision?: string,
        prefixArgs?: string[],
        gOpts?: string,
        input?: string
    ): Promise<string> {
        const resource = file;
        return runCommand(resource, command, {
            file,
            revision,
            prefixArgs,
            gOpts,
            input
        });
    }
}
