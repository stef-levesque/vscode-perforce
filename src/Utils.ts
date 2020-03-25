import { Event, workspace } from "vscode";
import { PerforceService } from "./PerforceService";

import * as fs from "fs";

export function mapEvent<I, O>(event: Event<I>, map: (i: I) => O): Event<O> {
    return (listener, thisArgs = null, disposables?) =>
        event(i => listener.call(thisArgs, map(i)), null, disposables);
}

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
}
