import { Event, Uri, workspace } from 'vscode';
import * as Path from 'path';
import { PerforceService } from './PerforceService';
import { Display } from './Display';

import * as fs from 'fs';

export function mapEvent<I, O>(event: Event<I>, map: (i: I) => O): Event<O> {
    return (listener, thisArgs = null, disposables?) => event(i => listener.call(thisArgs, map(i)), null, disposables);
}

export namespace Utils {
    // normalize function for turning windows paths into
    // something comparable before and after processing
    export function normalize(path): string {
        path = path.replace(/\\\\/g, '/');
        path = path.replace(/\\/g, '/');
        const matches = /([A-Z]):(.*)/.exec(path);
        if (matches) {
            path = `${matches[1].toLowerCase()}:${matches[2]}`;
        }
        return path;
    }

    // Use ASCII expansion for special characters
    export function expansePath(path: string): string {
        if (workspace.getConfiguration('perforce').get('realpath', false)) {
            if (fs.existsSync(path)) {
                path = fs.realpathSync(path);
            }
        }

        const fixup = path.replace(/%/g, '%25').replace(/\*/g, '%2A').replace(/#/g, '%23').replace(/@/g, '%40');
        const relativeToRoot = PerforceService.convertToRel(fixup);
        return relativeToRoot;        
    }

    export function processInfo(output): Map<string, string> {
        const map = new Map<string, string>();
        const lines = output.trim().split('\n');

        for (let i = 0, n = lines.length; i < n; ++i) {
            // Property Name: Property Value
            const matches = lines[i].match(/([^:]+): (.+)/);

            if (matches) {
                map.set(matches[1], matches[2]);
            }

        }

        return map;
    }

    export function isLoggedIn(compatibilityMode: string): Promise<boolean> {
        return new Promise((resolve, reject) => {
            if (compatibilityMode === 'sourcedepot') {
                resolve(true);
                return;
            }
            //TODO: find proper workspace
            let resource = workspace.workspaceFolders ? workspace.workspaceFolders[0].uri : Uri.file('');
            PerforceService.execute(resource, 'login', (err, stdout, stderr) => {
                err && Display.showError(err.toString());
                stderr && Display.showError(stderr.toString());
                if (err) {
                    reject(err);
                } else if (stderr) {
                    reject(stderr);
                } else {
                    resolve(true);
                }
            }, '-s');
        });
    }

    export function getSimpleOutput(resource: Uri, command: string): Promise<string> {
        return new Promise((resolve, reject) => {
            PerforceService.execute(resource, command, (err, stdout, stderr) => {
                err && Display.showError(err.toString());
                stderr && Display.showError(stderr.toString());
                if (err) {
                    reject(err);
                } else if (stderr) {
                    reject(stderr);
                } else {
                    resolve(stdout);
                }
            });
        });
    }

    // Get a string containing the output of the command
    export function getOutput(command: string, file: Uri, revision?: number, prefixArgs?: string, gOpts?: string, input?: string): Promise<string> {
        //TODO: find proper workspace
        let resource = file;
        return new Promise((resolve, reject) => {
            let args = prefixArgs != null ? prefixArgs : '';

            if (gOpts != null) {
                command = gOpts + ' ' + command;
            }

            var revisionString: string = revision == null || isNaN(revision) ? '' : `#${revision}`;

            if (file) {
                let path = (typeof file === 'string') ? file : file.fsPath;
                path = expansePath(path);
                
                args += ' "' + path + revisionString + '"';
            }

            PerforceService.execute(resource, command, (err, stdout, stderr) => {
                err && Display.showError(err.toString());
                stderr && Display.showError(stderr.toString());
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
    export function getFile(command: string, file: Uri, revision?: number, prefixArgs?: string): Promise<string> {
        //TODO: find proper workspace
        let resource = file;
        return new Promise((resolve, reject) => {
            var args = prefixArgs != null ? prefixArgs : '';
            var revisionString: string = isNaN(revision) ? '' : `#${revision}`;

            var ext = Path.extname(file.fsPath);
            var tmp = require("tmp");
            var tmpFilePath = tmp.tmpNameSync({ postfix: ext });

            var requirePipe = true;
            if (command == "print") {
                if (!file.fsPath) {
                    reject("P4 Print command require a file path");
                }

                // special case to directly output in the file
                args += ' -q -o "' + tmpFilePath + '"';
                requirePipe = false;
            }

            if (!file.fsPath) {
                args += ' "' + expansePath(file.fsPath) + revisionString + '"';
            }

            if (requirePipe) {
                // forward all output to the file
                args += ' > "' + tmpFilePath + '"';
            }

            PerforceService.execute(resource, "print", (err, strdout, stderr) => {
                if (err) {
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