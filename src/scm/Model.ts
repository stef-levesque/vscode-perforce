import { scm, Uri, EventEmitter, Event, SourceControl, SourceControlResourceGroup, Disposable, window, commands } from 'vscode';
import { Utils } from '../Utils';
import { Display } from '../Display';
import { Resource } from './Resource';

import * as Path from 'path';

function isResourceGroup(arg: any): arg is SourceControlResourceGroup {
    return arg.id !== undefined;
}


export class Model implements Disposable {
    private _disposables: Disposable[] = [];

    private _onDidChange = new EventEmitter<SourceControlResourceGroup[]>();
    public get onDidChange(): Event<SourceControlResourceGroup[]> {
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
    private _shelvedGroups = new Map<number, { description: string, group: SourceControlResourceGroup }>();

    public get ResourceGroups(): SourceControlResourceGroup[] {
        const result: SourceControlResourceGroup[] = [];

        if (this._defaultGroup)
            result.push(this._defaultGroup);
        
        this._pendingGroups.forEach((value) => {
            result.push(value.group);
        });

        this._shelvedGroups.forEach((value) => {
            result.push(value.group);
        });
        
        return result;
    }

    public constructor() {}

    public async Sync(): Promise<void> {
        const loggedin = await Utils.isLoggedIn();
        if (!loggedin) {
            return;
        }

        window.withScmProgress(() => this.syncUpdate());
    }

    public async Refresh(): Promise<void> {
        this.clean();

        const loggedin = await Utils.isLoggedIn();
        if (!loggedin) {
            return;
        }

        await window.withScmProgress(() => this.updateInfo());
        window.withScmProgress(() => this.updateStatus());
    }

    public async CreateChangelist(): Promise<void> {
        const command = '-ztag change';
        const args = '-i ';
        const desc = scm.inputBox.value.trim();
        scm.inputBox.value = '';
        if (desc.length === 0) {
            return;
        }

        let input = 'Change: new\n';
        input += 'Description: \n';
        input += '\t' + desc.trim().split('\n').join('\n\t');

        Utils.getOutput(command, null, null, args, null, input).then((output) => {
            Display.channel.append(output);
            this.Refresh();
        }).catch((reason) => {
            Display.showError(reason.toString());
        });

    }

    public async Describe(input: SourceControlResourceGroup): Promise<void> {
        const command = 'describe';
        const id = input.id;
        if (id.startsWith('pending')) {
            const args = id.substr(id.indexOf(':') + 1);
            const uri: Uri = new Uri().with({scheme: 'perforce', authority: command, query: args});
            commands.executeCommand<void>("vscode.open", uri);
        }

    }

    public async Submit(input: Resource | SourceControlResourceGroup | string): Promise<void> {
        const command = 'submit';
        let args = '';
        
        const group = input as SourceControlResourceGroup;

        if (group) {
            const id = group.id;
            const chnum = id.substr(id.indexOf(':') + 1);
            if (id.startsWith('pending')) {
                args = '-c ' + chnum;
            } else if (id.startsWith('shelved')) {
                args = '-e ' + chnum;
            } else {
                return;
            }
        } else if (typeof input === 'string') {
            args = '-d ' + input;
        } else {
            return;
        }


        Utils.getOutput(command, null, null, args).then((output) => {
            Display.channel.append(output);
            this.Refresh();
        }).catch( (reason) => {
            Display.showError(reason.toString());
        });
    }

    public async Revert(input: Resource | SourceControlResourceGroup): Promise<void> {
        const command = 'revert';
        let file = null;
        let args = null;
        let needRefresh = false;

        if (input instanceof Resource) {
            file = Uri.file(input.uri.fsPath);
        } else if (isResourceGroup(input)) {
            const id = input.id;
            if (id.startsWith('default')) {
                args = '-c default //...';
            } else if (id.startsWith('pending')) {
                const chnum = id.substr(id.indexOf(':') + 1);
                args = '-c ' + chnum + ' //...';
            } else {
                return;
            }
        } else {
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

    public async ReopenFile(input: Resource): Promise<void> {
        const loggedin = await Utils.isLoggedIn();
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
        }

        this._pendingGroups.forEach((value) => value.group.dispose());
        this._shelvedGroups.forEach((value) => value.group.dispose());
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
        this._infos = await Utils.getZtag('info');

    }

    private async updateStatus(): Promise<void> {

        const loggedin = await Utils.isLoggedIn();
        if (!loggedin) {
            return;
        }

        let defaults: Resource[] = [];
        let pendings = new Map<number, Resource[]>();
        let shelved = new Map<number, Resource[]>();

        this._defaultGroup = this._sourceControl.createResourceGroup('default', 'Default Changelist');
        this._pendingGroups.clear(); // dispose ?
        
        const pendingArgs = '-c ' + this._infos.get('clientName') + ' -s pending';
        var output: string = await Utils.getOutput('changes', null, null, pendingArgs);
        output.trim().split('\n').forEach( (value) => {
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
                    this._pendingGroups.set(chnum, {description: description, group: group});
                } else {
                    console.log('ERROR: pending changelist already exist: ' + chnum.toString() );
                }
                
            }

            const line = value.trim();
            const start = value.indexOf("'");
            const end = value.indexOf("'", start);
            const changelistDesc = line.substring(start, end);
        });
    

        output = await Utils.getOutput('opened');
        var opened = output.trim().split('\n');
        if (opened.length === 0) {
            return;
        }


        for (let i = 0, n = opened.length; i < n; ++i) {
            // depot-file#rev - action chnum change (type) [lock-status]
            const matches = opened[i].match(/(.+)#(\d+)\s-\s([\w\/]+)\s(default\schange|change\s\d+)\s\((\w+)\)/);

            if (matches) {
                const depotFile = matches[1];
                const rev = matches[2];
                const action = matches[3];
                const change = matches[4];
                const type = matches[5];

                const output: string = await Utils.getOutput('fstat', depotFile, null, '-T clientFile');

                if (output.indexOf('... clientFile ') === 0) {
                    const clientFile = output.substring(15, output.indexOf('\n')).trim();
                    const uri = Uri.file(clientFile);
                    const resource: Resource = new Resource(uri, change, action);

                    if (change === 'default change') {
                        defaults.push(resource);
                    } else {
                        let chnum: number = parseInt( change.substr(change.indexOf(' ')).trim() );

                        if (!pendings.has(chnum)) {
                            pendings.set(chnum, []);
                        }
                        pendings.get(chnum).push(resource);
                    }
                }
            }

        }

        this._defaultGroup.resourceStates = defaults;

        pendings.forEach( (value, key) => {
            const chnum = key.toString();
            if (this._pendingGroups.has(key)) {
                this._pendingGroups.get(key).group.resourceStates = value;
            } else {
                console.log('ERROR: pending changelist not found: ' + key.toString());
            }
        });

        this._onDidChange.fire(this.ResourceGroups);

    }
}