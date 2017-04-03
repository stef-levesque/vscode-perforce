import * as CP from 'child_process';
import * as Path from 'path';
import { PerforceService } from './PerforceService';

export namespace Utils
{
    const ztagRegex = /^\.\.\.\s+(\w+)\s+(.+)/;

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

    // process output from a p4 command executed with -ztag
    function processZtag(output): Map<string, string> {
        const map = new Map<string, string>();
        const lines = output.trim().split('\n');

        for (let i = 0, n = lines.length; i < n; ++i) {
            // ... key value
            const matches = lines[i].match(/\.\.\.\s(.[\w-]+)\s(.+)/);

            if (matches) {
                map.set(matches[1], matches[2]);
            }

        }

        return map;
    }

    // Get a map containing the keys and values of the command
    export function getZtag(command: string, localFilePath?: string, revision?: number, prefixArgs?: string): Promise<Map<string, string>> {
        return new Promise((resolve, reject) => {
            getOutput(command, localFilePath, revision, prefixArgs, '-ztag').then(output => {
                const map = processZtag(output);
                resolve( map );
            });
        });

    }

    export function isLoggedIn() : Promise<boolean> {
        return new Promise((resolve, reject) => {
            PerforceService.execute('login', (err, stdout, stderr) => {
                if (err) {
                    resolve(false);
                } else if (stderr) {
                    resolve(false);
                } else {
                    resolve(true);
                }
            }, '-s');
        });
    }

    // Get a string containing the output of the command
    export function getOutput(command: string, localFilePath?: string, revision?: number, prefixArgs?: string, gOpts?: string, input?: string): Promise<string> {
        return new Promise((resolve, reject) => {
            let args = prefixArgs != null ? prefixArgs : '';
            
            if (gOpts != null) {
                command = gOpts + ' ' + command;
            }

            var revisionString: string = revision == null || isNaN(revision) ? '' : `#${revision}`;

            if (localFilePath) {
                args += ' "' + expansePath(localFilePath) + revisionString + '"'
            }

            PerforceService.execute(command, (err, stdout, stderr) => {
                if (err) {
                    reject(err);
                } else if (stderr) {
                    reject(stderr);
                } else {
                    resolve(stdout);
                }
            }, args, null, input);
        });
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