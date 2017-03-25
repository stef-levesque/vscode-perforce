import * as CP from 'child_process';
import * as Path from 'path';
import {PerforceService} from './PerforceService';

export namespace Utils
{
    export function normalizePath(path: string): string
    {
        var normalizedPath = path;

        if (!pathIsUNC(normalizedPath)) {
            var replaceable = normalizedPath.split('\\');
            normalizedPath = replaceable.join('\\\\');
        }
        
        normalizedPath = "\"" + normalizedPath + "\"";
        return normalizedPath;
    }

    function pathIsUNC(path: string): boolean {
        return path.indexOf('\\\\') == 0;
    }

    // Use ASCII expansion for special characters
    function expansePath(path: string): string {
        return path.replace('%', '%25').replace('*', '%2A').replace('#', '%23').replace('@', '%40');
    }

    // Get a path to a file containing the output of the command
    export function getFile(command: string, localFilePath?: string, revision?: number, prefixArgs?: string) : Promise<string> {
        return new Promise((resolve, reject) => {
            var args = prefixArgs != null ? prefixArgs : '';
            var revisionString: string = isNaN(revision) ? '' : `#${revision}`;

            var ext = Path.extname(localFilePath);
            var tmp = require("tmp");
            var tmpFilePath = tmp.tmpNameSync({ postfix: ext });

            var requirePipe = true;
            if (command == "print") {
                if(localFilePath == null) {
                    reject("P4 Print command require a file path");
                }

                // special case to directly output in the file
                args += ' -q -o "' + tmpFilePath + '"';
                requirePipe = false;
            }

            if (localFilePath != null) {
                args += ' "' + expansePath(localFilePath) + revisionString + '"'
            }

            if (requirePipe) {
                // forward all output to the file
                args += ' > "' + tmpFilePath + '"';
            }

            PerforceService.execute("print", (err, strdout, stderr) => {
                if(err){
                    reject(err);
                } else if (stderr) {
                    reject(stderr);
                } else {
                    resolve(tmpFilePath);
                }
            }, args);
        });
    }
}