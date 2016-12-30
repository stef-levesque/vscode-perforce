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

    export function getFile(localFilePath: string, revision: number) : Promise<string> {
        return new Promise((resolve, reject) => {
            var ext = Path.extname(localFilePath);
            var tmp = require("tmp");
            var tmpFilePath = tmp.tmpNameSync({ postfix: ext });
            var revisionString: string = isNaN(revision) ? '' : `#${revision}`;
            PerforceService.execute("print", (err, strdout, stderr) => {
                if(err){
                    reject(err);
                } else if (stderr) {
                    reject(stderr);
                } else {
                    resolve(tmpFilePath);
                }
            }, '-q -o "' + tmpFilePath + '" "' + localFilePath + revisionString + '"');
        });
    }
}