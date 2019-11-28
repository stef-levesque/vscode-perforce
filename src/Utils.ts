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

    export function getDepotPathFromDepotUri(uri : Uri) : string {
        return "//"+uri.authority+uri.path;
    }

    function encodeParam(param : string , value?: any) {
        if (value !== undefined && typeof value === 'string') {
            return encodeURIComponent(param) + "=" + encodeURIComponent(value);
        } else if (value === undefined || value) {
            return encodeURIComponent(param)
        }
    }

    export function makePerforceDocUri(uri : Uri, command: string, p4Args?: string, otherArgs?: {[key: string]: string | boolean}) {
        return uri.with({scheme: 'perforce', query: makePerforceUriQuery(command, p4Args ?? '', otherArgs)});
    }

    export function makePerforceUriQuery(command: string, p4Args: string, otherArgs?: {[key: string]: string | boolean}) {
        let allArgs = [encodeParam('p4args', p4Args), encodeParam('command', command)];
        if (otherArgs) {
            allArgs.push(...
                Object.keys(otherArgs).filter(key => otherArgs[key] !== false).map((key) => encodeParam(key, otherArgs[key]))
            )
        }
        return allArgs.join("&");
    }

    export function decodeUriQuery(query: string) {
        let argArr = query?.split("&") ?? [];
        const allArgs = {};
        argArr.forEach(arg => {
            const parts = arg.split("=");
            const name = decodeURIComponent(parts[0]);
            const value = parts[1] ? decodeURIComponent(parts[1]) : true;
            allArgs[name] = value;
        });

        return allArgs;
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

    export function isLoggedIn(resource: Uri, compatibilityMode: string): Promise<boolean> {
        return new Promise((resolve, reject) => {
            if (compatibilityMode === 'sourcedepot') {
                resolve(true);
                return;
            }
            
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

    export function getOutputs(resource: Uri, command: string): Promise<[string, string]> {
        return new Promise((resolve, reject) => {
            PerforceService.execute(resource, command, (err, stdout, stderr) => {
                err && Display.showError(err.toString());
                if (err) {
                    reject(err);
                }
                resolve([stdout, stderr]);
            });
        });
    }

    // Get a string containing the output of the command
    export function runCommand(resource: Uri, command: string, file?: Uri | string | null, revision?: number | string, prefixArgs?: string, gOpts?: string, input?: string): Promise<string> {
        return new Promise((resolve, reject) => {
            let args = prefixArgs != null ? prefixArgs : '';
    
            if (gOpts != null) {
                command = gOpts + ' ' + command;
            }
    
            let revisionString: string = '';
            if (typeof revision === 'string') {
                revisionString = revision;
            } else if (revision != null && !isNaN(revision)) {
                revisionString = `#${revision}`;
            }
    
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

    // Get a string containing the output of the command specific to a file
    export function runCommandForFile(command: string, file: Uri, revision?: number | string, prefixArgs?: string, gOpts?: string, input?: string): Promise<string> {
        let resource = file;
        return runCommand(resource, command, file, revision, prefixArgs, gOpts, input);
    }

    // Get a path to a file containing the output of the command
    // TODO this is only used for print - seems unecessary when we have a perforce content provider
    export function getFile(command: string, file: Uri, revision?: number, prefixArgs?: string): Promise<string> {
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

            if (file.fsPath) {
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