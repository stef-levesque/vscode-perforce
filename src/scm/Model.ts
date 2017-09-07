import { scm, Uri, EventEmitter, Event, SourceControl, SourceControlResourceGroup, Disposable, ProgressLocation, window, workspace, commands } from 'vscode';
import { Utils } from '../Utils';
import { Display } from '../Display';
import { Resource } from './Resource';
import { Status } from './Status';

import * as Path from 'path';
import * as vscode from 'vscode';

function isResourceGroup(arg: any): arg is SourceControlResourceGroup {
    return arg.id !== undefined;
}


export class Model implements Disposable {
    private _disposables: Disposable[] = [];

    private _onDidChange = new EventEmitter<void>();
    public get onDidChange(): Event<void> {
        return this._onDidChange.event;
    }

    public dispose() {
        if (this._disposables) {
            this._disposables.forEach(d => d.dispose());
            this._disposables = [];
        }
    }

    public _sourceControl: SourceControl;
    private _infos = new Map<string, string>();

    private _defaultGroup: SourceControlResourceGroup;
    private _pendingGroups = new Map<number, { description: string, group: SourceControlResourceGroup }>();
    private _compatibilityMode: string;

    public get ResourceGroups(): SourceControlResourceGroup[] {
        const result: SourceControlResourceGroup[] = [];

        if (this._defaultGroup)
            result.push(this._defaultGroup);

        this._pendingGroups.forEach((value) => {
            result.push(value.group);
        });

        return result;
    }

    public constructor(compatibilityMode: string) {
        this._compatibilityMode = compatibilityMode;
    }

    public async Sync(): Promise<void> {
        const loggedin = await Utils.isLoggedIn(this._compatibilityMode);
        if (!loggedin) {
            return;
        }

        window.withProgress({
            location: ProgressLocation.SourceControl,
            title: 'Syncing...'
        }, () => this.syncUpdate());
    }

    public async Refresh(): Promise<void> {
        this.clean();
        const loggedin = await Utils.isLoggedIn(this._compatibilityMode);
        if (!loggedin) {
            return;
        }

        await window.withProgress({
            location: ProgressLocation.SourceControl,
            title: 'Updating info...'
        }, () => this.updateInfo());
        window.withProgress({
            location: ProgressLocation.SourceControl,
            title: 'Updating status...'
        }, () => this.updateStatus());
    }

    public async ProcessChangelist(): Promise<void> {
        const command = 'change';
        let args = '-o ';

        const input = scm.inputBox.value;
        scm.inputBox.value = '';
        let description = input;

        const matches = input.match(/^#(\d+)\r?\n([^]+)/);
        if (matches) {
            // Change existing changelist
            args += matches[1];
            description = matches[2];
        }

        const spec: string = await Utils.getOutput(command, null, null, args);
        const changeFields = spec.trim().split(/\n\r?\n/);
        let newSpec = '';
        for (let field of changeFields) {
            if (field.startsWith('Description:')) {
                newSpec += 'Description:\n\t';
                newSpec += description.trim().split('\n').join('\n\t');
                newSpec += '\n\n';
            } else {
                newSpec += field;
                newSpec += '\n\n';
            }
        }

        args = '-i';
        Utils.getOutput(command, null, null, args, null, newSpec).then((output) => {
            Display.channel.append(output);
            this.Refresh();
        }).catch((reason) => {
            Display.showError(reason.toString());
        });
    }

    public async EditChangelist(input: SourceControlResourceGroup): Promise<void> {
        let descStr = '';
        const id = input.id;
        let args = '-o ';
        if (id.startsWith('pending')) {
            const chnum = id.substr(id.indexOf(':') + 1);
            descStr = `#${chnum}\n`;
            args += chnum;
        }

        const output: string = await Utils.getOutput('change', null, null, args);
        const changeFields = output.trim().split(/\n\r?\n/);
        for (let field of changeFields) {
            if (field.startsWith('Description:')) {
                descStr += field.substr(field.indexOf('\n')).replace(/\n\t/g, '\n').trim();
                break;
            }
        }

        scm.inputBox.value = descStr;
    }

    public async Describe(input: SourceControlResourceGroup): Promise<void> {
        const id = input.id;

        if (id.startsWith('default')) {
            const command = 'change';
            const args = '-o';
            const uri: Uri = new Uri().with({ scheme: 'perforce', authority: command, query: args });
            commands.executeCommand<void>("vscode.open", uri);
        } else if (id.startsWith('pending')) {
            const command = 'describe';
            const args = id.substr(id.indexOf(':') + 1);
            const uri: Uri = new Uri().with({ scheme: 'perforce', authority: command, query: args });
            commands.executeCommand<void>("vscode.open", uri);
        }
    }

    public async SubmitDefault(): Promise<void> {
        const loggedin = await Utils.isLoggedIn(this._compatibilityMode);
        if (!loggedin) {
            return;
        }

        const noFiles = 'File(s) not opened on this client.';
        let fileListStr;
        try {
            fileListStr = await Utils.getOutput('opened', null, null, '-c default');
            if (fileListStr === noFiles) {
                Display.showError(noFiles);
                return;
            }
        } catch (err) {
            Display.showError(err.toString());
            return;
        }


        const fileList = fileListStr.split("\n").map(file => {
            const endOfFileStr = file.indexOf('#');
            return file.substring(0, endOfFileStr);
        });

        const descStr = await vscode.window.showInputBox({
            placeHolder: 'New changelist description',
            validateInput: (value: string) => {
                if (!value || value.trim().length === 0) {
                    return 'Cannot set empty description';
                }
                return null;
            },
            ignoreFocusOut: true
        });

        if (descStr === undefined || descStr.trim().length == 0) {
            // pressing enter with no other input will still submit the empty string
            Display.showError('Cannot set empty description');
            return;
        }

        const pick = await vscode.window.showQuickPick(["Submit", "Save Changelist", "Cancel"], { ignoreFocusOut: true });

        let command;
        let args = '';

        if (!pick || pick == "Cancel") {
            return;
        }

        if(pick === "Submit") {
            this.Submit(descStr);
            return;
        }

        // Save to changelist
        const spec: string = await Utils.getOutput('change', null, null, '-o');
        const changeFields = spec.trim().split(/\n\r?\n/);
        let newSpec = '';
        for (let field of changeFields) {
            if (field.startsWith('Description:')) {
                newSpec += 'Description:\n\t';
                newSpec += descStr.trim().split('\n').join('\n\t');
                newSpec += '\n\n';
            } else {
                newSpec += field;
                newSpec += '\n\n';
            }
        }

        let newChangelistNumber;
        try {
            const createdStr = await Utils.getOutput('change', null, null, '-i', null, newSpec);
            // Change #### created with ... 
            // newChangelistNumber = createdStr.match(/Change\s(\d+)\screated with/);
            Display.channel.append(createdStr);
            this.Refresh();
        } catch(err) {
            Display.showError(err.toString());
            return;
        }
    }


    public async Submit(input: Resource | SourceControlResourceGroup | string): Promise<void> {
        const command = 'submit';
        let args = '';

        if (typeof input === 'string') {
            args = `-d "${input}"`;
        } else {
            const group = input as SourceControlResourceGroup;
            const id = group.id;
            if (id) {
                const chnum = id.substr(id.indexOf(':') + 1);
                if (id.startsWith('pending')) {
                    args = '-c ' + chnum;
                } else if (id.startsWith('shelved')) {
                    args = '-e ' + chnum;
                } else {
                    return;
                }
            } else {
                return;
            }
        }


        Utils.getOutput(command, null, null, args).then((output) => {
            Display.channel.append(output);
            Display.showMessage("Changelist Submitted");
            this.Refresh();
        }).catch((reason) => {
            Display.showError(reason.toString());
        });
    }

    public async Revert(input: Resource | SourceControlResourceGroup): Promise<void> {
        const command = 'revert';
        let file = null;
        let args = null;
        let needRefresh = false;

        let message = "Are you sure you want to revert the changes ";
        if (input instanceof Resource) {
            file = Uri.file(input.uri.fsPath);
            message += "to file " + Path.basename(input.uri.fsPath) + "?";
        } else if (isResourceGroup(input)) {
            const id = input.id;
            if (id.startsWith('default')) {
                args = '-c default //...';
                message += "in the default changelist?";
            } else if (id.startsWith('pending')) {
                const chnum = id.substr(id.indexOf(':') + 1);
                args = '-c ' + chnum + ' //...';
                message += "in the changelist " + chnum + "?";
            } else {
                return;
            }
        } else {
            return;
        }

        const yes = "Revert Changes";
        const pick = await window.showWarningMessage(message, { modal: true }, yes);
        if (pick !== yes) {
            return;
        }

        await Utils.getOutput(command, file, null, args).then((output) => {
            Display.updateEditor();
            Display.channel.append(output);
            needRefresh = true;
        }).catch((reason) => {
            Display.showError(reason.toString());
        });

        // delete changelist after
        if (isResourceGroup(input)) {
            const command = 'change';
            const id = input.id;
            const chnum = id.substr(id.indexOf(':') + 1);
            if (id.startsWith('pending')) {
                args = '-d ' + chnum;

                await Utils.getOutput(command, null, null, args).then((output) => {
                    Display.updateEditor();
                    Display.channel.append(output);
                    needRefresh = true;
                }).catch((reason) => {
                    Display.showError(reason.toString());
                });
            }
        }

        if (needRefresh) {
            this.Refresh();
        }
    }

    public async ShelveOrUnshelve(input: Resource): Promise<void> {
        const file = input.uri;

        if (input.status == Status.SHELVE) {
            let args = '-c ' + input.change + ' -s ' + input.change;
            const command = 'unshelve';
            await Utils.getOutput(command, file, null, args).then((output) => {
                let args = '-d -c ' + input.change;
                const command = 'shelve';
                Utils.getOutput('shelve', file, null, args).then((output) => {
                    Display.updateEditor();
                    Display.channel.append(output);

                    this.Refresh();
                }).catch((reason) => {
                    Display.showError(reason.toString());

                    this.Refresh();
                });
            }).catch((reason) => {
                Display.showError(reason.toString());
            });
        }
        else {
            let args = '-f -c ' + input.change;
            const command = 'shelve';
            await Utils.getOutput(command, file, null, args).then((output) => {
                this.Revert(input);
            }).catch((reason) => {
                Display.showError(reason.toString());
            });
        }
    }

    public async ReopenFile(input: Resource): Promise<void> {
        const loggedin = await Utils.isLoggedIn(this._compatibilityMode);
        if (!loggedin) {
            return;
        }

        //TODO: remove the file current changelist
        let items = [];
        items.push({ id: 'default', label: this._defaultGroup.label, description: '' });
        this._pendingGroups.forEach((value, key) => {
            items.push({ id: key.toString(), label: '#' + key.toString(), description: value.description });
        });

        let _this = this;
        window.showQuickPick(items, { matchOnDescription: true, placeHolder: "Choose a changelist:" }).then(function (selection) {
            if (selection == undefined) {
                Display.showMessage("operation cancelled");
                return;
            }

            const file = Uri.file(input.uri.fsPath);
            const args = '-c ' + selection.id;

            Utils.getOutput('reopen', file, null, args).then((output) => {
                Display.channel.append(output);
                _this.Refresh();
            }).catch((reason) => {
                Display.showError(reason.toString());
            });
        });

    }

    private clean() {
        if (this._defaultGroup) {
            this._defaultGroup.dispose();
            this._defaultGroup = null;
        }

        this._pendingGroups.forEach((value) => value.group.dispose());
        this._pendingGroups.clear();

        this._onDidChange.fire();
    }

    private async syncUpdate(): Promise<void> {
        await Utils.getOutput('sync').then(output => {
            Display.channel.append(output);
            this.Refresh();
        }).catch(reason => {
            Display.showError(reason.toString());
        })
    }

    private async updateInfo(): Promise<void> {
        this._infos = await Utils.processInfo(await Utils.getOutput('info'));
    }

    private async updateStatus(): Promise<void> {
        const loggedin = await Utils.isLoggedIn(this._compatibilityMode);
        if (!loggedin) {
            return;
        }

        let defaults: Resource[] = [];
        let pendings = new Map<number, Resource[]>();
        let shelved = new Map<number, Resource[]>();

        this._defaultGroup = this._sourceControl.createResourceGroup('default', 'Default Changelist');
        this._pendingGroups.clear(); // dispose ?

        const pendingArgs = '-c ' + this._infos.get('Client name') + ' -s pending';
        let output: string = await Utils.getOutput('changes', null, null, pendingArgs);
        let changelists = output.trim().split('\n');

        const config = workspace.getConfiguration('perforce');
        const maxFilePerCommand: number = config.get<number>('maxFilePerCommand');
        if (config.get('changelistOrder') == 'ascending') {
            changelists = changelists.reverse();
        }

        changelists.forEach((value) => {
            // Change num on date by user@client [status] description
            const matches = value.match(/Change\s(\d+)\son\s(.+)\sby\s(.+)@(.+)\s\*(.+)\*\s\'(.+)\'/);

            if (matches) {
                const num = matches[1];
                const date = matches[2];
                const user = matches[3];
                const client = matches[4];
                const status = matches[5];
                const description = matches[6];

                const chnum: number = parseInt(num.toString());

                if (!this._pendingGroups.has(chnum)) {
                    const group = this._sourceControl.createResourceGroup('pending:' + chnum, '#' + chnum + ': ' + description);
                    group.resourceStates = [];
                    this._pendingGroups.set(chnum, { description: description, group: group });
                } else {
                    console.log('ERROR: pending changelist already exist: ' + chnum.toString());
                }

                this.getDepotShelvedFilePaths(chnum).then((value) => {
                    if (!pendings.has(chnum)) {
                        pendings.set(chnum, []);
                    }
                    value.forEach(element => {
                        const resource: Resource = new Resource(Uri.file(element), chnum.toString(), "shelve");
                        pendings.get(chnum).push(resource);
                    });
                });
            }
        });

        const depotOpenedFilePaths = await this.getDepotOpenedFilePaths();
        for (let i = 0; i < depotOpenedFilePaths.length; i += maxFilePerCommand) {
            const fstatInfo = await this.getFstatInfoForFiles(depotOpenedFilePaths.slice(i, i + maxFilePerCommand));

            fstatInfo.forEach(info => {
                const clientFile = info['clientFile'];
                const change = info['change'];
                const action = info['action'];
                const uri = Uri.file(clientFile);
                const resource: Resource = new Resource(uri, change, action);

                if (change.startsWith('default')) {
                    defaults.push(resource);
                } else {
                    let chnum: number = parseInt(change);

                    if (!pendings.has(chnum)) {
                        pendings.set(chnum, []);
                    }
                    pendings.get(chnum).push(resource);
                }
            });
        }

        this._defaultGroup.resourceStates = defaults;

        pendings.forEach((value, key) => {
            const chnum = key.toString();
            if (this._pendingGroups.has(key)) {
                this._pendingGroups.get(key).group.resourceStates = value;
            } else {
                console.log('ERROR: pending changelist not found: ' + key.toString());
            }
        });

        this._onDidChange.fire();
    }

    private async getDepotOpenedFilePaths(): Promise<string[]> {
        const output = await Utils.getOutput('opened');
        const opened = output.trim().split('\n');
        if (opened.length === 0) {
            return;
        }

        const files = [];
        opened.forEach(open => {
            const matches = open.match(/(.+)#(\d+)\s-\s([\w\/]+)\s(default\schange|change\s\d+)\s\(([\w\+]+)\)/);
            if (matches) {
                files.push(matches[1]);
            }
        });

        return files;
    }

    private async getDepotShelvedFilePaths(chnum: number): Promise<string[]> {
        const output = await Utils.getOutput('describe -Ss ' + chnum);
        const shelved = output.trim().split('\n');
        if (shelved.length === 0) {
            return;
        }

        const files = [];
        shelved.forEach(open => {
            const matches = open.match(/(\.+)\ (.*)#(.*)/);
            if (matches) {
                files.push(matches[2]);
            }
        });

        return files;
    }

    private async getFstatInfoForFiles(files: string[]): Promise<any> {
        const fstatOutput: string = await Utils.getOutput(`fstat "${files.join('" "')}"`);
        // Windows will have lines end with \r\n.
        // Each file has multiple lines of output separated by a blank line.
        // Splitting on \n\r?\n will find newlines followed immediately by a newline
        // which will split the output for each file.
        const fstatFiles = fstatOutput.trim().split(/\n\r?\n/);
        return fstatFiles.map((file) => {
            const lines = file.split('\n');
            const lineMap = {};
            lines.forEach(line => {
                // ... Key Value
                const matches = line.match(/[.]{3} (\w+)[ ]*(.+)?/);
                if (matches) {
                    // A key may not have a value (e.g. `isMapped`).
                    // Treat these as flags and map them to 'true'.
                    lineMap[matches[1]] = matches[2] ? matches[2] : 'true';
                }
            });
            return lineMap;
        });
    }
}