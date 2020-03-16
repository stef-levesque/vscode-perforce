import { Event, Uri, workspace } from "vscode";
import { PerforceService } from "./PerforceService";

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
            query: makePerforceUriQuery(command, p4Args ?? "", {
                ...Utils.decodeUriQuery(uri.query), // use existing params
                ...otherArgs
            })
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
                    .filter(param => !!param)
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
}
